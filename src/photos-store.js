import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { downscaleImageDataUrl } from './storage.js';
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';

/* Photo persistence with a split-storage model:
   - Full-res JPEG (1600px / 0.82q, ~200-400KB) lives on the iOS app's
     Documents directory via Capacitor Filesystem. No size cap.
   - A small thumbnail (240px / 0.65q, ~10-20KB data URL) lives inline
     in the catch/PB record so list rendering doesn't pay a disk read.
   - On web (no Filesystem), the full-res stays inline as a data URL —
     same as the old model. Web users hit localStorage cap eventually
     but the architectural pivot is for the iOS build, where it matters.

   Photo entry shape going forward:
     { thumb, src, path? }
       thumb: data URL — always present, always sync
       src:   string for <img src=...> — capacitor:// URL on native,
              data: URL on web
       path:  relative path under Directory.Data (native only;
              needed for delete)

   Legacy entries are plain data-URL strings. helpers.js
   pbPhotos/catchPhotos still normalize a mixed array; this module
   knows how to read either shape via photoThumbUrl/photoDisplayUrl.
*/

const NATIVE = Capacitor.isNativePlatform();
const PHOTO_DIR = 'photos';

/* Base capacitor:// URI for Directory.Data, resolved once at boot.

   Persisting a RESOLVED capacitor:// URI is a trap on iOS: the path
   contains the app container UUID, which changes on every install, so
   any URI baked into saved state dies at the next app update. That is
   exactly what happened to thumbnails — the full-size path survived
   only because photoDisplayUrl falls back to cloudUrl.

   So thumbnails now persist the RELATIVE path and this base is joined
   at render time. */
let _dataUriBase = null;

export async function initPhotoPaths() {
  if (!NATIVE || _dataUriBase) return;
  try {
    const { uri } = await Filesystem.getUri({ path: PHOTO_DIR, directory: Directory.Data });
    // uri ends with /<PHOTO_DIR>; keep the parent so paths join cleanly.
    _dataUriBase = uri.replace(new RegExp(`/${PHOTO_DIR}$`), '');
  } catch { /* thumbs fall back to other sources below */ }
}

/* Photo quality strategy.

   NATIVE (iOS): DO NOT re-encode the full-res photo. Capacitor's
   Camera plugin already hands us a quality:95 JPEG at the iPhone's
   native capture resolution (~4032 × 3024 on modern devices). Every
   canvas-round-trip is pure loss on top of that baseline — the fish
   scales blur, the gill-plate texture flattens. We write the raw
   bytes straight to Filesystem, generate a small inline thumb for
   list rendering, and leave the full-res untouched.

   WEB: still re-encode at 1600 / 0.82 because photos ride inline in
   localStorage which has a hard ~5 MB browser cap.

   Thumb: 240 px / 0.65 — cheap to generate, only used for list rows. */
const WEB_MAX_DIM     = 1600;
const WEB_QUALITY     = 0.82;
/* Thumb size is platform-dependent because the STORAGE is.

   NATIVE: thumbs live on the filesystem, so there's no byte budget to
   respect — 768 @ 0.80 (~80-150 KB) stays sharp on iPad grid tiles,
   which render several hundred CSS px wide at 2-3x DPR. 384 was chosen
   back when thumbs rode inline in localStorage's ~5 MB cap; that
   constraint is gone and 384 visibly softens on tablet.

   WEB: still inline in localStorage, so the old budget still applies —
   keep 384 @ 0.72.

   Both use the stepped high-quality downscale in storage.js. A single
   -pass downscale aliased visibly, which is what made thumbnails look
   pixelated before. Full-size display (photoDisplayUrl) is untouched. */
const THUMB_DIM       = NATIVE ? 768  : 384;
const THUMB_QUALITY   = NATIVE ? 0.80 : 0.72;

function newPhotoId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* Read a File/Blob as a data URL — used only on native when a caller
   hands us a File (e.g. web-shim library picker in dev on iOS). The
   real iOS Capacitor Camera plugin always returns a data URL directly. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function makeThumb(dataUrl) {
  return downscaleImageDataUrl(dataUrl, THUMB_DIM, THUMB_QUALITY);
}

