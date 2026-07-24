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

FETCH_ATTEMPTS = 3

def _image_problem(path):
    # Supabase Storage sometimes serves an empty 200 body, and
    # urlretrieve happily writes it as a 0-byte file. Anything that
    # doesn't decode crashes train_fish_id.py at its decode_image node
    # ("INVALID_ARGUMENT: Input is empty"), so reject it here.
    from PIL import Image
    try:
        if path.stat().st_size == 0:
            return "empty file (0 bytes)"
        with Image.open(path) as im:
            im.verify()
        return None
    except Exception as e:
        return f"undecodable image: {e}"

def _fetch(p):
    dest = DATA_DIR / p["path"]  # train/red_snapper/foo.jpg
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if _image_problem(dest) is None:
            return "cached"
        # Broken leftover from an earlier run — re-download it.
        try: dest.unlink()
        except Exception: pass
    crop = p.get("crop_bbox") or None
    last_err = None
    for attempt in range(FETCH_ATTEMPTS):
        if attempt:
            time.sleep(attempt)
        try:
            if crop:
                # Fetch to a scratch path, apply the normalized crop, save
                # the cropped result at dest. The training script reads
                # whatever's on disk under train/{species}/ — cropping is
                # transparent to it.
                import tempfile
                from PIL import Image
                scratch = Path(tempfile.mkdtemp()) / dest.name
                try:
                    urlretrieve(p["url"], str(scratch))
                    problem = _image_problem(scratch)
                    if problem:
                        last_err = problem
                        continue
                    with Image.open(scratch) as im:
                        w, h = im.size
                        x = max(0, int(round(float(crop.get("x", 0)) * w)))
                        y = max(0, int(round(float(crop.get("y", 0)) * h)))
                        cw = max(1, int(round(float(crop.get("w", 1)) * w)))
                        ch = max(1, int(round(float(crop.get("h", 1)) * h)))
                        cw = min(cw, w - x); ch = min(ch, h - y)
                        cropped = im.crop((x, y, x + cw, y + ch))
                        # Convert to RGB in case source is RGBA — train_fish_id
                        # expects standard image tensors and JPEG doesn't
                        # support alpha.
                        if cropped.mode != "RGB":
                            cropped = cropped.convert("RGB")
                        cropped.save(dest, format="JPEG", quality=92)
                finally:
                    try: scratch.unlink()
                    except Exception: pass
            else:
                urlretrieve(p["url"], str(dest))
            problem = _image_problem(dest)
            if problem is None:
                return "cropped" if crop else "ok"
            last_err = problem
        except Exception as e:
            last_err = e
        finally:
            # Never leave a broken file behind: the zip step would pack
            # it, and a later run's cached fast-path must re-download it.
            if last_err is not None and dest.exists():
                if _image_problem(dest) is not None:
                    try: dest.unlink()
                    except Exception: pass
    return f"fail:{last_err}"

print(f"[colab_run] Downloading {len(photos)} photos in parallel...")
start = time.time()
ok = 0; failed = 0; cached = 0; cropped = 0
FAIL_LOG = []
with ThreadPoolExecutor(max_workers=16) as pool:
    futures = {pool.submit(_fetch, p): p for p in photos}
    for i, fut in enumerate(as_completed(futures), 1):
        res = fut.result()
        if res == "ok": ok += 1
        elif res == "cropped": cropped += 1
        elif res == "cached": cached += 1
        else:
            failed += 1
            FAIL_LOG.append((futures[fut]["path"], res))
        if i % 500 == 0 or i == len(photos):
            elapsed = time.time() - start
            rate = i / elapsed if elapsed else 0
            print(f"  {i}/{len(photos)}  ({rate:.0f}/s, elapsed {elapsed:.0f}s)")

print(f"[colab_run] Downloads done. ok={ok} cropped={cropped} cached={cached} failed={failed}")
if failed:
    print(f"[colab_run] First few failures:")
    for path, err in FAIL_LOG[:5]:
        print(f"  - {path}: {err}")
if failed > len(photos) * 0.05:
    die(f"too many download failures ({failed}/{len(photos)}) - aborting.")


# 2b. Validate every image on disk. A single zero-byte or corrupt
#     file kills training mid-epoch with an opaque
#     "INVALID_ARGUMENT: Input is empty" from DecodeImage — some
#     browser uploads (iCloud files not materialized locally) PUT
#     empty bodies to storage successfully, so bad objects exist at
#     the source. Bad files get one re-download, then are removed
#     from the dataset so the run survives.
print("[colab_run] Validating images on disk...")
from PIL import Image

