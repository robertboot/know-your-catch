/* Mobile-app runtime model loader.

   On boot: check for cached model, then hit the public models-published
   manifest to see if a newer version has been promoted. Only download
   the .tflite bytes when the version_name actually changes. Cache the
   model + manifest to Capacitor Filesystem (or IndexedDB on web) so
   the app works fully offline after first sync.

   Publishing is decoupled from bundling: the app's iOS binary never
   ships model bytes. When you promote v0.2, users get it on their
   next network-online launch — no App Store review, no rebuild.

   Storage layout on native (iOS):
     Directory.Data/models/current.tflite   — cached model bytes
     Directory.Data/models/current.json     — cached manifest

   The tflite runtime (@tensorflow/tfjs-tflite) is lazy-loaded when
   inference is actually requested — no cold-start cost when the user
   just opens the app to check regulations. */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { SUPABASE_URL } from './supabase-client.js';

const NATIVE = Capacitor.isNativePlatform();
const MODEL_DIR      = 'models';
const CACHED_MODEL   = `${MODEL_DIR}/current.tflite`;
const CACHED_MANIFEST= `${MODEL_DIR}/current.json`;
const LS_MODEL_KEY   = 'kyc.model.current';   // web fallback
const LS_MANIFEST_KEY= 'kyc.model.manifest';  // web fallback

/* Public URLs — no auth needed since the bucket is public-read. */
export const PUBLIC_MODEL_URL = () =>
  SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/models-published/current.tflite` : null;
export const PUBLIC_MANIFEST_URL = () =>
  SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/models-published/current.json` : null;

/* State — set by initModel(). Adapter reads via getReadyModel(). */
let _model = null;                // loaded tflite runtime model
let _manifest = null;             // cached manifest object
let _readyPromise = null;         // resolves to _model (or null)
let _modelSource = 'NONE';        // 'BUNDLED' | 'CACHED_UPDATE' | 'NONE'
let _cacheQuarantinedThisSession = false;

/* A cached model that failed RUNTIME load is removed so it cannot win
   selection again — this session (flag) or the next (files gone). The
   bundled model is app content and untouchable; a WORKING cache never
   reaches here. A future background update that downloads AND
   load-validates writes a fresh cache as before. */
async function _quarantineCache(reason) {
  _cacheQuarantinedThisSession = true;
  try {
    if (NATIVE) {
      try { await Filesystem.deleteFile({ path: CACHED_MODEL,    directory: Directory.Data }); } catch {}
      try { await Filesystem.deleteFile({ path: CACHED_MANIFEST, directory: Directory.Data }); } catch {}
    } else {
      localStorage.removeItem(LS_MODEL_KEY);
      localStorage.removeItem(LS_MANIFEST_KEY);
    }
    _log('LOG', `cache quarantined (${(reason || '').slice(0, 80)})`);
  } catch (e) {
    _log('ERR', `cache quarantine failed: ${e?.message || e}`);
  }
}
let _status = 'idle';             // 'idle' | 'loading' | 'ready' | 'error' | 'no-network'
let _lastError = null;            // human-readable string surfaced in Settings

/* In-memory diagnostic ring buffer. Every [model-loader] line goes
   here in addition to console so the Fish-ID card can display them
   without needing Xcode / Web Inspector access. */
