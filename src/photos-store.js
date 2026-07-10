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
const THUMB_DIM       = 240;
const THUMB_QUALITY   = 0.65;

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
    entry = { thumb, src: Capacitor.convertFileSrc(uri), path };
  }

  // Best-effort cloud upload. Silent if no session or Supabase config.
  await uploadToCloud(entry, full);
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
    const { data } = c.storage.from('catch-photos').getPublicUrl(key);
    entry.cloudUrl = data?.publicUrl || null;
  } catch {
    // silent — local save still counts as success
  }
}

/* Remove a photo's underlying file if it lives on disk. Safe to call
   on legacy strings / web entries — does nothing then. */
export async function deletePhoto(p) {
  if (!NATIVE || !p || typeof p === 'string' || !p.path) return;
  try {
    await Filesystem.deleteFile({ path: p.path, directory: Directory.Data });
  } catch (e) {
    // File already gone or never existed — not worth surfacing.
  }
}

/* Synchronous thumbnail URL for list-view rendering. Handles legacy
   plain-string entries by using them as their own thumb. */
export function photoThumbUrl(p) {
  if (!p) return null;
  if (typeof p === 'string') return p;
  return p.thumb || p.src || null;
}

/* Synchronous full-size URL for <img src=...> / lightbox / share.
   On native this is already a capacitor:// URL the WebView can load
   directly — no async disk read needed. Cross-device sync case:
   entries pulled from another device only have cloudUrl (no local
   file yet); fall back to that so the photo renders while the
   background lazy-download populates the on-disk copy. */
export function photoDisplayUrl(p) {
  if (!p) return null;
  if (typeof p === 'string') return p;
  return p.src || p.cloudUrl || p.thumb || null;
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
    if (typeof entry !== 'string') return entry;
    if (!entry.startsWith('data:')) return entry;
    changed = true;
    // savePhoto owns the downscale — idempotent for already-small
    // images (single re-encode pass at tier-target dims).
    return await savePhoto(entry);
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
