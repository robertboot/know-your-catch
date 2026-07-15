#!/usr/bin/env python3
"""Bulk iNaturalist photo fetcher — every ReelIntel species in one run.

Walks the full species list (fetched live from Supabase so it matches
the admin exactly, with the bundled list as offline fallback) and
downloads research-grade, permissively-licensed photos for each into
per-species folders — same layout, filenames, and metadata.csv columns
as the original single-species script, so existing folders keep
working and already-downloaded photos are skipped.

Usage: python3 fetch_inat_photos.py
Tune the CONFIG block below. Re-running is safe: it resumes wherever
it stopped, skips species that already have TARGET_PER_SPECIES images,
and never re-downloads a photo id it already has.
"""

import csv
import json
import os
import re
import time
import urllib.parse
import urllib.request

# ---------------- CONFIG ----------------
BASE_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"
)
TARGET_PER_SPECIES = 300     # stop a species once its images/ has this many
MAX_PAGES = 5                # iNat pages per species (200 obs/page)
SLEEP_BETWEEN_CALLS = 1.0    # be a good API citizen
ALLOWED = {"cc0", "cc-by", "cc-by-nc"}   # photo licenses we keep

# Fill these from your .env.local to fetch the LIVE species list
# (includes species you added through the admin). Leave blank to use
# the bundled fallback list below.
SUPABASE_URL = ""       # e.g. https://abcdefgh.supabase.co
SUPABASE_ANON_KEY = ""

# Species to skip — add common names here for folders you've already
# finished under a different folder name (e.g. "Scamp" if your folder
# is "Scamp Grouper").
SKIP_COMMON = set([
    # "Scamp",
])
# -----------------------------------------

# Bundled fallback — mirrors src/data.js SPECIES.
BUNDLED = [
    ("Red Snapper", "Lutjanus campechanus"),
    ("Vermilion Snapper", "Rhomboplites aurorubens"),
    ("Lane Snapper", "Lutjanus synagris"),
    ("Gray Snapper", "Lutjanus griseus"),
    ("Mutton Snapper", "Lutjanus analis"),
    ("Yellowtail Snapper", "Ocyurus chrysurus"),
    ("Red Grouper", "Epinephelus morio"),
    ("Gag Grouper", "Mycteroperca microlepis"),
    ("Black Grouper", "Mycteroperca bonaci"),
    ("Scamp", "Mycteroperca phenax"),
    ("Greater Amberjack", "Seriola dumerili"),
    ("Lesser Amberjack", "Seriola fasciata"),
    ("Almaco Jack", "Seriola rivoliana"),
    ("Banded Rudderfish", "Seriola zonata"),
    ("Spanish Mackerel", "Scomberomorus maculatus"),
    ("King Mackerel", "Scomberomorus cavalla"),
    ("Cero Mackerel", "Scomberomorus regalis"),
    ("Yellowfin Tuna", "Thunnus albacares"),
    ("Blackfin Tuna", "Thunnus atlanticus"),
    ("Atlantic Bluefin Tuna", "Thunnus thynnus"),
    ("Albacore Tuna", "Thunnus alalunga"),
    ("Little Tunny", "Euthynnus alletteratus"),
    ("Bigeye Tuna", "Thunnus obesus"),
    ("Blue Marlin", "Makaira nigricans"),
    ("Swordfish", "Xiphias gladius"),
    ("Atlantic Sailfish", "Istiophorus albicans"),
    ("White Marlin", "Kajikia albida"),
    ("Gray Triggerfish", "Balistes capriscus"),
    ("Blacktip Shark", "Carcharhinus limbatus"),
    ("Cobia", "Rachycentron canadum"),
    ("Wahoo", "Acanthocybium solandri"),
    ("Opah", "Lampris guttatus"),
    ("Mahi-Mahi", "Coryphaena hippurus"),
    ("Golden Tilefish", "Lopholatilus chamaeleonticeps"),
    ("Blueline Tilefish", "Caulolatilus microps"),
    ("Short Bigeye", "Pristigenys alta"),
    ("Atlantic Cod", "Gadus morhua"),
    ("Goliath Grouper", "Epinephelus itajara"),
    ("Atlantic Mackerel", "Scomber scombrus"),
    ("Atlantic Menhaden", "Brevoortia tyrannus"),
    ("Atlantic Sharpnose Shark", "Rhizoprionodon terraenovae"),
    ("Shortfin Mako Shark", "Isurus oxyrinchus"),
    ("Atlantic Sturgeon", "Acipenser oxyrinchus oxyrinchus"),
    ("Winter Flounder", "Pseudopleuronectes americanus"),
    ("Summer Flounder", "Paralichthys dentatus"),
    ("Scup", "Stenotomus chrysops"),
    ("Black Sea Bass", "Centropristis striata"),
    ("Blacknose Shark", "Carcharhinus acronotus"),
    ("Great White Shark", "Carcharodon carcharias"),
    ("Winter Skate", "Leucoraja ocellata"),
    ("Smalltooth Sawfish", "Pristis pectinata"),
    ("Scalloped Hammerhead", "Sphyrna lewini"),
    ("Sandbar Shark", "Carcharhinus plumbeus"),
    ("Oceanic Whitetip Shark", "Carcharhinus longimanus"),
    ("Bonnethead Shark", "Sphyrna tiburo"),
    ("Bluefish", "Pomatomus saltatrix"),
    ("Butterfish", "Peprilus triacanthus"),
    ("Nassau Grouper", "Epinephelus striatus"),
    ("Warsaw Grouper", "Hyporthodus nigritus"),
    ("Silk Snapper", "Lutjanus vivanus"),
    ("Cubera Snapper", "Lutjanus cyanopterus"),
    ("Blackfin Snapper", "Lutjanus buccanella"),
    ("Queen Snapper", "Etelis oculatus"),
    ("Yellowmouth Grouper", "Mycteroperca interstitialis"),
    ("Wreckfish", "Polyprion americanus"),
    ("Snowy Grouper", "Hyporthodus niveatus"),
    ("Hogfish", "Lachnolaimus maximus"),
    ("Black Drum", "Pogonias cromis"),
]


