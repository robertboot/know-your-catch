/* Classifier adapter — the swappable seam for the ID pipeline.

   Runtime: LiteRT.js (@litertjs/core) over the DeepBlue model provided
   by model-loader.js, which exposes a plain
   { run(Float32Array) -> Float32Array } runner — no tfjs tensors.
   Preprocessing and softmax renormalisation are unchanged from the
   tfjs-tflite era and verified A/B equivalent (10/10 top-1, max score
   delta 3.9e-6).

   Fully offline after first sync: the model + manifest are cached
   to Capacitor Filesystem (native) or localStorage (web) on the
   first successful launch. Subsequent runs go straight to the cache.

   Fallback: on first launch with no cache and no network the stub
   returns an empty top-K, which routes users to the manual species
   picker via identifyPhoto.js's "low" band handling — a graceful
   degradation, not a crash. */

import { getReadyModel, getModelInfo, initModel } from '../model-loader.js';

/* Kept for the identify pipeline import — populated at build time
   when we bake in the label→speciesId map for edge cases. Empty means
   the pipeline falls back to identity mapping (label === speciesId),
   which matches how our Colab training script emits labels. */
export const LABEL_TO_SPECIES_ID = {};

/* Feature flag for the stub path. Kept as an export for tests / dev
   overrides; wired to the "no-network first-launch" fallback in
   classify() below. Defaults false — production always uses the
   real classifier. */
export const USE_STUB_MODEL = false;

const IMG_SIZE_DEFAULT = 224;

let _lastCropTrace = null;
export function lastCropTrace() { return _lastCropTrace; }

/* Auto-crop is removed (see realClassify). These are kept so the ID
   pipeline and its diagnostic line keep compiling without a scatter of
   conditionals, and so re-introducing a real fish DETECTOR later is a
   one-file change rather than a re-wiring. */
export function lastSubjectNote()  { return 'auto-crop disabled'; }
export function lastSubjectFound() { return false; }
export function lastSubjectBox()   { return null; }







/* Decode a data URL / URL string into an HTMLImageElement so we can
   rasterize to a fixed size + get pixel bytes. Kept sync to the tab
   we're already on — no Web Workers, matches the admin Test Image
   panel path. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // Apply the EXIF Orientation tag — the default, stated explicitly
    // because the training pipeline now depends on it.
    //
    // 'from-image' is the HTML default, so this changes nothing at
    // runtime; it exists so that anyone setting it to 'none' has to
    // notice they are breaking parity with training/train_fish_id.py's
    // _decode_upright(), which applies the tag via PIL. Both sides must
    // hand the model the same physical pixels.
    // See tests/test_exif_parity.py.
    try { img.style.imageOrientation = 'from-image'; } catch { /* older WebView */ }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

/* Extract 224x224 uint8 RGB bytes from an image. Skips
   tf.browser.fromPixels' int32 route so the tflite runtime never has
   to insert an int32→uint8 conversion op (which hangs on Safari's
   CPU fallback). */
/* region (optional): { x, y, w, h } in 0..1 of the source image, so a
   caller can classify a sub-crop without re-encoding the photo.

   Aspect is PRESERVED (letterboxed), not squashed. This used to be
   drawImage(img, 0, 0, size, size), which stretched a 3:4 portrait into
   a square — body proportions are a primary ID cue, so the model was
   being handed a distorted fish. */
function imageToRgb(img, size, region) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Neutral grey padding — black would read as a dark object.
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const sx = region ? Math.max(0, Math.round(region.x * iw)) : 0;
  const sy = region ? Math.max(0, Math.round(region.y * ih)) : 0;
  const sw = region ? Math.max(1, Math.round(region.w * iw)) : iw;
  const sh = region ? Math.max(1, Math.round(region.h * ih)) : ih;

  const scale = Math.min(size / sw, size / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh,
    Math.round((size - dw) / 2), Math.round((size - dh) / 2), dw, dh);
  const rgba = ctx.getImageData(0, 0, size, size).data;
  const pixelCount = size * size;
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3]     = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}

/* Dequantize + renormalize the TFLite output to a proper softmax
   distribution. Verbatim copy of the admin Test Image path — see
   the comments there for why this defensive coding is required
   across tfjs-tflite versions. */
