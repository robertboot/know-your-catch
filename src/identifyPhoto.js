/* ============================================================
   PHOTO IDENTIFICATION — INTEGRATION POINT FOR ML MODEL
   ============================================================

   This file is THE stub the rest of the app calls.
   Right now it returns canned sample results to drive the UI.
   When the real on-device ML model is built (TensorFlow Lite,
   Core ML, ONNX Runtime, etc.), replace the body of
   `identifyPhoto()` below. The rest of the app does not change.

   CONTRACT — the function must return:
   {
     confidence: 'high' | 'medium' | 'low',
     candidates: [
       {
         speciesId: string,           // must match an id in data.js SPECIES
         score:     number,           // 0..1 model probability
         evidence:  string[],         // human-readable feature list shown to user
       },
       ...
     ]
   }

   UI INTERPRETATION:
     - 'high'   : show "Confirmed: <species>" with lookalike cross-check.
     - 'medium' : show "Narrowed to N species" with side-by-side cards.
     - 'low'    : show "Couldn't identify confidently" + manual fallback.
                   (candidates array may be empty.)

   IMPLEMENTATION NOTES FOR THE REAL MODEL:
     - Run inference on-device. Do not call an external API. This app
       must work offshore without internet.
     - Decode the image at a reasonable resolution (256x256 or 320x320
       is typical for mobile classification models).
     - Map model output classes 1:1 to speciesId values in src/data.js.
     - Use temperature scaling on softmax outputs so 'high' actually
       means high — overconfident models are the failure mode this app
       was built to avoid.
     - Suggested thresholds (tune with real data):
         top1 > 0.85 and top1 - top2 > 0.30  → 'high'
         top1 > 0.40                          → 'medium'
         else                                 → 'low'
     - Generate `evidence` strings from feature activations or from a
       lookup table keyed on the predicted species + visible features.
============================================================ */

const SAMPLE_RESULTS = [
  {
    confidence: 'high',
    candidates: [
      {
        speciesId: 'red_snapper',
        score: 0.94,
        evidence: [
          'Pinkish-red body coloration',
          'Pointed anal fin shape',
          'Red iris detected',
          'Deep, stocky body proportions',
        ],
      },
    ],
  },
  {
    confidence: 'high',
    candidates: [
      {
        speciesId: 'mahi',
        score: 0.97,
        evidence: [
          'Brilliant green / blue / gold coloration',
          'Long continuous dorsal fin',
          'Deeply forked tail',
        ],
      },
    ],
  },
  {
    confidence: 'medium',
    candidates: [
      {
        speciesId: 'spanish_mackerel',
        score: 0.52,
        evidence: [
          'Mackerel body profile',
          'Yellow spots visible on flank',
          'Lateral line: angle unclear from this angle',
        ],
      },
      {
        speciesId: 'king_mackerel',
        score: 0.41,
        evidence: [
          'Mackerel body profile',
          'Spot pattern unclear',
        ],
      },
    ],
  },
  {
    confidence: 'medium',
    candidates: [
      {
        speciesId: 'greater_amberjack',
        score: 0.48,
        evidence: ['Jack body profile', 'Amber stripe partially visible'],
      },
      {
        speciesId: 'almaco_jack',
        score: 0.39,
        evidence: ['Deep body shape', 'Tall dorsal fin lobe'],
      },
      {
        speciesId: 'lesser_amberjack',
        score: 0.13,
        evidence: ['Small relative size'],
      },
    ],
  },
  {
    confidence: 'medium',
    candidates: [
      {
        speciesId: 'red_snapper',
        score: 0.49,
        evidence: ['Reddish coloration', 'Snapper body shape'],
      },
      {
        speciesId: 'vermilion_snapper',
        score: 0.46,
        evidence: ['Reddish coloration', 'Slender body'],
      },
    ],
  },
  {
    confidence: 'low',
    candidates: [],
  },
];

/**
 * @param {string} imageDataUrl  base64 data URL of the captured image
 * @returns {Promise<{confidence: 'high'|'medium'|'low', candidates: Array}>}
 */
export async function identifyPhoto(imageDataUrl) {
  // === STUB BEHAVIOR — REPLACE THIS WHEN INTEGRATING REAL MODEL ===
  // Simulate model inference time so the analyzing UI is meaningful.
  await new Promise(r => setTimeout(r, 1800));

  // For prototype: rotate through canned results. Pick a result whose
  // index varies with the image data so repeated tests don't all look
  // the same.
  const seed = imageDataUrl ? imageDataUrl.length % SAMPLE_RESULTS.length : 0;
  return SAMPLE_RESULTS[seed];
  // === END STUB ===
}

/**
 * Features the model is examining — surfaced to the user in the
 * analyzing screen so the app feels honest about its method.
 */
export const ANALYSIS_FEATURES = [
  'Body profile and proportions',
  'Fin shape and position',
  'Color pattern and markings',
  'Lateral line angle',
  'Tail and caudal fin shape',
  'Mouth size and position',
];