const _logBuf = [];
const _LOG_MAX = 40;
function _log(level, msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${level} ${msg}`;
  _logBuf.push(line);
  if (_logBuf.length > _LOG_MAX) _logBuf.shift();
  if (level === 'ERR') console.error('[model-loader]', msg);
  else                 console.log ('[model-loader]', msg);
  _emit();
}

/* Subscribers for Settings UI. Notified on status changes. */
const _subs = new Set();
function _emit() { for (const cb of _subs) { try { cb(); } catch {} } }
export function subscribeModel(cb) { _subs.add(cb); return () => _subs.delete(cb); }

export function getModelStatus() { return _status; }
export function getModelInfo()   { return _manifest; }
export function getReadyModel()  { return _readyPromise; }
export function getModelError()  { return _lastError; }
export function getModelLog()    { return _logBuf.slice(); }
export function getModelSource() { return _modelSource; }

/* Read the cached manifest from disk (or localStorage on web). Returns
   null if nothing cached. */
async function readCachedManifest() {
  try {
    if (NATIVE) {
      const { data } = await Filesystem.readFile({
        path: CACHED_MANIFEST, directory: Directory.Data, encoding: 'utf8',
      });
      return JSON.parse(data);
    }
    const raw = localStorage.getItem(LS_MANIFEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* Read cached model bytes as an ArrayBuffer, or null. */
async function readCachedModelBytes() {
  try {
    if (NATIVE) {
      const { data } = await Filesystem.readFile({
        path: CACHED_MODEL, directory: Directory.Data,
      });
      // Capacitor returns base64 for binary — decode to Uint8Array.
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer;
    }
    const raw = localStorage.getItem(LS_MODEL_KEY);
    if (!raw) return null;
    // Web cache stores base64 too, same format for symmetry.
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  } catch {
    return null;
  }
}

/* Write model bytes + manifest to disk. Idempotent. */
async function writeCache(modelBytes, manifest) {
  const base64 = _bufferToBase64(modelBytes);
  if (NATIVE) {
    await Filesystem.writeFile({
      path: CACHED_MODEL, data: base64, directory: Directory.Data, recursive: true,
    });
    await Filesystem.writeFile({
      path: CACHED_MANIFEST, data: JSON.stringify(manifest), directory: Directory.Data,
      encoding: 'utf8', recursive: true,
    });
  } else {
    try {
      localStorage.setItem(LS_MODEL_KEY, base64);
      localStorage.setItem(LS_MANIFEST_KEY, JSON.stringify(manifest));
    } catch {
      // localStorage quota — web fallback is best-effort. Live model
      // still works, we just won't have it cached across reloads.
    }
  }
}

function _bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* Bounded await — 'loading' must never be a terminal state. A hang in
   the WASM bootstrap or an asset fetch converts to a thrown error,
   which the existing cache -> bundled -> error ladder already handles. */
/* WebKit's Error.stack is FRAMES ONLY — no name, no message. Every
   formatter here used `e.stack || e.message`, so on iOS the one thing
   we needed (the message) was systematically discarded, and the build
   199 trace ended in anonymous stack frames. Name and message first,
   always; frames after. */
function _errText(e) {
  if (!e) return String(e);
  const head = `${e.name || 'Error'}: ${e.message || String(e)}`;
  return e.stack ? `${head}\n${e.stack}` : head;
}

function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms)),
  ]);
}

/* Validate a candidate model before it is allowed to serve. A model
   that fails here is treated as ABSENT — never "sort of loaded". */
function validModelPair(bytes, manifest) {
  if (!bytes || bytes.byteLength < 1024) return 'bytes missing/truncated';
  const v = new Uint8Array(bytes);
  const magic = String.fromCharCode(v[4], v[5], v[6], v[7]);
  if (magic !== 'TFL3') return `bad flatbuffer magic ${JSON.stringify(magic)}`;
  if (!manifest || !Array.isArray(manifest.labels) || manifest.labels.length < 2) {
    return 'manifest/labels invalid';
  }
  if (!Number.isFinite(manifest.input_size)) return 'manifest missing input_size';
  return null;
}

/* The GUARANTEED baseline: DeepBlue shipped inside the app bundle at
   public/models/deepblue/. Fish ID must never depend on any network —
   that is the product's core promise, and build 195 proved the old
   design broke it: a reinstall wiped the cache, the first offline
   launch cached a FAILED init for the whole session, Settings showed a
   blank model, and the user had to know to press "Check for updates"
   to make the flagship feature exist. */
async function loadBundledModel() {
  const base = `${(import.meta.env.BASE_URL || '/')}models/deepblue/`;
  try {
    const [mResp, jResp] = await withTimeout(Promise.all([
      fetch(`${base}current.tflite`), fetch(`${base}current.json`),
    ]), 15000, 'bundled asset fetch');
    if (!mResp.ok || !jResp.ok) {
      _log('ERR', `bundled model fetch: tflite=${mResp.status} json=${jResp.status}`);
      return null;
    }
    const bytes = await mResp.arrayBuffer();
    const manifest = await jResp.json();
    const bad = validModelPair(bytes, manifest);
    if (bad) { _log('ERR', `bundled model invalid: ${bad}`); return null; }
    _log('LOG', `bundled model ok: ${manifest.version_name}, ${bytes.byteLength} bytes`);
    return { bytes, manifest };
  } catch (e) {
    _log('ERR', `bundled model load threw: ${e?.message || e}`);
    return null;
  }
}

/* Fetch the remote manifest. Returns null if offline / bucket unset. */
async function fetchRemoteManifest() {
  const url = PUBLIC_MANIFEST_URL();
  if (!url) return null;
  try {
    // cache: 'no-store' — the manifest is small and we always want
    // the freshest read. Cache-busting query string as a belt-and-
    // suspenders for CDN edge caches that ignore the header.
    const resp = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchRemoteModel() {
  const url = PUBLIC_MODEL_URL();
  if (!url) {
    _log('ERR', 'fetchRemoteModel: no SUPABASE_URL configured');
    return null;
  }
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) {
      _log('ERR', `fetchRemoteModel: HTTP ${resp.status} ${resp.statusText} from ${url}`);
      return null;
    }
    const buf = await resp.arrayBuffer();
    _log('LOG', `fetchRemoteModel: ok, ${buf.byteLength} bytes`);
    return buf;
  } catch (e) {
    _log('ERR', `fetchRemoteModel: network error ${e && (e.message || e)}`);
    return null;
  }
}

/* Load the tflite runtime + a model from bytes. Kept private so all
   the WASM path setup lives in one place. Mirrors the admin
   TestImagePanel setup so behavior is identical. */
/* Make a dynamic-batch model static. DeepBlue is exported with batch
   dimension -1, and LiteRT.js 2.5.3 has no resize API — it rejects a
   [1,...] buffer against a [-1,...] signature outright. The batch dim
   lives in exactly three little-endian int32s of flatbuffer METADATA
   (input shape_signature [-1,224,224,3] and two output [-1,N] entries);
   weights are untouched. Idempotent: a model already static contains no
   [-1,...] patterns and passes through unchanged. Verified A/B against
   tfjs-tflite on 10 fish images: top-1 10/10, top-5 ordering identical,
   max score delta 3.9e-6.  N comes from the manifest's label count so
   this works for future models with different class counts. */
function staticizeModelBytes(buf, numLabels) {
  const bytes = new Uint8Array(buf.slice(0));
  const dv = new DataView(bytes.buffer);
  const size = getModelInputSize({ input_size: 224 });
  const patchSeq = (seq) => {
    let n = 0;
    outer: for (let i = 0; i <= bytes.length - seq.length * 4; i += 4) {
      for (let j = 0; j < seq.length; j++) {
        if (dv.getInt32(i + j * 4, true) !== seq[j]) continue outer;
      }
      dv.setInt32(i, 1, true);
      n++;
    }
    return n;
  };
  // Fail closed on anything unexpected. This is surgery on flatbuffer
  // metadata: the ONLY acceptable outcomes are "already static, nothing
  // to do" or "exactly the known DeepBlue shape entries patched". A
  // future model with a different structure must be REJECTED (throw ->
  // the lifecycle treats it as an invalid model and falls back), never
  // silently half-patched into something that loads and lies.
  if (!Number.isFinite(numLabels) || numLabels < 2) {
    throw new Error(`staticize: invalid label count ${numLabels}`);
  }
  const a = patchSeq([-1, size, size, 3]);
  const b = patchSeq([-1, numLabels]);
  if (a === 0 && b === 0) return bytes;          // already static — no-op
  if (a !== 1 || b < 1 || b > 2) {
    throw new Error(`staticize: unexpected shape layout (input=${a}, output=${b}) — refusing to patch`);
  }
  _log('LOG', `staticize: patched ${a} input + ${b} output batch dims`);
  return bytes;
}

function getModelInputSize(manifest) {
  return Number.isFinite(manifest?.input_size) ? manifest.input_size : 224;
}

/* LiteRT.js runtime. Replaces @tensorflow/tfjs-tflite 0.0.1-alpha.10,
   whose Emscripten module loader returned undefined on the local
   capacitor:// origin ("undefined is not an object (evaluating
   'l._malloc')" — build 200 device trace) and only ever worked via the
   CDN. LiteRT's WASM ships in the app at models/litert/; no CDN, no
   HEAD probe, no instantiate patches, no fetch rewrites.

   Returns a runner: { run(Float32Array) -> Float32Array } so the
   adapter needs no tfjs tensors. */
let _litert = null;
async function loadRuntimeAndModel(modelBytes, manifest) {
  const { loadLiteRt, loadAndCompile, Tensor } = await import('@litertjs/core');
  if (!_litert) {
    const base = `${(import.meta.env.BASE_URL || '/')}models/litert/`;
    _log('LOG', `loadLiteRt(${base})`);
    _litert = await loadLiteRt(base);
    _log('LOG', 'LiteRT wasm ready');
  }
  const size = getModelInputSize(manifest);
  const labels = (manifest && Array.isArray(manifest.labels)) ? manifest.labels.length : 0;
  const staticBytes = staticizeModelBytes(modelBytes, labels);
  const compiled = await loadAndCompile(staticBytes, { accelerator: 'wasm' });
  _log('LOG', `LiteRT model compiled (${staticBytes.byteLength} bytes, input ${size})`);
  return {
    __litert: true,
    run: async (f32) => {
      const t = new Tensor(f32, [1, size, size, 3]);
      const outs = await compiled.run(t);
      const o = Array.isArray(outs) ? outs[0] : Object.values(outs)[0];
      const data = o.toTypedArray();
      try { t.delete && t.delete(); } catch { /* runtime-managed */ }
      try { o.delete && o.delete(); } catch { /* runtime-managed */ }
      return data;
    },
  };
}

/* Main entry point — called from App.jsx on boot. Idempotent: repeat
   calls return the same in-flight promise. */
export function initModel() {
  // A finished init that did NOT produce a model must not be cached for
  // the session — that is the exact defect that left build 195 blank:
  // one offline first-launch resolved null, and every later call
  // (including after network returned) got that same null back until
  // the user manually pressed "Check for updates".
  if (_readyPromise && (_status === 'loading' || _status === 'ready')) {
    return _readyPromise;
  }
  _readyPromise = _doInit();
  return _readyPromise;
}

async function _doInit() {
  _status = 'loading';
  _lastError = null;
  _logBuf.length = 0;
  _log('LOG', `_doInit start; native=${NATIVE}`);
  _emit();

  // ---- 1. LOCAL FIRST. Fish ID readiness must never wait on, or be
  //         denied by, a network response.
  let bytes = null, manifest = null;

  // ---- 1a. Try a structurally valid CACHE first — but a cache that
  //          passes the byte checks and then THROWS at runtime load is
  //          rejected the same as a corrupt one. The previous code set
  //          status=error there and returned null, so a bad cached
  //          update made Fish ID unavailable while a known-good bundled
  //          model sat unread in the app package. A failed cached
  //          update must never cost the feature.
  let cachedLoadError = null;
  if (!_cacheQuarantinedThisSession) {
    const cachedManifest = await readCachedManifest();
    const cachedBytes = cachedManifest ? await readCachedModelBytes() : null;
    const cacheProblem = validModelPair(cachedBytes, cachedManifest);
    if (!cacheProblem) {
      try {
        _model = await withTimeout(loadRuntimeAndModel(cachedBytes, cachedManifest), 25000, 'cached model load');
        _manifest = cachedManifest;
        _modelSource = 'CACHED_UPDATE';
        _status = 'ready'; _lastError = null;
        _log('LOG', `ready: ${cachedManifest.version_name} (source=CACHED_UPDATE)`);
        _emit();
        _backgroundUpdateCheck(cachedManifest.version_name).catch(() => {});
        return _model;
      } catch (e) {
        cachedLoadError = _errText(e);
        _log('ERR', `cached: LOAD FAIL — ${cachedLoadError}`);
        await _quarantineCache(cachedLoadError);
      }
    } else {
      _log('LOG', `cache unusable (${cacheProblem}) — using bundled`);
    }
  } else {
    _log('LOG', 'cache quarantined earlier this session — using bundled');
  }

  // ---- 1b. BUNDLED DeepBlue — the guaranteed baseline.
  const bundled = await loadBundledModel();
  if (bundled) { bytes = bundled.bytes; manifest = bundled.manifest; }

  if (!bytes || !manifest) {
    // Only reachable when the cache failed AND the bundle failed —
    // a genuinely broken install, the sole case allowed to say
    // "model unavailable".
    _modelSource = 'NONE';
    _lastError = cachedLoadError
      ? `cached update failed (${cachedLoadError.slice(0, 120)}) and bundled model failed to load`
      : 'bundled model failed to load';
    _log('ERR', `no usable model: ${_lastError}`);
    _status = 'error'; _emit();
    return null;
  }

  try {
    _model = await withTimeout(loadRuntimeAndModel(bytes, manifest), 25000, 'bundled model load');
    _manifest = manifest;
    _modelSource = 'BUNDLED';
    _status = 'ready';
    // Keep the cached failure visible in diagnostics without making the
    // feature look broken — the model IS ready.
    _lastError = cachedLoadError ? `cached update rejected: ${cachedLoadError.slice(0, 160)}` : null;
    _log('LOG', `bundled: LOAD PASS — ready: ${manifest.version_name} (source=BUNDLED)`);
    _emit();
  } catch (e) {
    const msg = _errText(e);
    _log('ERR', `bundled runtime load failed: ${msg}`);
    _modelSource = 'NONE';
    _lastError = msg; _status = 'error'; _emit();
    return null;
  }

  // ---- 3. Background update check — strictly after readiness, fire
  //         and forget, and NEVER able to un-ready the model.
  _backgroundUpdateCheck(manifest.version_name).catch(() => { /* logged inside */ });

  return _model;
}

/* Opportunistic update: if a newer promoted model exists, download it,
   VALIDATE it, persist it, and only then hot-swap. Any failure leaves
   the running model exactly as it was. */
async function _backgroundUpdateCheck(currentVersion) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    _log('LOG', 'update check skipped (offline)');
    return;
  }
  const remote = await fetchRemoteManifest();
  if (!remote) { _log('LOG', 'update check: no remote manifest'); return; }
  if (remote.version_name === currentVersion) {
    _log('LOG', `update check: ${currentVersion} is current`);
    return;
  }
  _log('LOG', `update available: ${currentVersion} -> ${remote.version_name}`);
  const freshBytes = await fetchRemoteModel();
  const bad = validModelPair(freshBytes, remote);
  if (bad) { _log('ERR', `update rejected: ${bad} — keeping ${currentVersion}`); return; }
  try {
    const m = await loadRuntimeAndModel(freshBytes, remote);
    await writeCache(freshBytes, remote);
    _model = m;
    _manifest = remote;
    _modelSource = 'CACHED_UPDATE';
    _log('LOG', `updated to ${remote.version_name}`);
    _emit();
  } catch (e) {
    _log('ERR', `update load failed: ${e?.message || e} — keeping ${currentVersion}`);
  }
}

/* Force a re-check now — used by a "Check for updates" button in
   Settings. Wipes the cached bytes + manifest; the next init falls to
   the bundled model or a fresh download. LiteRT's wasm stays loaded —
   only the compiled model is rebuilt. */
export async function forceRefreshModel() {
  _readyPromise = null;
  _model = null;
  try {
    if (NATIVE) {
      try { await Filesystem.deleteFile({ path: CACHED_MODEL,    directory: Directory.Data }); } catch {}
      try { await Filesystem.deleteFile({ path: CACHED_MANIFEST, directory: Directory.Data }); } catch {}
    } else {
      try { localStorage.removeItem(LS_MODEL_KEY); }    catch {}
      try { localStorage.removeItem(LS_MANIFEST_KEY); } catch {}
    }
    _log('LOG', 'forceRefreshModel: cleared cached model + manifest');
  } catch (e) {
    _log('ERR', `forceRefreshModel: cache clear failed: ${e && (e.message || e)}`);
  }
  // LiteRT keeps its wasm loaded; only the compiled model is rebuilt.
  _log('LOG', 'forceRefreshModel: LiteRT runtime retained; model will recompile');
  return initModel();
}
