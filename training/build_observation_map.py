#!/usr/bin/env python3
"""
Build a training_images.id -> iNaturalist observation_id map.

WHY THIS IS NEEDED
    training_images has no observation_id column. Its rows are keyed by
    a UUID derived from the ORIGINAL FILENAME:

        id = SHA1(f"{species_id}|{filename}") folded into UUID shape
             (src/training-store.js stableTrainingId / stableKey)

    The iNat fetcher names files "{slug}_{photo_id}.jpg", and each
    species folder's metadata.csv carries photo_id -> observation_id.
    Chaining those two facts recovers the observation for every scraped
    image, which is what an observation-aware split requires.

    Images NOT from the iNat scrape (owner uploads, model feedback)
    have no observation and are reported separately — the splitter
    treats each as its own singleton group.

OUTPUT
    training/observation_map.json
      {
        "generated_at": "...",
        "source": "inat-metadata-csv",
        "map": { "<training_image_id>": "inat:<observation_id>", ... },
        "unmatched_files": N,
        "species_without_metadata": [...]
      }

READ-ONLY with respect to the database. Only reads local files and the
species list.

    python3 build_observation_map.py
"""
import csv
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"))
OUT = Path(__file__).parent / "observation_map.json"


def load_env():
    path = Path(__file__).parent.parent / ".env.local"
    env = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def stable_training_id(key: str) -> str:
    """Exact port of src/training-store.js stableTrainingId().

        const hex = sha1(utf8(key)).toString('hex')
        `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-
         ${hex.slice(16,20)}-${hex.slice(20,32)}`

    Note it does NOT force the RFC-4122 version/variant bits — it is a
    UUID-SHAPED string, not a real v4/v5 UUID. Setting those bits (the
    obvious "correction") changes two nibbles and silently breaks every
    lookup, so the shape is reproduced verbatim. Verified against the JS
    in tests/test_stable_id_parity.mjs.
    """
    hx = hashlib.sha1(key.encode("utf-8")).hexdigest()
    return f"{hx[0:8]}-{hx[8:12]}-{hx[12:16]}-{hx[16:20]}-{hx[20:32]}"


def load_species():
    env = load_env()
    url = env.get("VITE_SUPABASE_URL"); key = env.get("VITE_SUPABASE_ANON_KEY")
    if not url or not key:
        sys.exit("No Supabase creds in .env.local")
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/species?select=id,common_name,alt_names,is_active",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    rows = json.load(urllib.request.urlopen(req, timeout=45))
    primary, alias = {}, {}
    for r in rows:
        if r.get("is_active") is False:
            continue
        primary[r["common_name"].strip().lower()] = r["id"]
        for a in (r.get("alt_names") or []):
            alias.setdefault(a.strip().lower(), r["id"])
    return primary, alias


def main():
    if not BASE_DIR.is_dir():
        sys.exit(f"Photo root not found: {BASE_DIR}")
    primary, alias = load_species()

    obs_map = {}
    unmatched = 0
    no_meta = []
    folders = 0

    for folder in sorted(BASE_DIR.iterdir()):
        if not folder.is_dir() or folder.name.startswith("_"):
            continue
        images = folder / "images"
        if not images.is_dir():
            continue
        key = folder.name.strip().lower()
        species_id = primary.get(key) or alias.get(key)
        if not species_id:
            continue
        folders += 1

        meta = folder / "metadata.csv"
        if not meta.exists():
            no_meta.append(folder.name)
            continue

        # photo_id -> observation_id from this species' metadata
        photo_to_obs = {}
        try:
            with open(meta, newline="") as f:
                for row in csv.DictReader(f):
                    pid = (row.get("photo_id") or "").strip()
                    oid = (row.get("observation_id") or "").strip()
                    if pid and oid:
                        photo_to_obs[pid] = oid
        except Exception as e:
            print(f"  ! {folder.name}: unreadable metadata.csv ({e})")
            no_meta.append(folder.name)
            continue

        for img in sorted(images.iterdir()):
            if img.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            m = re.search(r"_(\d+)\.[a-z]+$", img.name, re.I)
            if not m:
                unmatched += 1
                continue
            oid = photo_to_obs.get(m.group(1))
            if not oid:
                unmatched += 1
                continue
            tid = stable_training_id(f"{species_id}|{img.name}")
            obs_map[tid] = f"inat:{oid}"

    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "inat-metadata-csv",
        "key_format": "stableTrainingId(f'{species_id}|{filename}')",
        "map": obs_map,
        "unmatched_files": unmatched,
        "species_without_metadata": sorted(no_meta),
        "folders_scanned": folders,
    }, indent=1))

    print(f"folders scanned          : {folders}")
    print(f"images mapped to an obs  : {len(obs_map)}")
    print(f"unique observations      : {len(set(obs_map.values()))}")
    print(f"files with no obs match  : {unmatched}")
    print(f"folders lacking metadata : {len(no_meta)}")
    if no_meta:
        for n in no_meta[:10]:
            print(f"    {n}")
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
