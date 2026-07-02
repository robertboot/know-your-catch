/* Brand asset overlay store.

   Same shape as species-store: bundled defaults in public/brand/ are
   the offline-first floor; a non-empty row in Supabase's brand_assets
   table overrides the path used at render time.

   Boot flow:
    1. Sync: read cached overrides from localStorage → applied before
       first paint so the header logo doesn't flash bundled → override.
    2. Async: refreshBrandAssets() fetches live rows; on change, cache
       + notify subscribers so App re-renders and reads new URLs.

   Public API:
    - brandAsset(key, fallbackUrl) — returns override or fallback
    - refreshBrandAssets() — kicks a fetch
    - upsertBrandAsset({ key, url }) — admin write
    - subscribe(fn) — for App to bump re-renders

   Known keys (Vite build asserts these render targets):
    - logo_horizontal — top-bar logo in App.jsx
    - logo_brand      — JSX splash logo in SplashScreen
    - hero_tuna       — home hero image */
import { client } from './supabase-client.js';

const CACHE_KEY = 'kyc_brand_overrides_v1';
const overrides = new Map();  // key -> url

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.rows)) {
      for (const r of parsed.rows) if (r?.key && r?.url) overrides.set(r.key, r.url);
    }
  } catch {}
}

function saveCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      rows,
      cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) { try { fn(); } catch {} }
}

// Sync-load cached overrides at module init.
loadCache();

/** Returns the Supabase override URL for a given brand key, or the
    fallback bundled URL if there's no override. */
export function brandAsset(key, fallbackUrl) {
  return overrides.get(key) || fallbackUrl;
}

/** Return a plain object of all known override rows — used by the
    admin editor to render the current-state grid. */
export function listOverrides() {
  return Object.fromEntries(overrides.entries());
}

/** Fetch live rows from Supabase, replace cache, notify. Silent on
    failure so the app keeps rendering bundled defaults offline. */
export async function refreshBrandAssets() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  try {
    const { data, error } = await c
      .from('brand_assets')
      .select('key, url, updated_at');
    if (error) return { ok: false, error: error.message };
    overrides.clear();
    for (const r of (data || [])) if (r?.key && r?.url) overrides.set(r.key, r.url);
    saveCache(data || []);
    notify();
    return { ok: true, count: overrides.size };
  } catch (e) {
    return { ok: false, error: e?.message || 'refresh failed' };
  }
}

/** Admin upsert. RLS enforces the write allowlist. */
export async function upsertBrandAsset({ key, url }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c
    .from('brand_assets')
    .upsert({ key, url }, { onConflict: 'key' });
  if (error) return { ok: false, error: error.message };
  await refreshBrandAssets();
  return { ok: true };
}

/** Remove an override so the render falls back to the bundled default. */
export async function deleteBrandAsset(key) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('brand_assets').delete().eq('key', key);
  if (error) return { ok: false, error: error.message };
  await refreshBrandAssets();
  return { ok: true };
}
