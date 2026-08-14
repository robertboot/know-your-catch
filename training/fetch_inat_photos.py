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
import hashlib
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
TARGET_PER_SPECIES = 1000    # stop a species once its images/ has this many
MAX_PAGES = 12                # iNat pages per species (200 obs/page)
SLEEP_BETWEEN_CALLS = 1.0    # be a good API citizen
ALLOWED = {"cc0", "cc-by", "cc-by-nc"}   # photo licenses we keep

# The LIVE admin species list is the default. The project URL is
# pre-filled; the anon key is resolved automatically from (in order):
#   1. env var  SUPABASE_ANON_KEY  or  VITE_SUPABASE_ANON_KEY
#   2. the repo's ../.env.local     (VITE_SUPABASE_ANON_KEY=...)
# The anon key is public (same one shipped in the app) — never put the
# service_role key here. If no key is found it falls back to the bundled
# list, but the whole point is to match the admin, so keep .env.local.
def _resolve_anon_key():
    for var in ("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"):
        v = os.environ.get(var)
        if v:
            return v.strip()
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    try:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("VITE_SUPABASE_ANON_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""

SUPABASE_URL = (os.environ.get("SUPABASE_URL")
                or os.environ.get("VITE_SUPABASE_URL")
                or "https://hfptpsmdfemduhkueyoz.supabase.co")
SUPABASE_ANON_KEY = _resolve_anon_key()

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
    ("Mangrove Snapper", "Lutjanus griseus"),
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
    ("Goliath Grouper", "Epinephelus itajara"),
    ("Atlantic Mackerel", "Scomber scombrus"),
    ("Atlantic Menhaden", "Brevoortia tyrannus"),
    ("Atlantic Sharpnose Shark", "Rhizoprionodon terraenovae"),
    ("Shortfin Mako Shark", "Isurus oxyrinchus"),
    ("Black Sea Bass", "Centropristis striata"),
    ("Blacknose Shark", "Carcharhinus acronotus"),
    ("Great White Shark", "Carcharodon carcharias"),
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
    ("Atlantic Thread Herring", "Opisthonema oglinum"),
    ("Atlantic Croaker", "Micropogonias undulatus"),
    ("Ballyhoo", "Hemiramphus brasiliensis"),
    ("Bay Anchovy", "Anchoa mitchilli"),
    ("Blue Runner", "Caranx crysos"),
    ("Atlantic Bonito", "Sarda sarda"),
    ("Cigar Minnow", "Decapterus punctatus"),
    ("Gulf Menhaden", "Brevoortia patronus"),
    ("Glass Minnow", "Anchoa spp."),
    ("Ladyfish", "Elops saurus"),
    ("Pinfish", "Lagodon rhomboides"),
    ("Longspine Porgy", "Stenotomus caprinus"),
    ("Scaled Sardine", "Harengula jaguana"),
    ("Spanish Sardine", "Sardinella aurita"),
    ("Spot", "Leiostomus xanthurus"),
    ("Striped Anchovy", "Anchoa hepsetus"),
    ("Yellowfin Menhaden", "Brevoortia smithi"),
    ("Squid", "Doryteuthis spp."),
    ("Pigfish", "Orthopristis chrysoptera"),
    ("Atlantic Angel Shark", "Squatina dumeril"),
    ("Basking Shark", "Cetorhinus maximus"),
    ("Bigeye Sand Tiger Shark", "Odontaspis noronhai"),
    ("Bigeye Sixgill Shark", "Hexanchus nakamurai"),
    ("Bigeye Thresher Shark", "Alopias superciliosus"),
    ("Bignose Shark", "Carcharhinus altimus"),
    ("Caribbean Reef Shark", "Carcharhinus perezii"),
    ("Caribbean Sharpnose Shark", "Rhizoprionodon porosus"),
    ("Dusky Shark", "Carcharhinus obscurus"),
    ("Galapagos Shark", "Carcharhinus galapagensis"),
    ("Longfin Mako Shark", "Isurus paucus"),
    ("Narrowtooth Shark", "Carcharhinus brachyurus"),
    ("Night Shark", "Carcharhinus signatus"),
    ("Sharpnose Sevengill Shark", "Heptranchias perlo"),
    ("Silky Shark", "Carcharhinus falciformis"),
    ("Smalltail Shark", "Carcharhinus porosus"),
    ("Bluntnose Sixgill Shark", "Hexanchus griseus"),
    ("Sand Tiger Shark", "Carcharias taurus"),
    ("Spiny Dogfish", "Squalus acanthias"),
    ("Gulf Sturgeon", "Acipenser oxyrinchus desotoi"),
    ("Largetooth Sawfish", "Pristis pristis"),
    ("Spotted Eagle Ray", "Aetobatus narinari"),
    ("Giant Manta Ray", "Mobula birostris"),
    ("Blue Shark", "Prionace glauca"),
    ("Bull Shark", "Carcharhinus leucas"),
    ("Finetooth Shark", "Carcharhinus isodon"),
    ("Great Hammerhead Shark", "Sphyrna mokarran"),
    ("Lemon Shark", "Negaprion brevirostris"),
    ("Nurse Shark", "Ginglymostoma cirratum"),
    ("Porbeagle Shark", "Lamna nasus"),
    ("Smooth Hammerhead Shark", "Sphyrna zygaena"),
    ("Spinner Shark", "Carcharhinus brevipinna"),
    ("Thresher Shark", "Alopias vulpinus"),
    ("Tiger Shark", "Galeocerdo cuvier"),
    ("Alligator Gar", "Atractosteus spatula"),
    ("Bonefish", "Albula vulpes"),
    ("Striped Mullet", "Mugil cephalus"),
    ("Common Snook", "Centropomus undecimalis"),
    ("Swordspine Snook", "Centropomus ensiferus"),
    ("Tarpon", "Megalops atlanticus"),
    ("African Pompano", "Alectis ciliaris"),
    ("Florida Pompano", "Trachinotus carolinus"),
    ("Gulf Flounder", "Paralichthys albigutta"),
    ("Southern Flounder", "Paralichthys lethostigma"),
    ("Sheepshead", "Archosargus probatocephalus"),
    ("Permit", "Trachinotus falcatus"),
    ("Striped Bass", "Morone saxatilis"),
    ("Gafftopsail Catfish", "Bagre marinus"),
    ("Red Porgy", "Pagrus pagrus"),
    ("Jolthead Porgy", "Calamus bajonado"),
    ("Tripletail", "Lobotes surinamensis"),
    ("Yellowedge Grouper", "Hyporthodus flavolimbatus"),
    ("Misty Grouper", "Hyporthodus mystacinus"),
    ("Coney", "Cephalopholis fulva"),
    ("Graysby", "Cephalopholis cruentata"),
    ("Speckled Hind", "Epinephelus drummondhayi"),
    ("Yellowfin Grouper", "Mycteroperca venenosa"),
    ("Blackline Tilefish", "Caulolatilus cyanops"),
    ("Anchor Tilefish", "Caulolatilus intermedius"),
    ("Goldface Tilefish", "Caulolatilus chrysops"),
    ("Sand Tilefish", "Malacanthus plumieri"),
    ("Crevalle Jack", "Caranx hippos"),
    ("Black Snapper", "Apsilus dentatus"),
    ("Schoolmaster Snapper", "Lutjanus apodus"),
    ("Dog Snapper", "Lutjanus jocu"),
    ("Mahogany Snapper", "Lutjanus mahogoni"),
    ("Red Drum", "Sciaenops ocellatus"),
    ("Spotted Seatrout", "Cynoscion nebulosus"),
    ("Weakfish", "Cynoscion regalis"),
    ("Silver Seatrout", "Cynoscion nothus"),
    ("Sand Seatrout", "Cynoscion arenarius"),
    ("Great Barracuda", "Sphyraena barracuda"),
    ("Longbill Spearfish", "Tetrapturus pfluegeri"),
    ("Longtail Bass", "Anthias woodsi"),
    ("Blackbelly Rosefish", "Helicolenus dactylopterus"),
]


