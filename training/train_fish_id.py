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
# Padding value used when letterboxing to a square. MUST match the app's
# imageToRgb() in src/identify/adapter.js, which fills the canvas with
# #808080 before drawing. Grey rather than black because black padding
# reads to the model as a large dark object.
PAD_VALUE = 128.0
BATCH_SIZE = 32
DEFAULT_EPOCHS = 35          # was 20 — fine-tuning needs longer to converge
FROZEN_EPOCHS = 8            # was 5 — let the head settle before unfreezing
UNFREEZE_LAST_N = 80         # was 20 — adapt more of the backbone to fish
DEFAULT_MIN_IMAGES = 45      # per-class floor on TOTAL images (train+val).
                             # Matches the admin coverage count (verified
                             # images), so "45" means the same thing in both
                             # places. Below it a species is excluded — too
                             # few photos to learn, only adds noise.


def unzip_export(zip_path: Path, work_dir: Path) -> tuple[Path, dict]:
    """Unpack export ZIP → return (data_root, manifest)."""
    work_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(work_dir)
    manifest = json.loads((work_dir / "manifest.json").read_text())
    return work_dir, manifest


def _decode_upright(path_bytes):
    """Decode a JPEG/PNG applying its EXIF Orientation tag, returning
    uint8 HWC RGB.

    Shared by the training pipeline and tests/test_exif_parity.py, so
    the property being asserted is the one actually used.
    """
    import numpy as np
    from PIL import Image, ImageOps

    p = path_bytes.decode("utf-8") if isinstance(path_bytes, bytes) else str(path_bytes)
    with Image.open(p) as im:
        im = ImageOps.exif_transpose(im)      # the whole point
        if im.mode != "RGB":
            im = im.convert("RGB")
        return np.asarray(im, dtype=np.uint8)


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

    # LETTERBOX, don't squash.
    #
    # image_dataset_from_directory(image_size=...) does a plain resize,
    # which stretches a 4:3 photo into a square and distorts body
    # proportions. The APP does not do that — imageToRgb() in
    # src/identify/adapter.js scales by min(size/w, size/h) and pads the
    # remainder with #808080. So training on squashed fish and then
    # serving letterboxed fish was a train/serve skew, and it distorted
    # the single most discriminative feature the model has: body shape.
    # Barracuda vs king mackerel is a proportions call.
    #
    # Load at native resolution, then letterbox here.
    # resize_with_pad pads with ZEROS, so shift by -PAD_VALUE before and
    # +PAD_VALUE after: the padding lands on exactly the grey the app
    # uses, and real pixels are unchanged.
    def letterbox(x):
        x = tf.cast(x, tf.float32) - PAD_VALUE
        x = tf.image.resize_with_pad(x, IMG_SIZE, IMG_SIZE, method="bilinear")
        return x + PAD_VALUE

    # image_dataset_from_directory REQUIRES image_size and always resizes
    # to it, so it cannot hand us native-resolution images to letterbox.
    # (image_size=None raises "Expected a tuple of 2 integers".) Build the
    # file list ourselves instead — this also keeps the label index pinned
    # to `labels` order, which is what class_names= was doing.
    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

    def file_list(split):
        paths, targets = [], []
        for idx, name in enumerate(labels):
            d = data_root / split / name
            if not d.is_dir():
                continue
            for p in sorted(d.iterdir()):
                if p.suffix.lower() in IMAGE_EXTS:
                    paths.append(str(p))
                    targets.append(idx)
        return paths, targets

    def make(split):
        paths, targets = file_list(split)
        if not paths:
            raise SystemExit(f"no images found under {data_root / split}")
        print(f"  {split}: {len(paths)} images across {len(labels)} species", flush=True)

        ds = tf.data.Dataset.from_tensor_slices((paths, targets))
        if split == "train":
            ds = ds.shuffle(len(paths), seed=seed, reshuffle_each_iteration=True)

        def load(path, y):
            # EXIF orientation is applied HERE, not by decode_image.
            #
            # tf.io.decode_image ignores the EXIF Orientation tag; a
            # browser <img> (which is what the app decodes with) applies
            # it. An iPhone photo tagged Orientation=6 therefore trained
            # on its side and served upright — a train/serve skew on the
            # single most discriminative feature the model has, body
            # shape, and invisible in every metric because train and val
            # were skewed identically.
            #
            # Pillow's exif_transpose is the reference implementation of
            # the tag, so decoding through it means both pipelines see
            # the same physical pixels. numpy_function because this is
            # not expressible in graph ops.
            img = tf.numpy_function(_decode_upright, [path], tf.uint8,
                                    name="decode_exif_upright")
            img.set_shape([None, None, 3])
            img = letterbox(img)
            # decode_image returns an unknown static shape; the model's
            # Input layer needs a concrete one.
            img.set_shape([IMG_SIZE, IMG_SIZE, 3])
            return img, y

        return (ds.map(load, num_parallel_calls=tf.data.AUTOTUNE)
                  .batch(BATCH_SIZE))

    train_ds = make("train")
    val_ds   = make("val")
    # TEST is optional so an old export without a test/ dir still runs.
    # When present it is returned UNAUGMENTED and is never handed to
    # fit(), so it cannot leak into early stopping or LR scheduling.
    test_ds = None
    try:
        test_ds = make("test").prefetch(tf.data.AUTOTUNE)
    except SystemExit:
        print("  test: no test/ split in this export — test metrics will be null",
              flush=True)

    # Composed augmentation pipeline — kept as separate layers so
    # each keeps its own PRNG state, invoked with training=True on
    # every batch so they actually mutate the pixels.
    augment = tf.keras.Sequential([
        layers.RandomFlip("horizontal"),
        # 0.028, not 0.10. Keras expresses the factor as a fraction of a
        # FULL TURN, so 0.10 meant +/-36 degrees — a tilt no angler's
        # photo ever has. That spends model capacity learning poses that
        # never occur at inference. +/-10 degrees covers real handheld
        # variation.
        layers.RandomRotation(0.028, fill_mode="constant", fill_value=PAD_VALUE),
        layers.RandomZoom(0.10, fill_mode="constant", fill_value=PAD_VALUE),
        layers.RandomContrast(0.20),
        layers.RandomBrightness(0.20, value_range=(0.0, 255.0)),
    ], name="augment")

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.map(
        lambda x, y: (augment(x, training=True), y),
        num_parallel_calls=autotune,
    )
    return train_ds.prefetch(autotune), val_ds.prefetch(autotune), test_ds


