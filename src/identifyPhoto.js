/* ============================================================
   PHOTO IDENTIFICATION PIPELINE
   ============================================================

   Public API used by src/screens1.jsx PhotoAnalyzingScreen. The
   pipeline runs six stages inside identifyPhoto():

     1. Detect & crop           (inside adapter, TODO in Scope B)
     2. Preprocess              (inside adapter)
     3. Classify                (via src/identify/adapter.js — the
                                 swappable seam. TF.js or Core ML.)
     4. Map labels → speciesId  (LABEL_TO_SPECIES_ID + identity)
     5. Constrain to jurisdiction (penalize out-of-range instead of
                                   silently dropping — rare catches
                                   surface at low confidence)
     6. Rank, band, and shape into the public contract

   FULLY OFFLINE: no fetch / XHR / remote URLs anywhere in this
   file OR the adapter. The model, when bundled, loads from a
   packaged static asset only — never downloaded at runtime.

   CONTRACT — must remain identical to the original stub so the
   rest of the app doesn't change:
     {
       confidence: 'high' | 'medium' | 'low',
       candidates: [
         { speciesId: string,
           score:     number,       // 0..1
           evidence:  string[] }
       ]
     }

   UI INTERPRETATION:
     high   — one confident candidate; UI prefills species.
     medium — 2–3 candidates, side-by-side disambiguation.
     low    — no confident pick; UI routes to manual species entry.
   ============================================================ */

import { SPECIES, REGULATIONS } from './data.js';
import { classify, LABEL_TO_SPECIES_ID } from './identify/adapter.js';

/* Confidence-band thresholds. Computed from a numeric top-1 score +
   the margin over #2, then translated to the string bands the rest of
   the app already branches on. Conservative on purpose: this is a
   "stay legal" app, so a confidently-wrong ID has real consequences.
   Tune the numbers once real-model accuracy is measured. */
const BAND = {
  highScore:       0.85,   // top-1 must clear this to earn 'high'
  highMargin:      0.20,   //   AND margin over #2 must clear this
  mediumScore:     0.40,   // top-1 (or a competitor) must clear this
  lookalikeFloor:  0.25,   // #2 above this triggers lookalike collision
  outOfRangePenalty: 0.5,  // multiplier for jurisdiction-missing species
};

const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/* Stage 4 — Map raw model labels to our internal speciesIds.
   Order:
     1. LABEL_TO_SPECIES_ID (populated by the real model in Scope B)
     2. Identity fallback if the label already IS a speciesId
        (the stub emits speciesId strings directly)
   Anything unmapped is dropped. */
function mapLabelsToSpecies(topK) {
  return topK
    .map((p) => {
      const mapped =
        LABEL_TO_SPECIES_ID[p.label] ||
        (SPECIES_BY_ID[p.label] ? p.label : null);
      return mapped ? { speciesId: mapped, score: p.score } : null;
    })
    .filter(Boolean);
}

/* Stage 5 — Constrain to the angler's current jurisdiction.
   REGULATIONS[speciesId][jurisdictionId] being present is our proxy
   for "this species is caught here." Out-of-range candidates are
   penalized rather than dropped so a genuinely rare catch can still
   surface at low confidence instead of vanishing. */
function constrainToJurisdiction(candidates, jurisdictionId) {
  if (!jurisdictionId) return candidates;
  return candidates.map((c) => {
    const inRange = !!REGULATIONS[c.speciesId]?.[jurisdictionId];
    if (inRange) return c;
    return { ...c, score: c.score * BAND.outOfRangePenalty, outOfRange: true };
  });
}

/* Evidence — pull the species' key ID cues from the local dataset.
   These are the same "why" bullets the angler already sees on
   Species Detail, so the confirmation card shows a familiar
   rationale rather than model-speak. */
function evidenceFor(speciesId, outOfRange) {
  const s = SPECIES_BY_ID[speciesId];
  const cues = s?.keyIds?.slice(0, 4) || [];
  if (outOfRange) return [...cues, 'Uncommon in your current waters'];
  return cues;
}

/* Lookalike cross-check — if the top pick looks confident but a known
   lookalike also scored above the floor, downgrade to medium so the
   UI presents them side-by-side. Prevents the "confidently wrong
   snapper" failure mode. */
function lookalikeCollision(top, rest) {
  if (!top) return false;
  const lookalikes = new Set(SPECIES_BY_ID[top.speciesId]?.lookalikes || []);
  return rest.some(
    (c) => lookalikes.has(c.speciesId) && c.score >= BAND.lookalikeFloor
  );
}

/* Stage 6 — Rank, band, and shape into the public contract. */
function rankAndBand(candidates) {
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return { confidence: 'low', candidates: [] };

  const top = sorted[0];
  const rest = sorted.slice(1);
  const margin = top.score - (rest[0]?.score ?? 0);
  const collision = lookalikeCollision(top, rest);

  const shape = (c) => ({
    speciesId: c.speciesId,
    score: c.score,
    evidence: evidenceFor(c.speciesId, c.outOfRange),
  });

  if (
    top.score >= BAND.highScore &&
    margin      >= BAND.highMargin &&
    !collision
  ) {
    return { confidence: 'high', candidates: [shape(top)] };
  }

  if (
    top.score >= BAND.mediumScore ||
    (rest[0] && rest[0].score >= BAND.mediumScore)
  ) {
    return {
      confidence: 'medium',
      candidates: sorted.slice(0, 3).map(shape),
    };
  }

  return { confidence: 'low', candidates: [] };
}

/* ============================================================
   PUBLIC API — signature and return shape unchanged from the stub.

   Called by src/screens1.jsx PhotoAnalyzingScreen.
     imageDataUrl: base64 data URL of the captured image
     options.jurisdictionId: pass the angler's current waters so
       Stage 5 can filter out implausible-for-region species.
       Optional and backward-compatible — missing = no constraint.
   ============================================================ */
export async function identifyPhoto(imageDataUrl, options = {}) {
  const { jurisdictionId = null } = options;

  // Stages 1–3: detect / preprocess / classify happen inside the
  // adapter so runtime specifics stay behind the seam.
  const topK = await classify(imageDataUrl);

  // Stage 4: raw labels → our speciesIds.
  const mapped = mapLabelsToSpecies(topK);

  // Stage 5: apply jurisdiction constraint.
  const constrained = constrainToJurisdiction(mapped, jurisdictionId);

  // Stage 6: rank + band + shape.
  return rankAndBand(constrained);
}

/* Kept unchanged — surfaced by PhotoAnalyzingScreen while the model
   runs so the app "shows its work" instead of a mystery spinner. */
export const ANALYSIS_FEATURES = [
  'Body profile and proportions',
  'Fin shape and position',
  'Color pattern and markings',
  'Lateral line angle',
  'Tail and caudal fin shape',
  'Mouth size and position',
];
