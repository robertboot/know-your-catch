/* Models sub-tab — Phase 5.

   Two sub-views:
     - List: every imported model version, most recent first, with
       Promote / Delete actions and per-row status pill for the
       currently-production model.
     - Detail: overall accuracy, per-species accuracy table, confusion
       matrix, lookalike-group breakdown, and a diff panel comparing
       against the previously-production version.

   Uploading a new version: drag the three artifacts (fish_id_model.tflite,
   fish_id_labels.json, fish_id_metrics.json) onto the drop zone. The
   panel parses the two JSONs client-side before insert so obviously
   broken files get caught up front. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../theme.js';
import { SPECIES } from '../data.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, H1, inputStyle,
} from '../components.jsx';
import {
  importModelVersion, listModelVersions, promoteModelVersion,
  deleteModelVersion, getModelVersion, publishPromotedModel,
} from '../model-store.js';
import {
  listPendingBundles, downloadPendingBundle, markBundleImported,
} from '../training-exports-store.js';
import { LOOKALIKE_GROUP_SEEDS } from '../training-store.js';

export default function ModelsPanel({ onOpenTestTool }) {
  const [view, setView] = useState('list'); // 'list' | 'detail' | 'upload'
  const [detailId, setDetailId] = useState(null);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {view === 'list' && (
        <ModelsList
          onUpload={() => setView('upload')}
          onOpen={(id) => { setDetailId(id); setView('detail'); }}
          onOpenTestTool={onOpenTestTool}
        />
      )}
      {view === 'upload' && <UploadArtifactsPanel onDone={() => setView('list')} />}
      {view === 'detail' && detailId && (
        <ModelDetail
          id={detailId}
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
}

function ModelsList({ onUpload, onOpen, onOpenTestTool }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Separate from `error` on purpose. A publish warning is not a
  // hard error — the DB promote succeeded, is_production is set,
  // the admin sees the row highlighted as production. But the
  // public bucket the mobile app polls still has the old .tflite,
  // which means the device won't see the promoted version until
  // Republish succeeds. This state persists across refresh() so
  // the admin can't clear it by re-loading — only a successful
  // Republish (or another Promote) drains it.
  const [publishWarning, setPublishWarning] = useState('');
  const [pending, setPending] = useState([]);
  const [importing, setImporting] = useState(null); // storagePath being imported

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, p] = await Promise.all([listModelVersions(), listPendingBundles()]);
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    setError('');
    setRows(r.rows);
    if (p.ok) setPending(p.rows);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const importFromCloud = async (pendingRow) => {
    setImporting(pendingRow.path);
    setError('');
    try {
      const dl = await downloadPendingBundle(pendingRow.path);
      if (!dl.ok) throw new Error(dl.error || 'download failed');
      // Extract the bundle client-side (same path the drop-zone uses).
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(dl.blob);
      let tfliteFile = null, labels = null, metrics = null;
      for (const entryName of Object.keys(zip.files)) {
        const entry = zip.files[entryName];
        if (entry.dir) continue;
        const base = entryName.split('/').pop();
        if (base.endsWith('.tflite')) {
          const blob = await entry.async('blob');
          tfliteFile = new File([blob], base, { type: 'application/octet-stream' });
        } else if (base === 'fish_id_labels.json') {
          labels = JSON.parse(await entry.async('text'));
        } else if (base === 'fish_id_metrics.json') {
          metrics = JSON.parse(await entry.async('text'));
        }
      }
      if (!tfliteFile || !labels || !metrics) throw new Error('bundle missing files');
      const defaultName = `Big Red ${rows.length + 1}.0`;
      const versionName = (window.prompt(
        'Name this model version:', defaultName,
      ) || defaultName).trim();
      if (!versionName) { setImporting(null); return; }
      const r = await importModelVersion({
        versionName, tfliteFile, labels, metrics,
        notes: `Auto-imported from Colab · ${pendingRow.path}`,
      });
      if (!r.ok) throw new Error(r.error || 'import failed');
      // Move the bundle out of pending/ so it stops showing up in the
      // Pending Bundles card on every refresh. Historical bug: the
      // move was awaited but not checked, so an RLS mismatch or
      // storage-move race silently re-shipped the SAME bundle over and
      // over — the admin thought "Import" was failing and would click
      // it repeatedly, ending up with four identical Big Red X.0 rows.
      // Now: surface the move failure as a warning so the admin knows
      // the DB import succeeded but the bundle is still in pending/.
      const mv = await markBundleImported(pendingRow.path);
      if (!mv.ok) {
        // Non-fatal — the model version imported fine, but the source
        // bundle wasn't moved. Report so the admin can manually delete
        // it from Storage instead of re-importing until they get four
        // duplicate rows.
        setError(
          `Model imported as ${versionName}, but couldn't move the ` +
          `Colab bundle out of pending/: ${mv.error || 'unknown'}. ` +
          `Delete it from Supabase Storage → model-artifacts → pending/ ` +
          `manually, otherwise it'll keep showing up on Refresh.`
        );
      }
      refresh();
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setImporting(null);
    }
  };

  const promote = async (id) => {
    if (!window.confirm('Promote this model to production? The currently-production version (if any) will be demoted.')) return;
    setError('');
    setPublishWarning('');
    const r = await promoteModelVersion(id);
    if (!r.ok) { setError(r.error || 'promote failed'); return; }
    // DB promote succeeded. The publish step (copy .tflite + manifest
    // into the public bucket the mobile app polls) may have failed —
    // if so surface it as a distinct warning so the admin knows the
    // mobile app is still on the OLD model. Refreshing the list won't
    // clear this — only a successful Republish will.
    if (r.publishWarning) {
      setPublishWarning(
        `Promoted, but publish to the mobile bucket failed: ${r.publishWarning}. ` +
        `Click Republish above to retry — until then, mobile apps are still on the previous model.`
      );
    }
    refresh();
  };

  const republish = async () => {
    setError('');
    const r = await publishPromotedModel();
    if (!r.ok) { setError(r.error || 'republish failed'); return; }
    setPublishWarning('');
    alert('Model republished to public bucket. Mobile app will pick it up on next launch or Check for updates.');
  };

  const del = async (id, path) => {
    if (!window.confirm('Delete this model version? Cannot be undone.')) return;
    const r = await deleteModelVersion(id, path);
    if (!r.ok) { setError(r.error || 'delete failed'); return; }
    refresh();
  };

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel>Model versions</SectionLabel>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 3 }}>
            {rows.length} imported · {rows.filter(r => r.is_production).length ? 'one in production' : 'no production model yet'}
          </div>
        </div>
        {onOpenTestTool && (
          <GhostButton onClick={onOpenTestTool} style={{ padding: '8px 12px', fontSize: 12 }}>Test image →</GhostButton>
        )}
        <GhostButton onClick={refresh} disabled={loading} style={{ padding: '8px 12px', fontSize: 12 }}>
          {loading ? 'Loading…' : 'Refresh'}
        </GhostButton>
        <PrimaryButton onClick={onUpload} style={{ padding: '10px 16px' }}>
          Upload artifacts
        </PrimaryButton>
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {publishWarning && (
        <div role="alert" style={{
          padding: 10, borderRadius: 8, fontSize: 12,
          background: 'rgba(255,200,87,0.14)', color: T.warn,
          border: `1px solid ${T.warn}`,
          lineHeight: 1.5,
        }}>
          <strong>Publish incomplete</strong> — {publishWarning}
        </div>
      )}

      {pending.length > 0 && (
        <Card style={{ borderColor: T.brass }}>
          <SectionLabel style={{ marginBottom: 6 }}>Pending bundles (from Colab)</SectionLabel>
          <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
            Colab-uploaded bundles that haven't been imported yet. Click Import to ingest and stage the version below — you can still promote / delete it after.
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {pending.map(pb => {
              const when = pb.created_at ? new Date(pb.created_at).toLocaleString() : '—';
              const sizeKb = pb.metadata?.size ? `${(pb.metadata.size / 1024).toFixed(0)} KB` : '';
              const busy = importing === pb.path;
              return (
                <div key={pb.path} style={{
                  display: 'flex', flexDirection: 'column', gap: 10,
                  padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${T.cardEdge}`,
                }}>
                  <div>
                    <div style={{ fontSize: 13, color: T.ink, fontWeight: 800 }}>{when}</div>
                    <div style={{
                      fontSize: 10, color: T.inkMute, fontFamily: 'monospace',
                      marginTop: 3, overflowWrap: 'anywhere',
                    }}>
                      {pb.path}{sizeKb ? ` · ${sizeKb}` : ''}
                    </div>
                  </div>
                  <PrimaryButton
                    onClick={() => importFromCloud(pb)}
                    disabled={busy || !!importing}
                    style={{ padding: '10px 14px', fontSize: 13, width: '100%' }}
                  >
                    {busy ? 'Importing…' : 'Import'}
                  </PrimaryButton>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {rows.length === 0 && !loading && (
        <Card style={{ padding: 20, textAlign: 'center', color: T.inkMute, fontSize: 13 }}>
          No model versions yet. Train a model via the Colab notebook (Phase 4), then upload the three artifacts here.
        </Card>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(r => {
          const m = r.metrics_json || {};
          const overall = m.overall_accuracy != null ? `${(m.overall_accuracy * 100).toFixed(1)}%` : '—';
          const species = Array.isArray(r.labels_json?.labels) ? r.labels_json.labels.length : 0;
          return (
            <Card
              key={r.id}
              onClick={() => onOpen(r.id)}
              style={{
                padding: 12, cursor: 'pointer',
                border: `${r.is_production ? '2' : '1'}px solid ${r.is_production ? T.brass : T.cardEdge}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.version_name}
                    {r.is_production && (
                      <span style={{
                        fontSize: 9, letterSpacing: 1, fontWeight: 800,
                        background: T.brass, color: T.oceanDeep,
                        padding: '2px 7px', borderRadius: 999,
                      }}>PRODUCTION</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: T.inkMute, marginTop: 3 }}>
                    Imported {new Date(r.imported_at).toLocaleString()} by {r.imported_by || 'unknown'}
                    {r.trained_at ? ` · trained ${new Date(r.trained_at).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12, color: T.inkSoft }}>
                  <div><strong style={{ color: T.ink }}>{overall}</strong> val acc</div>
                  <div style={{ fontSize: 10, color: T.inkMute }}>{species} species</div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginLeft: 8 }} onClick={e => e.stopPropagation()}>
                  {!r.is_production && (
                    <GhostButton onClick={() => promote(r.id)} style={{ padding: '6px 10px', fontSize: 11, color: T.open, borderColor: T.open }}>
                      Promote
                    </GhostButton>
                  )}
                  {r.is_production && (
                    <GhostButton onClick={() => republish()} style={{ padding: '6px 10px', fontSize: 11, color: T.brass, borderColor: T.brass }}
                      title="Copy this model to the public bucket so the mobile app can fetch it.">
                      Republish
                    </GhostButton>
                  )}
                  <GhostButton onClick={() => del(r.id, r.model_file_path)} style={{ padding: '6px 10px', fontSize: 11, color: T.closed, borderColor: T.closed }}>
                    Delete
                  </GhostButton>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function UploadArtifactsPanel({ onDone }) {
  const [versionName, setVersionName] = useState(
    `v0.1-${new Date().toISOString().slice(0, 10)}`
  );
  const [notes, setNotes] = useState('');
  const [tfliteFile, setTfliteFile] = useState(null);
  const [labels, setLabels] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [parseError, setParseError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const applyEntry = async ({ name, blob, textFn }) => {
    if (name.endsWith('.tflite')) {
      const file = blob instanceof File
        ? blob
        : new File([blob], name, { type: 'application/octet-stream' });
      setTfliteFile(file);
    } else if (name === 'fish_id_labels.json') {
      try { setLabels(JSON.parse(await textFn())); }
      catch (e) { setParseError(`labels.json parse: ${e.message}`); }
    } else if (name === 'fish_id_metrics.json') {
      try { setMetrics(JSON.parse(await textFn())); }
      catch (e) { setParseError(`metrics.json parse: ${e.message}`); }
    }
  };

  const handleFiles = async (fileList) => {
    setParseError(''); setError('');
    for (const f of Array.from(fileList || [])) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        // Colab hands artifacts back as a single ZIP. Expand it and
        // treat each entry as if the user had dropped it directly.
        try {
          const { default: JSZip } = await import('jszip');
          const zip = await JSZip.loadAsync(f);
          for (const entryName of Object.keys(zip.files)) {
            const entry = zip.files[entryName];
            if (entry.dir) continue;
            const base = entryName.split('/').pop();
            const blob = await entry.async('blob');
            await applyEntry({ name: base, blob, textFn: () => blob.text() });
          }
        } catch (e) {
          setParseError(`Could not read ${f.name}: ${e.message}`);
        }
      } else {
        await applyEntry({ name: f.name, blob: f, textFn: () => f.text() });
      }
    }
  };

  const save = async () => {
    setError('');
    if (!versionName.trim()) { setError('Give the version a name.'); return; }
    if (!tfliteFile) { setError('Missing fish_id_model.tflite.'); return; }
    if (!labels) { setError('Missing / unparseable fish_id_labels.json.'); return; }
    if (!metrics) { setError('Missing / unparseable fish_id_metrics.json.'); return; }
    setSaving(true);
    const r = await importModelVersion({
      versionName: versionName.trim(),
      tfliteFile,
      labels,
      metrics,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!r.ok) { setError(r.error || 'import failed'); return; }
    onDone();
  };

  const ready = !!tfliteFile && !!labels && !!metrics && !parseError;

  return (
    <>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <SectionLabel style={{ flex: 1 }}>Import model artifacts</SectionLabel>
          <GhostButton onClick={onDone}>← Back</GhostButton>
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
          Drop the <code>fish_id_artifacts.zip</code> from Colab (or the three files individually). The .tflite goes to storage; the two JSONs are parsed inline and stored on the row.
        </div>

        <Card
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${ready ? T.open : T.brass}`,
            textAlign: 'center', padding: 24, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}>
            Drop artifacts (or click to pick)
          </div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>
            fish_id_artifacts.zip · or fish_id_model.tflite + fish_id_labels.json + fish_id_metrics.json
          </div>
          <input
            ref={inputRef} type="file" multiple accept=".tflite,.json,.zip,application/json,application/zip,application/octet-stream" hidden
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
          />
        </Card>

        <div style={{ display: 'grid', gap: 4, marginTop: 10, fontSize: 12 }}>
          <FileState label="fish_id_model.tflite" f={tfliteFile} />
          <FileState label="fish_id_labels.json" f={labels}    ok={!!labels}   summary={labels && `${labels.labels?.length || 0} labels · min=${labels.min_confidence} high=${labels.high_confidence}`} />
          <FileState label="fish_id_metrics.json" f={metrics} ok={!!metrics}  summary={metrics && `overall ${(metrics.overall_accuracy * 100).toFixed(1)}% · ${metrics.confusion_labels?.length || 0} labels`} />
        </div>
        {parseError && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.closed }}>{parseError}</div>}
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Version name</SectionLabel>
        <input type="text" value={versionName} onChange={e => setVersionName(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>
          Recommend the pattern <code>v0.1-YYYY-MM-DD</code>.
        </div>
        <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Notes (optional)</SectionLabel>
        <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} placeholder="What changed in this run — dataset size, hyperparams, notable failure modes…" />
      </Card>

      {error && <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onDone} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={!ready || saving} style={{ flex: 1 }}>
          {saving ? 'Uploading…' : 'Import version'}
        </PrimaryButton>
      </div>
    </>
  );
}

function FileState({ label, f, ok, summary }) {
  const present = !!f;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: 4,
        background: (ok || present) ? T.open : T.inkMute,
      }} />
      <span style={{ color: T.ink }}>{label}</span>
      {summary && <span style={{ color: T.inkMute, fontSize: 11 }}>· {summary}</span>}
      {!summary && present && f?.size && <span style={{ color: T.inkMute, fontSize: 11 }}>· {(f.size / 1024).toFixed(0)} KB</span>}
    </div>
  );
}

/* ============================================================
   Detail view — overall + per-species + confusion + lookalike
   ============================================================ */