/* Save a photo. Accepts either the RAW full-res data URL from the
   camera (preferred — savePhoto is the single downscale site) or an
   already-downscaled one (idempotent — re-encoding at target dims
   costs one pass but preserves correctness).

   Returns a PhotoEntry: { thumb, src, path?, cloudUrl? }.

   Background: when a Supabase session is active we also upload the
   full-res bytes to the catch-photos bucket under the user's folder.
   The returned entry gets `cloudUrl` attached so cross-device sync
   can render the photo on the other device without re-downloading
   the raw bytes. The upload is fire-and-forget after the local write
   so a slow network never blocks the save. */
export async function savePhoto(rawDataUrl) {
  // Web: re-encode the full-res down to 1600 / 0.82 so it fits in the
  // localStorage cap. Native: skip the full re-encode entirely — the
  // Camera plugin's quality:95 output goes straight to Filesystem.
  const full = NATIVE
    ? (typeof rawDataUrl === 'string' ? rawDataUrl : await fileToDataUrl(rawDataUrl))
    : await downscaleImageDataUrl(rawDataUrl, WEB_MAX_DIM, WEB_QUALITY);
  const thumb = await makeThumb(full);

  let entry;
  if (!NATIVE) {
    entry = { thumb, src: full };
  } else {
    const id = newPhotoId();
    const path = `${PHOTO_DIR}/${id}.jpg`;
    const base64 = full.replace(/^data:image\/[^;]+;base64,/, '');
    await Filesystem.writeFile({
      path, data: base64, directory: Directory.Data, recursive: true,
    });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });

    // The thumb goes to disk too. It used to ride inline as base64 on
    // the entry, which meant every thumbnail was serialised into the
    // single localStorage state blob — ~30 KB each, three per catch,
    // against WKWebView's ~5 MB cap. A few dozen catches filled it and
    // saves started failing with "Storage is full" even though the
    // full-res photos were sitting safely on the filesystem.
    const thumbPath = `${PHOTO_DIR}/${id}_t.jpg`;
    let thumbSrc = null;
    try {
      await Filesystem.writeFile({
        path: thumbPath,
        data: thumb.replace(/^data:image\/[^;]+;base64,/, ''),
        directory: Directory.Data, recursive: true,
      });
      const t = await Filesystem.getUri({ path: thumbPath, directory: Directory.Data });
      thumbSrc = Capacitor.convertFileSrc(t.uri);
    } catch { /* fall back to the full-res src below */ }

    entry = thumbSrc
      ? { src: Capacitor.convertFileSrc(uri), path, thumbSrc, thumbPath }
      // Thumb write failed — point the thumb at the full-res file
      // rather than storing base64 and reintroducing the bloat.
      : { src: Capacitor.convertFileSrc(uri), path };
  }

  // Best-effort cloud upload — deliberately NOT awaited.
  //
  // This used to be `await uploadToCloud(...)`, which contradicted the
  // doc comment above ("fire-and-forget after the local write so a slow
  // network never blocks the save") and broke the app on exactly the
  // network the app is built for. A Supabase Storage upload has no
  // client timeout, so on a weak offshore signal it can hang for
  // minutes — and savePhoto's promise hung with it. Symptoms: LOG CATCH
  // did nothing at all, and before the overlay was made to wait for the
  // save, the photo silently vanished instead.
  //
  // The local write above is what makes a catch durable. The upload is
  // an optimisation for cross-device sync, and it mutates `entry` with
  // cloudPath when (if) it lands. A catch saved before that mutation
  // still renders from its local file, and cloudsync re-uploads later.
  uploadToCloud(entry, full).catch(() => { /* local copy is authoritative */ });
  return entry;
}

/* Upload full-res bytes to the catch-photos bucket. Path is prefixed
   with the user's uid so the storage RLS policy resolves. On success
   the entry gets cloudUrl attached so downstream cross-device sync
   can render the photo. Any failure is swallowed — the local copy
   is authoritative. */
