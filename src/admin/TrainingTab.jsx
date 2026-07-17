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
import { Image as ImageIcon, Menu as MenuIcon, Crop as CropIcon } from 'lucide-react';
import { T } from '../theme.js';
import { SPECIES } from '../data.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, H1,
  inputStyle,
} from '../components.jsx';
import {
  uploadTrainingImage, stableTrainingId, listTrainingImages,
  approve, reject, correctSpecies, deleteTrainingImage,
  classifyTrainingPhoto, inatIdentifyPhoto, INAT_TOKEN_KEY,
  saveCropBbox,
  signedUrl, countsBySpecies,
  MIN_TRAIN_THRESHOLD, ADEQUATE_THRESHOLD, TARGET_COVERAGE,
  buildLookalikeGroups, classifyCoverage,
  planExport,
  restoreTrainingRows,
  saveCropRecover,
} from '../training-store.js';
import { CropStep } from '../components.jsx';
import {
  uploadExport, listExports, getExportSignedUrl, deleteExport,
  modelBundleUploadUrl, trainingPhotoSignedUrls,
} from '../training-exports-store.js';
import { getCategories, subscribe as subscribeCategoriesStore } from '../categories-store.js';
import ModelsPanel from './ModelsPanel.jsx';
import TestImagePanel from './TestImagePanel.jsx';
import { SpeciesPickerModal, ModalShell } from './pickers.jsx';
import { loadFishIdRuntime, predictTop5 } from './fishIdRuntime.js';

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

  const subTabs = [
    ['upload', 'Upload'], ['review', 'Review'], ['swipe', 'Swipe'],
    ['coverage', 'Coverage'], ['export', 'Export'], ['models', 'Models'],
    ['test', 'Test image'],
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <TrainingSubNav tabs={subTabs} panel={panel} onPanel={setPanel} />
      {panel === 'upload' && (
        <UploadPanel
          initialSpeciesId={pendingUploadSpecies}
          onConsumeInitial={() => setPendingUploadSpecies(null)}
        />
      )}
      {panel === 'review' && <ReviewPanel />}
      {panel === 'swipe' && <SwipeReviewPanel />}
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

/* Training sub-nav — full row on desktop, hamburger on mobile so it
   doesn't push the panel (e.g. the Swipe card) off screen. */
function TrainingSubNav({ tabs, panel, onPanel }) {
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 720);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 720);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const current = tabs.find(([id]) => id === panel);

  if (narrow) {
    return (
      <div style={{ borderBottom: `1px solid ${T.cardEdge}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 8px' }}>
          <div style={{ flex: 1, color: T.brass, fontWeight: 800, fontSize: 15 }}>{current?.[1] || 'Training'}</div>
          <button onClick={() => setOpen(o => !o)} aria-label="Training menu" style={{
            width: 40, height: 40, borderRadius: 8, cursor: 'pointer',
            background: open ? T.brass : 'transparent',
            border: `1px solid ${open ? T.brass : T.cardEdge}`,
            color: open ? T.oceanDeep : T.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><MenuIcon size={20} /></button>
        </div>
        {open && (
          <div style={{ display: 'grid', gap: 2, paddingBottom: 8 }}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => { onPanel(id); setOpen(false); }} style={{
                textAlign: 'left', border: 'none', borderRadius: 6,
                background: panel === id ? T.parchmentDeep : 'transparent',
                color: panel === id ? T.brass : T.ink,
                padding: '13px 12px', fontSize: 15, fontWeight: 700, cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.cardEdge}` }}>
      {tabs.map(([id, label]) => (
        <SubTabBtn key={id} active={panel === id} onClick={() => onPanel(id)}>{label}</SubTabBtn>
      ))}
    </div>
  );
}

/* ============================================================
   Upload panel
   ============================================================ */
