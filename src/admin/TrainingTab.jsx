/* Training Data admin tab — Phase 1.

   Sub-nav: Upload | Review. (Coverage lands in Phase 2.)

   Upload:
     - Batch mode: pick species first, drop N files, all get that species.
     - Per-image mode: drop N files, assign species per row before submit.

   Review:
     - Species-scoped grid of training images.
     - Keyboard shortcuts:
         A = Approve (verified)
         R = Reject → reason picker
         C = Correct species
         D = Duplicate (rejected + reason=duplicate)
         ← / → = navigate images
         ⌘/Ctrl+A = select all
     - Bulk actions on selected: Approve / Reject / Correct.

   Crop tool is deferred per spec — export step (Phase 3) will use the
   full image when crop_bbox is null. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { T } from '../theme.js';
import { SPECIES } from '../data.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, H1,
  inputStyle,
} from '../components.jsx';
import {
  uploadTrainingImage, listTrainingImages,
  approve, reject, correctSpecies, deleteTrainingImage,
  signedUrl, countsBySpecies,
  MIN_TRAIN_THRESHOLD, ADEQUATE_THRESHOLD, TARGET_COVERAGE,
  buildLookalikeGroups, classifyCoverage,
  planExport,
} from '../training-store.js';
import {
  uploadExport, listExports, getExportSignedUrl, deleteExport,
  modelBundleUploadUrl,
} from '../training-exports-store.js';
import { CATEGORIES } from '../data.js';
import ModelsPanel from './ModelsPanel.jsx';
import TestImagePanel from './TestImagePanel.jsx';
import { SpeciesPickerModal, ModalShell } from './pickers.jsx';

const REJECT_REASONS = [
  { key: 'blurry',    label: 'Blurry / low quality' },
  { key: 'multiple',  label: 'Multiple fish' },
  { key: 'not_fish',  label: 'Not a fish' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'other',     label: 'Other' },
];

/* Bucket the failing upload rows into a single header banner so the
   diagnosis is one glance, not per-row detective work. Returns
   { kind, title, body } or null. Per-row inline errors still render
   regardless — this is a summary, not a replacement. */
function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function classifyUploadErrors(errorRows) {
  if (!errorRows || errorRows.length === 0) return null;
  const messages = errorRows.map(r => (r.error || '').toLowerCase());
  const codes    = errorRows.map(r => (r.code  || '').toLowerCase());
  const stati    = errorRows.map(r => r.statusCode).filter(Boolean);

  const quotaHit =
    stati.includes(413) ||
    messages.some(m =>
      m.includes('exceeded') || m.includes('quota') ||
      m.includes('payload too large') ||
      m.includes('storage limit') || m.includes('storage full') ||
      m.includes('resource exhausted'));
  if (quotaHit) {
    return {
      kind: 'quota',
      title: `Storage full — ${errorRows.length} upload${errorRows.length === 1 ? '' : 's'} rejected.`,
      body: 'The Supabase storage bucket has hit its size limit. Upgrade your Supabase plan, or delete rejected photos in Review to reclaim space, then retry.',
    };
  }

  const rlsHit =
    stati.includes(403) || stati.includes(401) ||
    codes.includes('42501') || // pg permission denied
    messages.some(m =>
      m.includes('row-level security') || m.includes('row level security') ||
      m.includes('rls') ||
      m.includes('permission denied') || m.includes('not authorized') ||
      m.includes('violates policy') || m.includes('new row violates'));
  if (rlsHit) {
    return {
      kind: 'rls',
      title: `Permission denied — ${errorRows.length} upload${errorRows.length === 1 ? '' : 's'} blocked.`,
      body: 'Row-level security is rejecting the write. Check that you\'re signed in as the admin allowlist email and that the training-photos bucket + training_images RLS policies permit INSERT for your role.',
    };
  }

  // Fallback: surface the unique error messages so nothing is opaque.
  const unique = Array.from(new Set(errorRows.map(r => r.error).filter(Boolean))).slice(0, 3);
  return {
    kind: 'other',
    title: `${errorRows.length} upload${errorRows.length === 1 ? '' : 's'} failed.`,
    body: unique.length
      ? `Errors: ${unique.join(' · ')}. Open the browser console for full details.`
      : 'Open the browser console for full details.',
  };
}

/* ============================================================
   Top-level TrainingTab
   ============================================================ */
