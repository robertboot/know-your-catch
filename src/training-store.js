/* Training-images store — thin CRUD wrapper over the Supabase
   `training_images` table + `training-photos` storage bucket.

   Admin-only. RLS restricts every read/write to the admin email,
   so callers don't need to gate — the network layer refuses.

   NEVER referenced by mobile-app code paths — this module lives
   in the admin bundle only. */
import { client, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-client.js';
import { getLastSession } from './auth.js';
import { ensureSpeciesRow } from './species-store.js';
import { SPECIES } from './data.js';

const BUCKET = 'training-photos';

/* Shared XHR wrappers so the signed-upload flow doesn't repeat the
   raw XHR ceremony twice. Both resolve to a discriminated union that
   the caller pattern-matches on. */
function xhrBinary({ url, body, contentType, timeoutMs = 60_000 }) {
  return new Promise((resolve) => {
    let xhr;
    try { xhr = new XMLHttpRequest(); }
    catch (e) { resolve({ kind: 'ctor_threw', thrown: e }); return; }
    xhr.open('PUT', url, true);
    if (contentType) xhr.setRequestHeader('content-type', contentType);
    xhr.onload = () => {
      const responseHeaders = xhr.getAllResponseHeaders?.() || '';
      const status = xhr.status;
      if (status >= 200 && status < 300) {
        resolve({ kind: 'ok', status, body: xhr.responseText || '', responseHeaders });
      } else {
        resolve({
          kind: 'non_2xx', status, statusText: xhr.statusText,
          body: xhr.responseText || '', responseHeaders,
        });
      }
    };
    xhr.onerror = () => resolve({
      kind: 'network_error', status: xhr.status, statusText: xhr.statusText,
      body: xhr.responseText || '',
    });
    xhr.ontimeout = () => resolve({ kind: 'timeout' });
    xhr.timeout = timeoutMs;
    try { xhr.send(body); }
    catch (e) { resolve({ kind: 'send_threw', thrown: e }); }
  });
}

function xhrJson({ method, url, headers = {}, body, timeoutMs = 30_000 }) {
  return new Promise((resolve) => {
    let xhr;
    try { xhr = new XMLHttpRequest(); }
    catch (e) { resolve({ kind: 'ctor_threw', thrown: e }); return; }
    xhr.open(method, url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      const responseHeaders = xhr.getAllResponseHeaders?.() || '';
      const status = xhr.status;
      const text = xhr.responseText || '';
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      if (status >= 200 && status < 300) {
        resolve({ kind: 'ok', status, body: text, json, responseHeaders });
      } else {
        resolve({
          kind: 'non_2xx', status, statusText: xhr.statusText,
          body: text, json, responseHeaders,
        });
      }
    };
    xhr.onerror = () => resolve({
      kind: 'network_error', status: xhr.status, statusText: xhr.statusText,
    });
    xhr.ontimeout = () => resolve({ kind: 'timeout' });
    xhr.timeout = timeoutMs;
    try { xhr.send(body); }
    catch (e) { resolve({ kind: 'send_threw', thrown: e }); }
  });
}

/* ============================================================
   Coverage thresholds (Phase 2)
   ============================================================
   Practical minimums for transfer-learning fine-tuning with
   aggressive augmentation. Below MIN_TRAIN_THRESHOLD a per-class
   classifier really can't learn — augmenting 20 photos can't fake
   200 real ones for shape/color variance. Above ADEQUATE_THRESHOLD
   the model is trainable with acceptable lookalike risk.
   TARGET_COVERAGE is the "solid v0.1" bar the dashboard renders and
   the copy references.

   Species that are visually distinct (Mahi, Cobia, Hogfish) work
   at ADEQUATE. Species that live in lookalike groups (any snapper,
   any grouper, any mackerel) need to hit TARGET before the model
   can distinguish them reliably.

   Kept as constants for now; move to a Supabase meta table later
   if we start tuning per-species. */
export const MIN_TRAIN_THRESHOLD  = 30;
export const ADEQUATE_THRESHOLD   = 75;
export const TARGET_COVERAGE      = 200;

/* Pre-seeded lookalike groups the Phase 2 balance widget watches.
   Each group is the exact set of species whose photos the classifier
   will have to disambiguate at inference time — if one member has
   500 photos and another has 40, the model learns "just say the
   500-photo one" which is the failure mode we're avoiding. */
export const LOOKALIKE_GROUP_SEEDS = [
  ['red_snapper', 'vermilion_snapper', 'lane_snapper'],
  ['gag_grouper', 'black_grouper', 'scamp', 'yellowmouth_grouper', 'red_grouper'],
  ['king_mackerel', 'spanish_mackerel', 'cero_mackerel', 'atlantic_mackerel'],
  ['greater_amberjack', 'lesser_amberjack', 'almaco_jack', 'banded_rudderfish'],
  ['blackfin_tuna', 'yellowfin_tuna', 'bigeye_tuna', 'bluefin_tuna', 'albacore_tuna', 'little_tunny'],
  ['blue_marlin', 'white_marlin', 'sailfish'],
  ['summer_flounder', 'winter_flounder'],
];

/* Build the full lookalike group list: seeded groups + auto-derived
   connected components from SPECIES.lookalikes[] for any species not
   already covered by a seeded group. Each returned entry is an array
   of speciesId strings, min length 2. Deterministic order so the
   dashboard renders stably.

   The auto-derive step uses a union-find on the lookalikes graph so
   transitive lookalikes (A ↔ B, B ↔ C) end up in the same group. */
export function buildLookalikeGroups() {
  const seededSet = new Set();
  for (const g of LOOKALIKE_GROUP_SEEDS) for (const id of g) seededSet.add(id);

  // Union-find over SPECIES for the auto-derive pass.
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const speciesIds = new Set(SPECIES.map(s => s.id));
  for (const s of SPECIES) {
    if (seededSet.has(s.id)) continue;
    parent.set(s.id, s.id);
  }
  for (const s of SPECIES) {
    if (seededSet.has(s.id)) continue;
    for (const la of s.lookalikes || []) {
      if (seededSet.has(la) || !speciesIds.has(la)) continue;
      if (!parent.has(la)) parent.set(la, la);
      union(s.id, la);
    }
  }
  const buckets = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(id);
  }

  const auto = [...buckets.values()]
    .filter(g => g.length >= 2)
    .map(g => g.slice().sort());

  return [
    ...LOOKALIKE_GROUP_SEEDS.map(g => g.slice()),
    ...auto,
  ];
}

