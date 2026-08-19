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
import { classify, LABEL_TO_SPECIES_ID, lastCropTrace, lastSubjectNote, lastSubjectFound, lastSubjectBox } from './identify/adapter.js';
import { getModelInfo, getModelStatus, getModelError } from './model-loader.js';
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';
import { downscaleImageDataUrl } from './storage.js';
import { photoEvent } from './photos-store.js';

/* Confidence-band thresholds — ONE authoritative source.
   See getBands(): the published model manifest wins when it carries
   thresholds, these are the fallback for a model that predates them.

   The published manifest already shipped min_confidence: 0.6 and
   high_confidence: 0.85, and this file ignored both in favour of its
   own hardcoded numbers. Two configs that disagree is worse than
   either one alone — retuning the manifest silently did nothing.

   NOTE the values below deliberately preserve TODAY's behaviour
   (0.40 medium floor), not the manifest's 0.6. Changing thresholds is
   a separate, measured exercise; this change is only about there
   being a single place that decides. */
const BAND_FALLBACK = {
  highScore:       0.85,   // top-1 must clear this to earn 'high'
  highMargin:      0.20,   //   AND margin over #2 must clear this
  mediumScore:     0.40,   // top-1 (or a competitor) must clear this
  lookalikeFloor:  0.25,   // #2 above this triggers lookalike collision
};

/* Resolve the active thresholds. Manifest values override the
   fallback per-key, so a model can ship one threshold without having
   to restate all of them. */
export function getBands() {
  let info = null;
  try { info = getModelInfo(); } catch { /* model not loaded yet */ }
  const b = { ...BAND_FALLBACK };
  if (info && typeof info === 'object') {
    if (Number.isFinite(info.high_confidence)) b.highScore = info.high_confidence;
    if (Number.isFinite(info.high_margin))     b.highMargin = info.high_margin;
    if (Number.isFinite(info.min_confidence))  b.mediumScore = info.min_confidence;
    if (Number.isFinite(info.lookalike_floor)) b.lookalikeFloor = info.lookalike_floor;
  }
  return b;
}

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

/* Stage 5 — ANNOTATE with jurisdiction coverage. Does NOT rescore.

   This used to multiply the score by 0.5 whenever
   REGULATIONS[speciesId][jurisdictionId] was missing, treating "we
   have no regulation row for this pair" as evidence against the fish
   being that species. Those are unrelated facts. Regulation coverage
   measures how far OUR research has got, not what is swimming in the
   water — and coverage is partial by construction (measured: only 60
   of the 116 model species have a bundled row for a given
   jurisdiction). So more than half the model's classes were having
   their probability halved for a bookkeeping gap.

   The damage was not merely reordering. A halved 0.7 becomes 0.35,
   which falls under the medium floor, and the pipeline then returned
   an EMPTY candidate list — the angler saw no suggestion at all for a
   fish the model had identified correctly.

   Identification and regulation availability are now separate
   concerns: the flag rides along for the UI to show "regulations
   unavailable for your waters", and the score is untouched. */
