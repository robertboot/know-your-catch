"""One-cell Colab runner for training — manifest-driven.

New flow (v2 manifest):
  The admin panel no longer builds a giant ZIP client-side. Instead it
  uploads a small manifest.json listing every training photo's storage
  path AND a long-lived signed URL. This script:
    1. Downloads the manifest via REELINTEL_EXPORT_URL.
    2. Downloads each photo in parallel into the same train/val/{species}
       folder tree the trainer expects.
    3. Fetches train_fish_id.py from GitHub and runs it.
    4. Zips the three output artifacts and PUTs the bundle to a signed
       upload URL so the admin Models tab can auto-import.

Env vars the admin snippet sets:
  REELINTEL_EXPORT_URL           - signed URL for manifest.json (required)
  REELINTEL_BUNDLE_UPLOAD        - signed upload URL for the bundle (optional)
  REELINTEL_BUNDLE_UPLOAD_TOKEN  - the token for the upload URL (paired)
"""
import os
import subprocess
import sys
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen, urlretrieve

BRANCH = "claude/upload-app-assets-NUxRr"
SCRIPT_URL = (
    "https://raw.githubusercontent.com/robertboot/know-your-catch/"
    f"{BRANCH}/training/train_fish_id.py"
)
SCRIPT_PATH = "/content/train_fish_id.py"
CONTENT_DIR = Path("/content")
DATA_DIR = Path("/content/dataset")
OUT_DIR = Path("/content/artifacts")
BUNDLE_ZIP = CONTENT_DIR / "fish_id_bundle.zip"