async function uploadToCloud(entry, fullDataUrl) {
  try {
    const sess = getLastSession();
    const uid = sess?.user?.id;
    const c = client();
    if (!uid || !c) return;
    const id = entry.path ? entry.path.split('/').pop().replace(/\.jpg$/, '') : newPhotoId();
    const key = `${uid}/${id}.jpg`;
    const blob = await (await fetch(fullDataUrl)).blob();
    const { error } = await c.storage.from('catch-photos').upload(key, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000, immutable',
      upsert: false,
    });
    if (error && !/already exists|Duplicate/i.test(error.message || '')) return;
    // Store the private storage PATH — NOT a public URL. The catch-photos
    // bucket is private; cross-device display resolves a short-lived
    // SIGNED url on demand (photoSignedUrl). Never persist a public,
    // auth-free URL into the synced record.
    entry.cloudPath = key;
  } catch {
    // silent — local save still counts as success
  }
}

const CATCH_PHOTOS_BUCKET = 'catch-photos';
// In-memory signed-URL cache (path -> { url, exp }). Signed URLs are
// short-lived; re-sign lazily as they approach expiry.
const _signedCache = new Map();

/* Resolve the private storage path for a photo entry. Prefers the new
   cloudPath; falls back to parsing a legacy public cloudUrl so old
   synced records keep rendering once the bucket goes private. */
function cloudPathOf(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.cloudPath) return p.cloudPath;
  if (typeof p.cloudUrl === 'string') {
    const m = p.cloudUrl.match(/\/catch-photos\/(.+)$/);
    if (m) return decodeURIComponent(m[1].split('?')[0]);
  }
  return null;
}

/* Does this photo's LOCAL file still exist on this device?

   Cached per path — the answer cannot change within a session, and
   Filesystem.stat on every thumbnail render would be absurd.

   Why this is needed at all: a photo record stores a relative `path`,
   and photoThumbUrl/photoDisplayUrl rebuild a capacitor:// URL from it.
   That URL is always well-FORMED, but says nothing about whether the
   bytes are there. Catches created under a previous install point into
   a container that iOS has since replaced, so the file is gone while
   the record still looks complete.

   Relying on the <img>'s onerror to discover that is not good enough:
   the escalation only advances if WebKit reports the failure, and a
   missing file behind a custom scheme handler does not reliably do so.
   The angler is then left on the browser's broken-image glyph with a
   perfectly good cloud copy sitting one call away. Ask the filesystem
   directly instead. */
const _existsCache = new Map();

export async function photoLocalExists(p, which = 'path') {
  if (!NATIVE || !p || typeof p !== 'object') return false;
  const rel = which === 'thumbPath' ? p.thumbPath : p.path;
  if (!rel) return false;
  if (_existsCache.has(rel)) return _existsCache.get(rel);
  let ok = false;
  try {
    await Filesystem.stat({ path: rel, directory: Directory.Data });
    ok = true;
  } catch {
    ok = false;
  }
  _existsCache.set(rel, ok);
  return ok;
}

/* Pull the cloud copy back down to disk, at the SAME relative path the
   record already stores.

   This is what makes the app offline-first again after a reinstall.
   Rendering from a signed URL fixes the empty thumbnail but leaves the
   photo permanently network-dependent — the bytes still are not on the
   device, so the next airplane-mode launch shows nothing. That is not
   "works offline", it is "works while online and hides the failure".

   Writing to p.path (relative) rather than a fresh id means the record
   needs no mutation: photoThumbUrl/photoDisplayUrl already rebuild
   capacitor://<base-resolved-this-launch>/<path>, so the very next
   render finds a real file and never touches the network again.

   Best-effort and fire-and-forget by design — a failure here costs a
   re-fetch next launch, nothing worse. */
const _rehydrating = new Set();

export async function rehydrateFromCloud(p) {
  if (!NATIVE || !p || typeof p !== 'object' || !p.path) return false;
  if (_rehydrating.has(p.path)) return false;
  _rehydrating.add(p.path);
  try {
    const url = await photoSignedUrl(p);
    if (!url) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    // btoa over a big photo in one call blows the argument limit on
    // some WebKit builds; chunk it.
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    const b64 = btoa(bin);
    await Filesystem.writeFile({
      path: p.path, data: b64,
      directory: Directory.Data, recursive: true,
    });
    _existsCache.set(p.path, true);

    // The THUMB has to be rebuilt too, not just the full-size.
    //
    // photoThumbUrl returns capacitor://<base>/<thumbPath> whenever
    // thumbPath is set — it does not check the file. So restoring only
    // the full-size leaves the thumb URL pointing at a file that is
    // still missing, and the list view flashes and re-fetches on every
    // single launch. Regenerate it from the bytes we just downloaded.
    if (p.thumbPath) {
      try {
        const thumbDataUrl = await downscaleImageDataUrl(
          `data:image/jpeg;base64,${b64}`, THUMB_DIM, THUMB_QUALITY);
        await Filesystem.writeFile({
          path: p.thumbPath,
          data: thumbDataUrl.replace(/^data:image\/[^;]+;base64,/, ''),
          directory: Directory.Data, recursive: true,
        });
        _existsCache.set(p.thumbPath, true);
      } catch { /* full-size alone still renders */ }
    }
    return true;
  } catch {
    return false;
  } finally {
    _rehydrating.delete(p.path);
  }
}

