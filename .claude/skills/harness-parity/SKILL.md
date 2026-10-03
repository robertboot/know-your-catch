---
name: harness-parity
description: Use BEFORE concluding that a model, a data source or an API is wrong, when the evidence comes from a test page, an admin panel, a script or any tool that is not the shipping code path. A measuring tool that does not match production produces a fault that looks exactly like a real one. Also use when building or changing such a tool.
---

# Trust the thing you measured with, or don't trust the measurement

## What this cost

The admin **Test Image** panel reported DeepBlue 12.2 and 12.3 missing
species they had always been confident on, and answering "tripletail" for
nearly everything. 12.2 was the shipping model and was not failing on
device. The conclusion on the table was to rebuild the model in Colab —
hours of GPU time and a day of round-trips — to fix a model that was fine.

The panel had its own copy of the image preprocessing. The app letterboxes
the photo into the 224×224 square and pads with neutral grey. The panel
still ran the original `drawImage(img, 0, 0, size, size)`, which squashes.
Fish photos are landscape, so every fish was compressed sideways into
something short and deep-bodied — and tripletail is the deepest-bodied fish
in the 135 labels. **The model was answering the picture it was handed.**
Both symptoms, one cause, and none of it was the model.

## The rule

When a tool reports something broken, establish **first** that the tool
runs the same path as production. Not "looks similar" — the same imported
function.

Before blaming the model / the feed / the API, check in this order:

1. **Does the harness share code with the app, by import?** If it has its
   own copy of any transform, that copy is the first suspect, not the
   subject under test.
2. **Does the fault point at the harness?** A known-good version failing
   in a new tool is a tool fault until proven otherwise. So is *every*
   input producing the same answer — that is the signature of degenerate
   or constant input, not of a badly trained class.
3. **Does the shipping path reproduce it?** If the app on a device gets it
   right and the admin page gets it wrong, the model is right.

Only when all three say "the harness is faithful" does the subject under
test become the suspect.

## In this repo

- `src/identify/preprocess.js` holds `imageToRgb()` — the **one** copy of
  model input preprocessing. The app's `src/identify/adapter.js` and the
  admin `src/admin/TestImagePanel.jsx` both import it.
- `scripts/ship.sh` refuses to build if `imageToRgb` is defined anywhere
  else, or if an aspect-squashing `drawImage(img, 0, 0, inputSize,
  inputSize)` appears in `src/`. Do not weaken these checks; they exist
  because the review that should have caught the drift did not.
- Preprocessing contract (must match training, see
  [[offline-fishid-contract]]): 224×224 · RGB · aspect-preserving
  letterbox · neutral grey `#808080` padding · float32 · range `[0,255]` ·
  normalization inside the model graph.
- `input_dtype` defaults to `float32` in the admin runtime. Every
  DeepBlue 12.x export is float32; the old `uint8` default silently fed an
  int32 tensor to any export whose `labels_json` omitted the field.

## The same shape elsewhere

Any tool that stands in for the app can drift the same way. Treat these as
harnesses and hold them to the same rule:

| Harness | Production path it must match |
|---|---|
| Admin Test Image | `src/identify/adapter.js` |
| Admin forecast previews | `src/forecast-extras.js` scoring |
| Newsletter review copy | what `weekly-report-send` actually mails |
| Anything run with service_role | what the app sees through RLS |

## Related

- [[duplicated-knowledge]] — why a second copy is a bug waiting its turn.
- [[debug-before-fixing]] — measure before changing; this skill is about
  checking the ruler before trusting the measurement.
