/* Species overlay store.

   The bundled SPECIES const in data.js is the offline-first floor.
   The Supabase `species` table sits on top as an overlay so the admin
   can edit species without a rebuild — TestFlight installs pull the
   fresh rows on the next boot after an edit and merge them over the
   seed.

   Boot flow:
    1. On module load (SYNCHRONOUS): read cached overrides from
       localStorage and apply them in place to SPECIES. This runs
       before App renders, so the first paint already reflects the
       last known good overrides.
    2. From App on mount (ASYNC): call refreshSpecies() which fetches
       the live rows from Supabase, writes them to cache, applies to
       SPECIES, and notifies subscribers so the UI re-renders.

   Overrides only *change* rows the bundled seed already ships or
   *add* new ones. Overlay never deletes a bundled species. */
import { SPECIES } from './data.js';
import { client } from './supabase-client.js';

const CACHE_KEY = 'kyc_species_overrides_v1';
const PHOTOS_CACHE_KEY = 'kyc_species_photos_v1';

// speciesId -> [{ url, credit, license, source, is_primary, sort_order, path }]
const photoOverrides = new Map();

/* Map a Supabase row (snake_case + arrays) to the JS SPECIES shape
   (camelCase). Nullish column values fall back to what the bundled
   seed already has, so partial edits are safe. */
export function rowToSpecies(row) {
  return {
    id:          row.id,
    commonName:  row.common_name,
    altNames:    Array.isArray(row.alt_names) ? row.alt_names : [],
    scientific:  row.scientific,
    category:    row.category,
    keyIds:      Array.isArray(row.key_ids) ? row.key_ids : [],
    lookalikes:  Array.isArray(row.lookalikes) ? row.lookalikes : [],
    habitat:     row.habitat || '',
    typicalSize: row.typical_size || '',
    reefFish:    row.reef_fish === true ? true : undefined,
    hms:         row.hms === true ? true : undefined,
    // Soft-delete flag. `undefined` (older cached rows) is treated as
    // active — only an explicit `false` from Supabase hides a species
    // from pickers. Deactivated species are NOT removed from SPECIES
    // so existing catches referencing them still resolve.
    active:      row.is_active === false ? false : true,
  };
}

/* Inverse: SPECIES shape → Supabase row for upsert. Drops undefined
   values so unchanged columns aren't clobbered. */
export function speciesToRow(sp) {
  const row = {
    id:            sp.id,
    common_name:   sp.commonName,
    alt_names:     Array.isArray(sp.altNames) ? sp.altNames : [],
    scientific:    sp.scientific || '',
    category:      sp.category || '',
    key_ids:       Array.isArray(sp.keyIds) ? sp.keyIds : [],
    lookalikes:    Array.isArray(sp.lookalikes) ? sp.lookalikes : [],
    habitat:       sp.habitat || '',
    typical_size: sp.typicalSize || '',
    reef_fish:     sp.reefFish === true,
    hms:           sp.hms === true,
    // Default TRUE at write time. Deactivation goes through
    // deactivateSpecies() below, not the shared upsert path, so the
    // bulk edit form doesn't accidentally re-activate a hidden row.
    is_active:     sp.active === false ? false : true,
  };
  return row;
}

/* Apply an array of override species (JS shape) to the bundled SPECIES
   array in place. Existing entries are replaced by id; new entries are
   appended. Used both from the sync cache load and from Supabase
   refresh. Returns the number of rows that changed. */
export function applyOverrides(overrides) {
  if (!Array.isArray(overrides)) return 0;
  let changed = 0;
  for (const ov of overrides) {
    if (!ov?.id) continue;
    const idx = SPECIES.findIndex(s => s.id === ov.id);
    if (idx >= 0) {
      SPECIES[idx] = { ...SPECIES[idx], ...ov };
    } else {
      SPECIES.push(ov);
    }
    changed++;
  }
  return changed;
}

/* Sync cache load — runs at module init below. */
function loadCachedOverrides() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.overrides) ? parsed.overrides : null;
  } catch {
    return null;
  }
}

function saveCachedOverrides(overrides) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      overrides,
      cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

// === Subscribe/notify so App.jsx can re-render on refresh =========
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) { try { fn(); } catch {} }
}

