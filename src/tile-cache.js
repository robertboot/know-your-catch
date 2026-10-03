/* Offline store for map imagery — basemap tiles and the data overlays.
 *
 * The conditions numbers cache to localStorage, but map imagery cannot:
 * a handful of tiles is already megabytes, and localStorage is a
 * synchronous ~5 MB box shared with the app's own state. IndexedDB
 * holds blobs, is asynchronous, and has room.
 *
 * Why tiles at all: a cached chlorophyll overlay with no basemap under
 * it is a coloured rectangle with no coastline — you cannot tell whether
 * the green edge is ten miles out or sixty. The overlay is only useful
 * with something to place it against, so both are stored or neither is
 * worth storing.
 */

const DB = 'kyc-tiles';
const STORE = 'img';
const VERSION = 1;
// Roughly a week of Gulf imagery at the zooms this map opens on. Old
// entries are evicted oldest-first when the count is exceeded.
const MAX_ENTRIES = 600;

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexeddb')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'url' });
        s.createIndex('at', 'at');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
};

/** A cached blob URL for this image, or null. */
export async function getCachedImage(url) {
  try {
    const row = await tx('readonly', (s) => s.get(url));
    if (!row?.blob) return null;
    return URL.createObjectURL(row.blob);
  } catch { return null; }
}

/** Fetch and store. Returns a blob URL, or null if the network refused. */
export async function fetchAndCache(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    // Store and return, but never let a storage failure cost the caller
    // the image it just downloaded.
    tx('readwrite', (s) => s.put({ url, blob, at: Date.now() })).then(evict).catch(() => {});
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally { clearTimeout(timer); }
}

/** Cache first, network second — the order a boat needs. */
export async function imageUrl(url) {
  const hit = await getCachedImage(url);
  if (hit) {
    // Refresh in the background so the next look is current, without
    // making this one wait on a link that may not answer.
    fetchAndCache(url).catch(() => {});
    return { url: hit, cached: true };
  }
  const fresh = await fetchAndCache(url);
  return fresh ? { url: fresh, cached: false } : { url: null, cached: false };
}

async function evict() {
  try {
    const count = await tx('readonly', (s) => s.count());
    const n = (typeof count === 'number' ? count : 0) - MAX_ENTRIES;
    if (n <= 0) return;
    await tx('readwrite', (s) => {
      const idx = s.index('at');
      let removed = 0;
      idx.openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur || removed >= n) return;
        cur.delete(); removed += 1; cur.continue();
      };
    });
  } catch { /* eviction is housekeeping; never surface it */ }
}

/** When the newest cached entry was stored, for an honest age label. */
export async function cacheAge(url) {
  try {
    const row = await tx('readonly', (s) => s.get(url));
    return row?.at ? Date.now() - row.at : null;
  } catch { return null; }
}
