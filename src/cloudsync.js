/* Sync layer — cross-device replication for catches + PBs.

   Model: last-write-wins by updated_at, soft-delete via deleted_at,
   server always canonical after pull. Photos ride along on each
   catch as a jsonb array; the actual bytes live in the catch-photos
   Supabase Storage bucket via cloudUrl attached by photos-store.

   Public API:
     pullAll(userId)     — snapshot the server for this user, merge
                           with local state via the caller-supplied
                           mergeCallback({ catches, pbs }).
     syncChanges(prev,   — call after every update(). Diffs prev vs
       next, userId)       next, upserts changed records to server.
                           Debounced per-record 500ms so a rapid
                           stream of edits collapses into one write.
     subscribe(fn)       — receives sync status updates:
                           'idle' | 'syncing' | 'synced' | 'offline'
     getStatus()         — current status snapshot
     forceSync(state)    — reset local diffs + re-upsert everything;
                           used from Settings "Sync Now"

   The whole module is silent when no Supabase client is configured
   or no user is signed in — the app runs offline exactly as before.
*/
import { client } from './supabase-client.js';

const DEBOUNCE_MS = 500;
const _debounceTimers = new Map();  // key -> timeoutId
let   _pendingRecords = { catches: new Set(), pbs: new Set() };

let   _status = 'idle';
const _listeners = new Set();
let   _lastSyncedAt = null;

// Track what we last successfully pushed so a subsequent state
// change can detect "did this row actually change?". Serialized JSON
// per record keyed by id / speciesId.
const _lastPushed = { catches: new Map(), pbs: new Map() };

function setStatus(s) {
  _status = s;
  if (s === 'synced') _lastSyncedAt = Date.now();
  for (const fn of _listeners) { try { fn(s); } catch {} }
}

export function subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
export function getStatus() { return _status; }
export function getLastSyncedAt() { return _lastSyncedAt; }

/* ------------------------------------------------------------------
   Row <-> app shape helpers
   ------------------------------------------------------------------ */
function catchToRow(c, userId) {
  return {
    id:           c.id,
    user_id:      userId,
    species_id:   c.speciesId || null,
    date_iso:     c.dateIso   || null,
    lat:          c.lat ?? null,
    lon:          c.lon ?? null,
    length_in:    c.length ?? null,
    weight_lb:    c.weight ?? null,
    notes:        c.notes || null,
    status:       c.status || 'complete',
    sun_alt:      c.sunAlt ?? null,
    sun_az:       c.sunAz ?? null,
    moon_phase:   c.moonPhase ?? null,
    moon_illum:   c.moonIllum ?? null,
    moon_name:    c.moonName || null,
    weather:      c.weather || null,
    jurisdiction: c.jurisdiction || null,
    photos:       Array.isArray(c.photos) ? c.photos : [],
    deleted_at:   null,
  };
}
function rowToCatch(r) {
  return {
    id:           r.id,
    speciesId:    r.species_id,
    dateIso:      r.date_iso,
    lat:          r.lat,
    lon:          r.lon,
    length:       r.length_in,
    weight:       r.weight_lb,
    notes:        r.notes,
    status:       r.status || 'complete',
    sunAlt:       r.sun_alt,
    sunAz:        r.sun_az,
    moonPhase:    r.moon_phase,
    moonIllum:    r.moon_illum,
    moonName:     r.moon_name,
    weather:      r.weather,
    jurisdiction: r.jurisdiction,
    photos:       Array.isArray(r.photos) ? r.photos : [],
    photo:        (Array.isArray(r.photos) && r.photos.length > 0) ? r.photos[0] : null,
  };
}

/* ------------------------------------------------------------------
   Pull: snapshot server for the signed-in user, hand back to caller
   to merge with local state.
   ------------------------------------------------------------------ */
export async function pullAll(userId) {
  const c = client();
  if (!c || !userId) return null;
  setStatus('syncing');
  try {
    const [catchesRes, pbsRes] = await Promise.all([
      c.from('catches').select('*').eq('user_id', userId),
      c.from('pbs').select('*').eq('user_id', userId),
    ]);
    if (catchesRes.error) throw catchesRes.error;
    if (pbsRes.error)     throw pbsRes.error;

    // Filter out soft-deleted rows and rebuild the app-shape objects.
    const catches = (catchesRes.data || [])
      .filter(r => !r.deleted_at)
      .map(rowToCatch);
    const pbs = {};
    for (const r of (pbsRes.data || [])) {
      if (r.deleted_at) continue;
      pbs[r.species_id] = r.data;
    }

    // Prime the "last pushed" cache so subsequent local edits diff
    // against what's known-on-server rather than treating a pulled
    // row as a fresh change to push back up.
    _lastPushed.catches.clear();
    _lastPushed.pbs.clear();
    for (const r of (catchesRes.data || [])) _lastPushed.catches.set(r.id, JSON.stringify(catchToRow(rowToCatch(r), userId)));
    for (const r of (pbsRes.data     || [])) _lastPushed.pbs.set(r.species_id, JSON.stringify(r.data));

    setStatus('synced');
    return { catches, pbs };
  } catch (e) {
    console.warn('[cloudsync] pull failed', e?.message || e);
    setStatus('offline');
    return null;
  }
}