/* Async signed URL for a photo's private cloud copy. Returns null when
   there's no cloud copy, no session, or the sign fails. Cached per path
   so repeated renders don't re-sign. */
export async function photoSignedUrl(p, ttlSeconds = 3600) {
  const path = cloudPathOf(p);
  if (!path) return null;
  const now = Date.now();
  const hit = _signedCache.get(path);
  if (hit && hit.exp > now + 60_000) return hit.url;
  try {
    const c = client();
    if (!c) return null;
    // Bounded, deliberately. This is the LAST link in PhotoImg's
    // escalation chain: if it never settles, the component never reaches
    // setFailed(true) and the angler is left staring at WebKit's broken
    // -image glyph forever instead of the graceful placeholder. A
    // Supabase Storage call has no client timeout of its own, and one
    // bar of signal offshore is exactly where it stalls — so an
    // unbounded await here is a hang, not a slow load.
    const { data, error } = await Promise.race([
      c.storage.from(CATCH_PHOTOS_BUCKET).createSignedUrl(path, ttlSeconds),
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('signed-url timeout') }), 8000)),
    ]);
    if (error || !data?.signedUrl) return null;
    _signedCache.set(path, { url: data.signedUrl, exp: now + ttlSeconds * 1000 });
    return data.signedUrl;
  } catch {
    return null;
  }
}

/* Remove a photo's underlying file if it lives on disk. Safe to call
   on legacy strings / web entries — does nothing then. */
export async function deletePhoto(p) {
  if (!NATIVE || !p || typeof p === 'string') return;
  for (const path of [p.path, p.thumbPath]) {
    if (!path) continue;
    try {
      await Filesystem.deleteFile({ path, directory: Directory.Data });
    } catch (e) {
      // File already gone or never existed — not worth surfacing.
    }
  }
}

/* Synchronous thumbnail URL for list-view rendering. Handles legacy
   plain-string entries by using them as their own thumb. */
export function photoThumbUrl(p) {
  if (!p) return null;
  if (typeof p === 'string') return p;
  // Rebuild from the relative path + the base resolved this launch.
  // Never trust a persisted thumbSrc first: it may carry a dead
  // container UUID from a previous install.
  if (p.thumbPath && _dataUriBase) {
    return Capacitor.convertFileSrc(`${_dataUriBase}/${p.thumbPath}`);
  }
  // thumb = legacy inline base64 (pre-migration entries).
  // cloudUrl before src: a stale capacitor:// src fails the same way.
  return p.thumb || p.thumbSrc || p.cloudUrl || p.src || null;
}

/* Synchronous full-size URL for <img src=...> / lightbox / share.
   On native this is already a capacitor:// URL the WebView can load
   directly — no async disk read needed. Cross-device sync case:
   entries pulled from another device carry the ORIGINATING device's
   capacitor:// src, which is meaningless on the current device (the
   file exists only on the device that saved). Detect that and prefer
   cloudUrl so cross-device renders hit the full-res Supabase copy
   instead of falling through to the 240px thumb. */