/* Classify a per-species verified count against the three thresholds.
   Returns 'excluded' | 'thin' | 'ok' | 'good':
     'excluded' — below MIN_TRAIN_THRESHOLD; classifier drops entirely
     'thin'     — MIN..ADEQUATE; trainable but risky, lookalikes suffer
     'ok'       — ADEQUATE..TARGET; solid on distinct species, hedges
                  on lookalikes
     'good'     — TARGET+; confident on lookalikes, shippable v0.1 */
export function classifyCoverage(verified) {
  if (verified >= TARGET_COVERAGE)     return 'good';
  if (verified >= ADEQUATE_THRESHOLD)  return 'ok';
  if (verified >= MIN_TRAIN_THRESHOLD) return 'thin';
  return 'excluded';
}

/* Upload one file to storage, then insert a training_images row.
   Storage path: {species_id}/{uuid}.jpg. UUID is generated locally
   so we can return the storage path before Supabase confirms.
   Returns { ok, id, storagePath, error, stage }.
     stage: 'ensure_species' | 'storage_upload' | 'db_insert' — tells
     the caller where the failure happened so it can classify + banner. */
export async function uploadTrainingImage(file, speciesId) {
  const c = client();
  if (!c) return { ok: false, stage: 'client', error: 'not-configured' };
  if (!file || !speciesId) return { ok: false, stage: 'client', error: 'missing file or species' };
  const sess = getLastSession();
  const email = sess?.user?.email || null;

  // Seed the FK target BEFORE the storage upload so a bundled-only
  // species (never touched via the admin edit form) doesn't fail the
  // insert AFTER we've already burned a storage write. Idempotent
  // upsert; no-op if the row is already there.
  const seed = await ensureSpeciesRow(speciesId);
  if (!seed.ok) {
    console.error('[training upload] ensureSpeciesRow failed', { speciesId, error: seed.error });
    return { ok: false, stage: 'ensure_species', error: seed.error };
  }

  const id = crypto.randomUUID();
  const ext = (file.name?.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
  const storagePath = `${speciesId}/${id}.${ext}`;

  // Snapshot everything we know about the caller + client BEFORE the
  // upload so if the URL comes out malformed we can see why.
  const sessNow = getLastSession();
  const authedEmail = sessNow?.user?.email || null;
  const authedRole  = sessNow?.user?.role  || null;
  const tokenTail   = sessNow?.access_token
    ? `…${sessNow.access_token.slice(-8)}`
    : '(no token)';
  const supabaseUrlSnapshot = (typeof window !== 'undefined' && window.__KYC_SUPABASE_URL__) || '(unknown)';
  console.log('[training upload] pre-upload snapshot', {
    supabaseUrl: supabaseUrlSnapshot,
    bucket: BUCKET, storagePath,
    authedEmail, authedRole, tokenTail,
    file: file.name, size: file.size, type: file.type,
  });

  const accessToken = sessNow?.access_token;
  if (!accessToken) {
    console.error('[training upload] no access_token on session', { authedEmail });
    return {
      ok: false, stage: 'storage_upload',
      error: 'no access token — sign out and back in', statusCode: null,
    };
  }

  // Two-step signed-upload flow to route around Safari's ITP block on
  // Cloudflare's __cf_bm cookie:
  //   1) POST /storage/v1/object/upload/sign/{bucket}/{path} with auth
  //      headers → returns { url, token } for a pre-signed upload.
  //   2) PUT the file to that pre-signed URL with NO auth headers. The
  //      pre-signed URL carries a token in the query string; the PUT
  //      is treated as an anonymous drop, which sidesteps the cookie
  //      check that Safari's ITP was breaking.
  // Chrome does the direct POST fine; this path works there too.
  const signUrl = `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`;
  const signResult = await xhrJson({
    method: 'POST',
    url: signUrl,
    headers: {
      authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (signResult.kind !== 'ok') {
    console.error('[training upload] sign step failed', {
      signUrl, ...signResult,
    });
    return {
      ok: false, stage: 'storage_upload',
      error: signResult.body || signResult.statusText || `sign ${signResult.kind}`,
      statusCode: signResult.status || null,
    };
  }
  // Response body shape: { url: '/object/upload/sign/{bucket}/{path}?token=...' , token: '...' }
  const signRelUrl = signResult.json?.url;
  if (!signRelUrl) {
    console.error('[training upload] sign step returned no url', { body: signResult.body });
    return {
      ok: false, stage: 'storage_upload',
      error: 'signed upload URL missing from response',
      statusCode: null,
    };
  }
  const putUrl = signRelUrl.startsWith('http')
    ? signRelUrl
    : `${SUPABASE_URL}/storage/v1${signRelUrl}`;
  console.log('[training upload] signed url ok, putting to', putUrl.slice(0, 120) + (putUrl.length > 120 ? '…' : ''));

  const putResult = await xhrBinary({
    url: putUrl,
    body: file,
    contentType: file.type || 'image/jpeg',
  });
  if (putResult.kind === 'ok') {
    // fall through to DB insert
  } else if (putResult.kind === 'non_2xx') {
    console.error('[training upload] signed PUT non-2xx', {
      putUrl, status: putResult.status, statusText: putResult.statusText,
      body: (putResult.body || '').slice(0, 400),
      responseHeaders: putResult.responseHeaders,
    });
    return {
      ok: false, stage: 'storage_upload',
      error: putResult.body || putResult.statusText || 'upload failed',
      statusCode: putResult.status,
    };
  } else {
    console.error('[training upload] signed PUT transport failed', {
      putUrl, kind: putResult.kind,
      status: putResult.status, statusText: putResult.statusText,
      thrownMessage: putResult.thrown?.message, thrownName: putResult.thrown?.name,
    });
    return {
      ok: false, stage: 'storage_upload',
      error: `signed PUT ${putResult.kind}${putResult.status ? ` (status ${putResult.status})` : ''}`,
      statusCode: putResult.status || null,
    };
  }
  // Shape the parity object for the DB-insert branch below.
  const up = { data: { path: storagePath }, error: null };

  // Owner-uploaded photos land as VERIFIED. Rationale: the admin
  // (owner) is also the reviewer, so an upload from the admin console
  // IS the review — leaving these at 'pending' just parks them in a
  // queue that never gets processed and silently starves Coverage /
  // export. Model-feedback rows (model_confirmation / model_correction)
  // already land verified via saveModelFeedback below.
  const nowIso = new Date().toISOString();
  const { data, error } = await c.from('training_images').insert({
    id,
    species_id: speciesId,
    storage_path: storagePath,
    source: 'owner_upload',
    status: 'verified',
    uploaded_by: email,
    reviewed_by: email,
    reviewed_at: nowIso,
  }).select('id').single();
  if (error) {
    console.error('[training upload] training_images.insert failed', {
      storagePath, error,
      code: error.code, message: error.message, details: error.details, hint: error.hint,
    });
    // Rollback storage — no orphan bytes.
    await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return {
      ok: false,
      stage: 'db_insert',
      error: error.message,
      code: error.code || null,
      rawError: error,
    };
  }
  return { ok: true, id: data.id, storagePath };
}

/* Save a labeled example produced by the Test Image page.
   Two sources are legal:
     - 'model_confirmation' — user clicked Confirm on the model's top
       pick. speciesId === originalSpeciesId.
     - 'model_correction'   — user clicked Wrong and picked the true
       species from the picker. originalSpeciesId is what the model
       predicted (kept so we can measure confusion later).
   Both land as status='verified' (owner-vetted) and are safe to
   include in the next export.
   Returns { ok, id, storagePath, error }. */
export async function saveModelFeedback({ file, speciesId, originalSpeciesId, source }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!file || !speciesId) return { ok: false, error: 'missing file or species' };
  if (source !== 'model_confirmation' && source !== 'model_correction') {
    return { ok: false, error: `invalid source: ${source}` };
  }
  const sess = getLastSession();
  const email = sess?.user?.email || null;

  // Same Phase-1 fix: seed the FK target before storage write.
  const seed = await ensureSpeciesRow(speciesId);
  if (!seed.ok) return { ok: false, error: seed.error };

  const id = crypto.randomUUID();
  const ext = (file.name?.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
  const storagePath = `${speciesId}/${id}.${ext}`;

  const up = await c.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };

  const { data, error } = await c.from('training_images').insert({
    id,
    species_id: speciesId,
    storage_path: storagePath,
    source,
    status: 'verified',
    original_species_id: originalSpeciesId || null,
    uploaded_by: email,
    reviewed_by: email,
    reviewed_at: new Date().toISOString(),
  }).select('id').single();
  if (error) {
    await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data.id, storagePath };
}

/* List training images, optionally filtered by species + status. */
export async function listTrainingImages({ speciesId = null, status = null, limit = 500 } = {}) {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  let q = c.from('training_images')
    .select('id, species_id, storage_path, source, status, rejection_reason, original_species_id, crop_bbox, uploaded_at, uploaded_by, reviewed_at, reviewed_by')
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (speciesId) q = q.eq('species_id', speciesId);
  if (status)    q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/* Approve a batch of ids. Sets status='verified', stamps reviewer. */
export async function approve(ids) {
  return _reviewUpdate(ids, { status: 'verified', rejection_reason: null });
}

/* Backlog cleanup — count of the current admin's own pending
   owner_upload rows so the Review-panel button can show a live
   number. Filters on uploaded_by = current session email so a
   second admin's backlog isn't touched. */
export async function countMyPendingOwnerUploads() {
  const c = client();
  if (!c) return { ok: false, count: 0, error: 'not-configured' };
  const email = getLastSession()?.user?.email || null;
  if (!email) return { ok: false, count: 0, error: 'no session' };
  const { count, error } = await c.from('training_images')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'owner_upload')
    .eq('status', 'pending')
    .eq('uploaded_by', email);
  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: count || 0, email };
}

/* Batch-restore prior state for a set of rows. Used exclusively by
   the Review panel's undo stack — takes snapshots taken BEFORE a
   bulk mutation and replays them to reverse the action. Groups rows
   by target patch so we do one UPDATE per unique state instead of
   one per row. Restoring to 'pending' also nulls reviewed_by /
   reviewed_at because those stamps stop making sense when the row
   is un-reviewed. */
export async function restoreTrainingRows(snapshots) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured', count: 0 };
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return { ok: true, count: 0 };
  }
  const groups = new Map();
  for (const r of snapshots) {
    if (!r?.id) continue;
    const key = `${r.status}|${r.species_id || ''}|${r.rejection_reason || ''}`;
    if (!groups.has(key)) {
      const patch = {
        status: r.status,
        species_id: r.species_id,
        rejection_reason: r.rejection_reason || null,
      };
      if (r.status === 'pending') {
        patch.reviewed_by = null;
        patch.reviewed_at = null;
      }
      groups.set(key, { patch, ids: [] });
    }
    groups.get(key).ids.push(r.id);
  }
  let total = 0;
  for (const { patch, ids } of groups.values()) {
    const { data, error } = await c.from('training_images')
      .update(patch).in('id', ids).select('id');
    if (error) return { ok: false, error: error.message, count: total };
    total += (data || []).length;
  }
  return { ok: true, count: total };
}

