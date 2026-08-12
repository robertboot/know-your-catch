---
name: model-pipeline
description: Train, import, and ship a new "Big Red" fish-ID model (dataset → Colab → import → promote). Use for anything touching training/, the admin Training tab, model export/import, quantization, or on-device inference.
---

# Fish-ID model pipeline ("Big Red")

Full reference: `training/TRAINING.md`. This skill is the operator's map + the
non-obvious gotchas. The 5-step loop reaches every phone on next app launch —
no App Store review, no rebuild.

## The loop
1. **Grow the dataset** — `training/fetch_inat_photos.py` (or the bash snippet in
   TRAINING.md) scrapes iNaturalist by `SPECIES_NAME` + `SCIENTIFIC`, `LIMIT≈500`.
   Photos drop into the admin Training folders.
2. **Export** — admin **Training → Export**. It uploads a small **`manifest.json`**
   (storage paths + long-lived signed URLs) to the `training-exports` bucket —
   NOT a giant client-side ZIP. (`supabase/training-exports-schema.sql`,
   `src/training-exports-store.js`.)
3. **Train (Colab)** — paste one cell that runs `training/colab_run.py`. It
   downloads the manifest, pulls every photo in parallel into `train/val/{species}`,
   fetches `train_fish_id.py` from GitHub, trains, then PUTs the bundle back.
4. **Import** — admin **Training → Models → Import**; the name you type is what
   users see (**Big Red N.M**).
5. **Promote** — admin **Models → Promote** → publishes to the public
   `models-published` bucket (`src/model-store.js` publish-on-promote);
   `src/model-loader.js` loads it on app boot.

Naming: **Big Red N.M** — N bumps for a new taxonomic family, M for a retrain of
existing species with more data.

## Gotchas (these bit us)
- **`colab_run.py` pins `BRANCH`** for the `train_fish_id.py` raw URL. If you work
  on a different branch, update that constant or Colab trains stale code.
- **Trainer**: MobileNetV3-**Large**, `IMG_SIZE=224`, 35 epochs (8 frozen then
  fine-tune), **class weights** (rare vs common), per-class floor
  `DEFAULT_MIN_IMAGES=45` on total train+val.
- **Quantization is float16** (NOT full-INT8 — INT8 collapsed accuracy). The
  trainer writes `input_dtype` into `labels.json`, and `evaluate_tflite` reports
  the *quantized* accuracy, not just the float model's.
- **Inference input dtype must match**: `src/identify/adapter.js` +
  `TestImagePanel` build a **float32** input tensor for float16 models (int32 for
  legacy). `src/model-store.js` manifest carries `input_dtype`. Mismatch = garbage
  predictions.
- Colab upload auth: prefer the **mint-ticket** path (`REELINTEL_MINT_URL` /
  `REELINTEL_MINT_TICKET`, 7-day) which mints a fresh signed upload URL in-run;
  falls back to a pre-minted `REELINTEL_BUNDLE_UPLOAD` + `_TOKEN`. Edge function
  `mint-model-upload-url` must be deployed `--no-verify-jwt` with
  `MODEL_UPLOAD_SECRET` set.

## Preprocessing must match the app EXACTLY

The single highest-leverage thing in this pipeline, and it was wrong
until 2026-08-12. Training used
`image_dataset_from_directory(image_size=(224,224))`, which **squashes**
a 4:3 photo into a square. The app **letterboxes** — `imageToRgb()` in
`src/identify/adapter.js` scales by `min(size/w, size/h)` and pads with
`#808080`.

So the model trained on stretched fish and was served correctly-
proportioned ones. **Body proportions are the most discriminative
feature this model has** — barracuda vs king mackerel is a proportions
call, and that miss was reported from the field.

The trainer now loads at native resolution and letterboxes via
`resize_with_pad`, shifted `-128`/`+128` so padding lands on exactly the
same grey the app uses. `PAD_VALUE = 128.0` in `train_fish_id.py` is the
counterpart of `#808080` in `adapter.js`.

**This is duplicated knowledge across two languages with nothing
asserting it holds** (see [[duplicated-knowledge]]). Any change to
either side — input size, pad colour, aspect handling, rescaling — must
change both. There is no parity check for it; there should be.

Other trainer facts worth keeping straight:
- `RandomRotation` factor is a fraction of a **full turn**. `0.10` is
  ±36°, not ±10% of anything sane. It is now `0.028` (±10°).
- `label_smoothing=0.05` on `CategoricalCrossentropy`. Without it the
  head returns 0.75–0.86 on species it has **wrong**, and
  `identifyPhoto.js` shows those numbers to the angler. Expect top-1 to
  read slightly *lower* than an unsmoothed run — that is the point, not
  a regression.
- Label smoothing needs one-hot targets, and Keras `class_weight=` only
  accepts integer labels. The two cannot be combined; class weights are
  folded into the **training split only** as per-sample weights. Val
  stays unweighted so the metric callbacks stop on stays honest.
- Build **fresh callbacks per stage**. One shared list across both
  `fit()` calls carries stage-1 patience and best-weights into stage 2,
  which can restore frozen-backbone weights over a fine-tuned run.

## Colab runs what is PUSHED, not what is local

`colab_run.py` fetches `train_fish_id.py` from
`raw.githubusercontent.com` on the pinned `BRANCH`. Editing the trainer
locally changes nothing until it is committed **and pushed**. Verify
before telling Robert to start a run:

    curl -sS "https://raw.githubusercontent.com/robertboot/know-your-catch/<BRANCH>/training/train_fish_id.py" | grep -c "<something from the change>"

## Owed manual steps (agent can't do these)
Deploy the edge function; run `training-exports-schema.sql` /
`models-published-schema.sql`; run Colab; Import + Promote in the admin.
