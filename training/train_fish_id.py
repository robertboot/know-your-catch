#!/usr/bin/env python3
"""
ReelIntel — Fish ID model training.

Consumes the ZIP exported from admin Training → Export, fine-tunes a
MobileNetV3-Small classifier, evaluates on the val split, quantizes
to INT8 TFLite, writes three artifacts:
    fish_id_model.tflite      — bundled into iOS
    fish_id_labels.json       — bundled into iOS
    fish_id_metrics.json      — read by the admin evaluation view

The Colab notebook (train_fish_id.ipynb) is a thin wrapper that runs
the same steps cell-by-cell. Prefer the notebook — this CLI exists
for machines with a local GPU.

Usage:
    python train_fish_id.py \\
        --export /path/to/reelintel-training-YYYY-MM-DD.zip \\
        --out    /path/to/artifacts/ \\
        [--epochs 20] [--seed 42]
"""
import argparse
import json
import os
import random
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path


IMG_SIZE = 224
BATCH_SIZE = 32
DEFAULT_EPOCHS = 35          # was 20 — fine-tuning needs longer to converge
FROZEN_EPOCHS = 8            # was 5 — let the head settle before unfreezing
UNFREEZE_LAST_N = 80         # was 20 — adapt more of the backbone to fish
DEFAULT_MIN_IMAGES = 40      # per-class TRAIN floor; below this a species is
                             # excluded (too few photos to learn — it would
                             # only add noise and drag the average down)


def unzip_export(zip_path: Path, work_dir: Path) -> tuple[Path, dict]:
    """Unpack export ZIP → return (data_root, manifest)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(work_dir)
    manifest = json.loads((work_dir / "manifest.json").read_text())
    return work_dir, manifest


def build_datasets(data_root: Path, labels: list[str], seed: int):
    """train_ds, val_ds — image_dataset_from_directory over the
    train/ and val/ subdirs. class_names is pinned to `labels` so
    the head's output index matches manifest species order.

    Augmentation lives in the training data pipeline (via .map)
    rather than as layers inside the model graph. Rationale: TFLite
    INT8 quantization has no kernels for RandomFlip / RandomRotation
    / RandomBrightness etc. If those layers are baked into the model,
    quantization fails silently mid-conversion and the .tflite is
    never written. Applying augmentation as a dataset transform
    trains through the same distribution but leaves the export
    graph clean (input → rescale → mobilenet → head → softmax). """
    import tensorflow as tf
    from tensorflow.keras import layers

    def make(split):
        return tf.keras.utils.image_dataset_from_directory(
            data_root / split,
            labels="inferred",
            label_mode="int",
            class_names=labels,
            color_mode="rgb",
            batch_size=BATCH_SIZE,
            image_size=(IMG_SIZE, IMG_SIZE),
            shuffle=(split == "train"),
            seed=seed,
        )

    train_ds = make("train")
    val_ds   = make("val")

    # Composed augmentation pipeline — kept as separate layers so
    # each keeps its own PRNG state, invoked with training=True on
    # every batch so they actually mutate the pixels.
    augment = tf.keras.Sequential([
        layers.RandomFlip("horizontal"),
        layers.RandomRotation(0.10),
        layers.RandomZoom(0.10),
        layers.RandomContrast(0.20),
        layers.RandomBrightness(0.20),
    ], name="augment")

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.map(
        lambda x, y: (augment(x, training=True), y),
        num_parallel_calls=autotune,
    )
    return train_ds.prefetch(autotune), val_ds.prefetch(autotune)


def build_model(num_classes: int):
    """MobileNetV3-Small backbone + tiny classification head.

    Two-stage training: backbone frozen for FROZEN_EPOCHS, then last
    UNFREEZE_LAST_N layers unfrozen. Augmentation is applied via the
    dataset .map (see build_datasets), NOT via layers inside this
    graph — those don't have INT8 kernels and break quantization."""
    import tensorflow as tf
    from tensorflow.keras import layers, models

    # Float32 input in [0, 255]. Rescaling normalises to [0, 1] for
    # MobileNet. The TFLite converter (see quantize_to_tflite) inserts
    # the uint8→float32 quantize op at the input boundary via
    # inference_input_type = tf.uint8, so the shipped .tflite still
    # accepts uint8 tensors from the app.
    inputs = layers.Input(shape=(IMG_SIZE, IMG_SIZE, 3), dtype="float32")
    x = layers.Rescaling(1.0 / 255.0)(inputs)

    # MobileNetV3-Large (was Small). Small is the tiniest backbone and
    # underpowered for 60+ fine-grained fish classes with many near-
    # identical lookalikes (snappers, groupers, tunas). Large roughly
    # doubles capacity for a small size/latency cost — still an on-device
    # model that runs on the iOS Neural Engine.
    base = tf.keras.applications.MobileNetV3Large(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
        include_preprocessing=False,  # we already rescaled
    )
    base.trainable = False

    x = base(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.25)(x)
    outputs = layers.Dense(num_classes, activation="softmax", name="species")(x)
    model = models.Model(inputs, outputs)
    return model, base