function UploadPanel({ initialSpeciesId = null, onConsumeInitial }) {
  const [mode, setMode] = useState('batch'); // 'batch' | 'per-image' | 'ai-sort'
  const [batchSpeciesId, setBatchSpeciesId] = useState(
    initialSpeciesId || SPECIES[0]?.id || ''
  );
  const [queue, setQueue] = useState([]); // [{ file, id, speciesId, status, error, path }]
  const [uploading, setUploading] = useState(false);
  const [aiSorting, setAiSorting] = useState(false);
  const inputRef = useRef(null);
  // Fetch All (folders): hidden directory picker + import summary.
  const folderRef = useRef(null);
  const [folderSummary, setFolderSummary] = useState(null); // {matched, unmatched:[names], files}

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
      aiSort: mode === 'ai-sort',
    }));
    console.log('[training upload] queued', rows.length, 'files',
      { mode, batchSpeciesId, firstFile: rows[0]?.file?.name });
    setQueue(q => [...q, ...rows]);
  };

  // Fetch All: user picks the base photos folder (e.g. "Fish ID
  // Model"); we walk every subfolder, match the folder name to a
  // species, and queue every image as PENDING with a deterministic
  // id — so re-importing the same folder skips what's already up,
  // and everything lands in Review pre-categorized for one-tap
  // Approve.
  const normName = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const speciesMatcher = useMemo(() => {
    const exact = new Map();
    for (const sp of SPECIES) {
      if (sp.active === false) continue;
      exact.set(normName(sp.commonName), sp.id);
      for (const alt of (sp.altNames || [])) exact.set(normName(alt), sp.id);
    }
    return (folderName) => {
      const n = normName(folderName);
      if (!n) return null;
      if (exact.has(n)) return exact.get(n);
      // Folder names sometimes carry extra words ("Scamp Grouper" for
      // "Scamp"): match when the folder STARTS WITH a known name or a
      // known name starts with the folder, longest name wins.
      let best = null, bestLen = 0;
      for (const [name, id] of exact) {
        if ((n.startsWith(name + ' ') || name.startsWith(n + ' ') || name === n)
            && name.length > bestLen) {
          best = id; bestLen = name.length;
        }
      }
      return best;
    };
  }, []);

  const onPickFolder = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const rows = [];
    const unmatched = new Set();
    let skippedNonImage = 0;
    for (const f of files) {
      if (!/\.(jpe?g|png)$/i.test(f.name)) { skippedNonImage += 1; continue; }
      const parts = (f.webkitRelativePath || f.name).split('/');
      // ".../<Species Folder>/images/<file>" — species folder is the
      // segment before "images"; otherwise the folder the file sits in.
      const imagesIdx = parts.findIndex(seg => seg.toLowerCase() === 'images');
      const folder = imagesIdx > 0 ? parts[imagesIdx - 1]
        : parts.length >= 2 ? parts[parts.length - 2] : '';
      const speciesId = speciesMatcher(folder);
      if (!speciesId) { unmatched.add(folder || '(no folder)'); continue; }
      rows.push({
        file: f,
        id: crypto.randomUUID(),
        speciesId,
        status: 'queued',
        error: null,
        path: null,
        pending: true,               // land as pending → Review queue
        stableKey: `${speciesId}|${f.name}`,
      });
    }
    setFolderSummary({ matched: rows.length, unmatched: [...unmatched], skippedNonImage });
    if (rows.length) setQueue(q => [...q, ...rows]);
  };

  // When switching to batch mode (or changing the batch species) with
  // queued rows already present, retroactively tag every queued row
  // that has no species set. That way switching modes doesn't leave a
  // queue full of orphans that can't be uploaded. AI-sort rows are
  // exempt — the classifier (or a manual per-row pick) owns those.
  useEffect(() => {
    if (mode !== 'batch' || !batchSpeciesId) return;
    setQueue(q => q.map(r =>
      r.status === 'queued' && !r.speciesId && !r.aiSort
        ? { ...r, speciesId: batchSpeciesId }
        : r
    ));
  }, [mode, batchSpeciesId]);

  // AI sort: run every unclassified AI-sort row through the
  // classify-fish-photo edge function (Claude vision). Two lanes —
  // each call carries an image, so keep concurrency polite. Rows the
  // AI can't place stay queued with no species for a manual per-row
  // pick; everything else is ready for the normal Upload button.
  const aiSortAll = async () => {
    if (aiSorting || uploading) return;
    const targets = queue.filter(r => r.status === 'queued' && r.aiSort && !r.speciesId);
    if (targets.length === 0) return;
    setAiSorting(true);
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const row = targets[next++];
        setQueue(q => q.map(r => r.id === row.id ? { ...r, status: 'classifying' } : r));
        const res = await classifyTrainingPhoto(row.file);
        setQueue(q => q.map(r => {
          if (r.id !== row.id) return r;
          if (!res.ok) {
            return { ...r, status: 'error', error: `AI sort failed: ${res.error}` };
          }
          if (!res.speciesId) {
            return {
              ...r, status: 'queued',
              aiConfidence: 0,
              aiNote: res.note || 'AI could not identify — pick the species manually.',
            };
          }
          return {
            ...r, status: 'queued',
            speciesId: res.speciesId,
            aiConfidence: res.confidence,
            aiNote: res.note || '',
            stableKey: `${res.speciesId}|${row.file.name}`,
          };
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
    setAiSorting(false);
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
    // Small worker pool — folder imports can queue thousands of
    // files; strictly sequential would take hours, unbounded
    // parallel would thrash storage. 4 lanes is the sweet spot.
    let next = 0;
    const worker = async () => {
      while (next < readyRows.length) {
        const row = readyRows[next++];
        setQueue(q => q.map(r => r.id === row.id ? { ...r, status: 'uploading' } : r));
        // EVERY admin upload lands pending — Review is the quality
        // gate. Scraped batches routinely contain wrong-species
        // shots; auto-verifying them poisons the training data.
        const res = await uploadTrainingImage(row.file, row.speciesId, {
          status: 'pending',
          ...(row.stableKey ? { stableId: await stableTrainingId(row.stableKey) } : {}),
        });
        setQueue(q => q.map(r => r.id === row.id
          ? { ...r,
              status: res.ok ? 'done' : 'error',
              skipped: !!res.skipped,
              error:  res.ok ? null    : res.error,
              stage:      res.ok ? null : res.stage,
              statusCode: res.ok ? null : (res.statusCode || null),
              code:       res.ok ? null : (res.code       || null),
              path:   res.ok ? res.storagePath : null }
          : r));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, readyRows.length) }, worker));
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
  const aiPendingCount = queue.filter(r => r.status === 'queued' && r.aiSort && !r.speciesId).length;

  // Classify errors into a header banner category. First match wins;
  // any unmatched errors still show inline on their row so nothing is
  // silently swallowed.
  const banner = classifyUploadErrors(errorRows);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 8 }}>Mode</SectionLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ModeBtn active={mode === 'batch'} onClick={() => setMode('batch')}>Batch (one species)</ModeBtn>
          <ModeBtn active={mode === 'per-image'} onClick={() => setMode('per-image')}>Per-image</ModeBtn>
          <ModeBtn active={mode === 'ai-sort'} onClick={() => setMode('ai-sort')}>AI sort (misc)</ModeBtn>
          <ModeBtn active={false} onClick={() => folderRef.current?.click()}>Fetch All (folders)</ModeBtn>
        </div>
        <input
          ref={folderRef}
          type="file"
          webkitdirectory=""
          multiple
          style={{ display: 'none' }}
          onChange={onPickFolder}
        />
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
          <strong style={{ color: T.ink }}>Fetch All</strong> — pick your photo base folder
          (e.g. "Fish ID Model"). Every subfolder is matched to its species automatically and
          the photos queue as <strong>pending</strong>, so they land in Review pre-categorized
          for quick Approve. Re-running skips photos already uploaded.
        </div>
        {folderSummary && (
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 8,
            background: folderSummary.unmatched.length ? T.warnBg : T.openBg,
            border: `1px solid ${folderSummary.unmatched.length ? T.warn : T.open}`,
            fontSize: 12, color: T.ink, lineHeight: 1.5,
          }}>
            Queued {folderSummary.matched} photos across matched species.
            {folderSummary.skippedNonImage > 0 && <> Skipped {folderSummary.skippedNonImage} non-image files.</>}
            {folderSummary.unmatched.length > 0 && (
              <> Could not match folders: <strong>{folderSummary.unmatched.join(', ')}</strong> —
              rename them to the species name in the app, or upload them via Batch mode.</>
            )}
          </div>
        )}
        {mode === 'ai-sort' && (
          <div style={{
            marginTop: 10, padding: '8px 10px', borderRadius: 8,
            background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
            fontSize: 12, color: T.inkSoft, lineHeight: 1.5,
          }}>
            <strong style={{ color: T.ink }}>AI sort</strong> — drop a misc folder of
            unsorted fish photos. Each one is identified by AI (Claude vision, same brain
            as the regulations research) and assigned its species automatically; then hit
            Upload and they land in <strong>Review as pending</strong>, pre-categorized
            with the AI's confidence shown. Photos it can't place stay in the queue for a
            manual pick. Nothing enters training data until you approve it in Review.
          </div>
        )}
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
          Everything lands as <strong>pending</strong> and counts for training only
          after you approve it in Review.
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
            {errorCount > 0 && !uploading && (
              <GhostButton
                onClick={() => setQueue(q => q.map(r => r.status === 'error'
                  ? { ...r, status: 'queued', error: null, stage: null, statusCode: null, code: null }
                  : r))}
                style={{ fontSize: 12, padding: '6px 10px', color: T.warn, borderColor: T.warn }}
              >
                Retry {errorCount} failed
              </GhostButton>
            )}
            {aiPendingCount > 0 && (
              <PrimaryButton
                onClick={aiSortAll}
                disabled={aiSorting || uploading}
                style={{ fontSize: 12, padding: '8px 14px', width: 'auto', flexShrink: 0 }}
              >
                {aiSorting ? `AI sorting… (${aiPendingCount} left)` : `AI sort ${aiPendingCount} photo${aiPendingCount === 1 ? '' : 's'}`}
              </PrimaryButton>
            )}
            <PrimaryButton
              onClick={uploadAll}
              disabled={uploading || aiSorting || readyCount === 0}
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
                : mode === 'ai-sort'
                  ? 'Hit "AI sort" to identify the queued photos, or pick a species on each row manually.'
                  : 'Pick a species on each queued row before uploading.'}
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            {/* Folder imports can queue thousands of rows — rendering
                them all freezes the tab. Show active + recent ones and
                summarize the rest; totals above stay exact. */}
            {(queue.length <= 80
              ? queue
              : [
                  ...queue.filter(r => r.status === 'uploading' || r.status === 'classifying' || r.status === 'error').slice(0, 40),
                  ...queue.filter(r => r.status === 'queued').slice(0, 40),
                ]
            ).map(row => (
              <UploadRow
                key={row.id}
                row={row}
                mode={mode}
                speciesOptions={speciesOptions}
                onSpeciesChange={(sid) => setRowSpecies(row.id, sid)}
                onRemove={() => removeRow(row.id)}
              />
            ))}
            {queue.length > 80 && (
              <div style={{ fontSize: 11, color: T.inkMute, padding: '6px 2px' }}>
                Showing active rows only — {queue.length} total in queue,
                {' '}{doneCount} uploaded so far.
              </div>
            )}
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
    row.status === 'done'        ? T.open :
    row.status === 'error'       ? T.closed :
    row.status === 'uploading'   ? T.brass :
    row.status === 'classifying' ? T.brass :
    T.inkMute;
  const statusLabel =
    row.status === 'done'        ? 'Uploaded' :
    row.status === 'error'       ? 'Error' :
    row.status === 'uploading'   ? 'Uploading…' :
    row.status === 'classifying' ? 'AI sorting…' :
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
        {(mode === 'per-image' || row.aiSort) && row.status === 'queued' && (
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
        {row.aiSort && row.aiConfidence != null && row.status !== 'error' && (
          row.speciesId && row.aiConfidence > 0 ? (
            <div style={{ fontSize: 11, marginTop: 3, color: row.aiConfidence >= 0.75 ? T.open : T.warn }}>
              AI: {Math.round(row.aiConfidence * 100)}% confident{row.aiNote ? ` — ${row.aiNote}` : ''}
            </div>
          ) : !row.speciesId ? (
            <div style={{ fontSize: 11, marginTop: 3, color: T.warn }}>
              {row.aiNote || 'AI could not identify — pick the species manually.'}
            </div>
          ) : null
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
  // Crop-to-recover state — the row currently being cropped + its
  // resolved image URL (signed) for the CropStep component.
  const [cropRow, setCropRow] = useState(null);
  const [cropUrl, setCropUrl] = useState(null);
  // Undo stack — last 5 bulk actions, in-memory only. Each entry has
  // enough info to reverse the mutation via a targeted UPDATE.
  const [undoStack, setUndoStack] = useState([]);
  const [undoing, setUndoing]     = useState(false);
  // AI assist — runs the promoted Fish ID model on the focused photo
  // and shows its top-5 guesses as one-tap approve/recategorize chips.
  const [aiOn, setAiOn]           = useState(false);
  const [aiRuntime, setAiRuntime] = useState(null);
  const [aiStatus, setAiStatus]   = useState(''); // '' | 'loading' | in-strip error text
  const [aiPreds, setAiPreds]     = useState({}); // row.id → [{ speciesId, score }]
  // iNaturalist second opinion — free cross-check via the admin's
  // short-lived iNat token (stored in localStorage).
  const [inatToken, setInatToken] = useState(
    (typeof localStorage !== 'undefined' && localStorage.getItem(INAT_TOKEN_KEY)) || ''
  );
  const [inatTokenOpen, setInatTokenOpen] = useState(false);
  const [inatPreds, setInatPreds] = useState({}); // row.id → { results } | { error }

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

  // AI assist: load the model runtime the first time it's switched on.
  // Failures land in the panel's error banner and flip the toggle back
  // off so it can be retried (loadFishIdRuntime clears its cache on
  // failure).
  useEffect(() => {
    if (!aiOn || aiRuntime) return undefined;
    let alive = true;
    setAiStatus('loading');
    loadFishIdRuntime()
      .then(rt => { if (alive) { setAiRuntime(rt); setAiStatus(''); } })
      .catch(e => {
        if (!alive) return;
        setError(`AI assist: ${e?.message || e}`);
        setAiStatus('');
        setAiOn(false);
      });
    return () => { alive = false; };
  }, [aiOn, aiRuntime]);

  // The row the AI strip operates on: the keyboard cursor, but only
  // while no multi-selection is active (chips are single-photo).
  const aiRow = aiOn && selected.size === 0 ? (rows[cursor] || null) : null;

  // Predict the focused row once; results cache per row id for the
  // panel's lifetime so arrowing back is instant.
  useEffect(() => {
    if (!aiRuntime || !aiRow || aiPreds[aiRow.id]) return undefined;
    let alive = true;
    setAiStatus('');
    (async () => {
      try {
        const u = await signedUrl(aiRow.storage_path);
        if (!u) throw new Error('signed url failed');
        const top5 = await predictTop5(aiRuntime, u);
        if (alive) setAiPreds(p => ({ ...p, [aiRow.id]: top5 }));
      } catch (e) {
        if (alive) setAiStatus(`AI check failed: ${e?.message || e}`);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRuntime, aiRow?.id]);

  // iNaturalist second opinion for the focused row — runs alongside
  // the Big Red predict whenever AI assist is on and a token is set.
  // Cached per row id. A stale/expired token surfaces inline so the
  // reviewer knows to refresh it.
  useEffect(() => {
    if (!aiOn || !aiRow || !inatToken || inatPreds[aiRow.id]) return undefined;
    let alive = true;
    (async () => {
      const res = await inatIdentifyPhoto(aiRow.storage_path);
      if (alive) setInatPreds(p => ({ ...p, [aiRow.id]: res }));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, aiRow?.id, inatToken]);

  const saveInatToken = (val) => {
    const t = (val || '').trim();
    setInatToken(t);
    setInatPreds({}); // re-query with the new token
    try {
      if (t) localStorage.setItem(INAT_TOKEN_KEY, t);
      else localStorage.removeItem(INAT_TOKEN_KEY);
    } catch { /* private mode — in-memory only */ }
  };

  // Chip tap: the chip matching the row's current label approves it;
  // any other chip moves the photo to that species (verified, with
  // original_species_id kept as the audit trail — see correctSpecies).
  const aiPickChip = (cand) => {
    if (!aiRow || !cand?.speciesId) return;
    if (cand.speciesId === aiRow.species_id) doApprove([aiRow.id]);
    else doCorrect([aiRow.id], cand.speciesId);
  };

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
      else if (/^[1-5]$/.test(key) && aiOn && selected.size === 0 && rows[cursor]) {
        // AI assist: digits pick the Nth model guess for the focused
        // photo — same action as tapping the chip.
        const cand = (aiPreds[rows[cursor].id] || [])[Number(key) - 1];
        if (cand) { e.preventDefault(); aiPickChip(cand); }
      }
      else if (e.key === 'Escape') { setSelected(new Set()); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cursor, selected, correctPickerOpen, rejectPickerOpen, aiOn, aiPreds]);

  // --- Safety rails around every bulk mutation ---
  //
  // A hard confirm before touching more than CONFIRM_THRESHOLD rows —
  // paid this bill once with a 1,343-photo mass-reject and never want
  // to again. The count + destination are in the prompt so a bleary
  // fat-finger has to type through the intent.
  //
  // Every bulk action pushes a snapshot of the affected rows' prior
  // status/species_id/rejection_reason onto undoStack (capped at 5),
  // so the header's "Undo last" button can walk them back with one
  // targeted UPDATE per unique target state.
  //
  // Console gets a [review-bulk] breadcrumb per mutation — forensic
  // trail if this ever misfires again.
  const CONFIRM_THRESHOLD = 20;
  const now = () => new Date().toISOString();

  const confirmBulk = (count, label) => {
    if (count <= CONFIRM_THRESHOLD) return true;
    return window.confirm(
      `${label}\n\nThis will change ${count} training photos. ` +
      `Cancel to reconsider — this is exactly the size of accident that ` +
      `has bitten us before.`
    );
  };

  const snapshotFor = (ids) => ids
    .map(id => rows.find(r => r.id === id))
    .filter(Boolean)
    .map(r => ({
      id: r.id,
      status: r.status,
      species_id: r.species_id,
      rejection_reason: r.rejection_reason || null,
    }));

  const pushUndo = (label, snapshots) => {
    if (!snapshots || snapshots.length === 0) return;
    setUndoStack(s => [{ label, at: now(), snapshots }, ...s].slice(0, 5));
  };

  const doApprove = async (ids) => {
    if (ids.length === 0) return;
    if (!confirmBulk(ids.length, `Approve ${ids.length} photos as verified?`)) return;
    const snaps = snapshotFor(ids);
    console.log('[review-bulk]', now(), 'approve', {
      count: ids.length,
      idsSample: ids.slice(0, 5),
      priorStatusSample: snaps.slice(0, 5).map(s => s.status),
    });
    pushUndo(`Approve ${ids.length}`, snaps);
    const r = await approve(ids);
    if (!r.ok) return setError(r.error || 'approve failed');
    refresh();
  };
  const doReject = async (ids, reason) => {
    // Guard: caller MUST provide a reason. Dismissing the picker
    // returns undefined here — abort silently rather than treat the
    // absence as "just use the last one".
    if (!reason) {
      console.log('[review-bulk]', now(), 'reject aborted — no reason provided');
      return;
    }
    if (ids.length === 0) return;
    if (!confirmBulk(ids.length, `Reject ${ids.length} photos as "${reason}"?`)) return;
    const snaps = snapshotFor(ids);
    console.log('[review-bulk]', now(), 'reject', {
      count: ids.length, reason,
      idsSample: ids.slice(0, 5),
      priorStatusSample: snaps.slice(0, 5).map(s => s.status),
    });
    pushUndo(`Reject ${ids.length} as "${reason}"`, snaps);
    const r = await reject(ids, reason);
    if (!r.ok) return setError(r.error || 'reject failed');
    refresh();
  };
  const doCorrect = async (ids, newSpeciesId) => {
    if (!newSpeciesId) {
      console.log('[review-bulk]', now(), 'correct aborted — no species picked');
      return;
    }
    if (ids.length === 0) return;
    if (!confirmBulk(ids.length, `Correct ${ids.length} photos to species "${newSpeciesId}"?`)) return;
    const snaps = snapshotFor(ids);
    console.log('[review-bulk]', now(), 'correct', {
      count: ids.length, newSpeciesId,
      priorSpeciesSample: snaps.slice(0, 5).map(s => s.species_id),
    });
    pushUndo(`Correct ${ids.length} → ${newSpeciesId}`, snaps);
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

  const openCrop = async (row) => {
    // The Review panel already has a signed-URL helper via ReviewTile's
    // own useEffect; here we resolve one for the modal separately so
    // the URL is fresh at open time.
    setCropRow(row);
    const u = await signedUrl(row.storage_path);
    setCropUrl(u);
  };

  const closeCrop = () => { setCropRow(null); setCropUrl(null); };

  const applyCropSave = async ({ bbox }) => {
    if (!cropRow) return;
    if (!bbox) { setError('crop returned no bbox'); closeCrop(); return; }
    const priorId = cropRow.id;
    const priorStatus = cropRow.status;
    const priorReason = cropRow.rejection_reason;
    // Close the modal first so the TrainingTab error banner (rendered
    // behind the modal at z-index 0) is visible if the save fails.
    // Was previously an early-return-without-close, which made every
    // save error look like a dead button.
    closeCrop();
    const r = await saveCropRecover(priorId, bbox);
    if (!r.ok) { setError(r.error || 'crop save failed'); return; }
    console.log('[review-bulk]', new Date().toISOString(), 'crop-recover', {
      id: priorId, bbox, priorStatus, priorReason,
    });
    refresh();
  };

  const undoLast = async () => {
    if (undoStack.length === 0 || undoing) return;
    const [top, ...rest] = undoStack;
    if (!window.confirm(`Undo "${top.label}"?\n\nRestores ${top.snapshots.length} photos to their prior state.`)) return;
    setUndoing(true);
    console.log('[review-bulk]', now(), 'undo', {
      label: top.label,
      count: top.snapshots.length,
      wasAt: top.at,
    });
    const r = await restoreTrainingRows(top.snapshots);
    setUndoing(false);
    if (!r.ok) { setError(r.error || 'undo failed'); return; }
    setUndoStack(rest);
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
              <option value="all">All</option>
            </select>
          </div>
          <GhostButton onClick={refresh} disabled={loading} style={{ padding: '10px 14px' }}>
            {loading ? 'Loading…' : 'Refresh'}
          </GhostButton>
          <GhostButton
            onClick={() => setAiOn(v => !v)}
            style={{
              padding: '10px 14px',
              ...(aiOn ? { color: T.brass, borderColor: T.brass } : {}),
            }}
            title="Run the promoted Fish ID model on the focused photo and show its top-5 guesses as one-tap chips"
          >
            {aiOn ? (aiStatus === 'loading' ? 'AI assist: loading…' : 'AI assist: ON') : 'AI assist'}
          </GhostButton>
          {aiOn && (
            <GhostButton
              onClick={() => setInatTokenOpen(v => !v)}
              style={{ padding: '10px 14px', ...(inatToken ? { color: T.open, borderColor: T.open } : {}) }}
              title="iNaturalist gives a free second opinion. Paste a token from inaturalist.org/users/api_token (expires ~24h)."
            >
              {inatToken ? 'iNat: on' : 'iNat: add token'}
            </GhostButton>
          )}
          {undoStack.length > 0 && (
            <GhostButton
              onClick={undoLast}
              disabled={undoing}
              style={{ padding: '10px 14px', color: T.brass, borderColor: T.brass }}
              title={`Undo: ${undoStack[0].label}`}
            >
              {undoing ? 'Undoing…' : `Undo last (${undoStack.length})`}
            </GhostButton>
          )}
        </div>

        {aiOn && inatTokenOpen && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
          }}>
            <SectionLabel style={{ marginBottom: 6 }}>iNaturalist token</SectionLabel>
            <div style={{ fontSize: 11, color: T.inkSoft, lineHeight: 1.5, marginBottom: 8 }}>
              A free second opinion from iNaturalist's fish model. Sign in to iNaturalist,
              open <span style={{ color: T.brass }}>inaturalist.org/users/api_token</span>,
              copy the token, and paste it here. It expires about every 24 hours — re-paste
              when iNat says the token's stale.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="password"
                value={inatToken}
                onChange={e => setInatToken(e.target.value)}
                placeholder="Paste iNat API token…"
                style={{ ...inputStyle, flex: 1, fontFamily: 'monospace', fontSize: 11 }}
              />
              <GhostButton onClick={() => { saveInatToken(inatToken); setInatTokenOpen(false); }} style={{ padding: '8px 14px' }}>
                Save
              </GhostButton>
              {inatToken && (
                <GhostButton onClick={() => saveInatToken('')} style={{ padding: '8px 14px', color: T.closed, borderColor: T.closed }}>
                  Clear
                </GhostButton>
              )}
            </div>
          </div>
        )}

        {/* The old "Verify all my uploads" bulk backlog button lived
            here — removed deliberately. Every upload now lands pending
            and Review IS the quality gate (scraped batches carry
            wrong-species shots); a one-tap mass-verify would defeat
            it. Approve photos through the review flow below. */}

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

          {/* AI assist strip — the model's read on the focused photo.
              One tap on the chip matching the label approves; a tap on
              any other chip recategorizes the photo to that species.
              Hidden while a multi-selection is active (chips are
              strictly single-photo actions). */}
          {aiRow && (
            <Card>
              <SectionLabel>
                Model check{aiRuntime ? ` — ${aiRuntime.versionName}` : ''}
              </SectionLabel>
              {(() => {
                const preds = aiPreds[aiRow.id];
                const rowName = SPECIES.find(s => s.id === aiRow.species_id)?.commonName || aiRow.species_id;
                if (!preds) {
                  return (
                    <div style={{ fontSize: 12, color: aiStatus.startsWith('AI check failed') ? T.closed : T.inkMute, marginTop: 6 }}>
                      {aiStatus.startsWith('AI check failed') ? aiStatus
                        : aiStatus === 'loading' ? 'Loading model…'
                        : 'Checking photo…'}
                    </div>
                  );
                }
                const agrees = preds[0]?.speciesId === aiRow.species_id;
                return (
                  <>
                    <div style={{ fontSize: 12, marginTop: 6, fontWeight: 700, color: agrees ? T.open : T.brass }}>
                      {agrees
                        ? `Model agrees this is a ${rowName} (${Math.round((preds[0]?.score || 0) * 100)}%)`
                        : `Model's top pick differs from the label (${rowName})`}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      {preds.map((cand, i) => {
                        const sp = SPECIES.find(s => s.id === cand.speciesId);
                        const isLabel = cand.speciesId === aiRow.species_id;
                        return (
                          <button
                            key={cand.speciesId}
                            onClick={() => aiPickChip(cand)}
                            title={isLabel ? 'Approve this photo as-is' : `Move this photo to ${sp?.commonName || cand.speciesId} (verified)`}
                            style={{
                              background: isLabel ? T.open : T.parchmentDeep,
                              color: isLabel ? T.oceanDeep : T.ink,
                              border: `1px solid ${isLabel ? T.open : T.cardEdge}`,
                              borderRadius: 999, padding: '7px 12px',
                              fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            }}
                          >
                            {i + 1}. {sp?.commonName || cand.speciesId}
                            <span style={{ opacity: 0.7, marginLeft: 5, fontWeight: 600 }}>
                              {Math.round(cand.score * 100)}%
                            </span>
                            {isLabel && ' ✓'}
                          </button>
                        );
                      })}
                      <GhostButton
                        onClick={() => setCorrectPickerOpen(true)}
                        style={{ fontSize: 12, padding: '7px 12px' }}
                      >
                        Not listed — search…
                      </GhostButton>
                    </div>
                    <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
                      Tap the ✓ chip (or its number key) to approve as {rowName}; tap another
                      chip to recategorize the photo to that species. Keys <b>1–5</b> pick a chip.
                    </div>
                  </>
                );
              })()}

              {/* iNaturalist second opinion — a free cross-check. When
                  its top pick agrees with Big Red's or the row label,
                  that's a strong confirm signal. */}
              {inatToken && (() => {
                const ip = inatPreds[aiRow.id];
                if (!ip) {
                  return <div style={{ fontSize: 11, color: T.inkMute, marginTop: 10 }}>iNaturalist: checking…</div>;
                }
                if (!ip.ok) {
                  const stale = ip.error === 'inat_auth';
                  return (
                    <div style={{ fontSize: 11, color: stale ? T.warn : T.inkMute, marginTop: 10 }}>
                      {stale
                        ? 'iNaturalist token expired — tap "iNat: on" above to paste a fresh one.'
                        : `iNaturalist: no read (${ip.error}).`}
                    </div>
                  );
                }
                if (ip.results.length === 0) {
                  return <div style={{ fontSize: 11, color: T.inkMute, marginTop: 10 }}>iNaturalist: no match in our species list.</div>;
                }
                const top = ip.results[0];
                const agreesLabel = top.speciesId === aiRow.species_id;
                return (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.cardEdge}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: agreesLabel ? T.open : T.inkSoft }}>
                      iNaturalist: {top.commonName} ({Math.round(top.score * 100)}%)
                      {agreesLabel && ' — agrees ✓'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {ip.results.map(r => {
                        const isLabel = r.speciesId === aiRow.species_id;
                        return (
                          <button
                            key={r.speciesId}
                            onClick={() => aiPickChip({ speciesId: r.speciesId })}
                            title={isLabel ? 'Approve this photo as-is' : `Move this photo to ${r.commonName}`}
                            style={{
                              background: isLabel ? T.openBg : T.parchmentDeep,
                              color: T.ink, border: `1px solid ${isLabel ? T.open : T.cardEdge}`,
                              borderRadius: 999, padding: '5px 10px',
                              fontSize: 11, fontWeight: 600, cursor: 'pointer',
                            }}
                          >
                            {r.commonName}
                            <span style={{ opacity: 0.7, marginLeft: 4 }}>{Math.round(r.score * 100)}%</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
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
                onCrop={() => openCrop(r)}
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
          count={focusedIds.length}
          onPick={(reason) => {
            setRejectPickerOpen(false);
            // Defense in depth: never treat a falsy reason as valid.
            // ReasonPickerModal cannot produce one, but a future
            // refactor that adds a keyboard-focused "default" button
            // would ship silently through here otherwise.
            if (!reason) {
              console.log('[review-bulk]', new Date().toISOString(), 'reject picker returned no reason — aborting');
              return;
            }
            doReject(focusedIds, reason);
          }}
          onCancel={() => {
            console.log('[review-bulk]', new Date().toISOString(), 'reject picker cancelled — no rows modified');
            setRejectPickerOpen(false);
          }}
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

      {cropRow && cropUrl && (
        <CropStep
          imageSrc={cropUrl}
          onCancel={closeCrop}
          onConfirm={applyCropSave}
          title={`Crop to recover — ${cropRow.species_id}`}
          primaryLabel="Save crop &amp; verify"
          cancelLabel="Cancel"
        />
      )}
    </div>
  );
}

function ReviewTile({ row, selected, focused, onClick, onToggle, onCrop, showSpecies = false }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    signedUrl(row.storage_path).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [row.storage_path]);

  // 'corrected' kept in the palette as a defensive fallback for any
  // legacy rows still tagged that way; new corrections land as
  // 'verified' with original_species_id set (see correctSpecies).
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

  // Show the pre-correction species inline so a verified-via-Correct
  // row still surfaces its audit trail visually.
  const origSp = row.original_species_id
    ? SPECIES.find(s => s.id === row.original_species_id)
    : null;
  const origLabel = row.original_species_id
    ? (origSp?.commonName || row.original_species_id)
    : null;

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
      <div style={{ width: '100%', aspectRatio: '1 / 1', background: T.parchmentDeep, position: 'relative' }}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        {onCrop && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCrop(); }}
            aria-label="Crop this photo to recover it"
            title="Crop to recover"
            style={{
              position: 'absolute', top: 6, right: 6,
              background: 'rgba(6,20,36,0.75)', border: `1px solid ${T.brass}`,
              color: T.brass, borderRadius: 6,
              padding: '4px 8px', fontSize: 10, fontWeight: 800,
              cursor: 'pointer', letterSpacing: 0.4,
            }}
          >
            CROP
          </button>
        )}
        {row.crop_bbox && (
          <div aria-hidden style={{
            position: 'absolute',
            left:   `${(row.crop_bbox.x || 0) * 100}%`,
            top:    `${(row.crop_bbox.y || 0) * 100}%`,
            width:  `${(row.crop_bbox.w || 0) * 100}%`,
            height: `${(row.crop_bbox.h || 0) * 100}%`,
            border: `1.5px solid ${T.brass}`,
            boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }} />
        )}
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
      {origLabel && (
        <div style={{
          padding: '0 8px 6px', fontSize: 10, color: T.inkMute,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontStyle: 'italic',
        }}>
          was originally: {origLabel}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Swipe review — gamified, mobile-first mass verification.
   One pending photo at a time as a card:
     swipe RIGHT  → approve (verified)
     swipe LEFT   → reject
     "Correct the species" button → picker → recategorize + verify
   Built for fast thumb-driven passes over big folder imports.
   ============================================================ */
function SwipeReviewPanel() {
  const [speciesId, setSpeciesId] = useState('__all__');
  // 'pending' = verify new imports; 'verified' = audit already-approved
  // photos (catch mislabels — a wrong label hurts training).
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [done, setDone] = useState({ approved: 0, rejected: 0, corrected: 0, kept: 0 });
  const [undo, setUndo] = useState(null); // { row, action } for one-level undo
  const [menuOpen, setMenuOpen] = useState(false); // collapse controls on mobile
  const [cropOpen, setCropOpen] = useState(false);
  const [cropPreview, setCropPreview] = useState({}); // row.id → cropped dataUrl
  // Drag state for the top card.
  const [drag, setDrag] = useState({ x: 0, active: false });
  const startX = useRef(0);
  const cardUrl = useRef(new Map()); // row.id → signed url cache

  const speciesOptions = useMemo(
    () => [...SPECIES].filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const arg = speciesId === '__all__' ? null : speciesId;
    const res = await listTrainingImages({ speciesId: arg, status: statusFilter });
    setLoading(false);
    if (!res.ok) { setError(res.error || 'load failed'); return; }
    setRows(res.rows);
    setIdx(0);
    setDone({ approved: 0, rejected: 0, corrected: 0, kept: 0 });
    setUndo(null);
  }, [speciesId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const current = rows[idx] || null;
  const next = rows[idx + 1] || null;

  // Resolve signed URLs for the current + next card (prefetch next so
  // it's ready the instant the top card flies off).
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    const want = [current, next].filter(Boolean);
    (async () => {
      for (const r of want) {
        if (cardUrl.current.has(r.id)) continue;
        const u = await signedUrl(r.storage_path);
        if (!alive) return;
        if (u) { cardUrl.current.set(r.id, u); setUrls(m => ({ ...m, [r.id]: u })); }
      }
    })();
    return () => { alive = false; };
  }, [current?.id, next?.id]);

  // Optimistic: advance the UI immediately, fire the DB write in the
  // background so a fast pass never waits on the network.
  const bg = (p) => { p.then(r => { if (!r || !r.ok) setError((r && r.error) || 'save failed — reload to re-check'); }, () => setError('save failed — reload to re-check')); };
  const record = (row, action) => {
    setUndo({ row, action });
    setDone(d => ({
      approved:  d.approved  + (action === 'approve'  ? 1 : 0),
      rejected:  d.rejected  + (action === 'reject'   ? 1 : 0),
      corrected: d.corrected + (action === 'correct'  ? 1 : 0),
      kept:      d.kept      + (action === 'keep'     ? 1 : 0),
    }));
    setDrag({ x: 0, active: false });
    setIdx(i => i + 1);
  };

  const doApprove = (row) => {
    if (!row) return;
    // In audit mode the row is already verified — right swipe just
    // "keeps" it (no write, fastest path).
    if (statusFilter === 'verified') { record(row, 'keep'); return; }
    record(row, 'approve');
    bg(approve([row.id]));
  };
  const doReject = (row) => {
    if (!row) return;
    record(row, 'reject');
    bg(reject([row.id], 'swipe_reject'));
  };
  const doCorrect = (newId) => {
    setPickerOpen(false);
    const row = current;
    if (!row || !newId) return;
    record(row, 'correct');
    bg(correctSpecies([row.id], newId, row.species_id));
  };
  const doUndo = () => {
    if (!undo) return;
    const { row, action } = undo;
    setUndo(null);
    setIdx(i => Math.max(0, i - 1));
    setDrag({ x: 0, active: false });
    setDone(d => ({
      approved:  d.approved  - (action === 'approve'  ? 1 : 0),
      rejected:  d.rejected  - (action === 'reject'   ? 1 : 0),
      corrected: d.corrected - (action === 'correct'  ? 1 : 0),
      kept:      d.kept      - (action === 'keep'     ? 1 : 0),
    }));
    if (action === 'keep') return; // nothing was written
    // Restore to the batch's original status + species.
    bg(restoreTrainingRows([{ id: row.id, status: statusFilter, species_id: row.species_id, rejection_reason: null }]));
  };

  // Pointer drag on the top card.
  const THRESHOLD = 90;
  const onDown = (e) => { if (busy) return; startX.current = e.clientX; setDrag({ x: 0, active: true }); e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (!drag.active) return; setDrag(d => ({ ...d, x: e.clientX - startX.current })); };
  const onUp = () => {
    if (!drag.active) return;
    const x = drag.x;
    if (x > THRESHOLD) doApprove(current);
    else if (x < -THRESHOLD) doReject(current);
    else setDrag({ x: 0, active: false });
  };

  // Keyboard: ← reject, → approve, c correct, u undo.
  useEffect(() => {
    const onKey = (e) => {
      if (pickerOpen) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); doApprove(current); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); doReject(current); }
      else if (e.key.toLowerCase() === 'c') { e.preventDefault(); if (current) setPickerOpen(true); }
      else if (e.key.toLowerCase() === 'u') { e.preventDefault(); doUndo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, busy, pickerOpen, undo]);

  const remaining = rows.length - idx;
  const curSpecies = current ? SPECIES.find(s => s.id === current.species_id) : null;
  const rot = drag.x / 18; // deg

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 460, margin: '0 auto' }}>
      <Card style={{ padding: '10px 12px' }}>
        {/* Compact bar: live status + counts on the left, a single
            hamburger on the right. Keeps the card on-screen on phones. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
            <div style={{ color: T.ink, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statusFilter === 'verified' ? 'Audit verified' : 'Verify pending'}
              {' · '}{speciesId === '__all__' ? 'All species' : (speciesOptions.find(s => s.id === speciesId)?.commonName || speciesId)}
            </div>
            <div style={{ marginTop: 2, color: T.inkSoft }}>
              {statusFilter === 'verified'
                ? <span style={{ color: T.open }}>✓ {done.kept}</span>
                : <span style={{ color: T.open }}>✓ {done.approved}</span>}
              <span style={{ color: T.closed }}> · ✕ {done.rejected}</span>
              <span style={{ color: T.brass }}> · ✎ {done.corrected}</span>
              <span style={{ color: T.inkMute }}> · {Math.max(0, remaining)} left</span>
            </div>
          </div>
          {undo && <button onClick={doUndo} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Undo</button>}
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Menu"
            style={{
              flexShrink: 0, width: 40, height: 40, borderRadius: 8,
              background: menuOpen ? T.brass : 'transparent',
              border: `1px solid ${menuOpen ? T.brass : T.cardEdge}`,
              color: menuOpen ? T.oceanDeep : T.ink, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <MenuIcon size={20} />
          </button>
        </div>

        {menuOpen && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div>
              <SectionLabel style={{ marginBottom: 6 }}>Mode</SectionLabel>
              <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }} style={inputStyle}>
                <option value="pending">Verify pending</option>
                <option value="verified">Audit verified</option>
              </select>
            </div>
            <div>
              <SectionLabel style={{ marginBottom: 6 }}>Species</SectionLabel>
              <select value={speciesId} onChange={e => setSpeciesId(e.target.value)} style={inputStyle}>
                <option value="__all__">All species</option>
                {speciesOptions.map(s => <option key={s.id} value={s.id}>{s.commonName}</option>)}
              </select>
            </div>
            <GhostButton onClick={() => { load(); setMenuOpen(false); }} disabled={loading} style={{ padding: '10px 14px' }}>
              {loading ? 'Loading…' : 'Reload'}
            </GhostButton>
            {statusFilter === 'verified' && (
              <div style={{ fontSize: 11, color: T.inkMute, lineHeight: 1.5 }}>
                Audit pass — swipe right to keep, left to reject a bad one, or correct a mislabel.
              </div>
            )}
          </div>
        )}
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>{error}</div>
      )}

      {!current && !loading && (
        <Card style={{ textAlign: 'center', padding: 28, fontSize: 14, color: T.inkMute }}>
          {rows.length === 0 ? `No ${statusFilter} photos to review.` : 'All done — nothing left in this batch.'}
          {rows.length > 0 && <div style={{ marginTop: 10 }}><GhostButton onClick={load}>Reload for more</GhostButton></div>}
        </Card>
      )}

      {current && (
        <>
          {/* Card stack — next card peeks behind the draggable top card. */}
          <div style={{ position: 'relative', height: 420, userSelect: 'none' }}>
            {next && (
              <div style={{
                position: 'absolute', inset: 0, transform: 'scale(0.96) translateY(8px)',
                borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.cardEdge}`, background: T.parchmentDeep,
              }}>
                {urls[next.id] && <img src={urls[next.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />}
              </div>
            )}
            <div
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{
                position: 'absolute', inset: 0,
                borderRadius: 16, overflow: 'hidden',
                border: `1px solid ${T.cardEdge}`, background: '#000',
                transform: `translateX(${drag.x}px) rotate(${rot}deg)`,
                transition: drag.active ? 'none' : 'transform 200ms ease-out',
                cursor: 'grab', touchAction: 'pan-y',
                boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
              }}
            >
              {(cropPreview[current.id] || urls[current.id])
                ? <img src={cropPreview[current.id] || urls[current.id]} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.inkMute, fontSize: 13 }}>Loading photo…</div>}

              {/* Crop button — top-right. stopPropagation so grabbing it
                  doesn't start a swipe. */}
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); if (urls[current.id]) setCropOpen(true); }}
                aria-label="Crop photo"
                style={{
                  position: 'absolute', top: 12, right: 12,
                  width: 42, height: 42, borderRadius: 999,
                  background: cropPreview[current.id] ? T.brass : 'rgba(3,27,51,0.7)',
                  color: cropPreview[current.id] ? T.oceanDeep : T.ink,
                  border: `1px solid ${cropPreview[current.id] ? T.brass : 'rgba(255,255,255,0.25)'}`,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <CropIcon size={18} />
              </button>

              {/* Species label chip */}
              <div style={{
                position: 'absolute', left: 12, bottom: 12, right: 12,
                background: 'rgba(3,27,51,0.8)', color: T.ink,
                padding: '8px 12px', borderRadius: 10, fontSize: 15, fontWeight: 800,
              }}>
                {curSpecies?.commonName || current.species_id}
              </div>

              {/* Swipe intent overlays */}
              <div aria-hidden style={{
                position: 'absolute', top: 16, left: 16,
                border: `3px solid ${T.open}`, color: T.open,
                padding: '4px 12px', borderRadius: 8, fontWeight: 900, fontSize: 22, letterSpacing: 1,
                transform: 'rotate(-12deg)', opacity: Math.max(0, Math.min(1, drag.x / THRESHOLD)),
              }}>KEEP</div>
              <div aria-hidden style={{
                position: 'absolute', top: 16, right: 16,
                border: `3px solid ${T.closed}`, color: T.closed,
                padding: '4px 12px', borderRadius: 8, fontWeight: 900, fontSize: 22, letterSpacing: 1,
                transform: 'rotate(12deg)', opacity: Math.max(0, Math.min(1, -drag.x / THRESHOLD)),
              }}>NOPE</div>
            </div>
          </div>

          {/* Action buttons — reject / correct / approve */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
            <button onClick={() => doReject(current)} disabled={busy} aria-label="Reject" style={circleBtn(T.closed)}>✕</button>
            <button onClick={() => setPickerOpen(true)} disabled={busy} style={{
              flex: 1, maxWidth: 200, background: 'transparent', border: `1.5px solid ${T.brass}`,
              color: T.brass, borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}>Correct the species</button>
            <button onClick={() => doApprove(current)} disabled={busy} aria-label="Approve" style={circleBtn(T.open)}>✓</button>
          </div>
          <div style={{ fontSize: 11, color: T.inkMute, textAlign: 'center' }}>
            Swipe right to keep, left to reject · keys ← ✕ · → ✓ · C correct · U undo
          </div>
        </>
      )}

      {pickerOpen && current && (
        <SpeciesPickerModal
          speciesOptions={speciesOptions}
          currentSpeciesId={current.species_id}
          onCancel={() => setPickerOpen(false)}
          onPick={doCorrect}
          title="Correct the species"
        />
      )}

      {cropOpen && current && urls[current.id] && (
        <CropStep
          imageSrc={urls[current.id]}
          title="Crop this photo"
          primaryLabel="Use crop"
          cancelLabel="Cancel"
          onCancel={() => setCropOpen(false)}
          onConfirm={({ dataUrl, bbox }) => {
            setCropOpen(false);
            const id = current.id;
            // Show the cropped view immediately; persist the bbox so the
            // export applies it. Status stays put — still swipe to decide.
            if (dataUrl) setCropPreview(m => ({ ...m, [id]: dataUrl }));
            if (bbox) saveCropBbox(id, bbox).then(r => { if (!r.ok) setError(r.error || 'crop save failed'); });
          }}
        />
      )}
    </div>
  );
}

function circleBtn(color) {
  return {
    width: 56, height: 56, borderRadius: 999, flexShrink: 0,
    background: 'transparent', border: `2px solid ${color}`, color,
    fontSize: 24, fontWeight: 900, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

/* ============================================================
   Modals
   ============================================================ */
function ReasonPickerModal({ onPick, onCancel, count = 0 }) {
  const title = count > 1
    ? `Reject ${count} photos — pick a reason`
    : 'Reject — pick a reason';
  return (
    <ModalShell onCancel={onCancel} title={title}>
      <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
        Fresh reason required each time — no default is remembered.
        Click Cancel to abort with no rows modified.
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {REJECT_REASONS.map(r => (
          <button
            key={r.key}
            type="button"
            // type="button" so Enter on any other focused element
            // (e.g., the bulk-action bar underneath the modal) cannot
            // implicit-submit into a reason. Buttons only fire on
            // explicit pointer click / Space/Enter WHILE focused —
            // which requires the user to have deliberately tabbed to
            // this control.
            onClick={() => onPick(r.key)}
            style={{
              background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
              color: T.ink, padding: '10px 12px', borderRadius: 8,
              fontSize: 13, textAlign: 'left', cursor: 'pointer',
            }}
          >
            {r.label}
          </button>
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
  // Live categories for the filter dropdown — subscribe so an admin
  // adding a new category on the Categories tab sees it here without
  // reload.
  const [cats, setCats] = useState(() => getCategories());
  useEffect(() => subscribeCategoriesStore(() => setCats(getCategories())), []);

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
        <div style={{
          fontSize: 11, color: T.inkSoft, marginTop: 8, padding: '8px 10px',
          background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
          borderRadius: 6, lineHeight: 1.5,
        }}>
          Only <b style={{ color: T.ink }}>verified</b> photos count toward the tier.
          Photos you upload from the admin console are <b style={{ color: T.ink }}>auto-verified</b> —
          they land in training immediately. Photos coming in from user model corrections
          arrive as pending and need you to accept them on the <b style={{ color: T.ink }}>Review</b> tab
          before they count.
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
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
      // No more client-side ZIP build + giant blob upload. Instead, we
      // mint signed URLs for every training photo (chunked, batched
      // via the plural createSignedUrls endpoint) and roll the whole
      // list into a small JSON manifest. Colab downloads the manifest,
      // then pulls each photo in parallel directly from Supabase.
      //
      // Wins:
      //   - Manifest is ~KB per photo, tops. Even 10k photos → ~2MB.
      //   - No JSZip in the browser (used to hold every photo in RAM).
      //   - Upload finishes in seconds. No more Safari-suspended-tab
      //     losses overnight.
      //   - Colab downloads in parallel (way faster than the previous
      //     sequential-then-zip flow).

      setProgress({ done: 0, total: plan.plan.length, status: 'Minting signed URLs…' });
      const paths = plan.plan.map(p => p.storage_path);
      const su = await trainingPhotoSignedUrls(paths, 86400); // 24h
      if (!su.ok) throw new Error(su.error || 'signed URL batch failed');
      if (su.urls.length !== paths.length) {
        throw new Error(`URL count mismatch: got ${su.urls.length} of ${paths.length}`);
      }
      const missing = su.urls.filter(u => !u).length;
      if (missing > 0) {
        throw new Error(`${missing} photos returned no signed URL — some storage rows may be orphaned`);
      }

      setProgress({ done: plan.plan.length, total: plan.plan.length, status: 'Building manifest…' });
      const manifest = {
        version: 2, // v2 = signed-URL manifest (no bundled photo bytes)
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
        // photos[] is what colab_run.py iterates. Every row is
        // self-contained — Colab just downloads url → path.
        photos: plan.plan.map((p, i) => ({
          path: `${p.split}/${p.species_id}/${p.filename}`,
          species_id: p.species_id,
          split: p.split,
          crop_bbox: p.crop_bbox || null,
          storage_path: p.storage_path,
          url: su.urls[i],
        })),
      };

      setProgress({ done: plan.plan.length, total: plan.plan.length, status: 'Uploading manifest…' });
      const up = await uploadExport({
        manifest,
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

        <details style={{
          background: T.parchmentDeep, borderRadius: 8, padding: '10px 12px',
          border: `1px solid ${T.cardEdge}`, fontSize: 12, color: T.inkSoft,
          marginBottom: 10,
        }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: T.brass, letterSpacing: 0.3 }}>
            How to run the Colab cell →
          </summary>
          <div style={{ marginTop: 10, lineHeight: 1.6 }}>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>Click <strong>Copy Colab cell</strong> below on the newest export.</li>
              <li>Open a new tab: <code>colab.research.google.com</code> → <strong>File → New notebook</strong>.</li>
              <li><strong>CRITICAL:</strong> Runtime → <strong>Change runtime type</strong> → pick <strong>L4 GPU</strong> (or T4 if L4 unavailable) → Save. Wait for the green "Connected" indicator top-right.</li>
              <li>Verify GPU: type <code>!nvidia-smi</code> in a cell → Run. Should show an NVIDIA card. Skip this and you'll land on CPU — training takes hours instead of ~30 min.</li>
              <li>New code cell → paste (⌘V) → click ▶ (or Shift+Enter).</li>
              <li>Walk away 30-60 min. It downloads all photos, trains, INT8-quantizes, uploads the bundle back automatically.</li>
              <li>When it finishes: come back here → <strong>Models</strong> tab → <strong>Pending bundles</strong> → click <strong>Import</strong> → name it (default is Big Red N.0, override with e.g. <em>Big Red 1.1</em>) → click <strong>Promote</strong>.</li>
              <li>Phone: Settings → Fish ID model → <strong>Check for updates</strong> → new version loads.</li>
            </ol>
            <div style={{ marginTop: 10, padding: '8px 10px', background: T.warnBg, borderRadius: 6, color: T.warn, fontSize: 11 }}>
              <strong>Colab tips:</strong> plug the Mac in, keep the tab focused, don't lock the screen. If you upgrade to Colab Pro ($10/mo) GPU availability is much better and you won't get idle-disconnected.
            </div>
          </div>
        </details>
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
                      padding: '6px 10px', fontSize: 11, fontWeight: 800,
                      color: state === 'copied' ? T.open : (state === 'error' ? T.closed : T.brass),
                      borderColor: state === 'copied' ? T.open : (state === 'error' ? T.closed : T.brass),
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
