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

/* Diagnostic ring buffer, same pattern as model-loader's _log. The
   photo pipeline has now shipped three builds whose behaviour on the
   DEVICE could not be observed — each looked correct from the desk and
   failed in the field. This makes the phone report what actually
   happened (sweep counts, per-photo failures) in the UI, without
   Xcode or Web Inspector. */
/* GLOBAL, not module-local. Build 191's panel said "no photo events
   yet" while broken tiles sat directly under it — which is only
   possible if the writer and the reader were different module
   instances (the bundle carries two chunk graphs). globalThis makes
   that structurally impossible: one buffer per webview, period. */
const _G = (typeof globalThis !== 'undefined' ? globalThis : window);
if (!_G.__kycPhotoDiag) {
  _G.__kycPhotoDiag = { buf: [], subs: new Set(), seq: 0,
                        session: `s_${Date.now().toString(36)}` };
}
const _DIAG = _G.__kycPhotoDiag;
export function getPhotoLog() { return _DIAG.buf.slice(); }
export function subscribePhotoLog(cb) { _DIAG.subs.add(cb); return () => _DIAG.subs.delete(cb); }

/* Structured event. Returns the event object so later stages (img
   onLoad/onError, restore results) can annotate the SAME event. */
export function photoEvent(fields) {
  const evt = {
    id: ++_DIAG.seq,
    t: new Date().toISOString().slice(11, 23),
    session: _DIAG.session,
    online: (typeof navigator !== 'undefined') ? navigator.onLine : null,
    native: NATIVE,
    ...fields,
  };
  _DIAG.buf.push(evt);
  if (_DIAG.buf.length > 50) _DIAG.buf.shift();
  // eslint-disable-next-line no-console
  console.log('[photos]', evt.kind || 'log', JSON.stringify(fields).slice(0, 200));
  for (const cb of _DIAG.subs) { try { cb(); } catch { /* subscriber */ } }
  return evt;
}

function _plog(msg) { photoEvent({ kind: 'log', msg }); }