function ModelDetail({ id, onBack }) {
  const [row, setRow] = useState(null);
  const [prev, setPrev] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getModelVersion(id);
      if (!alive) return;
      if (r.ok) setRow(r.row);
      const list = await listModelVersions();
      if (!alive) return;
      // Find the version imported immediately before this one — that's
      // the natural diff target.
      if (list.ok) {
        const sorted = list.rows.slice().sort((a, b) =>
          a.imported_at < b.imported_at ? -1 : 1
        );
        const idx = sorted.findIndex(x => x.id === id);
        if (idx > 0) setPrev(sorted[idx - 1]);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading || !row) {
    return <Card style={{ textAlign: 'center', color: T.inkMute, padding: 30 }}>{loading ? 'Loading…' : 'Not found.'}</Card>;
  }

  const m = row.metrics_json || {};
  const labels = m.confusion_labels || row.labels_json?.labels || [];
  const cm = m.confusion_matrix || [];
  const perSpecies = m.per_species || {};
  const overall = m.overall_accuracy;
  const lookalikeBreakdown = m.lookalike_group_confusion || [];

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <H1 size={18} style={{ marginBottom: 4 }}>{row.version_name}</H1>
          <div style={{ fontSize: 11, color: T.inkMute }}>
            Imported {new Date(row.imported_at).toLocaleString()} · {labels.length} labels
            {row.notes && ` · ${row.notes}`}
          </div>
        </div>
        {row.is_production && (
          <span style={{
            fontSize: 10, letterSpacing: 1, fontWeight: 800,
            background: T.brass, color: T.oceanDeep,
            padding: '3px 8px', borderRadius: 999,
          }}>PRODUCTION</span>
        )}
        <GhostButton onClick={onBack}>← Back</GhostButton>
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Overall accuracy</SectionLabel>
        <div style={{ fontSize: 30, fontWeight: 900, color: T.ink }}>
          {overall != null ? `${(overall * 100).toFixed(1)}%` : '—'}
          {prev?.metrics_json?.overall_accuracy != null && (
            <span style={{ fontSize: 14, color: T.inkMute, marginLeft: 12, fontWeight: 400 }}>
              vs. {(prev.metrics_json.overall_accuracy * 100).toFixed(1)}% ({row.metrics_json.overall_accuracy > prev.metrics_json.overall_accuracy ? '+' : ''}{((row.metrics_json.overall_accuracy - prev.metrics_json.overall_accuracy) * 100).toFixed(1)} pts)
            </span>
          )}
        </div>
      </Card>

      <LookalikeBreakdownCard breakdown={lookalikeBreakdown} />

      <PerSpeciesCard perSpecies={perSpecies} labels={labels} />

      <ConfusionMatrixCard cm={cm} labels={labels} />
    </>
  );
}

