# ReelIntel — Fish ID model training

This directory holds the training pipeline for the on-device fish
identification model. It consumes the ZIP exported from the admin
**Training → Export** tab and produces three artifacts you upload
back into the admin at **Training → Models**.

**Do NOT train on Mac Claude / your laptop CPU.** MobileNetV3-Small
fine-tuning on ~2,000 images takes 45+ minutes on a laptop CPU vs.
5–8 minutes on a Colab T4 GPU. Use Colab.

## The three artifacts

Every training run outputs:

| File | What it is | Where it goes |
|---|---|---|
| `fish_id_model.tflite` | INT8-quantized on-device classifier | Bundled into iOS app |
| `fish_id_labels.json` | Label index → speciesId + thresholds + excluded species | Bundled into iOS app |
| `fish_id_metrics.json` | Per-species accuracy + confusion matrix + lookalike-group breakdown | Read by admin evaluation view |

## Path A — Colab (recommended)

1. **Export from admin.** Training → Export → Download ZIP.
2. **Open the notebook in Colab:**
   [`train_fish_id.ipynb`](train_fish_id.ipynb) → click "Open in Colab"
   (or upload the notebook file to colab.research.google.com).
3. **Set the runtime to GPU:** Runtime → Change runtime type → T4 GPU.
4. **Run all cells top to bottom.** The notebook prompts you to
   upload the export ZIP in the first data cell.
5. **Download the artifacts** from Colab's file browser at the end.
   The notebook zips them together for a single download.
6. **Upload to admin:** Training → Models → drag the three files.

Total wall-clock: 5–10 minutes on a T4 including data prep. First
epoch is the slowest (JIT compilation); later epochs run at
30–60 s each.

## Path B — Local CLI

Requires a GPU-equipped machine with recent TensorFlow.

```bash
# TensorFlow 2.16 or newer — anything that gives you a working
# tf.keras.applications.MobileNetV3Small. Colab already ships TF so
# the notebook path doesn't need a pip install of it.
pip install 'tensorflow>=2.16' scikit-learn pillow numpy
python training/train_fish_id.py \
  --export /path/to/reelintel-training-2026-07-10.zip \
  --out    /path/to/artifacts/
```

## What the model actually is

- **Base:** MobileNetV3-Small, ImageNet-pretrained. Feature extractor
  frozen for the first 5 epochs, then unfrozen last 20 layers for
  fine-tuning.
- **Head:** GlobalAveragePooling → Dropout(0.25) → Dense(num_species).
- **Input:** 224 × 224 RGB, normalized to [0, 1].
- **Augmentation:** RandomFlip(horizontal), RandomRotation(±10%),
  RandomZoom(±10%), RandomContrast(±20%), RandomBrightness(±20%).
- **Loss:** Sparse categorical cross-entropy with label smoothing 0.05.
- **Optimizer:** Adam, initial LR 1e-3 → ReduceLROnPlateau on val loss.
- **Epochs:** 20 by default. Early-stops if val loss doesn't improve
  for 5 epochs.
- **Quantization:** Post-training INT8 with a representative dataset
  sampled from val — cuts the .tflite to ~2–4 MB.

## Confidence bands the admin + iOS reads from labels.json

The notebook writes these into `fish_id_labels.json`:

```json
{
  "labels": ["red_snapper", "vermilion_snapper", ...],
  "excluded_species": ["cero_mackerel", "warsaw_grouper", ...],
  "min_confidence": 0.6,   // below → 'low' → manual picker
  "high_confidence": 0.85, // above → 'high' → prefill species
  "input_size": 224
}
```

The runtime confidence bands are per the app spec:
- `< 0.6` → `low` → user picks manually
- `0.6..0.85` → `medium` → user confirms
- `>= 0.85` → `high` → user still confirms via IdentificationConfirmCard

## Reproducibility

`fish_id_metrics.json` records the training seed. Combined with the
export's deterministic split seed, a fresh training run on the same
ZIP should produce nearly identical numbers (small variance from
dropout randomness).

## What NOT to do

- Do not train on your laptop CPU. It works but takes 45+ min.
- Do not skip the val split evaluation — the confusion matrix is
  how you spot lookalike-pair failures before promoting.
- Do not promote a model whose lookalike-group confusion is worse
  than the currently-production version. Ship worse elsewhere first.