export async function photoLocalExists(p, which = 'path') {
  if (!NATIVE || !p || typeof p !== 'object') return false;
  const rel = which === 'thumbPath' ? p.thumbPath : p.path;
  if (!rel) return false;
  if (_existsCache.has(rel)) return _existsCache.get(rel);
  let ok = false;
  try {
    await Filesystem.stat({ path: rel, directory: Directory.Data });
    ok = true;
  } catch (e) {
    ok = false;
    _plog(`stat MISS ${rel} (${e?.message || e})`);
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

/* Failure backoff, PERSISTED. Without it a photo whose restore fails
   (bad path, revoked object, disk error) is re-downloaded at full
   resolution on EVERY launch forever — multi-MB fetch + decode per
   photo per launch, which is battery and heat, not resilience. One
   failure parks the photo for 6h; three failures parks it for good
   until the app version changes. */
/* v2: the v1 key is ABANDONED deliberately. Under builds 188-189 an
   OFFLINE restore attempt recorded a strike — photoSignedUrl returns
   null with no network, and that null was treated as a failure. Robert
   tested in airplane mode repeatedly (as designed!), so the photos his
   screens rendered while offline — exactly index 0 of each visible
   card — hit 3 strikes and were parked forever. Build 190 then
   restored the never-attempted photos 1-2 and skipped the parked
   photo 0: the precise blank/ok/ok pattern seen on-device. Changing
   the key unparks every wrongly-parked photo without needing a
   migration. */
const _REHYDRATE_LS = 'kyc.rehydrateFails.v2';
function _failMap() {
  try { return JSON.parse(localStorage.getItem(_REHYDRATE_LS) || '{}'); }
  catch { return {}; }
}
function _recordFail(path) {
  try {
    const m = _failMap();
    m[path] = { n: (m[path]?.n || 0) + 1, t: Date.now() };
    localStorage.setItem(_REHYDRATE_LS, JSON.stringify(m));
  } catch { /* diagnostics only */ }
}
function _shouldSkip(path) {
  const f = _failMap()[path];
  if (!f) return false;
  if (f.n >= 3) return true;                       // parked
  return (Date.now() - f.t) < 6 * 3600 * 1000;     // 6h backoff
}
function _clearFail(path) {
  try {
    const m = _failMap();
    if (m[path]) { delete m[path]; localStorage.setItem(_REHYDRATE_LS, JSON.stringify(m)); }
  } catch { /* diagnostics only */ }
}

export async function rehydrateFromCloud(p) {
  if (!NATIVE || !p || typeof p !== 'object' || !p.path) return false;
  if (_rehydrating.has(p.path)) return false;
  // Offline is NOT a failure — it is the absence of an attempt. Strikes
  // are reserved for the network answering and the restore still not
  // working (HTTP error, bad bytes, write error).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _plog(`rehydrate DEFER ${p.path} (offline)`);
    return false;
  }
  if (_shouldSkip(p.path)) { _plog(`rehydrate SKIP ${p.path} (backoff)`); return false; }
  _rehydrating.add(p.path);
  try {
    const url = await photoSignedUrl(p);
    if (!url) {
      // Two different situations share this null, and they must not
      // share a policy. Network dropped mid-flight: an attempt never
      // really happened — defer, no strike (the entry gate already
      // deferred the clearly-offline case). Genuinely ONLINE and the
      // sign still failed (revoked object, auth problem): that is a
      // real recoverable failure and earns a strike, or a photo that
      // can never sign would be retried every launch forever.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        _plog(`rehydrate DEFER ${p.path} (went offline mid-attempt, no strike)`);
        return false;
      }
      _plog(`rehydrate ${p.path}: NO SIGNED URL while online (strike)`);
      _recordFail(p.path);
      return false;
    }
    const res = await fetch(url);
    if (!res.ok) {
      photoEvent({ kind: 'restore', path: p.path, http: res.status, strike: true });
      _recordFail(p.path); return false;
    }
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
    // Post-write stat — trusting writeFile's silence cost us three
    // builds; ask the filesystem whether the bytes are really there.
    _existsCache.delete(p.path);
    if (p.thumbPath) _existsCache.delete(p.thumbPath);
    const postOrig = await photoLocalExists(p, 'path');
    const postThumb = p.thumbPath ? await photoLocalExists(p, 'thumbPath') : null;
    photoEvent({ kind: 'restore', path: p.path, bytes: bytes.length,
                 writeOriginal: 'PASS',
                 postStatOriginal: postOrig ? 'PASS' : 'FAIL',
                 postStatThumb: postThumb === null ? 'n/a' : (postThumb ? 'PASS' : 'FAIL') });
    _clearFail(p.path);
    return true;
  } catch (e) {
    _plog(`rehydrate FAIL ${p.path}: ${e?.message || e}`);
    // Same offline exemption as the entry gate: a fetch that died
    // because the network vanished mid-flight is a non-attempt, not
    // evidence about this photo.
    if (!(typeof navigator !== 'undefined' && navigator.onLine === false)) {
      _recordFail(p.path);
    }
    return false;
  } finally {
    _rehydrating.delete(p.path);
  }
}

/* ONE canonical native-file -> WebView URL conversion.

   Filesystem.getUri per file, then Capacitor.convertFileSrc. NEVER
   base-URI + string concatenation: build 192's device trace showed
   thumb:PASS -> LOCAL_THUMB -> img:onError, and the concat is why. The
   old path derived a base by regex-stripping "/photos" off
   getUri('photos') — if the platform returns a directory URI with a
   trailing slash the regex silently doesn't match, and every local URL
   gains a duplicated ".../photos//photos/..." segment. stat() kept
   passing because it uses the RELATIVE path; only the display URL was
   corrupt. Per-file getUri cannot have that class of bug: the platform
   itself produces the full URI for the exact file.

   Cached per relative path — one bridge call per file per session. */
const _uriCache = new Map();

export async function localPhotoDisplayUrl(relPath) {
  if (!NATIVE || !relPath) return null;
  if (_uriCache.has(relPath)) return _uriCache.get(relPath);
  try {
    const { uri } = await Filesystem.getUri({ path: relPath, directory: Directory.Data });
    const converted = Capacitor.convertFileSrc(uri);
    _uriCache.set(relPath, converted);
    return converted;
  } catch (e) {
    photoEvent({ kind: 'log', msg: `getUri FAIL ${relPath}: ${e?.message || e}` });
    return null;
  }
}

