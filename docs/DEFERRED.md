# Deferred work

Standing list of known follow-ups that aren't shipping in the current
build. Each has a rationale so nothing gets forgotten.

---

## Model accuracy audit for identifyPhoto.js

**Reported**: build 17 / early build 18 conversation. Angler notes
the current identifier is not correctly IDing real catches.

**Scope**:
- Audit `src/identifyPhoto.js` — what heuristics is the stub / current
  model using? Right now it's a canned rotation through
  `SAMPLE_RESULTS`, which is a placeholder from before real inference
  was wired.
- Consider replacing with a proper on-device vision model:
  Core ML for iOS (native), or TensorFlow Lite for cross-platform.
  Training set: Gulf species from the same NOAA source that already
  feeds the photo manifest.
- Training signal: build 18 starts persisting `aiIdentifiedSpeciesId`,
  `aiConfidence`, and `aiWasConfirmed` on every catch. Once we have a
  few hundred logged catches, that data becomes the ground truth for
  a model retrain — corrected picks label the misclassifications
  directly.

**Not shipping this pass** — the ID confirmation card in build 18 is
the UX work to make the current model's misses recoverable and to
capture the labeling signal. The model swap itself is bigger.

---

## Species-picker modal on "Not this fish"

**Scope**: today "Not this fish" drops the angler on catch_entry with
no species preselected — they pick from the dropdown. A dedicated
picker modal (search + browse) would feel richer and could show the
lookalikes of the AI's original pick first ("if it's not a Red
Snapper, maybe one of these?").

**Not shipping this pass** — dropdown is one tap, adding a modal would
be two. Waiting for the model swap to reduce "not this fish" taps
before optimizing that path.

---

## Settings surface for "your AI accuracy"

**Scope**: once catches accumulate with `aiIdentifiedSpeciesId` +
`aiWasConfirmed`, surface a rolling accuracy number in Settings
("Your AI: 62% over 40 catches"). Compare confidence-tier splits
(is 80%-confidence actually right 80% of the time?).

**Not shipping this pass** — needs enough logged catches to be
meaningful; deferred until the model swap has landed and stable
metrics exist.
