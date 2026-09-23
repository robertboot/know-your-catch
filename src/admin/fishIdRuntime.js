/* Shared in-browser Fish ID runtime for admin panels.

   Loads the currently-promoted .tflite model once per page load
   (module-level promise cache) and exposes a predict helper that
   takes any image URL and returns the top-5 ranked candidates.
   Used by the Review tab's AI-assist strip; TestImagePanel keeps
   its own copy of this wiring for its richer diagnostics view.

   Same runtime constraints as TestImagePanel:
     - numThreads: 1 (no SharedArrayBuffer — Vercel doesn't send
       COOP/COEP and Safari crashes rather than falling back)
     - enableXnnpackDelegate: false (alpha.10 Safari-crash bug)
     - self-hosted UMD runtime under public/models/tflite/ */
import { getProductionModel, modelSignedUrl } from '../model-store.js';

const TFLITE_LOCAL_BASE = `${import.meta.env.BASE_URL}models/tflite/`;

function loadTfliteScript() {
  if (window.tflite) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${TFLITE_LOCAL_BASE}tf-tflite.min.js`;
    s.onload = () => {
      if (!window.tflite) return reject(new Error('tflite global not set'));
      window.tflite.setWasmPath(TFLITE_LOCAL_BASE);
      resolve();
    };
    s.onerror = () => reject(new Error('failed to load tfjs-tflite runtime'));
    document.head.appendChild(s);
  });
}

/* Dequantize/renormalize model output into a [0, 1] distribution —
   handles raw uint8, unnormalized floats, and already-normalized
   scores (same three paths as TestImagePanel.normalizeScores). */
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

let _runtimePromise = null;

/* Resolves to { tflite, labels, excluded, inputSize, versionName }.
   Cached for the page's lifetime; a failed load clears the cache so
   the next call can retry. */
export function loadFishIdRuntime() {
  if (_runtimePromise) return _runtimePromise;
  _runtimePromise = (async () => {
    const prod = await getProductionModel();
    if (!prod) throw new Error('No production model — promote one on the Models tab first.');
    const url = await modelSignedUrl(prod.model_file_path);
    if (!url) throw new Error('model signed url failed');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch model ${resp.status}`);
    const bytes = await resp.arrayBuffer();
    // The UMD tflite bundle reaches for a global `tf` — hoist the ESM
    // module namespace onto window before loading it.
    const tf = await import('@tensorflow/tfjs');
    window.tf = tf;
    await loadTfliteScript();
    const model = await window.tflite.loadTFLiteModel(
      new Uint8Array(bytes),
      { numThreads: 1, enableXnnpackDelegate: false },
    );
    return {
      tflite: model,
      labels: prod.labels_json?.labels || [],
      excluded: new Set(prod.labels_json?.excluded_species || []),
      inputSize: prod.labels_json?.input_size ?? 224,
      versionName: prod.version_name,
    };
  })();
  _runtimePromise.catch(() => { _runtimePromise = null; });
  return _runtimePromise;
}

/* Run one image through the model → top-5 [{ speciesId, score }],
   highest first. imageUrl can be a signed Supabase URL (crossOrigin
   is set so the canvas doesn't taint) or a local object URL. */
export async function predictTop5(runtime, imageUrl) {
  const tf = await import('@tensorflow/tfjs');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = imageUrl;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('image decode failed'));
  });

  // uint8 RGB straight off a canvas — skip tf.browser.fromPixels,
  // whose int32 output provokes a conversion op that hangs Safari's
  // CPU fallback path (same workaround as TestImagePanel).
  const size = runtime.inputSize;
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
  const input = tf.tensor4d(rgb, [1, size, size, 3], 'int32');
  const out = runtime.tflite.predict(input);
  const raw = await out.data();
  input.dispose();
  out.dispose();

  const scores = normalizeScores(raw);
  return Array.from(scores)
    .map((score, i) => ({ speciesId: runtime.labels[i], score }))
    .filter(c => c.speciesId)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
