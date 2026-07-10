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
  MIN_TRAIN_THRESHOLD, TARGET_COVERAGE,
  buildLookalikeGroups, classifyCoverage,
} from '../training-store.js';
import { CATEGORIES } from '../data.js';

const REJECT_REASONS = [
  { key: 'blurry',    label: 'Blurry / low quality' },
  { key: 'multiple',  label: 'Multiple fish' },
  { key: 'not_fish',  label: 'Not a fish' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'other',     label: 'Other' },
];

/* ============================================================
   Top-level TrainingTab
   ============================================================ */
export default function TrainingTab() {
  const [panel, setPanel] = useState('upload'); // 'upload' | 'review' | 'coverage'
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.cardEdge}` }}>
        <SubTabBtn active={panel === 'upload'} onClick={() => setPanel('upload')}>Upload</SubTabBtn>
        <SubTabBtn active={panel === 'review'} onClick={() => setPanel('review')}>Review</SubTabBtn>
        <SubTabBtn active={panel === 'coverage'} onClick={() => setPanel('coverage')}>Coverage</SubTabBtn>
      </div>
      {panel === 'upload' && <UploadPanel />}
      {panel === 'review' && <ReviewPanel />}
      {panel === 'coverage' && <CoveragePanel />}
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
function UploadPanel() {
  const [mode, setMode] = useState('batch'); // 'batch' | 'per-image'
  const [batchSpeciesId, setBatchSpeciesId] = useState(SPECIES[0]?.id || '');
  const [queue, setQueue] = useState([]); // [{ file, id, speciesId, status, error, path }]
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  const speciesOptions = useMemo(
    () => [...SPECIES].filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

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
    setQueue(q => [...q, ...rows]);
  };

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
  const errorCount = queue.filter(r => r.status === 'error').length;

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
              style={{ fontSize: 12, padding: '8px 14px' }}
            >
              {uploading ? 'Uploading…' : `Upload ${readyCount} file${readyCount === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>

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
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    const url = URL.createObjectURL(row.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [row.file]);

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
      <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: T.card }}>
        {preview && <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.file.name}
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
          <div style={{ fontSize: 11, color: T.closed, marginTop: 4 }}>{row.error}</div>
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
    setLoading(true);
    const [imgRes, cRes] = await Promise.all([
      listTrainingImages({ speciesId, status: statusFilter === 'all' ? null : statusFilter }),
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
  const c = counts[speciesId] || { pending: 0, verified: 0, rejected: 0, corrected: 0, total: 0 };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Species</SectionLabel>
            <select value={speciesId} onChange={e => setSpeciesId(e.target.value)} style={inputStyle}>
              <option value="">— select species —</option>
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
            <strong style={{ color: T.ink }}>{focusedSpecies?.commonName || speciesId}</strong> — {c.total} total ·
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
          No {statusFilter} images for {focusedSpecies?.commonName || speciesId}.
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

function ReviewTile({ row, selected, focused, onClick, onToggle }) {
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

function SpeciesPickerModal({ speciesOptions, currentSpeciesId, onPick, onCancel }) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? speciesOptions.filter(s => {
        const lower = q.toLowerCase();
        return s.commonName.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower);
      })
    : speciesOptions.slice(0, 40);

  return (
    <ModalShell onCancel={onCancel} title="Correct species">
      <input
        type="search" placeholder="Search species…" autoFocus
        value={q} onChange={e => setQ(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10 }}
      />
      <div style={{ display: 'grid', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
        {filtered.map(s => (
          <button
            key={s.id}
            disabled={s.id === currentSpeciesId}
            onClick={() => onPick(s.id)}
            style={{
              background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
              color: s.id === currentSpeciesId ? T.inkMute : T.ink,
              padding: '8px 10px', borderRadius: 6,
              fontSize: 13, textAlign: 'left', cursor: s.id === currentSpeciesId ? 'not-allowed' : 'pointer',
              opacity: s.id === currentSpeciesId ? 0.5 : 1,
            }}
          >
            <span>{s.commonName}</span>
            <span style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace', marginLeft: 8 }}>{s.id}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function ModalShell({ onCancel, title, children }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`,
        borderRadius: 12, padding: 18, maxWidth: 460, width: '100%',
      }}>
        <H1 size={18} style={{ marginBottom: 12 }}>{title}</H1>
        {children}
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Coverage panel — Phase 2
   ============================================================ */
function CoveragePanel() {
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
    let good = 0, thin = 0, excluded = 0;
    for (const r of rows) {
      if (r.status === 'good') good++;
      else if (r.status === 'thin') thin++;
      else excluded++;
    }
    const totalVerified = rows.reduce((sum, r) => sum + r.verified, 0);
    return { good, thin, excluded, totalVerified, totalSpecies: rows.length };
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
        <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.65 }}>
          <span style={{ fontWeight: 700, color: T.open }}>{totals.good}</span> at target
          {' '} · {' '}
          <span style={{ fontWeight: 700, color: T.warn }}>{totals.thin}</span> thin (below {TARGET_COVERAGE})
          {' '} · {' '}
          <span style={{ fontWeight: 700, color: T.closed }}>{totals.excluded}</span> excluded (below {MIN_TRAIN_THRESHOLD})
          {' '} · {' '}
          <span style={{ color: T.inkMute }}>{totals.totalSpecies} active species, {totals.totalVerified.toLocaleString()} verified images total</span>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.55 }}>
          Excluded species won't ship in the classifier — their verified count is below the {MIN_TRAIN_THRESHOLD} floor.
          Thin species will train but risk overfitting; aim for {TARGET_COVERAGE}+ per species for reliable lookalike disambiguation.
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
              <option value="good">Good ({totals.good})</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 6 }}>
          {filtered.map(r => <CoverageRow key={r.speciesId} row={r} />)}
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
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function CoverageRow({ row }) {
  const pct = Math.min(100, (row.verified / TARGET_COVERAGE) * 100);
  const barColor =
    row.status === 'good'      ? T.open :
    row.status === 'thin'      ? T.warn :
    T.closed;
  const pillColor =
    row.status === 'good'      ? T.open :
    row.status === 'thin'      ? T.warn :
    T.closed;
  const pillLabel =
    row.status === 'good'      ? 'Good' :
    row.status === 'thin'      ? 'Thin' :
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
        <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.commonName}
        </div>
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

function LookalikeGroupRow({ members, counts }) {
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
              <div style={{ fontSize: 11, color: T.inkSoft, width: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.name}
              </div>
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