function LookalikeBreakdownCard({ breakdown }) {
  if (!breakdown || breakdown.length === 0) {
    return (
      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Lookalike groups</SectionLabel>
        <div style={{ fontSize: 12, color: T.inkMute }}>No breakdown in this version's metrics (older run?).</div>
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: T.brass }}>
      <SectionLabel style={{ marginBottom: 6 }}>Lookalike groups (pass/fail metric)</SectionLabel>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
        Per-group confusion. A member with accuracy noticeably below its peers is where the classifier is confusing that species with the group's other members. Rule of thumb: if any group's weakest member is &lt; 60%, do NOT promote to production.
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {breakdown.map((g, i) => (
          <LookalikeGroupCard key={i} group={g} />
        ))}
      </div>
    </Card>
  );
}

function LookalikeGroupCard({ group }) {
  const min = Math.min(...group.accuracy.filter(v => v != null));
  const warn = min < 0.6;
  return (
    <div style={{
      padding: 10, borderRadius: 8,
      background: warn ? T.warnBg : T.parchmentDeep,
      border: `1px solid ${warn ? T.warn : T.cardEdge}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
        {group.members.map(id => SPECIES.find(s => s.id === id)?.commonName || id).join(' · ')}
      </div>
      <div style={{ display: 'grid', gap: 3 }}>
        {group.members.map((id, i) => {
          const acc = group.accuracy[i];
          const support = group.support[i];
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: T.inkSoft, width: 160 }}>
                {SPECIES.find(s => s.id === id)?.commonName || id}
              </div>
              <div style={{ flex: 1, height: 6, background: T.card, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(acc || 0) * 100}%`,
                  background: acc == null ? T.inkMute : acc >= 0.8 ? T.open : acc >= 0.6 ? T.warn : T.closed,
                }} />
              </div>
              <div style={{ fontSize: 11, color: T.ink, width: 55, textAlign: 'right' }}>
                {acc != null ? `${(acc * 100).toFixed(0)}%` : '—'}
              </div>
              <div style={{ fontSize: 10, color: T.inkMute, width: 40, textAlign: 'right' }}>
                n={support}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerSpeciesCard({ perSpecies, labels }) {
  const rows = labels.map(l => ({
    label: l,
    ...(perSpecies[l] || { support: 0, correct: 0, accuracy: null }),
  })).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)); // weakest first

  return (
    <Card>
      <SectionLabel style={{ marginBottom: 8 }}>Per-species (weakest first)</SectionLabel>
      <div style={{ display: 'grid', gap: 4, maxHeight: 380, overflowY: 'auto' }}>
        {rows.map(r => {
          const sp = SPECIES.find(s => s.id === r.label);
          const color = r.accuracy == null ? T.inkMute
            : r.accuracy >= 0.8 ? T.open
            : r.accuracy >= 0.6 ? T.warn
            : T.closed;
          return (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', borderBottom: `1px dashed ${T.cardEdge}` }}>
              <div style={{ fontSize: 12, color: T.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {sp?.commonName || r.label}
              </div>
              <div style={{ width: 120, height: 5, background: T.parchmentDeep, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(r.accuracy || 0) * 100}%`, background: color }} />
              </div>
              <div style={{ fontSize: 11, color, width: 46, textAlign: 'right', fontWeight: 700 }}>
                {r.accuracy != null ? `${(r.accuracy * 100).toFixed(0)}%` : '—'}
              </div>
              <div style={{ fontSize: 10, color: T.inkMute, width: 46, textAlign: 'right' }}>
                {r.correct}/{r.support}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ConfusionMatrixCard({ cm, labels }) {
  if (!cm.length) return null;
  const N = labels.length;
  const cellSize = Math.max(6, Math.min(20, 640 / N));
  const maxNonDiag = useMemo(() => {
    let max = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j && cm[i][j] > max) max = cm[i][j];
    return max || 1;
  }, [cm, N]);

  return (
    <Card>
      <SectionLabel style={{ marginBottom: 6 }}>Confusion matrix</SectionLabel>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 8, lineHeight: 1.5 }}>
        Rows = true label; columns = predicted. Diagonal = correct. Off-diagonal brightness scales to the largest confusion cell in the matrix — bright cells outside the diagonal are the problem pairs.
      </div>
      <div style={{ overflow: 'auto', maxWidth: '100%' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${N}, ${cellSize}px)`,
          gap: 1, width: 'max-content',
        }}>
          {cm.map((row, i) => row.map((v, j) => {
            const isDiag = i === j;
            const rowSum = row.reduce((a, b) => a + b, 0);
            const shade = isDiag
              ? (rowSum ? v / rowSum : 0)
              : (v / maxNonDiag) * 0.85;
            const bg = isDiag
              ? `rgba(50, 209, 123, ${0.15 + shade * 0.85})`
              : v === 0
                ? T.parchmentDeep
                : `rgba(255, 77, 77, ${0.15 + shade * 0.85})`;
            return (
              <div key={`${i}-${j}`}
                title={`${labels[i]} → ${labels[j]}: ${v}`}
                style={{
                  width: cellSize, height: cellSize,
                  background: bg,
                  cursor: 'help',
                }}
              />
            );
          }))}
        </div>
      </div>
    </Card>
  );
}