/* THE canonical resolver. Every UI that shows a saved photo goes
   through this — PhotoImg is its only consumer, and every screen uses
   PhotoImg. One deterministic strategy, in priority order:

     1. inline thumb (legacy data URL)        — no filesystem, no network
     2. local thumbnail file (stat-verified)  — offline path
     3. local original file (stat-verified)   — offline path
     4. cloud copy via signed URL (online)    — also triggers ONE
        bounded background restore so step 2 works next launch
     5. unavailable

   Returns { state: 'available'|'unavailable', src, fromCloud }.
   The stat checks are cached per path, so after first resolution a
   list of 100 thumbnails costs zero filesystem calls.

   Replaces three overlapping mechanisms that grew across builds
   184-186 (render-time escalation chain, proactive per-render
   existence effect, transparent hold state) — each was added to patch
   the previous one's gap, and together they made failures invisible
   instead of impossible. */
export async function resolvePhotoDisplay(p, { preferThumb = true, diag = null } = {}) {
  // SINGLE-EXIT INSTRUMENTATION, by construction. Every return goes
  // through finish(), which emits the event — there is no code path
  // that produces a tile without producing a diagnostic. That property
  // is the assertion build 191 lacked: its panel said "no photo events
  // yet" above visibly broken tiles.
  const trace = {
    kind: 'resolve',
    screen: diag?.screen, catchId: diag?.catchId,
    species: diag?.species, index: diag?.index,
    path: (p && typeof p === 'object') ? (p.path || null) : null,
    thumbPath: (p && typeof p === 'object') ? (p.thumbPath || null) : null,
    cloudPath: (p && typeof p === 'object') ? (p.cloudPath || p.cloudUrl || null) : null,
    inlineThumb: !!(p && typeof p === 'object' && typeof p.thumb === 'string'),
    persistedSrc: (p && typeof p === 'object' && typeof p.src === 'string') ? p.src.slice(0, 30) : null,
    baseResolved: !!_dataUriBase,
    statThumb: null, statOriginal: null,
    signedTried: false, signedOk: null, restoreStarted: false,
    source: null,
  };
  const finish = (state, src, extra = {}) => {
    trace.source = extra.source || (state === 'unavailable' ? 'UNAVAILABLE' : trace.source);
    trace.srcType = !src ? null
      : src.startsWith('data:') ? 'data' : src.startsWith('capacitor:') ? 'capacitor'
      : src.startsWith('https:') ? 'https' : src.startsWith('http:') ? 'http'
      : src.startsWith('blob:') ? 'blob' : 'other';
    const evt = photoEvent(trace);
    return { state, src, fromCloud: extra.fromCloud, _evt: evt };
  };

  if (!p) return finish('unavailable', null, { source: 'UNAVAILABLE' });
  if (typeof p === 'string') return finish('available', p, { source: 'LEGACY_STRING' });

  if (preferThumb && typeof p.thumb === 'string' && p.thumb.startsWith('data:')) {
    return finish('available', p.thumb, { source: 'INLINE_THUMB' });
  }

  if (NATIVE) {
    if (preferThumb && p.thumbPath) {
      trace.statThumb = await photoLocalExists(p, 'thumbPath') ? 'PASS' : 'FAIL';
      if (trace.statThumb === 'PASS') {
        const converted = await localPhotoDisplayUrl(p.thumbPath);
        trace.nativeUri = _uriCache.has(p.thumbPath) ? 'per-file getUri' : null;
        trace.convertedUri = converted ? converted.slice(-60) : null;
        if (converted) return finish('available', converted, { source: 'LOCAL_THUMB' });
        trace.statThumb = 'PASS-but-getUri-FAIL';
      }
    }
    if (p.path) {
      trace.statOriginal = await photoLocalExists(p, 'path') ? 'PASS' : 'FAIL';
      if (trace.statOriginal === 'PASS') {
        const converted = await localPhotoDisplayUrl(p.path);
        trace.convertedUri = converted ? converted.slice(-60) : null;
        if (converted) return finish('available', converted, { source: 'LOCAL_ORIGINAL' });
        trace.statOriginal = 'PASS-but-getUri-FAIL';
      }
    }
  } else if (!NATIVE && typeof p.src === 'string' && p.src.startsWith('data:')) {
    return finish('available', p.src, { source: 'WEB_INLINE' });
  }

  if (p.cloudPath || p.cloudUrl) {
    trace.signedTried = true;
    const url = await photoSignedUrl(p);
    trace.signedOk = !!url;
    if (url) {
      trace.restoreStarted = true;
      rehydrateFromCloud(p);
      return finish('available', url, { source: 'CLOUD', fromCloud: true });
    }
  }

  if (typeof p.thumb === 'string' && p.thumb.startsWith('data:')) {
    return finish('available', p.thumb, { source: 'INLINE_THUMB_FALLBACK' });
  }
  return finish('unavailable', null, { source: 'UNAVAILABLE' });
}