def compute_class_weights(data_root: Path, labels: list[str]):
    """Balanced class weights from the TRAIN split image counts, so rare
    species aren't steamrolled by common ones during .fit(). Without
    this, an imbalanced dataset (some species 500 photos, some 45) biases
    the model toward the majority classes and the minority species score
    near zero — a big driver of the accuracy drop as species were added.

    Returns ({class_index: weight}, [per-class train counts]). Weight is
    the standard sklearn 'balanced' form: total / (n_classes * count)."""
    counts = []
    for l in labels:
        d = data_root / "train" / l
        counts.append(sum(1 for _ in d.iterdir()) if d.is_dir() else 0)
    total = sum(counts)
    n = len(labels)
    weights = {
        i: (total / (n * c)) if c > 0 else 1.0
        for i, c in enumerate(counts)
    }
    return weights, counts


def train(model, base, train_ds, val_ds, epochs: int, class_weight=None):
    """Two-stage fine-tune. Returns the training history for the
    metrics dump. class_weight balances rare vs common species."""
    import tensorflow as tf

    # Stage 1: head only.
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )
    callbacks = [
        tf.keras.callbacks.ReduceLROnPlateau(patience=3, factor=0.5, verbose=1),
        tf.keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True, verbose=1),
    ]
    h1 = model.fit(
        train_ds, validation_data=val_ds,
        epochs=FROZEN_EPOCHS, callbacks=callbacks,
        class_weight=class_weight, verbose=2,
    )

    # Stage 2: unfreeze last N layers of the backbone.
    base.trainable = True
    for layer in base.layers[:-UNFREEZE_LAST_N]:
        layer.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-4),  # lower LR post-unfreeze
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )
    h2 = model.fit(
        train_ds, validation_data=val_ds,
        epochs=max(1, epochs - FROZEN_EPOCHS),
        callbacks=callbacks, class_weight=class_weight, verbose=2,
    )

    history = {
        "stage1_epochs": len(h1.history.get("loss", [])),
        "stage2_epochs": len(h2.history.get("loss", [])),
        "stage2_val_accuracy_final": (
            h2.history.get("val_accuracy", [None])[-1]
        ),
    }
    return history


def evaluate(model, val_ds, labels: list[str]):
    """Per-species accuracy + confusion matrix from the val split."""
    import numpy as np
    from sklearn.metrics import confusion_matrix

    all_y, all_yhat = [], []
    for x, y in val_ds:
        pred = model.predict(x, verbose=0)
        all_y.extend(y.numpy().tolist())
        all_yhat.extend(pred.argmax(axis=1).tolist())

    all_y = np.array(all_y)
    all_yhat = np.array(all_yhat)
    n = len(labels)
    cm = confusion_matrix(all_y, all_yhat, labels=list(range(n)))

    per_species = {}
    for i, label in enumerate(labels):
        support = int(cm[i].sum())
        correct = int(cm[i, i])
        per_species[label] = {
            "support": support,
            "correct": correct,
            "accuracy": correct / support if support else None,
        }

    overall = float((all_y == all_yhat).mean()) if len(all_y) else None

    return {
        "overall_accuracy": overall,
        "per_species": per_species,
        "confusion_matrix": cm.tolist(),
        "confusion_labels": labels,
    }