function normalizeScores(raw) {
  const arr = raw instanceof Float32Array ? Array.from(raw) : Array.from(raw, Number);
  if (arr.length === 0) return arr;
  let max = -Infinity, sum = 0;
  for (const v of arr) { if (v > max) max = v; sum += v; }
  if (max > 1.5) {
    const scaled = arr.map(v => v / 255);
    const s = scaled.reduce((a, b) => a + b, 0) || 1;
    return scaled.map(v => v / s);
  }
  if (Math.abs(sum - 1) > 0.05 && sum > 0) {
    return arr.map(v => v / sum);
  }
  return arr;
}

/* Real classifier — used when a model is loaded. */
async function realClassify(imageDataUrl) {
  // Landing on any Fish-ID screen kicks off initModel() in App.jsx, so
  // by the time a photo is analyzed it's usually resolved already. But
  // if the pipeline somehow runs before that warm-up finishes we'd
  // rather wait than fail — the analyzing UI already shows a spinner.
  const model = await (getReadyModel() || initModel());
  if (!model) return [];
  const info = getModelInfo();
  if (!info) return [];

  const img = await loadImage(imageDataUrl);
  const size = info.input_size || IMG_SIZE_DEFAULT;

  /* Multi-crop ensemble.

     A fish is typically a small part of a boat photo — 20-25% of the
     frame is normal. Squeezed into a 224px input that leaves ~50px of
     actual fish, which is why confidence collapses on wide shots and
     jumps the moment the angler crops manually. DeepBlue also trained
     on iNaturalist photos, which are tight and fish-centric, so a wide
     scene is out of distribution for it.

     So do the crop for them: classify the full frame plus a few
     interior regions and keep whichever scores highest. Center crops
     because a held-up fish is nearly always centred; the wide 90%
     variant just trims boat clutter at the edges.

     Cost is N inferences. DeepBlue is small and this runs on the
     analyzing screen which already shows a progress UI. */
  /* No auto-crop. Two attempts failed for the same reason:

       saliency      → selected ~the whole frame (measured 0.92x0.99)
       segmentation  → selected the ANGLER (measured 0.77x0.99, full height)

     Saliency finds what stands out and segmentation finds the foreground
     subject; on a photo of a person holding a fish, both answer "the
     person". Neither knows what a fish is, so neither can isolate one,
     and a confidently wrong crop is worse than no crop. Doing this
     properly needs an object detector trained on labelled fish boxes.

     The full frame is still LETTERBOXED rather than squashed — the
     original code stretched a 3:4 photo into a square, distorting body
     proportions, which is a primary ID cue. That fix was real and
     stays. */
  const REGIONS = [null];

  return await classifyRegion(model, info, img, size, null);
}

/* One forward pass over a single region. Returns the full label list
   sorted best-first, or [] on failure. */
async function classifyRegion(model, info, img, size, region) {
  const rgb = imageToRgb(img, size, region);
  // LiteRT runner (model-loader) takes a raw Float32Array in [0,255] —
  // the model's own Rescaling layer divides by 255 in-graph, exactly as
  // before. Same bytes, same order, same range as the tfjs path; only
  // the tensor plumbing is gone.
  const raw = await model.run(Float32Array.from(rgb));
  const scores = normalizeScores(raw);
  const labels = info.labels || [];
  const excluded = new Set(info.excluded_species || []);
  // Return every label so the pipeline's Stage 5 (jurisdiction
  // annotate) has full context; sort best-first for its top-K
  // selection. Filter out the excluded set — matches the admin
  // Test Image behavior.
  return labels
    .map((label, i) => ({ label, score: scores[i] || 0 }))
    .filter((r) => !excluded.has(r.label))
    .sort((a, b) => b.score - a.score);
}

/* Adapter public interface — invoked by identifyPhoto.js pipeline
   Stage 3. Signature is intentionally minimal so both TF.js and
   Core-ML adapters can implement it identically. */
export async function classify(imageDataUrl) {
  if (USE_STUB_MODEL) return [];
  try {
    return await realClassify(imageDataUrl);
  } catch (e) {
    console.error('[classify] failed:', e);
    return [];
  }
}