export function photoDisplayUrl(p) {
  if (!p) return null;
  if (typeof p === 'string') return p;
  // A capacitor:// src is device-local by construction — the file only
  // exists on the device that saved it. On any other device the URL
  // resolves to nothing and the load fails, kicking us back to the
  // pixelated thumb. If we also have a cloudUrl, prefer it — the
  // Supabase public URL works from anywhere including the origin device.
  // Device-local FIRST, rebuilt from the relative path + the base
  // resolved this launch — same rule photoThumbUrl already follows.
  //
  // This used to hand back p.cloudUrl whenever src was capacitor://,
  // which inverted the priority: a photo sitting on THIS device was
  // rendered from the network. That breaks two ways. Offline — the
  // primary environment, a boat — it cannot load at all. Online it
  // still 403s, because catch-photos is a private bucket and cloudUrl
  // is the raw unsigned URL (PhotoImg's own comment says as much). So
  // the common case fell all the way through to the signed-URL lookup
  // for a file that was on disk the whole time.
  //
  // Never trust a persisted p.src: it carries the container UUID from
  // the install that wrote it, and iOS changes that on every reinstall.
  if (p.path && _dataUriBase) {
    return Capacitor.convertFileSrc(`${_dataUriBase}/${p.path}`);
  }
  // No local file — this entry came from another device. cloudUrl is
  // the only thing that can resolve here; PhotoImg escalates to a
  // signed URL when the raw one 403s.
  return p.cloudUrl || p.src || p.thumb || null;
}

/* Read a photo's bytes back as a data URL — only needed when handing
   the image to APIs that can't fetch a capacitor:// URL (e.g. some
   share flows). On web, returns the inline src directly. */
export async function photoAsDataUrl(p) {
  if (!p) return null;
  if (typeof p === 'string') return p;
  if (!p.path) return p.src; // web
  const { data } = await Filesystem.readFile({
    path: p.path, directory: Directory.Data,
  });
  return `data:image/jpeg;base64,${data}`;
}

/* Walk the persisted state and migrate any plain-string photo entries
   to the new { thumb, src, path? } shape. Idempotent — object-form
   entries pass through untouched. Returns a new state object if any
   changes were made, or the original state if no migration happened.
   Used at boot. */
export async function migratePhotosToStore(state) {
  let changed = false;

  const migrateOne = async (entry) => {
    if (!entry) return null;
    if (typeof entry === 'string') {
      if (!entry.startsWith('data:')) return entry;
      changed = true;
      // savePhoto owns the downscale — idempotent for already-small
      // images (single re-encode pass at tier-target dims).
      return await savePhoto(entry);
    }
    // Reclaim: entries saved before thumbs moved to disk still carry a
    // base64 `thumb`, which is what filled localStorage. Write it out to
    // a file and drop the inline copy. This is where the "Storage is
    // full" pressure actually gets released — new saves alone wouldn't
    // shrink an already-full state blob.
    if (NATIVE && typeof entry.thumb === 'string' && entry.thumb.startsWith('data:') && !entry.thumbSrc) {
      const id = entry.path
        ? entry.path.split('/').pop().replace(/\.jpg$/, '')
        : newPhotoId();
      const thumbPath = `${PHOTO_DIR}/${id}_t.jpg`;
      try {
        await Filesystem.writeFile({
          path: thumbPath,
          data: entry.thumb.replace(/^data:image\/[^;]+;base64,/, ''),
          directory: Directory.Data, recursive: true,
        });
        const t = await Filesystem.getUri({ path: thumbPath, directory: Directory.Data });
        const { thumb, ...rest } = entry;
        changed = true;
        return { ...rest, thumbPath, thumbSrc: Capacitor.convertFileSrc(t.uri) };
      } catch {
        // Couldn't write it out — keep the inline thumb rather than
        // leaving the row with no thumbnail at all.
        return entry;
      }
    }
    return entry;
  };

  const migrateArray = async (arr) => {
    if (!Array.isArray(arr)) return arr;
    return Promise.all(arr.map(migrateOne));
  };

  const next = { ...state };

  if (Array.isArray(state.catchLog)) {
    next.catchLog = await Promise.all(state.catchLog.map(async (c) => {
      const out = { ...c };
      if (Array.isArray(c.photos)) out.photos = await migrateArray(c.photos);
      if (typeof c.photo === 'string' && c.photo.startsWith('data:')) {
        out.photo = await migrateOne(c.photo);
      }
      // Keep the legacy mirror pointing at slot 0 in its new shape.
      if (Array.isArray(out.photos) && out.photos.length > 0) {
        out.photo = out.photos[0];
      }
      return out;
    }));
  }

  if (state.pbs && typeof state.pbs === 'object') {
    const entries = await Promise.all(Object.entries(state.pbs).map(async ([id, pb]) => {
      const out = { ...pb };
      if (Array.isArray(pb.photos)) out.photos = await migrateArray(pb.photos);
      if (typeof pb.photo === 'string' && pb.photo.startsWith('data:')) {
        out.photo = await migrateOne(pb.photo);
      }
      if (Array.isArray(out.photos) && out.photos.length > 0) {
        out.photo = out.photos[0];
      }
      return [id, out];
    }));
    next.pbs = Object.fromEntries(entries);
  }

  return changed ? next : state;
}