def evaluate_tflite(tflite_path: Path, val_ds, labels: list[str]):
    """Run the QUANTIZED .tflite over the val split and return its
    accuracy. This is what actually ships to the phone — INT8 post-
    training quantization can cost a few points versus the float Keras
    model, and until now nobody measured it, so the admin's headline
    accuracy overstated real-world performance. Feeds uint8 or float
    inputs to match whatever dtype the converter produced."""
    import numpy as np
    import tensorflow as tf

    interp = tf.lite.Interpreter(model_path=str(tflite_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    in_dtype = inp["dtype"]

    correct = total = 0
    for x, y in val_ds:
        for img, label in zip(x.numpy(), y.numpy()):
            # img is float [0,255]; feed uint8 if the model expects it,
            # else float32 (dynamic-range fallback path).
            sample = np.clip(img, 0, 255)
            sample = sample.astype(np.uint8) if in_dtype == np.uint8 else sample.astype(np.float32)
            interp.set_tensor(inp["index"], np.expand_dims(sample, 0))
            interp.invoke()
            pred = interp.get_tensor(out["index"])[0]
            if int(np.argmax(pred)) == int(label):
                correct += 1
            total += 1
    return (correct / total) if total else None


def compute_lookalike_group_confusion(metrics: dict, groups: list[list[str]]):
    """For each pre-seeded lookalike group, extract the sub-matrix
    of the confusion matrix. This is the pass/fail signal Phase 5
    surfaces at the top of the evaluation view."""
    labels = metrics["confusion_labels"]
    label_idx = {l: i for i, l in enumerate(labels)}
    cm = metrics["confusion_matrix"]
    result = []
    for group in groups:
        idxs = [label_idx[s] for s in group if s in label_idx]
        if len(idxs) < 2:
            continue
        sub = [[cm[i][j] for j in idxs] for i in idxs]
        support = [sum(row) for row in sub]
        correct = [sub[i][i] for i in range(len(idxs))]
        result.append({
            "members": [labels[i] for i in idxs],
            "matrix":  sub,
            "support": support,
            "correct": correct,
            "accuracy": [
                (correct[i] / support[i]) if support[i] else None
                for i in range(len(idxs))
            ],
        })
    return result


# Same seeds as src/training-store.js buildLookalikeGroups seeded groups.
LOOKALIKE_GROUP_SEEDS = [
    ["red_snapper", "vermilion_snapper", "lane_snapper"],
    ["gag_grouper", "black_grouper", "scamp", "yellowmouth_grouper", "red_grouper"],
    ["king_mackerel", "spanish_mackerel", "cero_mackerel", "atlantic_mackerel"],
    ["greater_amberjack", "lesser_amberjack", "almaco_jack", "banded_rudderfish"],
    ["blackfin_tuna", "yellowfin_tuna", "bigeye_tuna", "bluefin_tuna", "albacore_tuna", "little_tunny"],
    ["blue_marlin", "white_marlin", "sailfish"],
    ["summer_flounder", "winter_flounder"],
]


def quantize_to_tflite(model, val_ds, out_path: Path):
    """INT8 post-training quantization with val samples as the
    representative dataset. Slower than dynamic-range but produces a
    ~2-4 MB model that runs on the iOS Neural Engine at near-full
    accuracy."""
    import tensorflow as tf

    def rep_dataset():
        # Model's native input dtype is float32 in [0, 255] (Rescaling
        # inside the graph divides by 255). Yield tensors in that exact
        # range so calibration matches the training-time distribution.
        # The inference_input_type = uint8 below tells the converter to
        # add a uint8 → float32 quantize op AT THE MODEL BOUNDARY,
        # separate from calibration; the two mustn't be conflated.
        n = 0
        for x, _ in val_ds:
            for img in x:
                sample = tf.cast(img, tf.float32)
                # image_dataset_from_directory + Keras 3 already returns
                # tensors in [0, 255]. Clamp defensively so a stray
                # sample outside that range can't spoil quantization
                # stats.
                sample = tf.clip_by_value(sample, 0.0, 255.0)
                yield [tf.expand_dims(sample, 0)]
                n += 1
                if n >= 100:
                    return

    # Try full INT8 first — that's what the iOS Neural Engine wants
    # and what makes the .tflite tiny. If any op in the graph doesn't
    # have an INT8 kernel in the current TF version, fall back to
    # dynamic-range quantization (weights INT8, activations FP32) so
    # the run still produces a shippable model. The dynamic model is
    # ~2× larger but still runs on device.
    def try_convert(strict_int8: bool):
        conv = tf.lite.TFLiteConverter.from_keras_model(model)
        conv.optimizations = [tf.lite.Optimize.DEFAULT]
        if strict_int8:
            conv.representative_dataset = rep_dataset
            conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
            conv.inference_input_type = tf.uint8
            conv.inference_output_type = tf.uint8
        return conv.convert()

    try:
        tflite = try_convert(strict_int8=True)
        print("Quantization: full INT8 succeeded.")
    except Exception as e:
        print(f"Quantization: full INT8 failed ({e.__class__.__name__}: {e})")
        print("Quantization: falling back to dynamic-range quantization.")
        tflite = try_convert(strict_int8=False)
        print("Quantization: dynamic-range succeeded.")
    out_path.write_bytes(tflite)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--export", required=True, help="Path to export ZIP")
    p.add_argument("--out",    required=True, help="Output artifacts directory")
    p.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    p.add_argument("--seed",   type=int, default=42)
    p.add_argument("--min-images", type=int, default=DEFAULT_MIN_IMAGES,
                   help="exclude species with fewer than this many TRAIN images")
    args = p.parse_args()

    random.seed(args.seed)
    import numpy as np
    np.random.seed(args.seed)
    import tensorflow as tf
    tf.keras.utils.set_random_seed(args.seed)

    out_dir  = Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)
    work_dir = out_dir / "_data"
    if work_dir.exists():
        shutil.rmtree(work_dir)
    data_root, manifest = unzip_export(Path(args.export), work_dir)
    labels = list(manifest["species"])
    excluded = list(manifest.get("excluded", []))
    print(f"Manifest: {len(labels)} species, {len(excluded)} excluded, "
          f"{len(manifest['images'])} images", flush=True)

    # Guard: image_dataset_from_directory crashes outright when a
    # class_names entry has no folder in a split (a species with very
    # few photos can land 0 in val/). Drop those labels with a loud
    # warning instead of dying — they join the excluded list so the
    # app knows the model can't recognize them.
    def has_images(split, label):
        d = data_root / split / label
        return d.is_dir() and any(d.iterdir())
    droppable = [l for l in labels if not (has_images("train", l) and has_images("val", l))]
    if droppable:
        print(f"WARNING: dropping {len(droppable)} species with an empty "
              f"train/ or val/ split: {', '.join(droppable)}", flush=True)
        labels = [l for l in labels if l not in droppable]
        excluded = excluded + droppable

    # Minimum-images floor. A species with a handful of TRAIN photos can't
    # be learned — it only adds label noise and drags the average down.
    # Exclude it (the app falls back to the cloud/manual path for it) and
    # report the count so it's obvious which species need more clean
    # photos before they're worth including.
    train_counts = {
        l: (sum(1 for _ in (data_root / "train" / l).iterdir())
            if (data_root / "train" / l).is_dir() else 0)
        for l in labels
    }
    thin = [l for l in labels if train_counts[l] < args.min_images]
    if thin:
        thin_sorted = sorted(thin, key=lambda l: train_counts[l])
        print(f"WARNING: excluding {len(thin)} species under the "
              f"{args.min_images}-image floor: "
              + ", ".join(f"{l}({train_counts[l]})" for l in thin_sorted), flush=True)
        labels = [l for l in labels if l not in thin]
        excluded = excluded + thin
    if len(labels) < 2:
        raise SystemExit("fewer than 2 trainable species after the image-count "
                         "floor — lower --min-images or verify more photos")

    # Per-species train counts for the kept set — the worklist for "which
    # species still need more photos" (lowest counts = weakest classes).
    kept_counts = sorted(((l, train_counts[l]) for l in labels), key=lambda t: t[1])
    print(f"Training {len(labels)} species. Thinnest classes: "
          + ", ".join(f"{l}={c}" for l, c in kept_counts[:10]), flush=True)

    class_weight, _ = compute_class_weights(data_root, labels)

    train_ds, val_ds = build_datasets(data_root, labels, args.seed)
    model, base = build_model(num_classes=len(labels))
    print(model.summary())

    history = train(model, base, train_ds, val_ds, epochs=args.epochs,
                    class_weight=class_weight)

    # Checkpoint the trained Keras model BEFORE quantization. If the
    # TFLite converter later throws, the trained weights are still
    # on disk and can be reloaded to skip retraining. Delete after a
    # successful quantize so it doesn't ride into the artifacts dir.
    keras_ckpt = out_dir / "trained_model.keras"
    print(f"Checkpointing trained model → {keras_ckpt}")
    model.save(keras_ckpt)

    print("Evaluating on val split…")
    metrics = evaluate(model, val_ds, labels)
    metrics["lookalike_group_confusion"] = compute_lookalike_group_confusion(
        metrics, LOOKALIKE_GROUP_SEEDS,
    )
    metrics["training"] = history
    metrics["input_size"] = IMG_SIZE
    metrics["seed"] = args.seed
    metrics["created_at"] = datetime.now(timezone.utc).isoformat()

    tflite_path = out_dir / "fish_id_model.tflite"
    print(f"Quantizing to INT8 → {tflite_path}")
    quantize_to_tflite(model, val_ds, tflite_path)

    # Measure the QUANTIZED model — this is what ships to the phone, and
    # it can differ from the float number above. Surface both so the
    # admin's headline reflects real on-device accuracy, not the float
    # model's. Also record kept per-species train counts for the worklist.
    print("Evaluating the quantized .tflite (shipped model)…")
    metrics["quantized_accuracy"] = evaluate_tflite(tflite_path, val_ds, labels)
    metrics["float_accuracy"] = metrics["overall_accuracy"]
    metrics["train_counts"] = {l: train_counts[l] for l in labels}
    metrics["min_images"] = args.min_images

    # Quantize succeeded — the .keras checkpoint has served its
    # purpose. Drop it so the artifacts dir stays lean.
    if keras_ckpt.exists():
        keras_ckpt.unlink()

    (out_dir / "fish_id_labels.json").write_text(json.dumps({
        "labels": labels,
        "excluded_species": excluded,
        "min_confidence":  0.6,
        "high_confidence": 0.85,
        "input_size":      IMG_SIZE,
    }, indent=2))
    (out_dir / "fish_id_metrics.json").write_text(json.dumps(metrics, indent=2))

    print(f"\nArtifacts written to {out_dir}:")
    print(f"  fish_id_model.tflite    ({tflite_path.stat().st_size / 1024:.0f} KB)")
    print(f"  fish_id_labels.json")
    print(f"  fish_id_metrics.json")
    qa = metrics.get("quantized_accuracy")
    print(f"\nFloat val accuracy:     {metrics['overall_accuracy']:.3f}")
    print(f"Quantized (shipped):    {qa:.3f}" if qa is not None else
          "Quantized (shipped):    n/a")


if __name__ == "__main__":
    main()
