/* Admin image upload — shared between species photos and brand assets.

   Both flows do the same thing: take a File from an <input type="file">,
   optionally downscale to a target long-side, upload to a Supabase
   Storage bucket, and return the public URL. Public URLs work with the
   anon key alone so the iOS bundle can pull them without a session.

   Downscaling picks output format based on input:
    - image/png with alpha → PNG output (preserves transparency)
    - image/svg+xml → uploaded as-is, no downscale
    - everything else → JPEG output (smaller for photos)

   Species photos are typically NOAA-sourced JPEGs (no transparency);
   brand assets are typically PNGs with alpha (transparent BG on top of
   the dark ocean-blue header). The format-preserve rule handles both
   without a caller flag. */
import { client } from '../supabase-client.js';

const rand = () => Math.random().toString(36).slice(2, 10);

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/* Downscale a File to a max long-side, preserving PNG alpha. Returns
   { dataUrl, mime, ext }. If the input is a PNG, output stays PNG so
   transparent pixels don't flatten to black — that was the bug that
   put a black background behind the header logo. Anything non-PNG /
   non-SVG lands as JPEG. */
async function downscalePreservingFormat(file, maxDim, quality) {
  const isPng = file.type === 'image/png' || (file.name || '').toLowerCase().endsWith('.png');
  const outMime = isPng ? 'image/png' : 'image/jpeg';
  const outExt  = isPng ? 'png' : 'jpg';
  const srcUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const outUrl = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) { resolve(srcUrl); return; }
      const longest = Math.max(srcW, srcH);
      const ratio = Math.min(1, maxDim / longest); // scale down only
      const w = Math.max(1, Math.round(srcW * ratio));
      const h = Math.max(1, Math.round(srcH * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // The canvas is transparent by default; do NOT fill it. drawImage
      // preserves alpha from the source PNG. If we ever draw on top of
      // an opaque background here, transparent regions would flatten.
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const out = isPng
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', quality);
        resolve(out.length < srcUrl.length ? out : srcUrl);
      } catch {
        resolve(srcUrl);
      }
    };
    img.onerror = () => resolve(srcUrl);
    img.src = srcUrl;
  });
  return { dataUrl: outUrl, mime: outMime, ext: outExt };
}

/**
 * Upload a File to a Supabase Storage bucket and return its public URL.
 *
 * @param {Object} opts
 * @param {string} opts.bucket    — 'fish-photos' or 'brand-assets'
 * @param {string} opts.pathPrefix — e.g. 'red_snapper/' or 'logo_horizontal/'
 * @param {File}   opts.file
 * @param {boolean}[opts.downscale=true] — false for SVGs / already-optimised
 * @param {number} [opts.maxDim=1600]
 * @param {number} [opts.quality=0.82]
 * @returns {Promise<{ok: true, url: string, path: string} | {ok: false, error: string}>}
 */
export async function uploadImage({ bucket, pathPrefix = '', file, downscale = true, maxDim = 1600, quality = 0.82 }) {
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  if (!file) return { ok: false, error: 'No file selected.' };

  try {
    let bodyBlob;
    let contentType;
    let ext;
    const isSvg = file.type === 'image/svg+xml' || (file.name || '').toLowerCase().endsWith('.svg');
    if (isSvg) {
      bodyBlob = file;
      contentType = 'image/svg+xml';
      ext = 'svg';
    } else if (downscale) {
      const scaled = await downscalePreservingFormat(file, maxDim, quality);
      bodyBlob = await dataUrlToBlob(scaled.dataUrl);
      contentType = scaled.mime;
      ext = scaled.ext;
    } else {
      bodyBlob = file;
      contentType = file.type || 'image/jpeg';
      ext = (file.name || '').slice((file.name || '').lastIndexOf('.') + 1) || 'jpg';
    }

    const path = `${pathPrefix.replace(/\/+$/, '')}/${Date.now()}-${rand()}.${ext}`
      .replace(/^\/+/, '');
    const { error } = await c.storage.from(bucket).upload(path, bodyBlob, {
      contentType,
      cacheControl: '31536000, immutable',
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };
    const { data } = c.storage.from(bucket).getPublicUrl(path);
    return { ok: true, url: data.publicUrl, path };
  } catch (e) {
    return { ok: false, error: e?.message || 'Upload failed' };
  }
}

/** Delete a stored file by its bucket-relative path. */
export async function deleteStored(bucket, path) {
  const c = client();
  if (!c) return { ok: false };
  const { error } = await c.storage.from(bucket).remove([path]);
  return { ok: !error, error: error?.message };
}
