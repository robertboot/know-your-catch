# Fish ID model training — end-to-end reference

The pipeline you use every time you train a new model. Bookmark this file.

---

## TL;DR — the 5-step loop

1. **Grow the dataset** (scrape iNaturalist → drop folders in admin)
2. **Export** (admin Training → Export → Build + upload)
3. **Train** (Colab: paste one cell → wait)
4. **Import** (admin Training → Models → Import — you name it here)
5. **Promote** (admin Training → Models → Promote — auto-publishes to the mobile app)

New model reaches every phone on next launch. No App Store review, no rebuild.

---

## Naming convention

Model versions ship as **Big Red N.M** where:
- **N** = major release (bumps when you add a whole taxonomic family: snappers, groupers, jacks…)
- **M** = minor (bumps for retrains with more data of species already in the model)

Examples:
- `Big Red 1.0` — snappers + groupers baseline
- `Big Red 1.1` — same species, added ~500 photos each of the weakest
- `Big Red 2.0` — added jacks

The name you type on Import is what users see in Settings → Fish ID model.

---

## Step 1 — Grow the dataset (iNaturalist scraper)

Run this on your Mac. Change the top two lines per species. Photos land in
iCloud so they're accessible from anywhere.

```bash
SPECIES_NAME="Black Grouper"           # <-- common name, title case
SCIENTIFIC="Mycteroperca bonaci"       # <-- scientific name

LIMIT=500
BASE="/Users/robboot/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model/$SPECIES_NAME"
mkdir -p "$BASE/images"

SPECIES_NAME="$SPECIES_NAME" SCIENTIFIC="$SCIENTIFIC" LIMIT="$LIMIT" BASE="$BASE" python3 <<'PYEOF'
import os, csv, urllib.request, urllib.parse, json, time
SPECIES_NAME = os.environ["SPECIES_NAME"]; SCIENTIFIC = os.environ["SCIENTIFIC"]
LIMIT = int(os.environ["LIMIT"]); BASE = os.environ["BASE"]
IMG_DIR = os.path.join(BASE, "images"); META_PATH = os.path.join(BASE, "metadata.csv")
ALLOWED = {"cc0","cc-by","cc-by-nc","cc-by-sa","cc-by-nc-sa"}
seen = set()
if os.path.exists(META_PATH):
    with open(META_PATH, newline="") as f:
        for row in csv.DictReader(f):
            if row.get("photo_id"): seen.add(row["photo_id"])
new_file = not os.path.exists(META_PATH)
mf = open(META_PATH, "a", newline="")
writer = csv.DictWriter(mf, fieldnames=[
    "photo_id","observation_id","taxon_name","common_name","license",
    "observed_on","quality_grade","place","lat","lon","url","filename"])
if new_file: writer.writeheader()
BASE_URL = ("https://api.inaturalist.org/v1/observations"
    f"?taxon_name={urllib.parse.quote(SCIENTIFIC)}"
    "&photos=true&quality_grade=research&per_page=200")
saved = skipped_license = already = 0
for page in range(1, 11):
    if saved >= LIMIT: break
    try: data = json.load(urllib.request.urlopen(f"{BASE_URL}&page={page}", timeout=30))
    except Exception as e: print(f"page {page}: fetch failed - {e}"); break
    results = data.get("results", [])
    if not results: break
    for obs in results:
        if saved >= LIMIT: break
        if not obs: continue
        obs_id = obs.get("id")
        geo = obs.get("geojson") or {}; coords = geo.get("coordinates") or [None, None]
        for p in obs.get("photos") or []:
            if saved >= LIMIT: break
            if not p: continue
            pid = str(p.get("id")); lic = (p.get("license_code") or "").lower()
            if pid in seen: already += 1; continue
            if lic not in ALLOWED: skipped_license += 1; continue
            url = (p.get("url") or "").replace("square", "large")
            if not url: continue
            fname = f"{SPECIES_NAME.lower().replace(' ', '_')}_{pid}.jpg"
            try: urllib.request.urlretrieve(url, os.path.join(IMG_DIR, fname))
            except Exception: continue
            writer.writerow({
                "photo_id": pid, "observation_id": obs_id, "taxon_name": SCIENTIFIC,
                "common_name": SPECIES_NAME, "license": lic,
                "observed_on": obs.get("observed_on"), "quality_grade": obs.get("quality_grade"),
                "place": obs.get("place_guess"),
                "lat": coords[1] if coords else None, "lon": coords[0] if coords else None,
                "url": url, "filename": fname})
            mf.flush(); saved += 1
            if saved % 25 == 0: print(f"  ...{saved} saved")
    time.sleep(0.5)
mf.close()
print(f"\nDone. Newly saved this run: {saved}")
print(f"Skipped (all-rights-reserved / disallowed license): {skipped_license}")
if already: print(f"Already had (skipped): {already}")
print(f"Images folder: {IMG_DIR}\nMetadata:      {META_PATH}")
PYEOF
```

**Re-run safety:** metadata.csv doubles as a dedup log. Re-running skips
photos already downloaded. Run periodically to pick up new observations.

**License filter:** only pulls Creative Commons photos that permit derivatives.
Skips all-rights-reserved. See the ALLOWED set.

### After scraping, skim the folder

iNaturalist community IDs are 2-person agreements — not perfect. **Delete any
photo that doesn't clearly look like the right species** before uploading.
Bad labels poison the model harder than missing photos.

### Upload to admin

Admin → Training → **Upload** → Batch mode → pick the species → drop the
whole folder. The admin uploads to the `training-photos` Supabase bucket.