/* One-shot bulk verify — flips every pending owner_upload row
   uploaded by the current admin to verified in a single UPDATE.
   Companion to countMyPendingOwnerUploads; safe to call repeatedly
   (idempotent on second call because there's nothing left to flip). */
export async function verifyAllMyOwnerUploads() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured', count: 0 };
  const email = getLastSession()?.user?.email || null;
  if (!email) return { ok: false, error: 'no session', count: 0 };
  const nowIso = new Date().toISOString();
  const { data, error } = await c.from('training_images')
    .update({
      status: 'verified',
      reviewed_by: email,
      reviewed_at: nowIso,
    })
    .eq('source', 'owner_upload')
    .eq('status', 'pending')
    .eq('uploaded_by', email)
    .select('id');
  if (error) return { ok: false, error: error.message, count: 0 };
  return { ok: true, count: (data || []).length };
}

/* Reject a batch with a reason. */
export async function reject(ids, reason) {
  return _reviewUpdate(ids, { status: 'rejected', rejection_reason: reason });
}

/* Correct a batch: move to a different species_id, preserve the
   original in original_species_id so we can audit later. Both the
   destination and the source are FK targets; seed either if they
   only exist in the bundled data seed. */
export async function correctSpecies(ids, newSpeciesId, currentSpeciesId) {
  const destSeed = await ensureSpeciesRow(newSpeciesId);
  if (!destSeed.ok) return { ok: false, error: destSeed.error };
  if (currentSpeciesId) {
    const srcSeed = await ensureSpeciesRow(currentSpeciesId);
    if (!srcSeed.ok) return { ok: false, error: srcSeed.error };
  }
  return _reviewUpdate(ids, {
    status: 'corrected',
    species_id: newSpeciesId,
    original_species_id: currentSpeciesId,
    rejection_reason: null,
  });
}