function loadCachedPhotos() {
  try {
    const raw = localStorage.getItem(PHOTOS_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.bySpecies && typeof parsed.bySpecies === 'object') {
      for (const [id, arr] of Object.entries(parsed.bySpecies)) {
        if (Array.isArray(arr)) photoOverrides.set(id, arr);
      }
    }
  } catch {}
}
function saveCachedPhotos(bySpecies) {
  try {
    localStorage.setItem(PHOTOS_CACHE_KEY, JSON.stringify({
      bySpecies, cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

// === Module-init: seed SPECIES from cache before the app renders ==
const cached = loadCachedOverrides();
if (cached) applyOverrides(cached);
loadCachedPhotos();

/** Return the primary override photo for a species, or null. Preferred
    over the bundled photos/manifest.json entry — see speciesPhoto() in
    helpers.js. */
export function speciesPhotoOverride(id) {
  const rows = photoOverrides.get(id);
  if (!rows || rows.length === 0) return null;
  const primary = rows.find(r => r.is_primary) || rows[0];
  if (!primary?.url) return null;
  return { url: primary.url, credit: primary.credit, license: primary.license, source: primary.source };
}

/** All override photos for a species (admin editor uses this). */
export function speciesPhotoOverrideAll(id) {
  return (photoOverrides.get(id) || []).slice();
}

// === Public API ===================================================

/** Fetches the live overrides from Supabase, applies them, writes to
    cache, and notifies subscribers. Safe to call while offline — any
    failure is swallowed and the bundled + cached view stays canonical.
    Returns { ok, count, error }. */
export async function refreshSpecies() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  try {
    const [speciesRes, photosRes] = await Promise.all([
      c.from('species').select('id, common_name, alt_names, scientific, category, key_ids, lookalikes, habitat, typical_size, reef_fish, hms, is_active'),
      c.from('species_photos').select('id, species_id, url, credit, license, source, is_primary, sort_order').order('sort_order', { ascending: true }),
    ]);
    if (speciesRes.error) return { ok: false, error: speciesRes.error.message };
    const overrides = (speciesRes.data || []).map(rowToSpecies);
    applyOverrides(overrides);
    saveCachedOverrides(overrides);

    // Photos are a nice-to-have — a fetch failure here shouldn't
    // block the species refresh from committing.
    if (!photosRes.error && Array.isArray(photosRes.data)) {
      photoOverrides.clear();
      const bySpecies = {};
      for (const row of photosRes.data) {
        const sid = row.species_id;
        if (!sid) continue;
        (bySpecies[sid] ||= []).push(row);
      }
      for (const [sid, rows] of Object.entries(bySpecies)) photoOverrides.set(sid, rows);
      saveCachedPhotos(bySpecies);
    }

    notify();
    return { ok: true, count: overrides.length };
  } catch (e) {
    return { ok: false, error: e?.message || 'refresh failed' };
  }
}

/** Ensure a species row exists in Supabase so FK inserts succeed.
    Only most species live in the bundled SPECIES const, not in the DB
    (the DB holds edits/overlays). Adding a photo needs the FK target,
    so we lazily seed the row from the bundled record when missing.
    Safe to call redundantly — upsert on id primary key. */
async function ensureSpeciesRow(speciesId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sp = SPECIES.find(s => s.id === speciesId);
  if (!sp) return { ok: false, error: `species ${speciesId} not found in bundled seed` };
  const row = speciesToRow(sp);
  const { error } = await c.from('species').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Insert a species_photos row and refresh cache. */
export async function addSpeciesPhoto({ speciesId, url, credit, license, source, isPrimary }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  // FK target must exist. Seed from bundled if the species row is only
  // in the JS seed and hasn't been touched by the admin yet.
  const seed = await ensureSpeciesRow(speciesId);
  if (!seed.ok) return { ok: false, error: seed.error };
  const row = {
    species_id: speciesId, url,
    credit: credit || null, license: license || null, source: source || null,
    is_primary: !!isPrimary, sort_order: 0,
  };
  if (isPrimary) {
    // Unmark any existing primary for this species so at most one wins.
    await c.from('species_photos').update({ is_primary: false }).eq('species_id', speciesId);
  }
  const { error } = await c.from('species_photos').insert(row);
  if (error) return { ok: false, error: error.message };
  await refreshSpecies();
  return { ok: true };
}

/** Delete a species_photos row by id and refresh cache. */
export async function deleteSpeciesPhoto(photoId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('species_photos').delete().eq('id', photoId);
  if (error) return { ok: false, error: error.message };
  await refreshSpecies();
  return { ok: true };
}

/** Set a specific photo as primary; unset all others for that species. */
export async function setPrimarySpeciesPhoto(photoId, speciesId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  await c.from('species_photos').update({ is_primary: false }).eq('species_id', speciesId);
  const { error } = await c.from('species_photos').update({ is_primary: true }).eq('id', photoId);
  if (error) return { ok: false, error: error.message };
  await refreshSpecies();
  return { ok: true };
}

/** Upsert a single species (JS shape) to Supabase. Only the admin
    calls this; RLS restricts writes to the admin email. On success,
    updates cache + in-memory SPECIES + notifies. */
export async function upsertSpecies(sp) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const row = speciesToRow(sp);
  const { error } = await c.from('species').upsert(row, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  // Re-pull to keep the cache honest; cheap since the table is tiny.
  await refreshSpecies();
  return { ok: true };
}

/** Soft-delete: flip is_active=false. Species stays in the table so
    historical catches still resolve, but disappears from pickers +
    classifier candidates on the next mobile refresh. */
export async function deactivateSpecies(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  // ensureSpeciesRow so we can toggle even a bundled-only species (no
  // upsert override yet). Seeds from the JS record if needed.
  const seed = await ensureSpeciesRow(id);
  if (!seed.ok) return { ok: false, error: seed.error };
  const { error } = await c.from('species').update({ is_active: false }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await refreshSpecies();
  return { ok: true };
}

/** Reactivate a previously deactivated species. */
export async function reactivateSpecies(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('species').update({ is_active: true }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await refreshSpecies();
  return { ok: true };
}

/** Filter helper — SPECIES entries that consumers should offer in
    pickers, classifier candidates, etc. Historical lookups (e.g.
    resolving a catch's speciesId) should read the raw SPECIES array
    directly so a deactivated species still renders its details. */
export function activeSpecies() {
  return SPECIES.filter(s => s.active !== false);
}
