"""One-cell Colab runner for training.

Usage — paste this into a single Colab cell:

    !curl -fsSL https://raw.githubusercontent.com/robertboot/know-your-catch/claude/upload-app-assets-NUxRr/training/colab_run.py -o /content/colab_run.py
    %run /content/colab_run.py

That single %run replaces cells 2 + 3. It handles the export-zip
discovery, the shell-quoting, and invocation of train_fish_id.py.
Cell 4 (pack + download artifacts) is still a separate cell.
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import urlretrieve

BRANCH = "claude/upload-app-assets-NUxRr"
SCRIPT_URL = (
    "https://raw.githubusercontent.com/robertboot/know-your-catch/"
    f"{BRANCH}/training/train_fish_id.py"
)
SCRIPT_PATH = "/content/train_fish_id.py"
CONTENT_DIR = Path("/content")
OUT_DIR = Path("/content/artifacts")


def die(msg):
    print(f"[colab_run] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


# 1. Fetch the latest training script from the working branch.
print(f"[colab_run] Fetching train_fish_id.py from {BRANCH}…")
try:
    urlretrieve(SCRIPT_URL, SCRIPT_PATH)
    size = os.path.getsize(SCRIPT_PATH)
    print(f"[colab_run] Got {size} bytes → {SCRIPT_PATH}")
except Exception as e:
    die(f"could not fetch train_fish_id.py: {e}")


# 2. Find the export ZIP — newest one wins if there are duplicates
#    (Colab's `(1)` / `(2)` re-download suffixes).
zips = sorted(CONTENT_DIR.glob("reelintel-training-*.zip"))
if not zips:
    die(
        "no reelintel-training-*.zip found in /content/. "
        "Re-run the upload cell first."
    )
export_zip = zips[-1]
print(f"[colab_run] Using export ZIP: {export_zip.name} "
      f"({export_zip.stat().st_size / 1024 / 1024:.1f} MB)")


# 3. Install deps that aren't in Colab's default image.
print("[colab_run] Installing scikit-learn + pillow…")
subprocess.run(
    [sys.executable, "-m", "pip", "install", "--quiet", "scikit-learn", "pillow"],
    check=True,
)


# 4. Make sure the output dir exists.
OUT_DIR.mkdir(parents=True, exist_ok=True)


# 5. Print TF version + GPU so runtime issues surface here, not
#    30 seconds into training.
import tensorflow as tf
print(f"[colab_run] TensorFlow {tf.__version__}")
gpus = tf.config.list_physical_devices("GPU")
print(f"[colab_run] GPUs: {gpus}")
if not gpus:
    print("[colab_run] WARNING: no GPU detected. Runtime → Change runtime "
          "type → T4 GPU, then re-run this cell.")


# 6. Run the training script as a subprocess. subprocess.run handles
#    the argv list directly — no shell involved, so filenames with
#    parens / spaces / anything else are safe by construction.
cmd = [
    sys.executable, SCRIPT_PATH,
    "--export", str(export_zip),
    "--out",    str(OUT_DIR),
    "--epochs", "20",
]
print(f"[colab_run] Running: {' '.join(cmd)}")
print("[colab_run] ---- train_fish_id.py output begins ----")
result = subprocess.run(cmd)
print("[colab_run] ---- train_fish_id.py output ends ----")
if result.returncode != 0:
    die(f"train_fish_id.py exited with code {result.returncode} — "
        "scroll up for the traceback.")


# 7. Verify artifacts landed where the next cell expects them.
for name in ("fish_id_model.tflite", "fish_id_labels.json", "fish_id_metrics.json"):
    p = OUT_DIR / name
    if not p.exists():
        die(f"training finished but {p} is missing — check the "
            "output above for a hidden error.")
    print(f"[colab_run] ✓ {p} ({p.stat().st_size / 1024:.0f} KB)")

print("[colab_run] Done. Run the pack+download cell next.")