async function _reviewUpdate(ids, patch) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'no ids' };
  const sess = getLastSession();
  const reviewed_by = sess?.user?.email || null;
  const now = new Date().toISOString();
  const { error } = await c.from('training_images')
    .update({ ...patch, reviewed_at: now, reviewed_by })
    .in('id', ids);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* Delete a training image (storage + row). Used to purge duplicates
   entirely rather than mark rejected — keep for now under a distinct
   entry point in case we want to expose "hard delete" separately. */
export async function deleteTrainingImage(id, storagePath) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('training_images').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  if (storagePath) await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  return { ok: true };
}

/* Fast per-species / status counts + last upload timestamp for the
   review + coverage dashboards. Client-side aggregate over the raw
   rows — paginated in 1000-row chunks because Supabase's REST
   endpoint caps a single response at ~1000 rows regardless of what
   the client's .limit() says. Without pagination, a table with 6683
   rows returns only the first 1000 and Coverage undercounts every
   species that clusters later in id order. Returns:
     { [speciesId]: { pending, verified, rejected, corrected, total, lastUploadedAt } } */
export async function countsBySpecies() {
  const c = client();
  if (!c) return { ok: false, counts: {}, error: 'not-configured' };

  const PAGE = 1000;
  const counts = {};
  let from = 0;
  while (true) {
    const { data, error } = await c
      .from('training_images')
      .select('species_id, status, uploaded_at')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, counts: {}, error: error.message };
    if (!data || data.length === 0) break;
    for (const r of data) {
      const sid = r.species_id;
      const b = (counts[sid] ||= {
        pending: 0, verified: 0, rejected: 0, corrected: 0, total: 0,
        lastUploadedAt: null,
      });
      if (b[r.status] !== undefined) b[r.status] += 1;
      b.total += 1;
      if (!b.lastUploadedAt || r.uploaded_at > b.lastUploadedAt) {
        b.lastUploadedAt = r.uploaded_at;
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { ok: true, counts };
}

/* Signed URL for private-bucket display in the admin UI. Short TTL —
   this UI is transient; the URL only needs to survive one review pass. */
export async function signedUrl(storagePath, ttlSeconds = 3600) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) return null;
  return data?.signedUrl || null;
}