export default function TrainingTab() {
  const [panel, setPanel] = useState('upload'); // 'upload' | 'review' | 'coverage'
  // Coverage → Upload jump: when set, UploadPanel preselects this
  // species in Batch mode. Cleared once consumed so navigating back
  // doesn't re-force the picker.
  const [pendingUploadSpecies, setPendingUploadSpecies] = useState(null);

  const jumpToUpload = (speciesId) => {
    setPendingUploadSpecies(speciesId);
    setPanel('upload');
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.cardEdge}` }}>
        <SubTabBtn active={panel === 'upload'} onClick={() => setPanel('upload')}>Upload</SubTabBtn>
        <SubTabBtn active={panel === 'review'} onClick={() => setPanel('review')}>Review</SubTabBtn>
        <SubTabBtn active={panel === 'coverage'} onClick={() => setPanel('coverage')}>Coverage</SubTabBtn>
        <SubTabBtn active={panel === 'export'} onClick={() => setPanel('export')}>Export</SubTabBtn>
        <SubTabBtn active={panel === 'models'} onClick={() => setPanel('models')}>Models</SubTabBtn>
        <SubTabBtn active={panel === 'test'} onClick={() => setPanel('test')}>Test image</SubTabBtn>
      </div>
      {panel === 'upload' && (
        <UploadPanel
          initialSpeciesId={pendingUploadSpecies}
          onConsumeInitial={() => setPendingUploadSpecies(null)}
        />
      )}
      {panel === 'review' && <ReviewPanel />}
      {panel === 'coverage' && <CoveragePanel onUploadSpecies={jumpToUpload} />}
      {panel === 'export' && <ExportPanel />}
      {panel === 'models' && <ModelsPanel onOpenTestTool={() => setPanel('test')} />}
      {panel === 'test' && <TestImagePanel />}
    </div>
  );
}

function SubTabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', padding: '10px 14px',
      color: active ? T.brass : T.inkMute,
      fontWeight: 700, fontSize: 13, cursor: 'pointer',
      borderBottom: `2px solid ${active ? T.brass : 'transparent'}`,
      marginBottom: -1,
    }}>{children}</button>
  );
}

/* ============================================================
   Upload panel
   ============================================================ */
function UploadPanel({ initialSpeciesId = null, onConsumeInitial }) {
  const [mode, setMode] = useState('batch'); // 'batch' | 'per-image'
  const [batchSpeciesId, setBatchSpeciesId] = useState(
    initialSpeciesId || SPECIES[0]?.id || ''
  );
  const [queue, setQueue] = useState([]); // [{ file, id, speciesId, status, error, path }]
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const speciesOptions = useMemo(
    () => [...SPECIES].filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

  // Coverage → Upload jump: force batch mode with the target species
  // pre-selected. Consume the intent so the panel doesn't override
  // manual dropdown changes on future visits.
  useEffect(() => {
    if (!initialSpeciesId) return;
    setMode('batch');
    setBatchSpeciesId(initialSpeciesId);
    onConsumeInitial?.();
  }, [initialSpeciesId, onConsumeInitial]);

  const addFiles = (files) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    const rows = arr.map(f => ({
      file: f,
      id: crypto.randomUUID(),
      speciesId: mode === 'batch' ? batchSpeciesId : '',
      status: 'queued',
      error: null,
      path: null,
    }));
    console.log('[training upload] queued', rows.length, 'files',
      { mode, batchSpeciesId, firstFile: rows[0]?.file?.name });
    setQueue(q => [...q, ...rows]);
  };

  // When switching to batch mode (or changing the batch species) with
  // queued rows already present, retroactively tag every queued row
  // that has no species set. That way switching modes doesn't leave a
  // queue full of orphans that can't be uploaded.
  useEffect(() => {
    if (mode !== 'batch' || !batchSpeciesId) return;
    setQueue(q => q.map(r =>
      r.status === 'queued' && !r.speciesId
        ? { ...r, speciesId: batchSpeciesId }
        : r
    ));
  }, [mode, batchSpeciesId]);

  const onPick = (e) => { addFiles(e.target.files); e.target.value = ''; };
  const onDrop = (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  const uploadAll = async () => {
    if (uploading) return;
    const readyRows = queue.filter(r => r.status === 'queued' && r.speciesId);
    if (readyRows.length === 0) return;
    setUploading(true);
    // Sequential to keep the UI reactive + avoid RLS thrash.
    for (const row of readyRows) {
      setQueue(q => q.map(r => r.id === row.id ? { ...r, status: 'uploading' } : r));
      const res = await uploadTrainingImage(row.file, row.speciesId);
      setQueue(q => q.map(r => r.id === row.id
        ? { ...r,
            status: res.ok ? 'done' : 'error',
            error:  res.ok ? null    : res.error,
            stage:      res.ok ? null : res.stage,
            statusCode: res.ok ? null : (res.statusCode || null),
            code:       res.ok ? null : (res.code       || null),
            path:   res.ok ? res.storagePath : null }
        : r));
    }
    setUploading(false);
  };

  const clearDone = () => setQueue(q => q.filter(r => r.status !== 'done'));

  const setRowSpecies = (rowId, sid) => {
    setQueue(q => q.map(r => r.id === rowId ? { ...r, speciesId: sid } : r));
  };
  const removeRow = (rowId) => setQueue(q => q.filter(r => r.id !== rowId));

  const readyCount = queue.filter(r => r.status === 'queued' && r.speciesId).length;
  const doneCount  = queue.filter(r => r.status === 'done').length;
  const errorRows  = queue.filter(r => r.status === 'error');
  const errorCount = errorRows.length;

  // Classify errors into a header banner category. First match wins;
  // any unmatched errors still show inline on their row so nothing is
  // silently swallowed.
  const banner = classifyUploadErrors(errorRows);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 8 }}>Mode</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <ModeBtn active={mode === 'batch'} onClick={() => setMode('batch')}>Batch (one species)</ModeBtn>
          <ModeBtn active={mode === 'per-image'} onClick={() => setMode('per-image')}>Per-image</ModeBtn>
        </div>
        {mode === 'batch' && (
          <div style={{ marginTop: 10 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Species for this batch</SectionLabel>
            <select value={batchSpeciesId} onChange={e => setBatchSpeciesId(e.target.value)} style={inputStyle}>
              {speciesOptions.map(s => (
                <option key={s.id} value={s.id}>{s.commonName} — {s.id}</option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {/* Drop zone */}
      <Card
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${T.brass}`,
          textAlign: 'center', padding: 24,
          cursor: 'pointer',
        }}
        onClick={() => inputRef.current?.click()}
      >
        <div style={{ fontSize: 15, color: T.ink, fontWeight: 700 }}>
          Drop photos here, or click to pick files
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6 }}>
          JPG or PNG. Multiple files supported. Photos stay private — admin only.
        </div>
        <input
          ref={inputRef} type="file" accept="image/*" multiple hidden
          onChange={onPick}
        />
      </Card>

      {banner && (
        <div role="alert" style={{
          padding: '12px 14px', borderRadius: 8,
          background: banner.kind === 'quota' ? T.warnBg : T.closedBg,
          color: banner.kind === 'quota' ? T.brassDeep : T.closed,
          border: `1.5px solid ${banner.kind === 'quota' ? T.warn : T.closed}`,
          fontSize: 13, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>{banner.title}</div>
          <div>{banner.body}</div>
        </div>
      )}

      {queue.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <SectionLabel style={{ flex: 1 }}>Queue ({queue.length})</SectionLabel>
            {doneCount > 0 && (
              <GhostButton onClick={clearDone} style={{ fontSize: 12, padding: '6px 10px' }}>Clear done</GhostButton>
            )}
            <PrimaryButton
              onClick={uploadAll}
              disabled={uploading || readyCount === 0}
              style={{ fontSize: 12, padding: '8px 14px', width: 'auto', flexShrink: 0 }}
            >
              {uploading ? 'Uploading…' : `Upload ${readyCount} file${readyCount === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>

          {/* Why is Upload disabled? Explicit hint so it's not a
              silent dead-end. */}
          {!uploading && readyCount === 0 && queue.some(r => r.status === 'queued') && (
            <div style={{
              marginBottom: 10, padding: '8px 10px', borderRadius: 6,
              background: T.warnBg, color: T.brassDeep, fontSize: 12,
              border: `1px solid ${T.warn}`,
            }}>
              {mode === 'batch'
                ? 'Pick a batch species above — queued rows will inherit it.'
                : 'Pick a species on each queued row before uploading.'}
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            {queue.map(row => (
              <UploadRow
                key={row.id}
                row={row}
                mode={mode}
                speciesOptions={speciesOptions}
                onSpeciesChange={(sid) => setRowSpecies(row.id, sid)}
                onRemove={() => removeRow(row.id)}
              />
            ))}
          </div>

          {(errorCount > 0 || doneCount > 0) && (
            <div style={{ marginTop: 10, fontSize: 11, color: T.inkMute }}>
              {doneCount} uploaded · {errorCount} failed
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ModeBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? T.brass : 'transparent',
      color: active ? T.oceanDeep : T.ink,
      border: `1px solid ${active ? T.brass : T.cardEdge}`,
      padding: '8px 14px', borderRadius: 8,
      fontSize: 13, fontWeight: 700, cursor: 'pointer',
    }}>{children}</button>
  );
}

function UploadRow({ row, mode, speciesOptions, onSpeciesChange, onRemove }) {
  // No preview thumbnail. Prior tries (blob URL + FileReader) both
  // fell over at scale — Safari rejects blob-scheme URLs for many
  // dropped Files, and running 62 FileReaders in parallel OOMs. The
  // filename + size + type is enough for review; uploads never
  // needed the preview to succeed.

  const statusColor =
    row.status === 'done'      ? T.open :
    row.status === 'error'     ? T.closed :
    row.status === 'uploading' ? T.brass :
    T.inkMute;
  const statusLabel =
    row.status === 'done'      ? 'Uploaded' :
    row.status === 'error'     ? 'Error' :
    row.status === 'uploading' ? 'Uploading…' :
    'Queued';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: 8,
      background: T.parchmentDeep, borderRadius: 8, border: `1px solid ${T.cardEdge}`,
    }}>
      <div style={{
        width: 56, height: 56, flexShrink: 0, borderRadius: 6,
        background: T.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${T.cardEdge}`,
      }}>
        <ImageIcon size={20} color={T.inkMute} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.file.name}
        </div>
        <div style={{ fontSize: 10, color: T.inkMute, marginTop: 2 }}>
          {row.file.type || 'unknown type'} · {formatBytes(row.file.size)}
        </div>
        {mode === 'per-image' && row.status === 'queued' && (
          <select
            value={row.speciesId}
            onChange={(e) => onSpeciesChange(e.target.value)}
            style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, marginTop: 4 }}
          >
            <option value="">— pick species —</option>
            {speciesOptions.map(s => (
              <option key={s.id} value={s.id}>{s.commonName} — {s.id}</option>
            ))}
          </select>
        )}
        {mode === 'batch' && (
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{row.speciesId}</div>
        )}
        {row.error && (
          <div style={{ fontSize: 11, color: T.closed, marginTop: 4, wordBreak: 'break-word' }}>
            {row.stage && (
              <span style={{ fontWeight: 800, marginRight: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {row.stage.replace('_', ' ')}
                {row.statusCode ? ` (${row.statusCode})` : ''}:
              </span>
            )}
            {row.error}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: statusColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{statusLabel}</div>
      {(row.status === 'queued' || row.status === 'error') && (
        <button onClick={onRemove} style={{
          background: 'transparent', border: 'none', color: T.inkMute, cursor: 'pointer',
          fontSize: 16, padding: '0 4px',
        }} title="Remove">×</button>
      )}
    </div>
  );
}

/* ============================================================
   Review panel
   ============================================================ */
function ReviewPanel() {
  const [speciesId, setSpeciesId] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [cursor, setCursor] = useState(0);
  const [correctPickerOpen, setCorrectPickerOpen] = useState(false);
  const [rejectPickerOpen, setRejectPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState({});

  const speciesOptions = useMemo(
    () => [...SPECIES].filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

  const refresh = useCallback(async () => {
    if (!speciesId) { setRows([]); return; }
    // '__all__' means "no species filter" — pull rows for every
    // species at the chosen status. Everything else stays a normal
    // species-specific query.
    const speciesArg = speciesId === '__all__' ? null : speciesId;
    setLoading(true);
    const [imgRes, cRes] = await Promise.all([
      listTrainingImages({ speciesId: speciesArg, status: statusFilter === 'all' ? null : statusFilter }),
      countsBySpecies(),
    ]);
    setLoading(false);
    if (!imgRes.ok) { setError(imgRes.error || 'load failed'); return; }
    setError('');
    setRows(imgRes.rows);
    setSelected(new Set());
    setCursor(0);
    if (cRes.ok) setCounts(cRes.counts);
  }, [speciesId, statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Keyboard shortcuts. Guard so text inputs / modals don't hijack. */
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (correctPickerOpen || rejectPickerOpen) return;
      if (rows.length === 0) return;
      const focusedIds = selected.size > 0 ? Array.from(selected) : [rows[cursor].id];
      const key = e.key.toLowerCase();

      if (key === 'a') { e.preventDefault(); doApprove(focusedIds); }
      else if (key === 'r') { e.preventDefault(); setRejectPickerOpen(true); }
      else if (key === 'c') { e.preventDefault(); setCorrectPickerOpen(true); }
      else if (key === 'd') { e.preventDefault(); doReject(focusedIds, 'duplicate'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setCursor(i => Math.min(rows.length - 1, i + 1)); }
      else if (e.key === 'ArrowLeft')  { e.preventDefault(); setCursor(i => Math.max(0, i - 1)); }
      else if ((e.metaKey || e.ctrlKey) && key === 'a') {
        e.preventDefault();
        setSelected(new Set(rows.map(r => r.id)));
      }
      else if (e.key === 'Escape') { setSelected(new Set()); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cursor, selected, correctPickerOpen, rejectPickerOpen]);

  const doApprove = async (ids) => {
    const r = await approve(ids);
    if (!r.ok) return setError(r.error || 'approve failed');
    refresh();
  };
  const doReject = async (ids, reason) => {
    const r = await reject(ids, reason);
    if (!r.ok) return setError(r.error || 'reject failed');
    refresh();
  };
  const doCorrect = async (ids, newSpeciesId) => {
    // In All-species mode each row can belong to a different species,
    // so we can't hand correctSpecies a single currentSpeciesId. Group
    // the ids by their row's own species_id and call once per group.
    if (speciesId === '__all__') {
      const bySpecies = new Map();
      for (const id of ids) {
        const row = rows.find(r => r.id === id);
        if (!row) continue;
        const cur = row.species_id;
        if (!bySpecies.has(cur)) bySpecies.set(cur, []);
        bySpecies.get(cur).push(id);
      }
      for (const [cur, groupIds] of bySpecies) {
        const r = await correctSpecies(groupIds, newSpeciesId, cur);
        if (!r.ok) { setError(r.error || 'correct failed'); return; }
      }
      refresh();
      return;
    }
    const r = await correctSpecies(ids, newSpeciesId, speciesId);
    if (!r.ok) return setError(r.error || 'correct failed');
    refresh();
  };

  const toggleSelect = (id, shiftKey = false) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const focusedIds = selected.size > 0 ? Array.from(selected) : (rows[cursor] ? [rows[cursor].id] : []);
  const focusedSpecies = SPECIES.find(s => s.id === speciesId);
  // Aggregate counts across every species when browsing All. Keeps
  // the header stat readout meaningful in that mode.
  const c = speciesId === '__all__'
    ? Object.values(counts).reduce((acc, x) => ({
        pending:   acc.pending   + (x.pending   || 0),
        verified:  acc.verified  + (x.verified  || 0),
        rejected:  acc.rejected  + (x.rejected  || 0),
        corrected: acc.corrected + (x.corrected || 0),
        total:     acc.total     + (x.total     || 0),
      }), { pending: 0, verified: 0, rejected: 0, corrected: 0, total: 0 })
    : (counts[speciesId] || { pending: 0, verified: 0, rejected: 0, corrected: 0, total: 0 });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Species</SectionLabel>
            <select value={speciesId} onChange={e => setSpeciesId(e.target.value)} style={inputStyle}>
              <option value="">— select species —</option>
              <option value="__all__">All species (every row at the chosen status)</option>
              {speciesOptions.map(s => {
                const cc = counts[s.id];
                const tail = cc ? ` — ${cc.pending}P / ${cc.verified}V / ${cc.total}T` : '';
                return <option key={s.id} value={s.id}>{s.commonName}{tail}</option>;
              })}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Status</SectionLabel>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="corrected">Corrected</option>
              <option value="all">All</option>
            </select>
          </div>
          <GhostButton onClick={refresh} disabled={loading} style={{ padding: '10px 14px' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </GhostButton>
        </div>

        {speciesId && (
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 10, lineHeight: 1.5 }}>
            <strong style={{ color: T.ink }}>
              {speciesId === '__all__' ? 'All species' : (focusedSpecies?.commonName || speciesId)}
            </strong> — {c.total} total ·
            <span style={{ color: T.brass }}> {c.pending} pending</span> ·
            <span style={{ color: T.open }}> {c.verified} verified</span> ·
            <span style={{ color: T.closed }}> {c.rejected} rejected</span> ·
            {c.corrected} corrected
            <div style={{ marginTop: 6, fontSize: 11, color: T.inkMute }}>
              Keys: <b>A</b> approve · <b>R</b> reject (with reason) · <b>C</b> correct species · <b>D</b> duplicate ·
              <b> ← →</b> navigate · <b>⌘/Ctrl+A</b> select all · <b>Esc</b> clear selection
            </div>
          </div>
        )}
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {speciesId && rows.length > 0 && (
        <>
          {/* Bulk action bar (visible when selection is non-empty). */}
          {selected.size > 0 && (
            <Card style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: T.ink, fontWeight: 700, flex: 1 }}>
                {selected.size} selected
              </div>
              <GhostButton onClick={() => doApprove(Array.from(selected))} style={{ fontSize: 12, color: T.open, borderColor: T.open }}>
                Approve all
              </GhostButton>
              <GhostButton onClick={() => setRejectPickerOpen(true)} style={{ fontSize: 12, color: T.closed, borderColor: T.closed }}>
                Reject all…
              </GhostButton>
              <GhostButton onClick={() => setCorrectPickerOpen(true)} style={{ fontSize: 12 }}>
                Correct species…
              </GhostButton>
            </Card>
          )}

          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}>
            {rows.map((r, i) => (
              <ReviewTile
                key={r.id}
                row={r}
                showSpecies={speciesId === '__all__'}
                selected={selected.has(r.id)}
                focused={i === cursor && selected.size === 0}
                onClick={(e) => { setCursor(i); if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelect(r.id); }}
                onToggle={() => toggleSelect(r.id)}
              />
            ))}
          </div>
        </>
      )}

      {speciesId && rows.length === 0 && !loading && (
        <Card style={{ fontSize: 13, color: T.inkMute, textAlign: 'center', padding: 24 }}>
          No {statusFilter} images
          {' '}{speciesId === '__all__' ? 'across all species' : `for ${focusedSpecies?.commonName || speciesId}`}.
        </Card>
      )}

      {rejectPickerOpen && (
        <ReasonPickerModal
          onPick={(reason) => {
            setRejectPickerOpen(false);
            doReject(focusedIds, reason);
          }}
          onCancel={() => setRejectPickerOpen(false)}
        />
      )}

      {correctPickerOpen && (
        <SpeciesPickerModal
          speciesOptions={speciesOptions}
          currentSpeciesId={speciesId}
          onPick={(newId) => {
            setCorrectPickerOpen(false);
            doCorrect(focusedIds, newId);
          }}
          onCancel={() => setCorrectPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ReviewTile({ row, selected, focused, onClick, onToggle, showSpecies = false }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    signedUrl(row.storage_path).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [row.storage_path]);

  const statusColor =
    row.status === 'verified'  ? T.open :
    row.status === 'rejected'  ? T.closed :
    row.status === 'corrected' ? T.brass :
    T.warn; // pending

  // In "All species" mode the reviewer needs to know what species a
  // tile is claiming to be — otherwise you can't tell what you're
  // approving/correcting. Cheap lookup against the bundled SPECIES.
  const sp = showSpecies ? SPECIES.find(s => s.id === row.species_id) : null;
  const speciesLabel = sp?.commonName || row.species_id;

  return (
    <div
      onClick={onClick}
      style={{
        background: T.card,
        border: `2px solid ${selected ? T.brass : focused ? T.brassDeep : T.cardEdge}`,
        borderRadius: 10, overflow: 'hidden', cursor: 'pointer',
        position: 'relative',
      }}
    >
      <div style={{ width: '100%', aspectRatio: '1 / 1', background: T.parchmentDeep }}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </div>
      {showSpecies && (
        <div style={{
          padding: '5px 8px 0 8px',
          fontSize: 11, fontWeight: 700, color: T.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {speciesLabel}
        </div>
      )}
      <div style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{
          width: 8, height: 8, borderRadius: 4, background: statusColor, flexShrink: 0,
        }} />
        <div style={{ fontSize: 11, color: T.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {row.status}{row.rejection_reason ? ` · ${row.rejection_reason}` : ''}
        </div>
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggle}
          style={{ width: 14, height: 14, accentColor: T.brass }}
        />
      </div>
    </div>
  );
}

/* ============================================================
   Modals
   ============================================================ */
function ReasonPickerModal({ onPick, onCancel }) {
  return (
    <ModalShell onCancel={onCancel} title="Reject — pick a reason">
      <div style={{ display: 'grid', gap: 6 }}>
        {REJECT_REASONS.map(r => (
          <button key={r.key} onClick={() => onPick(r.key)} style={{
            background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
            color: T.ink, padding: '10px 12px', borderRadius: 8,
            fontSize: 13, textAlign: 'left', cursor: 'pointer',
          }}>{r.label}</button>
        ))}
      </div>
    </ModalShell>
  );
}

/* ============================================================
   Coverage panel — Phase 2
   ============================================================ */
function CoveragePanel({ onUploadSpecies }) {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState('gap'); // 'gap' | 'name' | 'count'
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'excluded' | 'thin' | 'good'

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await countsBySpecies();
    setLoading(false);
    if (r.ok) setCounts(r.counts);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const activeSpecies = useMemo(
    () => SPECIES.filter(s => s.active !== false),
    []
  );

  const rows = useMemo(() => activeSpecies.map(s => {
    const c = counts[s.id] || { verified: 0, pending: 0, total: 0, lastUploadedAt: null };
    const verified = c.verified;
    const status = classifyCoverage(verified);
    return {
      speciesId: s.id,
      commonName: s.commonName,
      category: s.category,
      verified,
      pending: c.pending,
      total: c.total,
      lastUploadedAt: c.lastUploadedAt,
      status,
      gap: Math.max(0, TARGET_COVERAGE - verified),
    };
  }), [counts, activeSpecies]);

  const filtered = rows.filter(r => {
    if (categoryFilter && r.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });
  filtered.sort((a, b) => {
    if (sortMode === 'name')  return a.commonName.localeCompare(b.commonName);
    if (sortMode === 'count') return b.verified - a.verified;
    // 'gap' default — largest gap first, then alphabetical
    if (a.gap !== b.gap) return b.gap - a.gap;
    return a.commonName.localeCompare(b.commonName);
  });

  const totals = useMemo(() => {
    let good = 0, ok = 0, thin = 0, excluded = 0;
    for (const r of rows) {
      if (r.status === 'good')          good++;
      else if (r.status === 'ok')       ok++;
      else if (r.status === 'thin')     thin++;
      else excluded++;
    }
    const totalVerified = rows.reduce((sum, r) => sum + r.verified, 0);
    return { good, ok, thin, excluded, totalVerified, totalSpecies: rows.length };
  }, [rows]);

  const groups = useMemo(() => buildLookalikeGroups(), []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <SectionLabel>Overall progress</SectionLabel>
          <GhostButton onClick={refresh} disabled={loading} style={{ padding: '6px 12px', fontSize: 12 }}>
            {loading ? 'Loading…' : 'Refresh'}
          </GhostButton>
        </div>
        <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.7 }}>
          <span style={{ fontWeight: 700, color: T.open }}>{totals.good}</span> at target
          {' '} · {' '}
          <span style={{ fontWeight: 700, color: T.brass }}>{totals.ok}</span> ok
          {' '} · {' '}
          <span style={{ fontWeight: 700, color: T.warn }}>{totals.thin}</span> thin
          {' '} · {' '}
          <span style={{ fontWeight: 700, color: T.closed }}>{totals.excluded}</span> excluded
          <div style={{ color: T.inkMute, fontSize: 12, marginTop: 4 }}>
            {totals.totalSpecies} active species, {totals.totalVerified.toLocaleString()} verified images total
          </div>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 10, lineHeight: 1.6 }}>
          <b style={{ color: T.closed }}>Excluded</b> (&lt; {MIN_TRAIN_THRESHOLD}) — classifier drops entirely; too few examples to learn from.
          {' '}
          <b style={{ color: T.warn }}>Thin</b> ({MIN_TRAIN_THRESHOLD}–{ADEQUATE_THRESHOLD - 1}) — trainable but risky; lookalike pairs will guess.
          {' '}
          <b style={{ color: T.brass }}>Ok</b> ({ADEQUATE_THRESHOLD}–{TARGET_COVERAGE - 1}) — solid on distinct species, hedges on lookalikes.
          {' '}
          <b style={{ color: T.open }}>Good</b> ({TARGET_COVERAGE}+) — shippable v0.1.
          {' '}
          Distinct species (Mahi, Cobia, Hogfish) work at ok; lookalike-group species need good.
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div>
            <SectionLabel style={{ marginBottom: 4 }}>Sort</SectionLabel>
            <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', fontSize: 12 }}>
              <option value="gap">Largest gap</option>
              <option value="count">Most verified</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 4 }}>Category</SectionLabel>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', fontSize: 12 }}>
              <option value="">All</option>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 4 }}>Status</SectionLabel>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, padding: '8px 10px', fontSize: 12 }}>
              <option value="all">All</option>
              <option value="excluded">Excluded ({totals.excluded})</option>
              <option value="thin">Thin ({totals.thin})</option>
              <option value="ok">Ok ({totals.ok})</option>
              <option value="good">Good ({totals.good})</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {filtered.map(r => (
            <CoverageRow
              key={r.speciesId}
              row={r}
              onUpload={() => onUploadSpecies?.(r.speciesId)}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ fontSize: 13, color: T.inkMute, padding: 20, textAlign: 'center' }}>
              No species match those filters.
            </div>
          )}
        </div>
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Lookalike group balance</SectionLabel>
        <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
          When one member of a lookalike group has ≥ 2× the verified photos of another, the classifier learns
          "just guess the majority" instead of the actual visual difference. Balance the small side first.
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {groups.map((group, i) => (
            <LookalikeGroupRow
              key={i}
              members={group}
              counts={counts}
              onUploadSpecies={onUploadSpecies}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function CoverageRow({ row, onUpload }) {
  const pct = Math.min(100, (row.verified / TARGET_COVERAGE) * 100);
  const barColor =
    row.status === 'good'     ? T.open :
    row.status === 'ok'       ? T.brass :
    row.status === 'thin'     ? T.warn :
    T.closed;
  const pillColor = barColor;
  const pillLabel =
    row.status === 'good'     ? 'Good' :
    row.status === 'ok'       ? 'Ok' :
    row.status === 'thin'     ? 'Thin' :
    'Excluded';
  const lastLabel = row.lastUploadedAt
    ? new Date(row.lastUploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      background: T.parchmentDeep, borderRadius: 8, padding: '10px 12px',
      border: `1px solid ${T.cardEdge}`,
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <button
          onClick={onUpload}
          title={`Upload photos for ${row.commonName}`}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 13, fontWeight: 700, color: T.brass,
            textAlign: 'left', textDecoration: 'underline', textDecorationThickness: 1,
            textUnderlineOffset: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            width: '100%',
          }}
        >
          {row.commonName}
        </button>
        <div style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace' }}>{row.speciesId}</div>
      </div>

      <div style={{ flex: '2 1 260px', minWidth: 160 }}>
        <div style={{
          height: 8, background: T.card, borderRadius: 4, overflow: 'hidden',
          border: `1px solid ${T.cardEdge}`,
        }}>
          <div style={{
            height: '100%', width: `${pct}%`, background: barColor,
            transition: 'width 220ms ease',
          }} />
        </div>
        <div style={{ fontSize: 10, color: T.inkMute, marginTop: 3, display: 'flex', justifyContent: 'space-between' }}>
          <span>
            <strong style={{ color: T.ink }}>{row.verified}</strong> / {TARGET_COVERAGE} verified
            {row.pending > 0 && <span style={{ color: T.brass, marginLeft: 6 }}>+{row.pending} pending</span>}
          </span>
          <span>{row.gap > 0 ? `${row.gap} to target` : '✓'}</span>
        </div>
      </div>

      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1,
        color: T.oceanDeep, background: pillColor,
        padding: '3px 8px', borderRadius: 999,
        flexShrink: 0,
      }}>{pillLabel}</span>

      <div style={{ fontSize: 11, color: T.inkMute, flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
        {lastLabel}
      </div>
    </div>
  );
}

/* ============================================================
   Export panel — Phase 3
   ============================================================
   Runs planExport (verified rows → deterministic 85/15 split,
   excluded species dropped), fetches each image via signed URL,
   packages train/{species}/*.jpg + val/{species}/*.jpg + manifest.json
   into a ZIP via JSZip, downloads. Streaming-ish: fetches sequentially
   and blobs go straight into JSZip so peak memory is dominated by
   one image at a time plus the zip's compressed buffer. */
function ExportPanel() {
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null); // { done, total, status }
  const [uploadedExportId, setUploadedExportId] = useState(null);
  const [priorExports, setPriorExports] = useState([]);
  const [copyState, setCopyState] = useState({}); // { [id]: 'copied' | 'error' }

  const runPlan = async () => {
    setPlanning(true);
    setError(''); setPlan(null); setUploadedExportId(null);
    const r = await planExport();
    setPlanning(false);
    if (!r.ok) { setError(r.error || 'plan failed'); return; }
    setPlan(r);
  };

  const refreshPriorExports = async () => {
    const r = await listExports();
    if (r.ok) setPriorExports(r.rows);
  };

  useEffect(() => {
    runPlan();
    refreshPriorExports();
  }, []); // Auto-plan on open.

  const runExport = async () => {
    if (!plan) return;
    setError('');
    setProgress({ done: 0, total: plan.plan.length, status: 'Starting…' });
    setUploadedExportId(null);

    try {
      // Lazy-load JSZip so the admin bundle doesn't eat it when not needed.
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      const manifest = {
        version: 1,
        created_at: new Date().toISOString(),
        split_seed: plan.splitSeed,
        thresholds: {
          min_train_threshold: MIN_TRAIN_THRESHOLD,
          adequate_threshold:  ADEQUATE_THRESHOLD,
          target_coverage:     TARGET_COVERAGE,
        },
        species: plan.species,
        excluded: plan.excluded,
        counts: plan.counts,
        images: plan.plan.map(p => ({
          path: `${p.split}/${p.species_id}/${p.filename}`,
          species_id: p.species_id,
          split: p.split,
          crop_bbox: p.crop_bbox || null,
        })),
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // Sequential fetch + add — keeps memory pressure low on larger
      // datasets. Every N images we let React tick to update progress.
      for (let i = 0; i < plan.plan.length; i++) {
        const p = plan.plan[i];
        setProgress({ done: i, total: plan.plan.length, status: `Fetching ${p.filename}…` });
        // Signed URL valid for the export session only.
        const url = await signedUrl(p.storage_path, 60 * 60);
        if (!url) throw new Error(`no signed url for ${p.storage_path}`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch ${resp.status} for ${p.storage_path}`);
        const blob = await resp.blob();
        zip.file(`${p.split}/${p.species_id}/${p.filename}`, blob);
      }

      setProgress({ done: plan.plan.length, total: plan.plan.length, status: 'Building ZIP…' });
      const out = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      setProgress({ done: plan.plan.length, total: plan.plan.length, status: 'Uploading to cloud…' });
      const up = await uploadExport({
        blob: out,
        speciesCount: plan.species.length,
        imageCount:   plan.plan.length,
        splitSeed:    plan.splitSeed,
      });
      if (!up.ok) throw new Error(up.error || 'upload failed');
      setUploadedExportId(up.id);
      setProgress({ done: plan.plan.length, total: plan.plan.length, status: 'Done — export saved to cloud.' });
      refreshPriorExports();
    } catch (e) {
      setError(e?.message || String(e));
      setProgress(null);
    }
  };

  const copyColabCell = async (row) => {
    try {
      const url = await getExportSignedUrl(row.storage_path);
      if (!url) throw new Error('signed URL failed');
      // Also mint a signed upload URL so Colab can auto-upload the
      // bundle back. Best-effort — if this fails the snippet still
      // works, the bundle just has to be picked up manually.
      const up = await modelBundleUploadUrl();
      const snippet = buildColabSnippet({
        exportUrl:   url,
        bundleUrl:   up?.ok ? up.signedUrl : null,
        bundleToken: up?.ok ? up.token     : null,
      });
      await navigator.clipboard.writeText(snippet);
      setCopyState((s) => ({ ...s, [row.id]: 'copied' }));
      setTimeout(() => setCopyState((s) => {
        const n = { ...s }; delete n[row.id]; return n;
      }), 2500);
    } catch (e) {
      setCopyState((s) => ({ ...s, [row.id]: 'error' }));
    }
  };

  const delExport = async (row) => {
    if (!window.confirm(`Delete ${new Date(row.exported_at).toLocaleString()} export from cloud? Cannot be undone.`)) return;
    const r = await deleteExport(row.id, row.storage_path);
    if (!r.ok) { setError(r.error || 'delete failed'); return; }
    refreshPriorExports();
  };

  const totalImages = plan?.plan.length || 0;
  const speciesCount = plan?.species.length || 0;
  const excludedCount = plan?.excluded.length || 0;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 8 }}>Export plan</SectionLabel>
        {planning && <div style={{ fontSize: 12, color: T.inkMute }}>Planning…</div>}
        {!planning && plan && (
          <>
            <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.7 }}>
              <span style={{ fontWeight: 700, color: T.brass }}>{totalImages.toLocaleString()}</span> verified images across
              <span style={{ fontWeight: 700, color: T.ink }}> {speciesCount}</span> species.
              {excludedCount > 0 && (
                <>
                  {' '}Excluding <span style={{ fontWeight: 700, color: T.closed }}>{excludedCount}</span> species below the {MIN_TRAIN_THRESHOLD}-image floor.
                </>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.55 }}>
              85/15 train/val split, deterministic (seed <code style={{ background: T.parchmentDeep, padding: '1px 5px', borderRadius: 3 }}>{plan.splitSeed}</code>).
              ZIP layout: <code>train/{'{species_id}'}/*.jpg</code>, <code>val/{'{species_id}'}/*.jpg</code>, <code>manifest.json</code>.
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <GhostButton onClick={runPlan} disabled={planning}>
            {planning ? 'Planning…' : 'Refresh plan'}
          </GhostButton>
          <PrimaryButton
            onClick={runExport}
            disabled={!plan || totalImages === 0 || (progress && !uploadedExportId && !error)}
            style={{ flex: 1 }}
          >
            {progress && !uploadedExportId && !error ? 'Exporting…' :
             uploadedExportId ? 'Rebuild export'
                             : `Build + upload (${totalImages.toLocaleString()} images)`}
          </PrimaryButton>
        </div>
      </Card>

      {plan && plan.species.length > 0 && (
        <Card>
          <SectionLabel style={{ marginBottom: 8 }}>Species included ({speciesCount})</SectionLabel>
          <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
            {plan.species.map(sid => {
              const c = plan.counts[sid];
              const sp = SPECIES.find(s => s.id === sid);
              return (
                <div key={sid} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '4px 6px', fontSize: 12, color: T.ink,
                  borderBottom: `1px dashed ${T.cardEdge}`,
                }}>
                  <span>{sp?.commonName || sid} <span style={{ color: T.inkMute, fontFamily: 'monospace', fontSize: 10 }}>· {sid}</span></span>
                  <span style={{ color: T.inkMute, fontSize: 11 }}>{c.verified} total · {c.train} train / {c.val} val</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {plan && plan.excluded.length > 0 && (
        <Card style={{ borderColor: T.warn }}>
          <SectionLabel style={{ marginBottom: 6, color: T.warn }}>Excluded ({plan.excluded.length})</SectionLabel>
          <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
            These species have &lt; {MIN_TRAIN_THRESHOLD} verified images so they won't be in the training set. Upload more to include them.
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: T.inkMute, fontFamily: 'monospace' }}>
            {plan.excluded.join(', ')}
          </div>
        </Card>
      )}

      {progress && (
        <Card>
          <SectionLabel style={{ marginBottom: 6 }}>Progress</SectionLabel>
          <div style={{ fontSize: 12, color: T.ink, marginBottom: 6 }}>
            {progress.status} <span style={{ color: T.inkMute }}>({progress.done} / {progress.total})</span>
          </div>
          <div style={{ height: 6, background: T.parchmentDeep, borderRadius: 3, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
            <div style={{
              height: '100%',
              width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
              background: T.brass,
              transition: 'width 220ms ease',
            }} />
          </div>
          {uploadedExportId && (
            <div style={{ marginTop: 12, fontSize: 12, color: T.ink }}>
              Uploaded to cloud. Find it in <strong>Prior exports</strong> below and click
              <strong> Copy Colab cell</strong> to get a one-cell snippet you can paste into Colab.
            </div>
          )}
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <SectionLabel style={{ flex: 1 }}>Prior exports (cloud)</SectionLabel>
          <GhostButton onClick={refreshPriorExports} style={{ padding: '6px 10px', fontSize: 11 }}>
            Refresh
          </GhostButton>
        </div>
        {priorExports.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMute }}>No exports yet. Build one above.</div>
        )}
        {priorExports.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {priorExports.map(row => {
              const state = copyState[row.id];
              const size = `${(row.size_bytes / 1024 / 1024).toFixed(1)} MB`;
              const when = new Date(row.exported_at).toLocaleString();
              const isNewest = priorExports[0]?.id === row.id;
              return (
                <div key={row.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6,
                  border: `1px solid ${isNewest ? T.brass : T.cardEdge}`,
                  background: isNewest ? T.parchmentDeep : 'transparent',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: T.ink, fontWeight: isNewest ? 800 : 600 }}>
                      {when} {isNewest && <span style={{ color: T.brass, marginLeft: 4 }}>latest</span>}
                    </div>
                    <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                      {row.image_count.toLocaleString()} images · {row.species_count} species · {size}
                    </div>
                  </div>
                  <GhostButton
                    onClick={() => copyColabCell(row)}
                    style={{
                      padding: '6px 10px', fontSize: 11,
                      color: state === 'copied' ? T.open : (state === 'error' ? T.closed : undefined),
                      borderColor: state === 'copied' ? T.open : (state === 'error' ? T.closed : undefined),
                    }}
                  >
                    {state === 'copied' ? '✓ Copied' : state === 'error' ? 'Failed' : 'Copy Colab cell'}
                  </GhostButton>
                  <GhostButton
                    onClick={() => delExport(row)}
                    style={{ padding: '6px 10px', fontSize: 11, color: T.closed, borderColor: T.closed }}
                  >
                    Delete
                  </GhostButton>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/* Build the one-cell Colab snippet the user pastes. Signed URLs for
   both the export download AND the bundle upload are baked in — the
   Colab run then does the full round trip without any manual file
   handling. */
function buildColabSnippet({ exportUrl, bundleUrl, bundleToken }) {
  const BRANCH = 'claude/upload-app-assets-NUxRr';
  const bundleEnv = bundleUrl && bundleToken
    ? `os.environ['REELINTEL_BUNDLE_UPLOAD'] = ${JSON.stringify(bundleUrl)}
os.environ['REELINTEL_BUNDLE_UPLOAD_TOKEN'] = ${JSON.stringify(bundleToken)}
`
    : '';
  return (
`# ReelIntel — train v-next from cloud export.
# Paste this cell into a fresh Colab notebook, run once.
# Runtime → Change runtime type → T4 GPU or L4 GPU first.
import os, urllib.request, runpy
os.environ['REELINTEL_EXPORT_URL'] = ${JSON.stringify(exportUrl)}
${bundleEnv}url = 'https://raw.githubusercontent.com/robertboot/know-your-catch/${BRANCH}/training/colab_run.py'
urllib.request.urlretrieve(url, '/content/colab_run.py')
runpy.run_path('/content/colab_run.py', run_name='__main__')
`);
}

function LookalikeGroupRow({ members, counts, onUploadSpecies }) {
  const memberData = members.map(id => {
    const sp = SPECIES.find(s => s.id === id);
    const c = counts[id] || { verified: 0 };
    return { id, name: sp?.commonName || id, verified: c.verified };
  });
  const verifiedCounts = memberData.map(m => m.verified);
  const max = Math.max(...verifiedCounts);
  const min = Math.min(...verifiedCounts);
  const unbalanced = max > 0 && max >= 2 * Math.max(1, min);
  const anyEmpty = min === 0 && max > 0;

  return (
    <div style={{
      padding: '10px 12px',
      background: (unbalanced || anyEmpty) ? T.warnBg : T.parchmentDeep,
      border: `1px solid ${(unbalanced || anyEmpty) ? T.warn : T.cardEdge}`,
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>
          {memberData.map(m => m.name).join(' · ')}
        </div>
        {(unbalanced || anyEmpty) && (
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 1,
            color: T.oceanDeep, background: T.warn,
            padding: '2px 7px', borderRadius: 999,
          }}>
            {anyEmpty ? 'Empty member' : 'Unbalanced'}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {memberData.map(m => {
          const pct = max > 0 ? Math.min(100, (m.verified / max) * 100) : 0;
          const isMin = m.verified === min && max > min;
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => onUploadSpecies?.(m.id)}
                title={`Upload photos for ${m.name}`}
                style={{
                  background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 11, color: T.brass, textAlign: 'left',
                  textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 2,
                  width: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {m.name}
              </button>
              <div style={{ flex: 1, height: 6, background: T.card, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: isMin ? T.closed : T.brass }} />
              </div>
              <div style={{ fontSize: 11, color: T.ink, width: 40, textAlign: 'right' }}>{m.verified}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
