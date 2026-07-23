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

   ONLINE-FIRST, OFFLINE-CAPABLE: when the phone has network AND the
   angler is signed in, Stage 3 first asks the cloud (Claude vision,
   via the identify-fish edge function) for a much stronger ID — and
   that call also feeds the photo back into the training queue so the
   on-device model keeps improving. On any failure — offline, signed
   out, rate-limited, or a network hiccup — it silently falls back to
   the fully-offline on-device pipeline below. The on-device model,
   when bundled, loads from a packaged static asset only.

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
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';
import { downscaleImageDataUrl } from './storage.js';

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
      if (!mapped) return null;
      // Deactivated species never surface as a classifier candidate,
      // even if the model has a label for one. Historical catches still
      // resolve elsewhere; the ID surface only offers active options.
      if (SPECIES_BY_ID[mapped]?.active === false) return null;
      return { speciesId: mapped, score: p.score };
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

/* Map a raw 0..1 cloud confidence to the app's string band. Slightly
   more forgiving than the on-device thresholds because Claude's
   confidence is calibrated and it always returns alternates for the
   confirm page to show. */
function bandForCloudConfidence(conf) {
  if (conf >= 0.8) return 'high';
  if (conf >= 0.45) return 'medium';
  return 'low';
}

/* Online ID via the identify-fish edge function (Claude vision).
   Returns the app's standard { confidence, candidates } contract, or
   null to signal "fall back to the on-device pipeline" — for offline,
   signed-out, rate-limited, or any error case. Never throws. */
async function tryCloudIdentify(imageDataUrl, jurisdictionId) {
  try {
    // Fast bail before any work: no network, or the app can't reach a
    // signed-in session to authenticate the call.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const c = client();
    if (!c) return null;
    const session = getLastSession();
    if (!session?.access_token) return null; // signed-out → on-device only

    const dataUrl = await downscaleImageDataUrl(imageDataUrl, 1024, 0.8);
    const m = dataUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,/i);
    if (!m) return null;
    const mediaType = m[1].toLowerCase();
    const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    const speciesList = SPECIES
      .filter(s => s.active !== false)
      .map(s => ({ id: s.id, commonName: s.commonName, scientific: s.scientific || undefined }));

    const { data, error } = await c.functions.invoke('identify-fish', {
      body: { imageBase64, mediaType, speciesList },
    });
    if (error || !data || data.error) return null;

    const topId = (typeof data.speciesId === 'string' && SPECIES_BY_ID[data.speciesId])
      ? data.speciesId : null;
    if (!topId) {
      // Cloud saw no match in OUR species list. It can still describe
      // what the fish is (data.note) even though we have no regulations
      // for it — surface that instead of a dead "no match", and flag it
      // so the UI can offer "add this species". Returning a valid
      // (empty-candidate) contract means we DON'T fall back to the
      // weaker on-device model.
      const note = typeof data.note === 'string' ? data.note.trim() : '';
      return { confidence: 'low', candidates: [], _source: 'ai', aiNote: note || null, offList: true };
    }

    // Build candidates: the top pick, then the alternates, with gently
    // decreasing pseudo-scores so the confirm page ranks them in order.
    const conf = Math.max(0, Math.min(1, Number(data.confidence) || 0));
    const alts = (Array.isArray(data.alternates) ? data.alternates : [])
      .filter(id => SPECIES_BY_ID[id] && SPECIES_BY_ID[id].active !== false && id !== topId);
    const ordered = [topId, ...alts];
    const candidates = ordered.map((id, i) => ({
      speciesId: id,
      score: i === 0 ? conf : Math.max(0.05, conf * Math.pow(0.5, i)),
      evidence: evidenceFor(id, !REGULATIONS[id]?.[jurisdictionId] && !!jurisdictionId),
    }));

    return { confidence: bandForCloudConfidence(conf), candidates, _source: 'ai' };
  } catch {
    return null;
  }
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

  // Online-first: ask the cloud (Claude vision) for a strong ID. This
  // also feeds the photo back into training so the on-device model
  // improves. null = offline / signed-out / error → use on-device.
  const cloud = await tryCloudIdentify(imageDataUrl, jurisdictionId);
  if (cloud) return cloud;

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