def http_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def load_species():
    """Live species from Supabase (matches admin, incl. user-added);
    bundled fallback when creds are blank or the fetch fails."""
    if SUPABASE_URL and SUPABASE_ANON_KEY:
        try:
            url = (SUPABASE_URL.rstrip("/")
                   + "/rest/v1/species?select=common_name,scientific,is_active")
            rows = http_json(url, {
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
            })
            live = [(r["common_name"], r.get("scientific") or "")
                    for r in rows if r.get("is_active") is not False]
            if live:
                print(f"Species list: {len(live)} from Supabase (live)")
                return live
        except Exception as e:
            print(f"Live species fetch failed ({e}) — using bundled list")
    print(f"Species list: {len(BUNDLED)} bundled")
    return list(BUNDLED)


def count_images(img_dir):
    if not os.path.isdir(img_dir):
        return 0
    return sum(1 for f in os.listdir(img_dir) if f.lower().endswith(".jpg"))


def fetch_species(common, scientific):
    if common in SKIP_COMMON:
        print(f"— {common}: in SKIP_COMMON, skipping")
        return
    if not scientific:
        print(f"— {common}: no scientific name, skipping")
        return

    sp_dir = os.path.join(BASE_DIR, common)
    img_dir = os.path.join(sp_dir, "images")
    meta_path = os.path.join(sp_dir, "metadata.csv")
    have = count_images(img_dir)
    if have >= TARGET_PER_SPECIES:
        print(f"— {common}: already has {have} images, skipping")
        return

    os.makedirs(img_dir, exist_ok=True)
    new_meta = not os.path.exists(meta_path)
    mf = open(meta_path, "a", newline="")
    writer = csv.DictWriter(mf, fieldnames=[
        "photo_id", "observation_id", "taxon_name", "common_name",
        "license", "observed_on", "quality_grade", "place",
        "lat", "lon", "url", "filename",
    ])
    if new_meta:
        writer.writeheader()

    saved = 0
    skipped_license = 0
    already = 0
    slug = re.sub(r"[^a-z0-9]+", "_", common.lower()).strip("_")

    print(f"\n=== {common} ({scientific}) — have {have}, "
          f"targeting {TARGET_PER_SPECIES} ===")
    for page in range(1, MAX_PAGES + 1):
        if have + saved >= TARGET_PER_SPECIES:
            break
        q = urllib.parse.urlencode({
            "taxon_name": scientific,
            "quality_grade": "research",
            "photos": "true",
            "photo_license": ",".join(sorted(ALLOWED)),
            "per_page": 200,
            "page": page,
            "order_by": "votes",
        })
        try:
            data = http_json(f"https://api.inaturalist.org/v1/observations?{q}")
        except Exception as e:
            print(f"  page {page}: API error — {e}")
            break
        results = data.get("results") or []
        if not results:
            break

        for obs in results:
            if have + saved >= TARGET_PER_SPECIES:
                break
            obs_id = obs.get("id")
            coords = (obs.get("geojson") or {}).get("coordinates")
            for p in obs.get("photos") or []:
                if have + saved >= TARGET_PER_SPECIES:
                    break
                pid = p.get("id")
                lic = (p.get("license_code") or "").lower()
                fname = f"{slug}_{pid}.jpg"
                fpath = os.path.join(img_dir, fname)
                if os.path.exists(fpath):
                    already += 1
                    continue
                if lic not in ALLOWED:
                    skipped_license += 1
                    continue
                url = (p.get("url") or "").replace("square", "large")
                if not url:
                    continue
                try:
                    urllib.request.urlretrieve(url, fpath)
                except Exception as e:
                    print(f"  photo {pid}: download failed — {e}")
                    continue
                writer.writerow({
                    "photo_id": pid,
                    "observation_id": obs_id,
                    "taxon_name": scientific,
                    "common_name": common,
                    "license": lic,
                    "observed_on": obs.get("observed_on"),
                    "quality_grade": obs.get("quality_grade"),
                    "place": obs.get("place_guess"),
                    "lat": coords[1] if coords else None,
                    "lon": coords[0] if coords else None,
                    "url": url,
                    "filename": fname,
                })
                mf.flush()
                saved += 1
                if saved % 25 == 0:
                    print(f"  ...{saved} saved")
        time.sleep(SLEEP_BETWEEN_CALLS)

    mf.close()
    print(f"  done: +{saved} new, {skipped_license} skipped (license), "
          f"{already} already had → total ~{have + saved}")


def main():
    species = load_species()
    print(f"Base folder: {BASE_DIR}")
    for i, (common, scientific) in enumerate(species, 1):
        print(f"\n[{i}/{len(species)}]", end=" ")
        try:
            fetch_species(common, scientific)
        except KeyboardInterrupt:
            print("\nInterrupted — safe to re-run later, it resumes.")
            return
        except Exception as e:
            print(f"— {common}: unexpected error — {e} (continuing)")
    print("\nALL SPECIES DONE.")


if __name__ == "__main__":
    main()