def build_model(num_classes: int):
    """MobileNetV3-Small backbone + tiny classification head.

    Two-stage training: backbone frozen for FROZEN_EPOCHS, then last
    UNFREEZE_LAST_N layers unfrozen. Augmentation is applied via the
    dataset .map (see build_datasets), NOT via layers inside this
    graph — those don't have INT8 kernels and break quantization."""
    import tensorflow as tf
    from tensorflow.keras import layers, models

    # Float32 input in [0, 255]. Rescaling normalises to [0, 1] for
    # MobileNet. The shipped .tflite is float16-weighted (see
    # quantize_to_tflite) and keeps this float32 [0, 255] input boundary —
    # the app feeds a float32 tensor and the graph rescales internally.
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


def train(model, base, train_ds, val_ds, epochs: int, class_weight=None,
          ckpt_dir: Path = None):
    """Two-stage fine-tune. Returns the training history for the
    metrics dump. class_weight balances rare vs common species."""
    import tensorflow as tf

    # Label smoothing calibrates confidence.
    #
    # Without it this model returns 0.75 and 0.86 on species it has
    # WRONG — measured, repeatedly. identifyPhoto.js bands those numbers
    # into high/medium/low and shows the angler a percentage, so an
    # overconfident head doesn't just look bad, it defeats the
    # thresholds. Smoothing costs a little raw top-1 and buys
    # probabilities that mean what they say.
    #
    # SparseCategoricalCrossentropy has no label_smoothing argument, so
    # labels are one-hot encoded in the dataset and the categorical loss
    # is used instead.
    LABEL_SMOOTHING = 0.05
    num_classes = model.output_shape[-1]

    # class_weight= on fit() expects INTEGER labels, so it cannot be
    # combined with the one-hot targets label smoothing needs. Fold the
    # weights into the dataset as per-sample weights instead — same
    # effect, and it survives the switch. Dropping this silently would
    # have un-balanced every rare species in the set.
    weight_lookup = None
    if class_weight:
        table = tf.constant([float(class_weight.get(i, 1.0)) for i in range(num_classes)],
                            dtype=tf.float32)
        weight_lookup = lambda y: tf.gather(table, tf.cast(y, tf.int32))

    def prepare(ds, weighted):
        def fn(x, y):
            oh = tf.one_hot(tf.cast(y, tf.int32), num_classes)
            if weighted and weight_lookup is not None:
                return x, oh, weight_lookup(y)
            return x, oh
        return ds.map(fn, num_parallel_calls=tf.data.AUTOTUNE)

    # Weight the training set only. Weighting val would distort the
    # metric the callbacks stop on.
    train_ds = prepare(train_ds, weighted=True)
    val_ds   = prepare(val_ds,   weighted=False)
    loss = tf.keras.losses.CategoricalCrossentropy(label_smoothing=LABEL_SMOOTHING)

    # Fresh callbacks PER STAGE. Reusing one list across both fit()
    # calls carried stage-1 state into stage 2: EarlyStopping's patience
    # counter and best-weights snapshot came from the frozen-backbone
    # run, so stage 2 could restore stage-1 weights or stop early
    # against a baseline that no longer applied. Monitor val_accuracy
    # rather than the default val_loss — with label smoothing the loss
    # floor shifts, and accuracy is what we actually care about.
    # Per-epoch learning rate, which Keras does not put in history.
    class LRLogger(tf.keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            lr = self.model.optimizer.learning_rate
            try:
                lr = float(tf.keras.backend.get_value(lr))
            except Exception:
                lr = float(lr) if isinstance(lr, (int, float)) else None
            if logs is not None and lr is not None:
                logs["lr"] = lr

    def make_callbacks(stage):
        cbs = [
            LRLogger(),
            tf.keras.callbacks.ReduceLROnPlateau(
                monitor="val_accuracy", mode="max",
                patience=3, factor=0.5, verbose=1),
            tf.keras.callbacks.EarlyStopping(
                monitor="val_accuracy", mode="max",
                patience=5, restore_best_weights=True, verbose=1),
        ]
        # Persistent checkpoints — a Colab disconnect used to destroy the
        # whole run, because the only save happened AFTER training and
        # the runtime disk is wiped the instant the session drops.
        if ckpt_dir is not None:
            cbs.append(tf.keras.callbacks.ModelCheckpoint(
                filepath=str(ckpt_dir / f"best_stage{stage}.keras"),
                monitor="val_accuracy", mode="max",
                save_best_only=True, verbose=1))
            cbs.append(tf.keras.callbacks.ModelCheckpoint(
                filepath=str(ckpt_dir / "latest.keras"),
                save_best_only=False, verbose=0))
            cbs.append(tf.keras.callbacks.CSVLogger(
                str(ckpt_dir / f"history_stage{stage}.csv"), append=True))
        return cbs

    # Stage 1: head only.
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss=loss,
        metrics=["accuracy"],
    )
    h1 = model.fit(
        train_ds, validation_data=val_ds,
        epochs=FROZEN_EPOCHS, callbacks=make_callbacks(1), verbose=2,
    )

    # Stage 2: unfreeze last N layers of the backbone.
    base.trainable = True
    for layer in base.layers[:-UNFREEZE_LAST_N]:
        layer.trainable = False
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-4),  # lower LR post-unfreeze
        loss=loss,
        metrics=["accuracy"],
    )
    h2 = model.fit(
        train_ds, validation_data=val_ds,
        epochs=max(1, epochs - FROZEN_EPOCHS),
        callbacks=make_callbacks(2), verbose=2,
    )

    # FULL per-epoch curves, not just the final number. Without these
    # there is no way to tell overfitting from underfitting after the
    # fact, and every past run threw them away.
    def curves(h):
        keys = ("loss", "val_loss", "accuracy", "val_accuracy", "lr")
        return {k: [float(v) for v in h.history.get(k, [])] for k in keys}

    c1, c2 = curves(h1), curves(h2)
    va = c1["val_accuracy"] + c2["val_accuracy"]
    best_idx = int(max(range(len(va)), key=lambda i: va[i])) if va else None

    history = {
        "stage1_epochs": len(h1.history.get("loss", [])),
        "stage2_epochs": len(h2.history.get("loss", [])),
        "stage2_val_accuracy_final": (
            h2.history.get("val_accuracy", [None])[-1]
        ),
        "total_epochs": len(va),
        # Index into the CONCATENATED curve, so it is comparable across
        # the stage boundary.
        "best_epoch": best_idx,
        "best_val_accuracy": (va[best_idx] if best_idx is not None else None),
        "stage1": c1,
        "stage2": c2,
    }
    return history


