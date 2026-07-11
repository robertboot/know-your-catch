"""One-cell Colab runner for training.

New flow (cloud-native):
  1. Reads REELINTEL_EXPORT_URL from the environment — a signed URL
     for the export ZIP in Supabase Storage. The admin panel generates
     this URL and puts the whole "paste-this-cell" snippet on the
     clipboard.
  2. Downloads the ZIP into /content/.
  3. Fetches train_fish_id.py from GitHub and runs it.
  4. Zips the three artifacts and uploads the bundle back to the
     `model-artifacts` bucket via a signed upload URL, so the admin
     Models tab can one-click import it.

Env vars the admin snippet sets:
  REELINTEL_EXPORT_URL       - signed URL for the export ZIP (required)
  REELINTEL_BUNDLE_UPLOAD    - signed upload URL for the bundle (optional;
                               if unset, the notebook just leaves the
                               bundle on Drive for manual pickup)
  REELINTEL_BUNDLE_UPLOAD_TOKEN - the token for the upload URL (paired
                                  with REELINTEL_BUNDLE_UPLOAD)
"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen, urlretrieve

BRANCH = "claude/upload-app-assets-NUxRr"
SCRIPT_URL = (
    "https://raw.githubusercontent.com/robertboot/know-your-catch/"
    f"{BRANCH}/training/train_fish_id.py"
)
SCRIPT_PATH = "/content/train_fish_id.py"
CONTENT_DIR = Path("/content")
OUT_DIR = Path("/content/artifacts")
EXPORT_ZIP = CONTENT_DIR / "reelintel-export.zip"
BUNDLE_ZIP = CONTENT_DIR / "fish_id_bundle.zip"


def die(msg):
    print(f"[colab_run] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


# 0. Read the required signed URL up front so bad configs fail fast.
export_url = os.environ.get("REELINTEL_EXPORT_URL")
if not export_url:
    die(
        "REELINTEL_EXPORT_URL not set. Paste the snippet from the admin "
        "Training → Export page (Copy Colab cell)."
    )


# 1. Download the export ZIP into /content/.
print(f"[colab_run] Downloading export ZIP from Supabase Storage…")
try:
    urlretrieve(export_url, str(EXPORT_ZIP))
    size_mb = EXPORT_ZIP.stat().st_size / 1024 / 1024
    print(f"[colab_run] Got {size_mb:.1f} MB → {EXPORT_ZIP}")
except Exception as e:
    die(f"could not download export ZIP: {e}")


# 2. Fetch the training script from the working branch.
print(f"[colab_run] Fetching train_fish_id.py from {BRANCH}…")
try:
    urlretrieve(SCRIPT_URL, SCRIPT_PATH)
    size = os.path.getsize(SCRIPT_PATH)
    print(f"[colab_run] Got {size} bytes → {SCRIPT_PATH}")
except Exception as e:
    die(f"could not fetch train_fish_id.py: {e}")


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


# 6. Run the training script.
cmd = [
    sys.executable, SCRIPT_PATH,
    "--export", str(EXPORT_ZIP),
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


# 7. Verify artifacts landed where the next steps expect them.
for name in ("fish_id_model.tflite", "fish_id_labels.json", "fish_id_metrics.json"):
    p = OUT_DIR / name
    if not p.exists():
        die(f"training finished but {p} is missing — check the "
            "output above for a hidden error.")
    print(f"[colab_run] ✓ {p} ({p.stat().st_size / 1024:.0f} KB)")


# 8. Zip the three artifacts.
import zipfile
print(f"[colab_run] Building bundle {BUNDLE_ZIP.name}…")
with zipfile.ZipFile(BUNDLE_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("fish_id_model.tflite", "fish_id_labels.json", "fish_id_metrics.json"):
        z.write(OUT_DIR / name, arcname=name)
bundle_kb = BUNDLE_ZIP.stat().st_size / 1024
print(f"[colab_run] Bundle: {BUNDLE_ZIP} ({bundle_kb:.0f} KB)")


# 9. If a signed upload URL was provided, PUT the bundle back to
#    Supabase Storage so the admin Models tab can auto-import it.
upload_url = os.environ.get("REELINTEL_BUNDLE_UPLOAD")
upload_token = os.environ.get("REELINTEL_BUNDLE_UPLOAD_TOKEN")
if upload_url and upload_token:
    print("[colab_run] Uploading bundle to Supabase Storage…")
    try:
        with open(BUNDLE_ZIP, "rb") as f:
            body = f.read()
        # Supabase's signed upload URLs authenticate via the ?token
        # query param — no auth header needed. Content-Type must
        # match what the admin panel expects downstream.
        req = Request(
            upload_url,
            data=body,
            method="PUT",
            headers={
                "Content-Type": "application/zip",
                "x-upsert": "false",
                "Authorization": f"Bearer {upload_token}",
            },
        )
        with urlopen(req) as resp:
            status = resp.status
        if 200 <= status < 300:
            print(f"[colab_run] ✓ Bundle uploaded ({status}). Open the admin "
                  "Models tab and click 'Import from cloud'.")
        else:
            print(f"[colab_run] WARNING: upload responded {status}. Bundle "
                  f"still at {BUNDLE_ZIP} — download it and import manually.")
    except Exception as e:
        print(f"[colab_run] WARNING: bundle upload failed: {e}. Bundle still "
              f"at {BUNDLE_ZIP} — download it and import manually.")
else:
    print("[colab_run] No REELINTEL_BUNDLE_UPLOAD env var — leaving bundle "
          f"at {BUNDLE_ZIP} for manual pickup.")

print("[colab_run] Done.")
