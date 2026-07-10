/* Classifier adapter — the swappable seam for the ID pipeline.

   All model-runtime knowledge lives behind classify(); the rest of
   identifyPhoto.js is runtime-agnostic. Swapping from the stub to a
   real Scope B (TF.js + fine-tuned MobileNet) or Scope C (native
   Core ML via Capacitor plugin) implementation only touches this file.

   Fully offline by construction:
     - No fetch() / XHR / remote URLs.
     - The real adapter, when written, will load its model from a
       packaged app asset via import.meta.glob or a static asset URL
       served from public/ — NEVER downloaded at runtime. */

/* Flip to false when a real model asset is bundled. Kept true today
   so PhotoAnalyzingScreen → IdentificationConfirmCard → CatchEntry
   preserves the same UX-test path we've been shipping. */
export const USE_STUB_MODEL = true;

/* label → speciesId lookup — Stage 4 of the pipeline consults this
   first. Empty until Scope B lands the fine-tuned MobileNet, whose
   output labels will look something like "L_campechanus" or a
   numeric class ID. The stub emits speciesId strings directly, so
   the pipeline's identity fallback matches them without an entry
   needing to be added here. */
export const LABEL_TO_SPECIES_ID = {
  // e.g. 'L_campechanus': 'red_snapper',
  // Filled in Scope B when the trained model's label file lands.
};

/* Canned top-K sequences the stub cycles through — one per hash of
   the image data URL length so repeat tests don't all look the same.
   Scores match the original stub's narrative (high / medium / low)
   and land on the same bands after §6 remapping. */
const STUB_SEQUENCES = [
  [{ label: 'red_snapper',       score: 0.94 }],
  [{ label: 'mahi',              score: 0.97 }],
  [{ label: 'spanish_mackerel',  score: 0.52 }, { label: 'king_mackerel',      score: 0.41 }],
  [{ label: 'greater_amberjack', score: 0.48 }, { label: 'almaco_jack',        score: 0.39 }, { label: 'lesser_amberjack', score: 0.13 }],
  [{ label: 'red_snapper',       score: 0.49 }, { label: 'vermilion_snapper',  score: 0.46 }],
  [],
];

async function stubClassify(imageDataUrl) {
  // Simulate model inference time so the analyzing UI stays meaningful.
  await new Promise((r) => setTimeout(r, 1200));
  const seed = imageDataUrl ? imageDataUrl.length % STUB_SEQUENCES.length : 0;
  return STUB_SEQUENCES[seed];
}

/* TODO(scope-B): implement the real classifier.

   Expected shape:
     - Runtime: TF.js in the WebView. Options:
         @tensorflow/tfjs-tflite   (best for a quantized MobileNet)
         @tensorflow/tfjs + tfjs-converter GraphModel
     - Model: MobileNetV3 or EfficientNet-Lite0 fine-tuned on our
       Gulf species. Bundle as a public/ static asset (path fixed
       at build time; no runtime download).
     - Preprocess:
         1. Decode dataUrl → HTMLImageElement (already do this in
            src/storage.js downscaleImageDataUrl — reuse that path).
         2. Optional: run a small detector (tiny YOLOv8 fish head)
            to crop to the fish. Falls back to center crop if no
            box is found.
         3. Resize to model input dims (typ. 224×224).
         4. Normalize per model spec (usually mean/scale).
     - Return top-K { label, score } sorted best-first. */
async function realClassify(_imageDataUrl) {
  return [];
}

/* Adapter public interface — invoked by identifyPhoto.js pipeline
   Stage 3. Signature is intentionally minimal so both TF.js and
   Core-ML adapters can implement it identically. */
export async function classify(imageDataUrl) {
  return USE_STUB_MODEL ? stubClassify(imageDataUrl) : realClassify(imageDataUrl);
}