Review pass (admin Training → Review) tags each photo `verified` or
`rejected`. Only verified photos make it into the export.

---

## Step 2 — Export (Admin)

Admin → Training → **Export** → wait for the "Export plan" summary → click
**Build + upload (N images)**.

- Builds ZIP client-side (all verified photos, 85/15 train/val split)
- Uploads directly to Supabase Storage → no browser download

When done: **Prior exports** card appears below. The newest one is at the top.

Click **Copy Colab cell** → the one-cell snippet is now on your clipboard.

---

## Step 3 — Train (Colab)

1. Open a fresh Colab notebook: https://colab.research.google.com/
2. **Runtime → Change runtime type → L4 GPU** (or T4 if L4 unavailable). Save.
3. **Paste the copied cell into an empty cell → Run.**

That's it. The cell:
- Downloads the export ZIP from Supabase
- Fetches `train_fish_id.py` from GitHub
- Trains 20 epochs (or early-stops)
- INT8-quantizes the model
- Uploads the bundle back to Supabase

Runtime: ~30–60 min on L4.

### Colab troubleshooting (learnings from Big Red 1.0)

| Symptom | Cause | Fix |
|---|---|---|
| Runtime disconnected, `/content/` empty | Free tier idle timeout | Colab Pro ($10/mo) — no more idle disconnects |
| `Cannot connect runtime` / no GPU | Free tier quota exhausted | Colab Pro, or retry in a few hours |
| `files.upload()` widget breaks | Safari bug | Not needed — the automated flow uses signed URLs, no widget |
| `BadZipFile` on the export | Old flow bug (Colab file browser truncated large uploads) | Not possible with the current flow — the ZIP downloads via curl |
| GPU shows `[]` in TF | Runtime allocated CPU only | Change runtime → verify with `!nvidia-smi` |

### If the automated bundle upload fails

Colab prints `WARNING: bundle upload failed` and leaves the bundle at
`/content/fish_id_bundle.zip`. Two fallbacks:

1. Right-click in Colab's file browser → Download → then Admin Models →
   Upload artifacts → drop the zip.
2. Copy to Drive from a new cell:
   ```python
   from google.colab import drive
   drive.mount('/content/drive')
   !cp /content/fish_id_bundle.zip /content/drive/MyDrive/
   ```
   Then download from drive.google.com on your Mac.

---

## Step 4 — Import (Admin)

Refresh Admin → Training → **Models**.

You'll see a **Pending bundles (from Colab)** card at the top. Click **Import**.

You'll be prompted for a name — default is `Big Red N.0` (auto-numbered).
Rename or accept. That's the name users see in Settings.

The bundle is moved from `pending/` to `imported/` so it doesn't show up
again. The model appears in the list below.

---

## Step 5 — Promote (Admin)

On the newly imported row, click **Promote**.

This does two things:
1. Sets `is_production = true` on that row (demotes any previously
   promoted one)
2. Copies the `.tflite` + a manifest JSON to the public `models-published`
   bucket

The mobile app fetches from that public bucket on launch. Next app launch
= new model.

**Verify:** Open the app → Settings → **Fish ID model** → should show the
new version name within a few seconds. If it still shows the old one, tap
**Check for updates**.

---

## Model performance — how to read it

**Overall val accuracy** on the Models detail page is on your held-out
photos. Real-world will be lower — expect a 10–15 percentage-point drop.

**Per-species (weakest first)** table tells you what to work on next.
Anything below 60% needs more data.

**Lookalike group pass/fail** flags families where the model is confused.
If the weakest member of a group is below 60%, **don't promote** — the
model will confidently give the wrong answer in that family. Retrain with
more photos of the weak member(s) first.

---

## Rollback

If a promoted model turns out worse than expected:

1. Admin → Training → Models → find the previous version
2. Click **Promote** on it
3. Wait 30 seconds → hit **Check for updates** in the mobile app

The demoted model still exists — nothing is destroyed. You can promote and
demote versions freely.

---

## Species catalog (add as you go)

| Common name | Scientific name |
|---|---|
| Red snapper | Lutjanus campechanus |
| Vermilion snapper | Rhomboplites aurorubens |
| Lane snapper | Lutjanus synagris |
| Mangrove snapper | Lutjanus griseus |
| Yellowtail snapper | Ocyurus chrysurus |
| Mutton snapper | Lutjanus analis |
| Blackfin snapper | Lutjanus buccanella |
| Black grouper | Mycteroperca bonaci |
| Gag grouper | Mycteroperca microlepis |
| Red grouper | Epinephelus morio |
| Nassau grouper | Epinephelus striatus |
| Scamp grouper | Mycteroperca phenax |
| Yellowmouth grouper | Mycteroperca interstitialis |
| Snowy grouper | Hyporthodus niveatus |
| Warsaw grouper | Hyporthodus nigritus |
| Goliath grouper | Epinephelus itajara |
| Wreckfish | Polyprion americanus |
| Greater amberjack | Seriola dumerili |
| Lesser amberjack | Seriola fasciata |
| Almaco jack | Seriola rivoliana |
| Banded rudderfish | Seriola zonata |
| King mackerel | Scomberomorus cavalla |
| Spanish mackerel | Scomberomorus maculatus |
| Cero mackerel | Scomberomorus regalis |
| Mahi | Coryphaena hippurus |
| Cobia | Rachycentron canadum |
| Hogfish | Lachnolaimus maximus |

Add scientific names for new species here as they get added to the model.
