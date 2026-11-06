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

/* iOS App Icon staging — NOT runtime-swappable.

   The home-screen icon on iOS is baked into the .app bundle by
   capacitor-assets at build time from resources/icon.png. This
   admin flow puts the 1024x1024 PNG in the brand-assets bucket at
   a fixed key so scripts/ios-ship.sh can curl it in as
   resources/icon.png before the icon-set regeneration runs. On the
   phone the icon only changes after that build ships through
   TestFlight/App Store and the user updates the app. */
const IOS_ICON_BUCKET = 'brand-assets';
const IOS_ICON_KEY    = 'ios-app-icon.png';

/** Public URL for the staged icon — the same URL ios-ship.sh curls. */
export function iosAppIconPublicUrl() {
  const c = client();
  if (!c) return null;
  const { data } = c.storage.from(IOS_ICON_BUCKET).getPublicUrl(IOS_ICON_KEY);
  return data?.publicUrl || null;
}

/** Admin upload. Overwrites any prior staged icon. Bucket RLS
    enforces the admin-write allowlist. */
export async function uploadIosAppIcon(file) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.storage
    .from(IOS_ICON_BUCKET)
    .upload(IOS_ICON_KEY, file, {
      contentType: 'image/png',
      cacheControl: 'no-store',
      upsert: true,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Admin delete. Next iOS build falls back to tracked resources/icon.png. */
export async function deleteIosAppIcon() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.storage.from(IOS_ICON_BUCKET).remove([IOS_ICON_KEY]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Returns { exists, updated_at? } for the currently staged icon. */
export async function getIosAppIconMeta() {
  const c = client();
  if (!c) return { exists: false };
  try {
    const { data, error } = await c.storage
      .from(IOS_ICON_BUCKET)
      .list('', { search: IOS_ICON_KEY, limit: 20 });
    if (error) return { exists: false };
    const row = (data || []).find(r => r.name === IOS_ICON_KEY);
    if (!row) return { exists: false };
    return { exists: true, updated_at: row.updated_at || row.created_at || null };
  } catch {
    return { exists: false };
  }
}