def _metrics_from_counts(y_true, y_pred, probs, labels):
    """Full metric block from raw predictions. Shared by the float and
    quantized evaluators so the two can never drift apart."""
    import numpy as np
    from sklearn.metrics import confusion_matrix

    n = len(labels)
    y_true = np.asarray(y_true); y_pred = np.asarray(y_pred)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(n)))

    tp = np.diag(cm).astype(float)
    support = cm.sum(axis=1).astype(float)      # true instances per class
    predicted = cm.sum(axis=0).astype(float)    # predicted instances per class

    with np.errstate(divide="ignore", invalid="ignore"):
        precision = np.where(predicted > 0, tp / predicted, np.nan)
        recall    = np.where(support   > 0, tp / support,   np.nan)
        f1 = np.where((precision + recall) > 0,
                      2 * precision * recall / (precision + recall), np.nan)

    # Macro averages over classes that actually APPEAR in this split.
    # Averaging in zeros for absent classes would report a number that
    # says more about the split than the model.
    present = support > 0
    def macro(a):
        vals = a[present]
        vals = vals[~np.isnan(vals)]
        return float(vals.mean()) if vals.size else None

    per_species = {}
    for i, label in enumerate(labels):
        per_species[label] = {
            "support":   int(support[i]),
            "correct":   int(tp[i]),
            "accuracy":  (float(tp[i] / support[i]) if support[i] else None),
            "precision": (None if np.isnan(precision[i]) else float(precision[i])),
            "recall":    (None if np.isnan(recall[i])    else float(recall[i])),
            "f1":        (None if np.isnan(f1[i])        else float(f1[i])),
        }

    top1 = float((y_true == y_pred).mean()) if len(y_true) else None

    # Top-3: needs the probability matrix, which the quantized path also
    # supplies. None when unavailable rather than silently 0.
    top3 = None
    if probs is not None and len(probs):
        P = np.asarray(probs)
        k = min(3, P.shape[1])
        topk = np.argpartition(-P, k - 1, axis=1)[:, :k]
        top3 = float(np.mean([y_true[i] in topk[i] for i in range(len(y_true))]))

    return {
        "top1_accuracy": top1,
        "top3_accuracy": top3,
        "balanced_accuracy": macro(recall),   # macro-recall, by definition
        "macro_precision": macro(precision),
        "macro_recall":    macro(recall),
        "macro_f1":        macro(f1),
        "per_species":     per_species,
        "confusion_matrix": cm.tolist(),
        "confusion_labels": labels,
        "n_samples": int(len(y_true)),
        "n_classes_present": int(present.sum()),
    }