/* Eagerly restore EVERY photo whose local file is missing.

   Lazy per-render rehydration is not enough, and shipping it as if it
   were was a real mistake: it only repairs a photo if the angler happens
   to open the screen showing it WHILE ONLINE. Go offline first — which
   is the normal way this app is used — and every screen you never
   visited is still empty. Personal Bests came up blank in airplane mode
   for exactly that reason.

   So sweep the whole saved state once at launch when there is a network,
   with a small concurrency cap so it never competes with the UI. Each
   photo is repaired once, ever; afterwards the device is self-sufficient.

   Returns { checked, restored, failed }. */
export async function rehydrateAllMissing(state, { concurrency = 2, maxPerLaunch = 12, onProgress } = {}) {
  const out = { checked: 0, restored: 0, failed: 0 };
  if (!NATIVE || !state) { _plog(`sweep skipped (native=${NATIVE}, state=${!!state})`); return out; }
  _plog('sweep starting');

  // Collect every photo entry the app knows about, from both shapes.
  const photos = [];
  const push = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(push); return; }
    if (typeof v === 'object' && (v.path || v.thumbPath)) photos.push(v);
  };
  // NEWEST CATCH FIRST, and all of a catch's photos CONTIGUOUS.
  //
  // The order used to be raw state order, which interacts badly with
  // the 12-per-launch cap: photo 0 of a catch gets restored anyway the
  // moment its list tile renders online, but photos 1-2 are only ever
  // restored by this sweep — and unordered, they could sit behind
  // dozens of ancient photos for several sessions. Proven on-device in
  // build 189: same catch, photo 0 fine offline, photos 1-2 missing.
  // Newest-first + grouped means the catches the angler actually looks
  // at become fully offline in the first session, and a catch is never
  // left half-restored ahead of one nobody opens.
  const byDate = [...(state.catchLog || [])].sort((a, b) =>
    String(b.dateIso || b.date_iso || b.date || '').localeCompare(
      String(a.dateIso || a.date_iso || a.date || '')));
  for (const c of byDate) { push(c.photos); push(c.photo); }
  for (const pb of Object.values(state.pbs || {})) { push(pb.photos); push(pb.photo); }

  // Only those with a cloud copy to restore FROM and no local bytes.
  const work = [];
  for (const p of photos) {
    if (!(p.cloudPath || p.cloudUrl)) continue;
    out.checked += 1;
    const [full, th] = await Promise.all([
      photoLocalExists(p, 'path'), photoLocalExists(p, 'thumbPath'),
    ]);
    if (!full || !th) work.push(p);
  }
  photoEvent({ kind: 'sweep', phase: 'scan', considered: photos.length,
               cloudBacked: out.checked, missingLocal: work.length });
  if (!work.length) return out;
  // Cap per launch. Restoring a 100-photo backlog in one go is a
  // hundred full-res downloads + decodes back to back — measurable
  // heat on a phone. 12 per launch clears a real backlog in a few
  // sessions without turning any single launch into a space heater.
  if (work.length > maxPerLaunch) {
    _plog(`sweep: capping to ${maxPerLaunch} this launch (${work.length - maxPerLaunch} deferred)`);
    work.length = maxPerLaunch;
  }

  let i = 0;
  const worker = async () => {
    while (i < work.length) {
      const p = work[i++];
      const ok = await rehydrateFromCloud(p);
      if (ok) out.restored += 1; else out.failed += 1;
      if (onProgress) onProgress({ ...out, total: work.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));
  photoEvent({ kind: 'sweep', phase: 'end', restored: out.restored, failed: out.failed });
  return out;
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
