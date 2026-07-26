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

## Owed manual steps (agent can't do these)
Deploy the edge function; run `training-exports-schema.sql` /
`models-published-schema.sql`; run Colab; Import + Promote in the admin.
