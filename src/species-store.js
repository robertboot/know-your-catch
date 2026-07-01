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

// === Module-init: seed SPECIES from cache before the app renders ==
const cached = loadCachedOverrides();
if (cached) applyOverrides(cached);

// === Public API ===================================================

/** Fetches the live overrides from Supabase, applies them, writes to
    cache, and notifies subscribers. Safe to call while offline — any
    failure is swallowed and the bundled + cached view stays canonical.
    Returns { ok, count, error }. */
export async function refreshSpecies() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  try {
    const { data, error } = await c
      .from('species')
      .select('id, common_name, alt_names, scientific, category, key_ids, lookalikes, habitat, typical_size, reef_fish, hms');
    if (error) return { ok: false, error: error.message };
    const overrides = (data || []).map(rowToSpecies);
    applyOverrides(overrides);
    saveCachedOverrides(overrides);
    notify();
    return { ok: true, count: overrides.length };
  } catch (e) {
    return { ok: false, error: e?.message || 'refresh failed' };
  }
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