def _validate(p):
    dest = DATA_DIR / p["path"]
    try:
        if not dest.exists() or dest.stat().st_size == 0:
            return (p, "missing/empty")
        with Image.open(dest) as im:
            im.verify()
        return None
    except Exception as e:
        return (p, f"corrupt: {e}")

bad = []
with ThreadPoolExecutor(max_workers=16) as pool:
    for res in pool.map(_validate, photos):
        if res:
            bad.append(res)

removed = 0
if bad:
    print(f"[colab_run] {len(bad)} invalid images — retrying once...")
    still_bad = []
    for p, reason in bad:
        dest = DATA_DIR / p["path"]
        try:
            if dest.exists():
                dest.unlink()
            urlretrieve(p["url"], str(dest))
            if dest.stat().st_size > 0:
                with Image.open(dest) as im:
                    im.verify()
            else:
                raise ValueError("zero bytes")
        except Exception as e:
            still_bad.append((p, f"{reason} / retry: {e}"))
            try:
                if dest.exists():
                    dest.unlink()
            except Exception:
                pass
    removed = len(still_bad)
    if removed:
        print(f"[colab_run] Removed {removed} unrecoverable images from the dataset:")
        for p, reason in still_bad[:10]:
            print(f"  - {p['path']}: {reason}")
        if removed > 10:
            print(f"  ... and {removed - 10} more")
        print("[colab_run] NOTE: these photos are broken at the SOURCE (zero-byte")
        print("[colab_run] uploads). Re-upload them via the admin, or leave them —")
        print("[colab_run] every run will skip them the same way.")
print(f"[colab_run] Validation done. {len(photos) - removed} usable images.")


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
    sys.executable, "-u", SCRIPT_PATH,
    "--export", str(STUB_ZIP),
    "--out",    str(OUT_DIR),
    "--epochs", "20",
]
print(f"[colab_run] Running: {' '.join(cmd)}")
print("[colab_run] ---- train_fish_id.py output begins ----")
# Stream the child's stdout+stderr line-by-line through the notebook's
# own stdout. A bare subprocess.run(cmd) inherits the kernel's file
# descriptors, and in Colab the child's stderr (i.e. the Python
# traceback when training crashes) never renders in the cell — the
# script "fails silently" with an empty output block.
proc = subprocess.Popen(
    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, bufsize=1,
)
for line in proc.stdout:
    print(line, end="", flush=True)
proc.wait()
print("[colab_run] ---- train_fish_id.py output ends ----")
if proc.returncode != 0:
    die(f"train_fish_id.py exited with code {proc.returncode}.")


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
        if getattr(e, "code", None) == 403:
            print("[colab_run] A 403 usually means the signed upload URL "
                  "expired - Supabase upload tokens last ~2 hours, which a "
                  "long training run can outlive. Mint a fresh URL from the "
                  "admin Models/Export UI and re-run just the upload, or "
                  "import the bundle manually.")
else:
    print("[colab_run] No REELINTEL_BUNDLE_UPLOAD env var - leaving bundle "
          f"at {BUNDLE_ZIP} for manual pickup.")

# 11. Belt-and-suspenders: ALWAYS also push the bundle to the browser as a
#     download, regardless of whether the Supabase upload succeeded. Two
#     independent failure modes have each silently lost a finished model:
#       - the signed upload URL is only valid ~2 hours and a long training
#         run outlives it (silent 403), and
#       - the Colab runtime's disk is wiped the instant it disconnects
#         (idle timeout, or the browser evicting a backgrounded tab).
#     A finished model then evaporates with nothing to recover. This
#     download lands the zip on the device running the notebook — drop it
#     into the admin Models -> "Upload artifacts" button to import it.
#     Guarded so a non-Colab / headless kernel just skips it cleanly.
try:
    from google.colab import files as _colab_files
    print(f"[colab_run] Downloading a local backup copy of {BUNDLE_ZIP.name} "
          "to your device (survives URL expiry AND runtime disconnect)...")
    _colab_files.download(str(BUNDLE_ZIP))
except Exception as e:
    print(f"[colab_run] (device download skipped — not in Colab? {e})")

print("[colab_run] Done.")
