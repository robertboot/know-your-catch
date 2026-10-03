/* Categories overlay store — cloud-first, bundled fallback.

   Same pattern as species-store: bundled CATEGORIES in data.js is
   the offline-first floor; the Supabase `categories` table sits on
   top as an overlay so the admin can rename/reorder/add/remove
   categories without a rebuild.

   Merge rules:
     - Supabase entry with matching id overrides bundled fields
     - Supabase entry with a new id appends
     - Supabase entry with is_active = false hides from the app UI
     - Bundled entries not touched by Supabase pass through unchanged

   Sort order = Supabase sort_order when present; falls back to
   bundled index. */
import { CATEGORIES as BUNDLED_CATEGORIES } from './data.js';
import { client } from './supabase-client.js';

const CACHE_KEY = 'kyc_categories_overrides_v1';

// Merged list — computed on init from bundled + cache, replaced
// wholesale on every refresh.
let _merged = BUNDLED_CATEGORIES.slice();

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

function rebuild(overlayRows = null) {
  const rows = Array.isArray(overlayRows) ? overlayRows : (loadCache() || []);
  const overlayById = new Map();
  for (const r of rows) {
    if (!r?.id) continue;
    overlayById.set(r.id, r);
  }
  // Bundled first, in bundled order (unless overlay sets sort_order).
  const combined = [];
  const seenIds = new Set();
  for (let i = 0; i < BUNDLED_CATEGORIES.length; i++) {
    const bc = BUNDLED_CATEGORIES[i];
    const ov = overlayById.get(bc.id);
    if (ov && ov.is_active === false) continue;
    const merged = ov
      ? {
          id: bc.id,
          name: ov.label || bc.name,
          sort_order: ov.sort_order ?? i,
          icon_key: ov.icon_key || null,
          rep_species_id: ov.rep_species_id || null,
        }
      : { ...bc, sort_order: i };
    combined.push(merged);
    seenIds.add(bc.id);
  }
  // Then any overlay-only categories not in the bundled seed.
  for (const [id, ov] of overlayById) {
    if (seenIds.has(id)) continue;
    if (ov.is_active === false) continue;
    combined.push({
      id,
      name: ov.label || id,
      sort_order: ov.sort_order ?? 999,
      icon_key: ov.icon_key || null,
      rep_species_id: ov.rep_species_id || null,
    });
  }
  combined.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  _merged = combined;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch { return null; }
}
function saveCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      rows, cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

// Init on module load — sync cache read so the first paint reflects
// the last known good overlay.
rebuild();

/** Return the current merged categories list. Read at every render;
    call sites subscribe() to get re-renders on refresh. */
export function getCategories() { return _merged; }

/** Look up by id (bundled + overlay). */
export function categoryById(id) { return _merged.find(c => c.id === id) || null; }

/** Fetch live overlay rows, apply, cache, notify. */
export async function refreshCategories() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  try {
    const { data, error } = await c
      .from('categories')
      .select('id, label, sort_order, icon_key, rep_species_id, is_active');
    if (error) return { ok: false, error: error.message };
    const rows = data || [];
    saveCache(rows);
    rebuild(rows);
    notify();
    return { ok: true, count: rows.length };
  } catch (e) {
    return { ok: false, error: e?.message || 'refresh failed' };
  }
}

/** Admin upsert. */
export async function upsertCategory({ id, label, sort_order, icon_key, rep_species_id, is_active = true }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const row = { id, label, sort_order, icon_key: icon_key || null, rep_species_id: rep_species_id || null, is_active };
  const { error } = await c.from('categories').upsert(row, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  await refreshCategories();
  return { ok: true };
}

/** Admin delete — deactivates via is_active = false so any species
    still referencing the id keeps rendering something. Callers are
    expected to bulk-reassign first. */
export async function deactivateCategory(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('categories').upsert({ id, is_active: false, label: id }, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  await refreshCategories();
  return { ok: true };
}

/** Batch reassign species from one category to another. Uses the
    species overlay table — admin edits set the category column on
    the affected species rows. Species that don't yet have an overlay
    row get seeded from bundled first so the NOT NULL columns
    (common_name, scientific, etc.) are populated. */
export async function reassignSpecies(speciesIds, newCategoryId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!Array.isArray(speciesIds) || speciesIds.length === 0) return { ok: true };
  // Import lazily to sidestep the module load-order chicken-and-egg.
  const { SPECIES } = await import('./data.js');
  const bundledById = new Map(SPECIES.map(s => [s.id, s]));
  const rows = speciesIds.map(id => {
    const bundled = bundledById.get(id);
    if (!bundled) return null;
    return {
      id,
      common_name: bundled.commonName,
      alt_names:   bundled.altNames || [],
      scientific:  bundled.scientific || '',
      category:    newCategoryId,  // the update
      key_ids:     bundled.keyIds || [],
      lookalikes:  bundled.lookalikes || [],
      habitat:     bundled.habitat || '',
      typical_size: bundled.typicalSize || '',
      reef_fish:   bundled.reefFish === true,
      hms:         bundled.hms === true,
    };
  }).filter(Boolean);
  if (rows.length === 0) return { ok: true };
  const { error } = await c.from('species').upsert(rows, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Seed the Supabase categories table from the bundled CATEGORIES
    array. Idempotent — only runs when the table is empty. Called
    from the admin console on first visit to the Categories tab. */
export async function seedFromBundled() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { count, error: countErr } = await c.from('categories').select('*', { count: 'exact', head: true });
  if (countErr) return { ok: false, error: countErr.message };
  if ((count || 0) > 0) return { ok: true, seeded: 0 };
  const rows = BUNDLED_CATEGORIES.map((c, i) => ({
    id: c.id, label: c.name, sort_order: i, is_active: true,
  }));
  const { error } = await c.from('categories').insert(rows);
  if (error) return { ok: false, error: error.message };
  await refreshCategories();
  return { ok: true, seeded: rows.length };
}