def die(msg):
    print(f"[colab_run] FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


# 0. Read the required signed URL up front so bad configs fail fast.
export_url = os.environ.get("REELINTEL_EXPORT_URL")
if not export_url:
    die(
        "REELINTEL_EXPORT_URL not set. Paste the snippet from the admin "
        "Training -> Export page (Copy Colab cell)."
    )


# 1. Download the manifest.
manifest_path = CONTENT_DIR / "manifest.json"
print("[colab_run] Downloading manifest from Supabase Storage...")
try:
    urlretrieve(export_url, str(manifest_path))
    with open(manifest_path, "r") as f:
        manifest = json.load(f)
except Exception as e:
    die(f"could not fetch/parse manifest: {e}")

version = manifest.get("version", 1)
if version < 2:
    die(
        f"manifest version {version} is the legacy ZIP flow. Re-export "
        "from the admin panel to get a v2 manifest."
    )

photos = manifest.get("photos") or []
if not photos:
    die("manifest has no photos.")
print(f"[colab_run] Manifest v{version}: {len(photos)} photos across "
      f"{len(manifest.get('species', []))} species.")


# 2. Download every photo in parallel into the expected layout.
#    Path scheme (matches train_fish_id.py's build_datasets):
#      /content/dataset/train/{species_id}/{filename}
#      /content/dataset/val/{species_id}/{filename}
DATA_DIR.mkdir(parents=True, exist_ok=True)

def _fetch(p):
    dest = DATA_DIR / p["path"]  # train/red_snapper/foo.jpg
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return "cached"
    try:
        urlretrieve(p["url"], str(dest))
        return "ok"
    except Exception as e:
        return f"fail:{e}"

print(f"[colab_run] Downloading {len(photos)} photos in parallel...")
start = time.time()
ok = 0; failed = 0; cached = 0
FAIL_LOG = []
with ThreadPoolExecutor(max_workers=16) as pool:
    futures = {pool.submit(_fetch, p): p for p in photos}
    for i, fut in enumerate(as_completed(futures), 1):
        res = fut.result()
        if res == "ok": ok += 1
        elif res == "cached": cached += 1
        else:
            failed += 1
            FAIL_LOG.append((futures[fut]["path"], res))
        if i % 500 == 0 or i == len(photos):
            elapsed = time.time() - start
            rate = i / elapsed if elapsed else 0
            print(f"  {i}/{len(photos)}  ({rate:.0f}/s, elapsed {elapsed:.0f}s)")

print(f"[colab_run] Downloads done. ok={ok} cached={cached} failed={failed}")
if failed:
    print(f"[colab_run] First few failures:")
    for path, err in FAIL_LOG[:5]:
        print(f"  - {path}: {err}")
if failed > len(photos) * 0.05:
    die(f"too many download failures ({failed}/{len(photos)}) - aborting.")


# 3. Fetch the training script from the working branch.
print(f"[colab_run] Fetching train_fish_id.py from {BRANCH}...")
try:
    urlretrieve(SCRIPT_URL, SCRIPT_PATH)
    print(f"[colab_run] Got {os.path.getsize(SCRIPT_PATH)} bytes.")
except Exception as e:
    die(f"could not fetch train_fish_id.py: {e}")


# 4. train_fish_id.py expects an --export ZIP path; give it a synthetic
#    zip pointer that just carries a pointer to our manifest + dataset,
#    OR just switch to passing the extracted dir. Simpler: bundle a
#    tiny manifest.json alongside the already-downloaded folder tree,
#    then feed the folder to the trainer. train_fish_id.py's
#    unzip_export step reads {work_dir}/manifest.json — we just
#    make sure that file exists at the expected location and passes
#    a --data-root instead of unzipping.
#
#    Since we're not changing train_fish_id.py, work around it: pack
#    a tiny stub zip that contains manifest.json + symlink-style
#    references. Easier: just ship the dataset folder AND a
#    manifest.json at its root, tell the trainer to skip unzip.
#
#    train_fish_id.py does `zipfile.ZipFile(zip_path).extractall(work_dir)`
#    then reads manifest.json. So the cheapest fix: build a zip that
#    contains all of /content/dataset/* PLUS manifest.json at the root.
#    That's a ~5-second local zip build over a few thousand files.

STUB_ZIP = CONTENT_DIR / "training_data.zip"
print(f"[colab_run] Packaging dataset dir into a local zip (fast, on-runtime)...")
import zipfile
manifest_for_zip = {
    "version": manifest.get("version"),
    "created_at": manifest.get("created_at"),
    "split_seed": manifest.get("split_seed"),
    "thresholds": manifest.get("thresholds"),
    "species": manifest.get("species"),
    "excluded": manifest.get("excluded"),
    "counts": manifest.get("counts"),
    # train_fish_id.py doesn't actually iterate images[] — it walks
    # the extracted folder tree. Keep a minimal images[] for compat.
    "images": [
        {"path": p["path"], "species_id": p["species_id"],
         "split": p["split"], "crop_bbox": p.get("crop_bbox")}
        for p in photos
    ],
}
zip_start = time.time()
with zipfile.ZipFile(STUB_ZIP, "w", zipfile.ZIP_STORED) as z:  # no compression - photos are already JPEG
    z.writestr("manifest.json", json.dumps(manifest_for_zip))
    for p in photos:
        src = DATA_DIR / p["path"]
        if src.exists():
            z.write(src, arcname=p["path"])
print(f"[colab_run] Local zip built in {time.time() - zip_start:.0f}s "
      f"({STUB_ZIP.stat().st_size / 1024 / 1024:.0f} MB).")


# 5. Install deps that aren't in Colab's default image.
print("[colab_run] Installing scikit-learn + pillow...")
subprocess.run(
    [sys.executable, "-m", "pip", "install", "--quiet", "scikit-learn", "pillow"],
    check=True,
)


# 6. Verify GPU up front.
OUT_DIR.mkdir(parents=True, exist_ok=True)
import tensorflow as tf
print(f"[colab_run] TensorFlow {tf.__version__}")
gpus = tf.config.list_physical_devices("GPU")
print(f"[colab_run] GPUs: {gpus}")
if not gpus:
    print("[colab_run] WARNING: no GPU. Runtime -> Change runtime type -> "
          "T4 GPU or L4 GPU, then re-run this cell.")


# 7. Run training.
cmd = [
    sys.executable, SCRIPT_PATH,
    "--export", str(STUB_ZIP),
    "--out",    str(OUT_DIR),
    "--epochs", "20",
]
print(f"[colab_run] Running: {' '.join(cmd)}")
print("[colab_run] ---- train_fish_id.py output begins ----")
result = subprocess.run(cmd)
print("[colab_run] ---- train_fish_id.py output ends ----")
if result.returncode != 0:
    die(f"train_fish_id.py exited with code {result.returncode}.")


# 8. Verify artifacts.
for name in ("fish_id_model.tflite", "fish_id_labels.json", "fish_id_metrics.json"):
    p = OUT_DIR / name
    if not p.exists():
        die(f"training finished but {p} is missing.")
    print(f"[colab_run] artifact ok: {p} ({p.stat().st_size / 1024:.0f} KB)")


# 9. Zip the three artifacts.
print(f"[colab_run] Building bundle {BUNDLE_ZIP.name}...")
with zipfile.ZipFile(BUNDLE_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("fish_id_model.tflite", "fish_id_labels.json", "fish_id_metrics.json"):
        z.write(OUT_DIR / name, arcname=name)
print(f"[colab_run] Bundle: {BUNDLE_ZIP} "
      f"({BUNDLE_ZIP.stat().st_size / 1024:.0f} KB)")


# 10. Upload the bundle back to Supabase Storage.
upload_url = os.environ.get("REELINTEL_BUNDLE_UPLOAD")
upload_token = os.environ.get("REELINTEL_BUNDLE_UPLOAD_TOKEN")
if upload_url and upload_token:
    print("[colab_run] Uploading bundle to Supabase Storage...")
    try:
        with open(BUNDLE_ZIP, "rb") as f:
            body = f.read()
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
            print(f"[colab_run] Bundle uploaded ({status}). Open the admin "
                  "Models tab and click Import on the pending bundle.")
        else:
            print(f"[colab_run] WARNING: upload responded {status}. Bundle "
                  f"still at {BUNDLE_ZIP} - download manually.")
    except Exception as e:
        print(f"[colab_run] WARNING: bundle upload failed: {e}. Bundle "
              f"still at {BUNDLE_ZIP} - download manually.")
else:
    print("[colab_run] No REELINTEL_BUNDLE_UPLOAD env var - leaving bundle "
          f"at {BUNDLE_ZIP} for manual pickup.")

print("[colab_run] Done.")
