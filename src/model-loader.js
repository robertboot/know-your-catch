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
let _status = 'idle';             // 'idle' | 'loading' | 'ready' | 'error' | 'no-network'

/* Subscribers for Settings UI. Notified on status changes. */
const _subs = new Set();
function _emit() { for (const cb of _subs) { try { cb(); } catch {} } }
export function subscribeModel(cb) { _subs.add(cb); return () => _subs.delete(cb); }

export function getModelStatus() { return _status; }
export function getModelInfo()   { return _manifest; }
export function getReadyModel()  { return _readyPromise; }

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
  if (!url) return null;
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

/* Load the tflite runtime + a model from bytes. Kept private so all
   the WASM path setup lives in one place. Mirrors the admin
   TestImagePanel setup so behavior is identical. */
async function loadRuntimeAndModel(modelBytes) {
  // Hoist the tfjs ESM module namespace onto window — the UMD tflite
  // bundle looks up `tf` there.
  const tf = await import('@tensorflow/tfjs');
  if (typeof window !== 'undefined') window.tf = tf;

  if (typeof window !== 'undefined' && !window.tflite) {
    await new Promise((resolve, reject) => {
      const base = `${(import.meta.env.BASE_URL || '/')}models/tflite/`;
      const s = document.createElement('script');
      s.src = `${base}tf-tflite.min.js`;
      s.onload = () => {
        if (!window.tflite) return reject(new Error('tflite global not set'));
        window.tflite.setWasmPath(base);
        resolve();
      };
      s.onerror = () => reject(new Error('failed to load tfjs-tflite runtime'));
      document.head.appendChild(s);
    });
  }
  // numThreads: 1 → single-threaded WASM (SharedArrayBuffer requires
  // COOP/COEP headers we don't ship). enableXnnpackDelegate: false →
  // avoids the Safari-crash bug in the alpha.10 XNNPACK delegate.
  return await window.tflite.loadTFLiteModel(
    new Uint8Array(modelBytes),
    { numThreads: 1, enableXnnpackDelegate: false },
  );
}

/* Main entry point — called from App.jsx on boot. Idempotent: repeat
   calls return the same in-flight promise. */
export function initModel() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = _doInit();
  return _readyPromise;
}

async function _doInit() {
  _status = 'loading'; _emit();

  // 1. Read whatever we have cached.
  const cachedManifest = await readCachedManifest();

  // 2. Try the network for the latest manifest.
  const remoteManifest = await fetchRemoteManifest();

  // 3. Decide which manifest wins.
  const needsDownload =
    !cachedManifest ||
    (remoteManifest && remoteManifest.version_name !== cachedManifest.version_name);

  let effectiveManifest = cachedManifest;
  let modelBytes = null;

  if (needsDownload && remoteManifest) {
    // New version available (or first launch). Try to fetch bytes.
    modelBytes = await fetchRemoteModel();
    if (modelBytes) {
      effectiveManifest = remoteManifest;
      await writeCache(modelBytes, remoteManifest);
    }
    // If bytes fetch failed but we have a cache, fall through to it.
  }

  // 4. If no bytes yet (either no download attempted or it failed),
  //    fall back to cached bytes.
  if (!modelBytes) {
    modelBytes = await readCachedModelBytes();
  }

  // 5. If we STILL have nothing, this is a first launch offline.
  if (!modelBytes || !effectiveManifest) {
    _status = 'no-network'; _emit();
    return null;
  }

  // 6. Load into runtime.
  try {
    _model = await loadRuntimeAndModel(modelBytes);
    _manifest = effectiveManifest;
    _status = 'ready';
    _emit();
    return _model;
  } catch (e) {
    console.error('[model-loader] runtime load failed:', e);
    _status = 'error';
    _emit();
    return null;
  }
}

/* Force a re-check now — used by a "Check for updates" button in
   Settings. Clears the in-flight promise so initModel() re-fetches. */
export async function forceRefreshModel() {
  _readyPromise = null;
  _model = null;
  return initModel();
}