/* ============================================================
   Phase 3 — Export
   ============================================================
   Fetch every verified training image, filter out excluded species,
   deterministic-shuffle within each species, 85/15 split, and hand
   back an object shape the Coverage UI can drive JSZip with. */

/* Deterministic seeded PRNG (mulberry32). Same seed → same shuffle
   → reproducible splits across export runs. */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Fisher–Yates shuffle with a seeded PRNG. Mutates in place. */
function shuffleInPlace(arr, seed) {
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* Simple string hash → 32-bit int for the shuffle seed. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* Group verified images by species, apply the coverage-tier filter,
   split each species 85/15 with a deterministic seed. Returns:
     {
       plan: [{ species_id, storage_path, split: 'train'|'val', filename }],
       counts: { species_id: { verified, train, val } },
       excluded: [species_id, ...]     // classifyCoverage → 'excluded'
       species: [species_id, ...]      // classifyCoverage NOT 'excluded'
     }
   Does NOT download bytes — that's the caller's job so a big export
   can stream through JSZip without exhausting memory. */
export async function planExport({ splitSeed = 'reelintel-v1' } = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };

  const rows = [];
  let from = 0;
  const page = 1000;
  // Page through in case the dataset outgrows a single request.
  // Order by id so pagination stays consistent across pages.
  while (true) {
    const { data, error } = await c.from('training_images')
      .select('id, species_id, storage_path, crop_bbox')
      .eq('status', 'verified')
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < page) break;
    from += page;
  }

  const bySpecies = new Map();
  for (const r of rows) {
    if (!bySpecies.has(r.species_id)) bySpecies.set(r.species_id, []);
    bySpecies.get(r.species_id).push(r);
  }

  const species = [];
  const excluded = [];
  const counts = {};
  const plan = [];

  const speciesIds = [...bySpecies.keys()].sort();
  for (const sid of speciesIds) {
    const list = bySpecies.get(sid);
    const tier = classifyCoverage(list.length);
    if (tier === 'excluded') { excluded.push(sid); continue; }

    // Deterministic split — seed combines the export seed + species id
    // so re-running an export produces the same split.
    shuffleInPlace(list, hashSeed(`${splitSeed}::${sid}`));
    const valCount   = Math.max(1, Math.round(list.length * 0.15));
    const trainCount = list.length - valCount;
    counts[sid] = { verified: list.length, train: trainCount, val: valCount };
    species.push(sid);

    list.forEach((row, i) => {
      const split = i < trainCount ? 'train' : 'val';
      const seq = String(i).padStart(4, '0');
      const ext = row.storage_path.split('.').pop() || 'jpg';
      const filename = `${sid}_${seq}.${ext}`;
      plan.push({
        species_id: sid,
        storage_path: row.storage_path,
        crop_bbox: row.crop_bbox,
        split,
        filename,
      });
    });
  }

  return { ok: true, plan, counts, excluded, species, splitSeed };
}