def http_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def load_species():
    """Live species from Supabase — the current admin list (incl.
    user-added, minus deactivated). Hard-stops rather than silently
    using the stale bundled list, so a run is always against admin."""
    if not SUPABASE_ANON_KEY:
        raise SystemExit(
            "No Supabase anon key found. Set SUPABASE_ANON_KEY (or "
            "VITE_SUPABASE_ANON_KEY), or add VITE_SUPABASE_ANON_KEY to "
            "../.env.local, so the fetch uses the live ADMIN species list.\n"
            "(Refusing to fall back to the bundled list to avoid fetching "
            "the wrong species set.)")
    url = (SUPABASE_URL.rstrip("/")
           + "/rest/v1/species?select=common_name,scientific,is_active")
    try:
        rows = http_json(url, {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
        })
    except Exception as e:
        raise SystemExit(
            f"Could not load the live admin species list ({e}). "
            "Check your network / anon key. Not falling back to the "
            "bundled list.")
    live = [(r["common_name"], r.get("scientific") or "")
            for r in rows if r.get("is_active") is not False]
    if not live:
        raise SystemExit("Admin species list came back empty — aborting.")
    print(f"Species list: {len(live)} from Supabase (LIVE admin list)")
    return live


def count_images(img_dir):
    if not os.path.isdir(img_dir):
        return 0
    return sum(1 for f in os.listdir(img_dir) if f.lower().endswith(".jpg"))


def _sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(chunk), b""):
            h.update(b)
    return h.hexdigest()


def existing_hashes(img_dir):
    """Content hashes of images already on disk. iNaturalist serves the
    same physical photo under many photo IDs, so skipping only by photo
    ID lets byte-identical duplicates through. Hashing what's already
    there lets us drop a fresh download that duplicates an existing image
    even though its photo ID (and filename) is new."""
    seen = set()
    if not os.path.isdir(img_dir):
        return seen
    for f in os.listdir(img_dir):
        if f.lower().endswith(".jpg"):
            try:
                seen.add(_sha256(os.path.join(img_dir, f)))
            except OSError:
                pass
    return seen


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
    dup_content = 0
    slug = re.sub(r"[^a-z0-9]+", "_", common.lower()).strip("_")
    # Byte-content de-dupe: seed with what's already on disk, then reject
    # any fresh download whose pixels match something we already have.
    seen_hashes = existing_hashes(img_dir)

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
                # Reject byte-identical duplicates (same image, new photo
                # ID). Remove the file we just wrote and move on.
                try:
                    digest = _sha256(fpath)
                except OSError:
                    digest = None
                if digest is not None and digest in seen_hashes:
                    try:
                        os.remove(fpath)
                    except OSError:
                        pass
                    dup_content += 1
                    continue
                if digest is not None:
                    seen_hashes.add(digest)
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
    if dup_content:
        print(f"  ({dup_content} byte-identical duplicate(s) discarded)")
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
