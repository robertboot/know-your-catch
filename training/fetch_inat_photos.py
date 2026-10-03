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


# Resolved taxon ids, so 168 species don't re-ask for the same lookup.
_TAXON_CACHE = {}

# Names where iNat's taxonomy genuinely disagrees with ours and no rule
# can safely bridge the gap. Each entry is a decision someone made by
# looking it up — NOT a fuzzy match. Anything not listed here and not
# matched by the passes below is skipped rather than guessed at.
# Each value is (taxon_id, the name iNat should report for it). The
# second half is the point: these overrides exist precisely BECAUSE
# iNat's name differs from ours, so checking the id against our own name
# would flag every correct entry.
TAXON_OVERRIDES = {
    # iNat lumps Atlantic sailfish into the Indo-Pacific species; most
    # authorities now treat them as one circumtropical species.
    "istiophorus albicans": (119719, "Istiophorus platypterus"),
    # Gulf sturgeon: we carry it as a subspecies of A. oxyrinchus,
    # iNat elevated it to full species as A. desotoi.
    "acipenser oxyrinchus desotoi": (1316440, "Acipenser desotoi"),
}

# Every id above is verified at import time. An override is a hand-typed
# integer, which is exactly the kind of thing that is confidently wrong —
# the first draft of this table pointed Atlantic Sailfish at a green alga
# and Gulf Sturgeon at a mite, and nothing downstream would have noticed.
def verify_overrides():
    """Check each override still names the taxon we think it does.
    Network-dependent, so failures warn rather than abort — an offline
    run should not be blocked by a sanity check."""
    for name, (tid, expect) in TAXON_OVERRIDES.items():
        try:
            d = http_json(f"https://api.inaturalist.org/v1/taxa/{tid}")
            got = ((d.get("results") or [{}])[0].get("name") or "?")
        except Exception as e:
            print(f"  ! could not verify override {name} -> {tid}: {e}")
            continue
        if got.strip().lower() != expect.strip().lower():
            print(f"  !! OVERRIDE WRONG: {name} -> {tid} is '{got}', "
                  f"expected '{expect}'")


def resolve_taxon(scientific):
    """Return (taxon_id, resolved_inat_name), or (None, None).

    We used to pass `taxon_name=<scientific>` straight to the
    observations endpoint. That parameter is a FUZZY NAME SEARCH, and
    when it mis-resolves iNat returns a full page of confidently-wrong
    observations rather than an error or an empty set. On 2026-08-14
    `Sarda sarda` (Atlantic Bonito) came back as `Regalecus glesne` —
    the oarfish — and 1000 oarfish photos had been downloaded into the
    Atlantic Bonito folder and trained on. Nothing in the fetch log
    looked wrong.

    So: resolve the name to an id here, verify the id's own name matches
    what we asked for, and let the caller filter by taxon_id instead.
    A species we cannot resolve is SKIPPED, never guessed at — a missing
    species costs recall, a mislabelled one corrupts the model.
    """
    key = (scientific or "").strip().lower()
    if not key:
        return (None, None)
    if key in _TAXON_CACHE:
        return _TAXON_CACHE[key]

    if key in TAXON_OVERRIDES:
        tid, expect = TAXON_OVERRIDES[key]
        print(f"  · {scientific} → {expect} (id {tid}, manual override)")
        _TAXON_CACHE[key] = (tid, expect)
        return _TAXON_CACHE[key]

    # "Anchoa spp." / "Doryteuthis spp." are genus-level ON PURPOSE —
    # the app groups those as one class because anglers do. Strip the
    # marker and accept the genus, which the binomial path forbids.
    genus_only = key.endswith(" spp.") or key.endswith(" sp.") or " " not in key
    lookup = re.sub(r"\s+sp{1,2}\.$", "", key).strip()

    q = urllib.parse.urlencode({"q": lookup, "rank": "species,subspecies,genus"})
    try:
        data = http_json(f"https://api.inaturalist.org/v1/taxa?{q}")
    except Exception as e:
        print(f"  ! taxon lookup failed for {scientific}: {e}")
        _TAXON_CACHE[key] = (None, None)
        return _TAXON_CACHE[key]

    results = data.get("results") or []
    parts = lookup.split(" ")
    # Last word for a trinomial too: we carry Gulf sturgeon as
    # "Acipenser oxyrinchus desotoi", and the epithet that identifies it
    # is desotoi, not oxyrinchus.
    want_epithet = parts[-1] if len(parts) > 1 else None

    def take(t, why):
        tid = t.get("id")
        if why:
            print(f"  · {scientific} resolved to {t.get('name')} (id {tid}) — {why}")
        _TAXON_CACHE[key] = (tid, t.get("name"))
        return _TAXON_CACHE[key]

    # Genus-level request: take the genus taxon itself.
    if genus_only:
        for t in results:
            if ((t.get("name") or "").strip().lower() == lookup
                    and t.get("rank") == "genus"):
                return take(t, "genus-level class, as intended")

    # Pass 1: exact binomial. Ranked first deliberately — iNat returns
    # the GENUS ahead of the species for a query like "Sarda sarda", and
    # a first-match-wins loop silently widens the fetch to every sibling
    # species in that genus.
    for t in results:
        if (t.get("name") or "").strip().lower() == lookup:
            return take(t, None)

    # Pass 2: same species epithet under a different genus. iNat
    # reclassifies constantly — Epinephelus drummondhayi is Hyporthodus
    # drummondhayi there now — and that is a rename, not another fish.
    if want_epithet:
        for t in results:
            name = (t.get("name") or "").strip().lower()
            bits = name.split(" ")
            if len(bits) == 2 and bits[1] == want_epithet:
                return take(t, "genus renamed upstream")

    # A bare genus is NOT accepted for a binomial query: it would pull
    # every sibling species under our species' label. Better to fetch
    # nothing and see the skip in the log.
    got = ", ".join((t.get("name") or "?") for t in results[:3])
    print(f"  ! {scientific} did not resolve (closest: {got or 'nothing'}) — SKIPPING")
    _TAXON_CACHE[key] = (None, None)
    return _TAXON_CACHE[key]


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

    # Resolve BEFORE creating any folder — an unresolvable name must not
    # leave an empty directory behind that later looks like a real class.
    taxon_id, resolved_name = resolve_taxon(scientific)
    if not taxon_id:
        print(f"— {common}: could not resolve '{scientific}', skipping")
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
    mismatched = 0
    # Genus of the taxon iNat ACTUALLY gave us, not of the name we asked
    # with. Those differ whenever iNat has renamed or lumped a species
    # (Epinephelus drummondhayi is Hyporthodus drummondhayi there), and
    # comparing against our own name would reject every photo for those
    # species while looking like a legitimate empty result.
    want_genus = (resolved_name or scientific).strip().lower().split(" ")[0]
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
            "taxon_id": taxon_id,
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
            # Second gate, deliberately redundant with taxon_id above.
            # The oarfish incident cost 1000 photos and a training run
            # precisely because one silent filter failure had nothing
            # behind it. This one reads the label off the observation we
            # were actually handed, so a filter that stops working can
            # only ever yield zero photos, never wrong ones.
            obs_genus = ((obs.get("taxon") or {}).get("name") or "").strip().lower().split(" ")[0]
            if obs_genus and obs_genus != want_genus:
                mismatched += 1
                continue
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
          f"{already} already had, {mismatched} wrong-taxon rejected "
          f"→ total ~{have + saved}")


def main():
    verify_overrides()
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