/* ------------------------------------------------------------------
   Push: diff prev vs next state and enqueue upserts for changed rows.
   Debounced per record so rapid-fire edits (typing notes, adjusting
   metrics) collapse into a single write.
   ------------------------------------------------------------------ */
function scheduleUpsert(kind, key, payloadFn) {
  const timerKey = `${kind}:${key}`;
  clearTimeout(_debounceTimers.get(timerKey));
  _pendingRecords[kind].add(key);
  _debounceTimers.set(timerKey, setTimeout(async () => {
    const c = client();
    if (!c) return;
    try {
      const payload = payloadFn();
      if (!payload) { _pendingRecords[kind].delete(key); return; }
      setStatus('syncing');
      const table = kind === 'catches' ? 'catches' : 'pbs';
      const conflictCols = kind === 'catches' ? 'id' : 'user_id,species_id';
      const { error } = await c.from(table).upsert(payload, { onConflict: conflictCols });
      _pendingRecords[kind].delete(key);
      if (error) throw error;
      if (kind === 'catches') _lastPushed.catches.set(key, JSON.stringify(payload));
      else                    _lastPushed.pbs.set(key, JSON.stringify(payload.data));
      if (_pendingRecords.catches.size === 0 && _pendingRecords.pbs.size === 0) {
        setStatus('synced');
      }
    } catch (e) {
      console.warn(`[cloudsync] upsert ${timerKey} failed`, e?.message || e);
      setStatus('offline');
    }
  }, DEBOUNCE_MS));
}

function scheduleSoftDelete(kind, key, payload) {
  const timerKey = `${kind}:${key}:del`;
  clearTimeout(_debounceTimers.get(timerKey));
  _debounceTimers.set(timerKey, setTimeout(async () => {
    const c = client();
    if (!c) return;
    try {
      setStatus('syncing');
      const table = kind === 'catches' ? 'catches' : 'pbs';
      const conflictCols = kind === 'catches' ? 'id' : 'user_id,species_id';
      const { error } = await c.from(table).upsert({ ...payload, deleted_at: new Date().toISOString() }, { onConflict: conflictCols });
      if (error) throw error;
      if (kind === 'catches') _lastPushed.catches.delete(key);
      else                    _lastPushed.pbs.delete(key);
      setStatus('synced');
    } catch (e) {
      console.warn(`[cloudsync] soft-delete ${timerKey} failed`, e?.message || e);
      setStatus('offline');
    }
  }, DEBOUNCE_MS));
}

/** Compare prev and next state, schedule upserts for the delta. */
export function syncChanges(prev, next, userId) {
  const c = client();
  if (!c || !userId) return;

  const prevCatches = new Map((prev.catchLog || []).map(x => [x.id, x]));
  const nextCatches = new Map((next.catchLog || []).map(x => [x.id, x]));
  // Additions / updates
  for (const [id, entry] of nextCatches) {
    const row = catchToRow(entry, userId);
    const serialized = JSON.stringify(row);
    if (_lastPushed.catches.get(id) === serialized) continue;
    scheduleUpsert('catches', id, () => row);
  }
  // Removals — soft-delete via deleted_at
  for (const id of prevCatches.keys()) {
    if (!nextCatches.has(id)) {
      scheduleSoftDelete('catches', id, { id, user_id: userId });
    }
  }

  const prevPbs = prev.pbs || {};
  const nextPbs = next.pbs || {};
  for (const [sid, pb] of Object.entries(nextPbs)) {
    const serialized = JSON.stringify(pb);
    if (_lastPushed.pbs.get(sid) === serialized) continue;
    scheduleUpsert('pbs', sid, () => ({
      user_id: userId, species_id: sid, data: pb, deleted_at: null,
    }));
  }
  for (const sid of Object.keys(prevPbs)) {
    if (!(sid in nextPbs)) {
      scheduleSoftDelete('pbs', sid, { user_id: userId, species_id: sid, data: {} });
    }
  }
}

/** Reset the pushed-cache and re-upsert everything. Used by Settings
    "Sync Now" — trades bandwidth for confidence when a device has
    drifted. */
export async function forceSync(state, userId) {
  _lastPushed.catches.clear();
  _lastPushed.pbs.clear();
  const empty = { catchLog: [], pbs: {} };
  syncChanges(empty, state, userId);
}
