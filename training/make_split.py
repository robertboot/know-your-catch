#!/usr/bin/env python3
"""
Observation-aware, deterministic 80/10/10 split -> versioned manifest.

WHAT THIS REPLACES
    src/training-store.js planExport() split each species 85/15 RANDOMLY
    BY IMAGE. iNaturalist attaches several photos to one observation —
    the same fish, same minute, same lighting — so near-identical frames
    landed on both sides. Measured on the current scrape: 94,111 mapped
    images across 58,387 observations, i.e. ~35,700 images share an
    observation with at least one other. Every accuracy figure the
    project has produced was measured across that leak.

GROUPING KEY, in order of strength:
    1. inat:<observation_id>  — from training/observation_map.json
    2. self:<image_id>        — fallback singleton for anything with no
                                recoverable observation (owner uploads,
                                model feedback). Reported explicitly,
                                never silently.

    A whole group always lands in exactly one split.

WHY A PERSISTED MANIFEST
    A split that is recomputed from a seed is only stable while the
    inputs and the code are. Adding one photo to a species reshuffles
    that species and quietly moves images across the train/test line,
    which invalidates every comparison against earlier runs. So the
    ASSIGNMENTS are written out and become the source of truth: later
    runs read this file, and only images absent from it are assigned.

    python3 make_split.py            # write the manifest
    python3 make_split.py --report   # read-only summary of an existing one
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
OBS_MAP = HERE / "observation_map.json"
MANIFEST = HERE / "split_manifest_v1.json"

TRAIN_FRAC, VAL_FRAC = 0.80, 0.10      # test gets the remainder
SPLIT_SALT = "reelintel-split-v1"      # bump = deliberate re-split


def load_env():
    p = HERE.parent / ".env.local"
    env = {}
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def service_key():
    """training_images is RLS-protected; the anon key returns 0 rows.
    Pull the service_role key from the authenticated Supabase CLI rather
    than ever putting it in a file or in chat."""
    import subprocess
    out = subprocess.run(
        ["supabase", "projects", "api-keys", "--project-ref",
         "hfptpsmdfemduhkueyoz", "--output", "json"],
        capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("supabase CLI not authenticated — run `supabase login`")
    for k in json.loads(out.stdout):
        if k.get("name") == "service_role":
            return k["api_key"]
    sys.exit("service_role key not found")


def fetch_verified(key):
    url = "https://hfptpsmdfemduhkueyoz.supabase.co/rest/v1/training_images"
    rows, frm = [], 0
    while True:
        req = urllib.request.Request(
            f"{url}?select=id,species_id&status=eq.verified&order=id"
            f"&offset={frm}&limit=1000",
            headers={"apikey": key, "Authorization": f"Bearer {key}"})
        page = json.load(urllib.request.urlopen(req, timeout=90))
        rows.extend(page)
        if len(page) < 1000:
            break
        frm += 1000
    return rows


def bucket_for(group_key: str) -> str:
    """Deterministic split from a hash of the GROUP key.

    Hash-based rather than shuffle-and-slice on purpose: the assignment
    of a group depends only on that group's own name, so adding or
    removing other groups cannot move it. Shuffling would re-seat
    everything whenever the dataset changed.
    """
    h = hashlib.sha256(f"{SPLIT_SALT}|{group_key}".encode()).digest()
    # 53-bit int -> [0,1), plenty of resolution for three buckets
    v = int.from_bytes(h[:7], "big") / float(1 << 56)
    if v < TRAIN_FRAC:
        return "train"
    if v < TRAIN_FRAC + VAL_FRAC:
        return "val"
    return "test"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true",
                    help="summarise the existing manifest, write nothing")
    args = ap.parse_args()

    if args.report:
        if not MANIFEST.exists():
            sys.exit(f"no manifest at {MANIFEST}")
        man = json.loads(MANIFEST.read_text())
        summarise(man)
        return

    if not OBS_MAP.exists():
        sys.exit(f"missing {OBS_MAP} — run build_observation_map.py first")
    obs = json.loads(OBS_MAP.read_text())["map"]

    print("Fetching verified training_images…", flush=True)
    rows = fetch_verified(service_key())
    print(f"  {len(rows)} verified rows", flush=True)

    prior = {}
    if MANIFEST.exists():
        prior = json.loads(MANIFEST.read_text()).get("assignments", {})
        print(f"  {len(prior)} assignments carried forward from the existing "
              f"manifest", flush=True)

    assignments, groups, fallback = {}, {}, 0
    for r in rows:
        iid = r["id"]
        gk = obs.get(iid)
        if not gk:
            gk = f"self:{iid}"
            fallback += 1
        groups[iid] = gk
        # An existing assignment WINS. Re-deriving it would silently move
        # images across the train/test boundary whenever the salt or the
        # fractions changed, invalidating comparisons to earlier runs.
        assignments[iid] = prior.get(iid) or bucket_for(gk)

    # A group must never straddle splits. Prior assignments can disagree
    # if a group gained members after the last manifest was written, so
    # force the whole group to its majority-existing bucket.
    by_group = defaultdict(list)
    for iid, gk in groups.items():
        by_group[gk].append(iid)
    repaired = 0
    for gk, members in by_group.items():
        buckets = {assignments[i] for i in members}
        if len(buckets) > 1:
            counts = defaultdict(int)
            for i in members:
                counts[assignments[i]] += 1
            winner = max(sorted(counts), key=lambda b: counts[b])
            for i in members:
                if assignments[i] != winner:
                    assignments[i] = winner
                    repaired += 1

    species = {r["id"]: r["species_id"] for r in rows}
    man = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "salt": SPLIT_SALT,
        "fractions": {"train": TRAIN_FRAC, "val": VAL_FRAC,
                      "test": round(1 - TRAIN_FRAC - VAL_FRAC, 4)},
        "grouping": "inat observation id where recoverable, else per-image singleton",
        "counts": {"images": len(assignments),
                   "groups": len(by_group),
                   "singleton_fallback_images": fallback,
                   "group_conflicts_repaired": repaired},
        "assignments": assignments,
        "groups": groups,
        "species": species,
    }
    MANIFEST.write_text(json.dumps(man, indent=1))
    print(f"\nwrote {MANIFEST}")
    summarise(man)


def summarise(man):
    assignments = man["assignments"]
    groups = man.get("groups", {})
    species = man.get("species", {})

    per_split = defaultdict(int)
    obs_per_split = defaultdict(set)
    sp_per_split = defaultdict(lambda: defaultdict(int))
    sp_obs = defaultdict(lambda: defaultdict(set))

    for iid, sp in assignments.items():
        pass
    for iid, bucket in assignments.items():
        per_split[bucket] += 1
        gk = groups.get(iid, f"self:{iid}")
        obs_per_split[bucket].add(gk)
        s = species.get(iid, "?")
        sp_per_split[s][bucket] += 1
        sp_obs[s][bucket].add(gk)

    total = sum(per_split.values()) or 1
    print("\nIMAGES PER SPLIT")
    for b in ("train", "val", "test"):
        print(f"  {b:<6} {per_split[b]:>7}  ({per_split[b]/total:5.1%})   "
              f"{len(obs_per_split[b]):>6} unique groups")

    # Leakage assertion — the whole point of the exercise.
    overlap = (obs_per_split["train"] & obs_per_split["val"]) \
        | (obs_per_split["train"] & obs_per_split["test"]) \
        | (obs_per_split["val"] & obs_per_split["test"])
    print(f"\n  GROUP OVERLAP ACROSS SPLITS: {len(overlap)} "
          f"{'<-- LEAK' if overlap else '(none — correct)'}")

    incomplete = [s for s, d in sp_per_split.items()
                  if not (d["train"] and d["val"] and d["test"])]
    print(f"\nSPECIES: {len(sp_per_split)} total, "
          f"{len(incomplete)} cannot fill all three splits")
    for s in sorted(incomplete)[:25]:
        d = sp_per_split[s]
        print(f"    {s:<28} train={d['train']:<5} val={d['val']:<4} test={d['test']}")
    if len(incomplete) > 25:
        print(f"    … and {len(incomplete)-25} more")


if __name__ == "__main__":
    main()