function annotateJurisdiction(candidates, jurisdictionId) {
  if (!jurisdictionId) return candidates;
  return candidates.map((c) => ({
    ...c,
    outOfRange: !REGULATIONS[c.speciesId]?.[jurisdictionId],
  }));
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
function lookalikeCollision(top, rest, band) {
  if (!top) return false;
  const lookalikes = new Set(SPECIES_BY_ID[top.speciesId]?.lookalikes || []);
  return rest.some(
    (c) => lookalikes.has(c.speciesId) && c.score >= band.lookalikeFloor
  );
}

/* Stage 6 — Rank, band, and shape into the public contract. */
function rankAndBand(candidates) {
  const band = getBands();
  const sorted = candidates.slice().sort((a, b) => b.score - a.score);
  // Genuinely nothing to say — the model returned no mappable label.
  if (sorted.length === 0) {
    return { confidence: 'low', candidates: [], notConfident: true };
  }

  const top = sorted[0];
  const rest = sorted.slice(1);
  const margin = top.score - (rest[0]?.score ?? 0);
  const collision = lookalikeCollision(top, rest, band);

  const shape = (c) => ({
    speciesId: c.speciesId,
    score: c.score,
    evidence: evidenceFor(c.speciesId, c.outOfRange),
    outOfRange: !!c.outOfRange,
  });

  if (
    top.score >= band.highScore &&
    margin     >= band.highMargin &&
    !collision
  ) {
    return { confidence: 'high', candidates: [shape(top)] };
  }

  if (
    top.score >= band.mediumScore ||
    (rest[0] && rest[0].score >= band.mediumScore)
  ) {
    return {
      confidence: 'medium',
      candidates: sorted.slice(0, 3).map(shape),
    };
  }

  // LOW — under the floor, but NOT silent.
  //
  // This used to return `candidates: []`, so an angler whose photo
  // scored 0.39 saw exactly what someone photographing an empty deck
  // saw: nothing. The model had an opinion and the pipeline threw it
  // away, which is why "it doesn't even give a suggestion" was a
  // reported symptom.
  //
  // The candidates now ride along with notConfident: true. The band is
  // still 'low', so every existing caller that branches on confidence
  // keeps its current behaviour and CANNOT mistake these for a
  // reliable ID — it has to opt in by reading notConfident.
  return {
    confidence: 'low',
    notConfident: true,
    candidates: sorted.slice(0, 3).map(shape),
  };
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
let _lastCloudReason = null;
/* Why the cloud ID didn't run. The function bailed silently on offline,
   signed-out, rate-limited and error alike, so a missing fallback was
   indistinguishable from a working one. Surfaced on the
   couldn't-identify screen. */
export function lastCloudReason() { return _lastCloudReason; }
const bail = (why) => { _lastCloudReason = why; return null; };

async function tryCloudIdentify(imageDataUrl, jurisdictionId) {
  _lastCloudReason = null;
  try {
    // Fast bail before any work: no network, or the app can't reach a
    // signed-in session to authenticate the call.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return bail('offline');
    const c = client();
    if (!c) return bail('supabase not configured');
    const session = getLastSession();
    if (!session?.access_token) return bail('signed out'); // on-device only

    const dataUrl = await downscaleImageDataUrl(imageDataUrl, 1024, 0.8);
    const m = dataUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,/i);
    if (!m) return bail('bad image encoding');
    const mediaType = m[1].toLowerCase();
    const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);

    const speciesList = SPECIES
      .filter(s => s.active !== false)
      .map(s => ({ id: s.id, commonName: s.commonName, scientific: s.scientific || undefined }));

    const { data, error } = await c.functions.invoke('identify-fish', {
      body: { imageBase64, mediaType, speciesList },
    });
    if (error || !data || data.error) return bail(`edge fn: ${error?.message || data?.error || 'no data'}`);

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
  } catch (e) {
    return bail(`threw: ${e?.message || e}`);
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

  /* On-device first and, in practice, only. classify() internally asks
     Vision for a subject box and crops to it, so DeepBlue is handed the
     fish rather than the whole boat scene. */
  let local = null;
  let localTop = 0;
  let cropped = false;
  let localErr = null;
  let localTopId = null;
  try {
    const topK = await classify(imageDataUrl);
    if (topK && topK.length) {
      localTop = topK[0]?.score || 0;
      localTopId = topK[0]?.label || null;
      cropped = lastSubjectFound();
      local = rankAndBand(annotateJurisdiction(mapLabelsToSpecies(topK), jurisdictionId));
      local._subjectBox = lastSubjectBox();
    } else {
      localErr = 'classify returned empty top-K';
    }
  } catch (e) {
    // Model not ready (e.g. first launch before it downloads) — but the
    // REASON must not be swallowed: build 194 showed cloud silently
    // papering over a dead local model whenever there was signal.
    localErr = e?.message || String(e);
  }

  const diagTail = () =>
    `on-device ${localTop.toFixed(2)} · subject ${lastSubjectNote() || 'n/a'}`;

  /* DeepBlue answers whenever it has an answer.

     The cloud was tried as the stronger identifier and repeatedly wasn't:
     it got species wrong that DeepBlue had just got right, including on
     photos DeepBlue handled uncropped. It's kept only for the case where
     there is no local answer at all — model still downloading on a first
     launch — and never as a second opinion, because "second opinion"
     turned into "overrides a correct answer with a wrong one". */
  if (local) {
    photoEvent({
      kind: 'fishid',
      modelStatus: getModelStatus(),
      modelVersion: getModelInfo()?.version_name || null,
      localTop1: localTopId, localScore: localTop,
      cloudCalled: false,
      engine: 'DEEPBLUE_LOCAL',
    });
    return {
      ...local,
      _diag: `${diagTail()}${cropped ? ' · cropped' : ''}`,
      _cropTrace: lastCropTrace(),
    };
  }

  const cloud = await tryCloudIdentify(imageDataUrl, jurisdictionId);
  photoEvent({
    kind: 'fishid',
    modelStatus: getModelStatus(),
    modelVersion: getModelInfo()?.version_name || null,
    modelError: (getModelError() || '').slice(0, 120) || null,
    localErr: localErr ? String(localErr).slice(0, 120) : null,
    localTop1: localTopId, localScore: localTop || null,
    cloudCalled: true, cloudResult: cloud ? (cloud.candidates?.[0]?.speciesId || 'none') : 'bail',
    engine: cloud ? 'CLAUDE_CLOUD' : 'NONE',
  });
  if (cloud) return { ...cloud, _diag: `cloud used (no local model) · ${diagTail()}`, _subjectBox: lastSubjectBox() };

  // Nothing available — return an empty, banded result.
  return rankAndBand([]);
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
