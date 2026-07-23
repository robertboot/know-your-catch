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
function imageToRgb(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
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
  const rgb = imageToRgb(img, size);
  const input = tf.tensor4d(rgb, [1, size, size, 3], 'int32');
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