def evaluate(model, ds, labels: list[str]):
    """Full metric block for the FLOAT Keras model over one split."""
    import numpy as np

    all_y, all_pred, all_prob = [], [], []
    for x, y in ds:
        p = model.predict(x, verbose=0)
        all_y.extend(y.numpy().tolist())
        all_pred.extend(p.argmax(axis=1).tolist())
        all_prob.append(p)

    probs = np.concatenate(all_prob, axis=0) if all_prob else None
    m = _metrics_from_counts(all_y, all_pred, probs, labels)
    # Back-compat key — the admin evaluation view reads overall_accuracy.
    m["overall_accuracy"] = m["top1_accuracy"]
    return m


def evaluate_tflite(tflite_path: Path, ds, labels: list[str]):
    """Run the QUANTIZED .tflite over a split and return the SAME full
    metric block as evaluate(). This is what actually ships to the
    phone; float16 stays within a hair of the float model but that is a
    claim worth re-measuring every run rather than assuming.

    Returns a dict (was: a bare float). Callers wanting the old scalar
    should read ["top1_accuracy"].
    """
    import numpy as np
    import tensorflow as tf

    interp = tf.lite.Interpreter(model_path=str(tflite_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    in_dtype = inp["dtype"]

    all_y, all_pred, all_prob = [], [], []
    for x, y in ds:
        for img, label in zip(x.numpy(), y.numpy()):
            sample = np.clip(img, 0, 255)
            sample = sample.astype(np.uint8) if in_dtype == np.uint8 else sample.astype(np.float32)
            interp.set_tensor(inp["index"], np.expand_dims(sample, 0))
            interp.invoke()
            pred = interp.get_tensor(out["index"])[0]
            all_y.append(int(label))
            all_pred.append(int(np.argmax(pred)))
            all_prob.append(pred)

    if not all_y:
        return None
    return _metrics_from_counts(all_y, all_pred, np.asarray(all_prob), labels)


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


def quantize_to_tflite(model, out_path: Path):
    """FLOAT16 weight quantization. Full INT8 PTQ was catastrophic for
    this MobileNetV3 model — its hard-swish activations lose too much
    precision under INT8, so the shipped model scored ~23% while the
    float model scored ~82%. (Nobody measured the quantized number
    before, which is why the on-device model always "underperformed".)

    Float16 keeps accuracy within a hair of the float model, still loads
    in the tflite WASM runtime the app uses, and roughly halves the
    float32 size. Input and output stay FLOAT32 — the app feeds a
    float32 [0,255] tensor and the model's Rescaling layer normalises
    inside the graph. Returns the input dtype string for the labels file.

    Falls back to a plain (lossless) float32 model if float16 conversion
    isn't available in the current TF build."""
    import tensorflow as tf

    def convert(kind: str):
        conv = tf.lite.TFLiteConverter.from_keras_model(model)
        if kind == "float16":
            conv.optimizations = [tf.lite.Optimize.DEFAULT]
            conv.target_spec.supported_types = [tf.float16]
        # kind == "float32": no optimizations → plain lossless float model
        return conv.convert()

    try:
        tflite = convert("float16")
        print("Quantization: float16 succeeded.")
    except Exception as e:
        print(f"Quantization: float16 failed ({e.__class__.__name__}: {e})")
        print("Quantization: falling back to plain float32 (larger, lossless).")
        tflite = convert("float32")
        print("Quantization: float32 succeeded.")
    out_path.write_bytes(tflite)
    return "float32"  # both float16- and float32-weighted models take float32 input


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
    def split_count(split, l):
        d = data_root / split / l
        return sum(1 for _ in d.iterdir()) if d.is_dir() else 0
    train_counts = {l: split_count("train", l) for l in labels}
    total_counts = {l: train_counts[l] + split_count("val", l) for l in labels}
    thin = [l for l in labels if total_counts[l] < args.min_images]
    if thin:
        thin_sorted = sorted(thin, key=lambda l: total_counts[l])
        print(f"WARNING: excluding {len(thin)} species under the "
              f"{args.min_images}-image floor: "
              + ", ".join(f"{l}({total_counts[l]})" for l in thin_sorted), flush=True)
        labels = [l for l in labels if l not in thin]
        excluded = excluded + thin
    if len(labels) < 2:
        raise SystemExit("fewer than 2 trainable species after the image-count "
                         "floor — lower --min-images or verify more photos")

    # Per-species image counts for the kept set — the worklist for "which
    # species still need more photos" (lowest counts = weakest classes).
    kept_counts = sorted(((l, total_counts[l]) for l in labels), key=lambda t: t[1])
    print(f"Training {len(labels)} species. Thinnest classes: "
          + ", ".join(f"{l}={c}" for l, c in kept_counts[:10]), flush=True)

    class_weight, _ = compute_class_weights(data_root, labels)

    train_ds, val_ds, test_ds = build_datasets(data_root, labels, args.seed)
    model, base = build_model(num_classes=len(labels))
    print(model.summary())

    # Parameter counts — previously only printed to stdout and lost.
    params = {
        "total": int(model.count_params()),
        "trainable_at_build": int(sum(
            __import__("numpy").prod(w.shape) for w in model.trainable_weights)),
    }

    ckpt_dir = out_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    history = train(model, base, train_ds, val_ds, epochs=args.epochs,
                    class_weight=class_weight, ckpt_dir=ckpt_dir)

    # Checkpoint the trained Keras model BEFORE quantization. If the
    # TFLite converter later throws, the trained weights are still
    # on disk and can be reloaded to skip retraining. Delete after a
    # successful quantize so it doesn't ride into the artifacts dir.
    keras_ckpt = out_dir / "trained_model.keras"
    print(f"Checkpointing trained model → {keras_ckpt}")
    model.save(keras_ckpt)

    print("Evaluating FLOAT model on val split…")
    metrics = evaluate(model, val_ds, labels)
    metrics["lookalike_group_confusion"] = compute_lookalike_group_confusion(
        metrics, LOOKALIKE_GROUP_SEEDS,
    )
    metrics["history"] = history
    metrics["training"] = history
    metrics["input_size"] = IMG_SIZE
    metrics["seed"] = args.seed
    metrics["created_at"] = datetime.now(timezone.utc).isoformat()

    tflite_path = out_dir / "fish_id_model.tflite"
    print(f"Quantizing (float16) → {tflite_path}")
    input_dtype = quantize_to_tflite(model, tflite_path)

    # Measure the QUANTIZED model — this is what ships to the phone, and
    # it can differ from the float number above. Surface both so the
    # admin's headline reflects real on-device accuracy, not the float
    # model's. Also record kept per-species train counts for the worklist.
    print("Evaluating the quantized .tflite on val…")
    q_val = evaluate_tflite(tflite_path, val_ds, labels)

    # ---- TEST SET: the only numbers that were never optimised against.
    # Computed LAST, once, after every decision (early stopping, LR
    # schedule, model selection, quantization) has already been made.
    test_float = test_quant = None
    if test_ds is not None:
        print("Evaluating FLOAT model on HELD-OUT TEST split…")
        test_float = evaluate(model, test_ds, labels)
        print("Evaluating quantized .tflite on HELD-OUT TEST split…")
        test_quant = evaluate_tflite(tflite_path, test_ds, labels)
    else:
        print("No test split present — test metrics will be null. Re-export "
              "with an observation-aware 80/10/10 split to populate them.")

    metrics["validation"] = {"float": {k: v for k, v in metrics.items()
                                       if k not in ("validation",)},
                             "quantized": q_val}
    metrics["test"] = {"float": test_float, "quantized": test_quant}
    # Back-compat scalars the admin view already reads.
    metrics["quantized_accuracy"] = (q_val or {}).get("top1_accuracy")
    metrics["float_accuracy"] = metrics["overall_accuracy"]
    metrics["test_accuracy"] = (test_float or {}).get("top1_accuracy")
    metrics["test_quantized_accuracy"] = (test_quant or {}).get("top1_accuracy")
    metrics["params"] = params
    metrics["train_counts"] = {l: train_counts[l] for l in labels}
    metrics["min_images"] = args.min_images
    metrics["split_manifest"] = manifest.get("split_manifest_version")

    # The .keras checkpoint is KEPT. It used to be deleted here "so the
    # artifacts dir stays lean", which meant a successful run left no
    # way to re-quantize, re-evaluate, or resume without retraining from
    # scratch — and Colab wipes its disk on disconnect. Disk is cheap;
    # a lost 40-minute GPU run is not.

    (out_dir / "fish_id_labels.json").write_text(json.dumps({
        "labels": labels,
        "excluded_species": excluded,
        "min_confidence":  0.6,
        "high_confidence": 0.85,
        "input_size":      IMG_SIZE,
        # The app feeds the model this input dtype. float16/float32 models
        # take a float32 [0,255] tensor; older INT8 models took uint8.
        "input_dtype":     input_dtype,
    }, indent=2))
    (out_dir / "fish_id_metrics.json").write_text(json.dumps(metrics, indent=2))

    # Per-epoch curves also written standalone so they survive even if
    # metrics.json is regenerated.
    (out_dir / "fish_id_history.json").write_text(json.dumps(history, indent=2))

    print(f"\nArtifacts written to {out_dir}:")
    print(f"  fish_id_model.tflite    ({tflite_path.stat().st_size / 1024:.0f} KB)")
    print(f"  fish_id_labels.json")
    print(f"  fish_id_metrics.json")
    def fmt(v):
        return f"{v:.4f}" if isinstance(v, float) else "n/a"
    print(f"\n  VALIDATION  float top1 {fmt(metrics.get('float_accuracy'))}  "
          f"quantized top1 {fmt(metrics.get('quantized_accuracy'))}")
    if test_float:
        print(f"  TEST        float top1 {fmt(test_float.get('top1_accuracy'))}  "
              f"top3 {fmt(test_float.get('top3_accuracy'))}  "
              f"macroF1 {fmt(test_float.get('macro_f1'))}  "
              f"balanced {fmt(test_float.get('balanced_accuracy'))}")
        print(f"  TEST (tflite) top1 {fmt((test_quant or {}).get('top1_accuracy'))}")
    else:
        print("  TEST        n/a — export has no test split")


if __name__ == "__main__":
    main()
