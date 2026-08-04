/* Classifier adapter — the swappable seam for the ID pipeline.

   Runtime: tfjs-tflite over the published MobileNetV3-Small model
   fetched by model-loader.js. Same preprocess + softmax renormalize
   as the admin Test Image panel so behavior is identical across
   admin and mobile.

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

/* Per-region top-1 scores from the last multi-crop run, e.g.
   "0.11/0.14/0.702/0.38" — full frame, 90%, 70%, 50%. Surfaced on the
   couldn't-identify screen so a failure shows whether the crops helped
   at all, instead of us guessing. */
let _lastCropTrace = null;
export function lastCropTrace() { return _lastCropTrace; }

/* Decode a data URL / URL string into an HTMLImageElement so we can
   rasterize to a fixed size + get pixel bytes. Kept sync to the tab
   we're already on — no Web Workers, matches the admin Test Image
   panel path. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
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

  const tf = await import('@tensorflow/tfjs');
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
  const REGIONS = [
    null,                                  // full frame (letterboxed)
    { x: 0.05, y: 0.05, w: 0.90, h: 0.90 }, // trim edge clutter
    { x: 0.15, y: 0.15, w: 0.70, h: 0.70 }, // center 70%
    { x: 0.25, y: 0.25, w: 0.50, h: 0.50 }, // center 50%
  ];

  let best = null;
  const trace = [];
  for (const region of REGIONS) {
    const scored = await classifyRegion(tf, model, info, img, size, region);
    if (!scored || !scored.length) { trace.push('x'); continue; }
    trace.push(scored[0].score.toFixed(2));
    if (!best || scored[0].score > best[0].score) best = scored;
  }
  _lastCropTrace = trace.join('/');
  return best || [];
}

/* One forward pass over a single region. Returns the full label list
   sorted best-first, or [] on failure. */
async function classifyRegion(tf, model, info, img, size, region) {
  const rgb = imageToRgb(img, size, region);
  // float16/float32 models want a float32 [0,255] tensor (the model's
  // Rescaling layer divides by 255 internally). Legacy INT8 models took
  // uint8, fed here as int32. Default to the legacy path when the
  // manifest doesn't declare a dtype.
  const input = info.input_dtype === 'float32'
    ? tf.tensor4d(Float32Array.from(rgb), [1, size, size, 3], 'float32')
    : tf.tensor4d(rgb, [1, size, size, 3], 'int32');
  let output;
  try {
    output = model.predict(input);
    const raw = await output.data();
    const scores = normalizeScores(raw);
    const labels = info.labels || [];
    const excluded = new Set(info.excluded_species || []);
    // Return every label so the pipeline's Stage 5 (jurisdiction
    // constrain) has full context; sort best-first for its top-K
    // selection. Filter out the excluded set — matches the admin
    // Test Image behavior.
    return labels
      .map((label, i) => ({ label, score: scores[i] || 0 }))
      .filter((r) => !excluded.has(r.label))
      .sort((a, b) => b.score - a.score);
  } finally {
    input.dispose();
    if (output) output.dispose();
  }
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