export const PHOTOS_STORE_NATIVE = NATIVE;

/* One-time thumbnail regeneration.

   Thumbs saved before the 768px bump are still 384px. The boot
   migration only MOVES those bytes to disk — it doesn't re-encode —
   so older photos keep the softer thumb while new ones are sharp.
   This pass rebuilds them from the full-res file already on disk.

   Deliberately NOT part of the blocking boot path:
     - runs after first paint, one photo at a time, yielding between
       each so the UI stays responsive
     - a fresh install has no photos, so new users never execute it
     - guarded by a localStorage flag AND a per-entry check, so an
       interrupted run resumes rather than redoing finished work
     - any single failure is skipped, not fatal

   Returns the updated state object, or the original if nothing changed. */
const THUMB_REGEN_KEY = 'kyc.photos.thumbRegen.v1';

export function thumbRegenNeeded() {
  if (!NATIVE) return false;
  try { return localStorage.getItem(THUMB_REGEN_KEY) !== 'done'; } catch { return false; }
}

export function markThumbRegenDone() {
  try { localStorage.setItem(THUMB_REGEN_KEY, 'done'); } catch {}
}

const yieldToUI = () => new Promise(r => setTimeout(r, 0));

export async function regenerateThumbs(state, { onProgress } = {}) {
  if (!NATIVE) return state;
  let changed = false;
  let done = 0;

  const regenOne = async (entry) => {
    if (!entry || typeof entry === 'string' || !entry.path) return entry;
    // Already at the new size — regenerated by a previous run.
    if (entry.thumbDim === THUMB_DIM) return entry;
    try {
      const full = await photoAsDataUrl(entry);
      if (!full) return entry;
      const thumb = await downscaleImageDataUrl(full, THUMB_DIM, THUMB_QUALITY);
      const id = entry.path.split('/').pop().replace(/\.jpg$/, '');
      const thumbPath = `${PHOTO_DIR}/${id}_t.jpg`;
      await Filesystem.writeFile({
        path: thumbPath,
        data: thumb.replace(/^data:image\/[^;]+;base64,/, ''),
        directory: Directory.Data, recursive: true,
      });
      const t = await Filesystem.getUri({ path: thumbPath, directory: Directory.Data });
      changed = true;
      done += 1;
      onProgress?.(done);
      const { thumb: _drop, ...rest } = entry;
      return { ...rest, thumbPath, thumbSrc: Capacitor.convertFileSrc(t.uri), thumbDim: THUMB_DIM };
    } catch {
      return entry; // keep whatever it had
    } finally {
      await yieldToUI();
    }
  };

  const regenArray = async (arr) => {
    if (!Array.isArray(arr)) return arr;
    const out = [];
    for (const e of arr) out.push(await regenOne(e)); // sequential on purpose
    return out;
  };

  const next = { ...state };

  if (Array.isArray(state.catchLog)) {
    const rows = [];
    for (const c of state.catchLog) {
      const row = { ...c };
      if (Array.isArray(c.photos)) row.photos = await regenArray(c.photos);
      if (c.photo) row.photo = await regenOne(c.photo);
      rows.push(row);
    }
    next.catchLog = rows;
  }

  if (state.pbs && typeof state.pbs === 'object') {
    const pbs = {};
    for (const [k, pb] of Object.entries(state.pbs)) {
      const row = { ...pb };
      if (Array.isArray(pb?.photos)) row.photos = await regenArray(pb.photos);
      if (pb?.photo) row.photo = await regenOne(pb.photo);
      pbs[k] = row;
    }
    next.pbs = pbs;
  }

  return changed ? next : state;
}
