#!/usr/bin/env python3
"""
Per-species dataset report, generated from the persisted split manifest.

Answers, for every species that will train: how many images, how many
UNIQUE OBSERVATIONS, and how those divide across train/val/test.

The observation count is the number that matters and the one nobody was
tracking. 800 images of 40 fish is a 40-example class wearing a costume:
augmentation aside, the model sees forty animals. Image counts hid that
completely.

    python3 dataset_report.py            # table to stdout
    python3 dataset_report.py --json     # machine-readable too
"""
import argparse
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
MANIFEST = HERE / "split_manifest_v1.json"
CONFLICTS = HERE / "cross_species_conflicts.json"
OUT = HERE / "dataset_report.json"

LOW_OBS_HARD = 25      # below this a class is barely a class
LOW_OBS_SOFT = 50
MIN_IMAGES = 45        # matches train_fish_id.py DEFAULT_MIN_IMAGES


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


def species_meta():
    env = load_env()
    url = env.get("VITE_SUPABASE_URL"); key = env.get("VITE_SUPABASE_ANON_KEY")
    req = urllib.request.Request(
        url.rstrip("/") + "/rest/v1/species?select=id,common_name,scientific,is_active",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return {r["id"]: r for r in json.load(urllib.request.urlopen(req, timeout=45))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not MANIFEST.exists():
        sys.exit(f"missing {MANIFEST} — run make_split.py first")
    man = json.loads(MANIFEST.read_text())
    assignments = man["assignments"]
    groups = man.get("groups", {})
    species_of = man.get("species", {})
    meta = species_meta()

    conflicted = set()
    if CONFLICTS.exists():
        c = json.loads(CONFLICTS.read_text())
        for grp in c.get("conflicts", []):
            for m in grp["members"]:
                conflicted.add(m["training_id"])

    per = defaultdict(lambda: {
        "images": 0, "train": 0, "val": 0, "test": 0,
        "obs": set(), "obs_train": set(), "obs_val": set(), "obs_test": set(),
        "conflicts": 0,
    })
    for iid, bucket in assignments.items():
        sid = species_of.get(iid, "?")
        gk = groups.get(iid, f"self:{iid}")
        d = per[sid]
        d["images"] += 1
        d[bucket] += 1
        d["obs"].add(gk)
        d[f"obs_{bucket}"].add(gk)
        if iid in conflicted:
            d["conflicts"] += 1

    rows = []
    for sid, d in per.items():
        m = meta.get(sid, {})
        rows.append({
            "species_id": sid,
            "common_name": m.get("common_name") or "(not in species table)",
            "scientific": m.get("scientific") or "",
            "total_images": d["images"],
            "unique_observations": len(d["obs"]),
            "train_images": d["train"], "val_images": d["val"], "test_images": d["test"],
            "train_observations": len(d["obs_train"]),
            "val_observations": len(d["obs_val"]),
            "test_observations": len(d["obs_test"]),
            "duplicate_conflicts": d["conflicts"],
            "flags": [],
        })

    imgs = [r["total_images"] for r in rows] or [0]
    median = sorted(imgs)[len(imgs) // 2]
    for r in rows:
        if r["unique_observations"] < LOW_OBS_HARD:
            r["flags"].append(f"<{LOW_OBS_HARD}_observations")
        elif r["unique_observations"] < LOW_OBS_SOFT:
            r["flags"].append(f"<{LOW_OBS_SOFT}_observations")
        if r["total_images"] < MIN_IMAGES:
            r["flags"].append("below_min_images_will_be_dropped")
        if median and r["total_images"] > median * 5:
            r["flags"].append("major_imbalance_high")
        if median and r["total_images"] * 5 < median:
            r["flags"].append("major_imbalance_low")
        if r["duplicate_conflicts"]:
            r["flags"].append("unresolved_duplicate_conflicts")
        if not r["scientific"]:
            r["flags"].append("suspected_contamination_no_scientific_name")
        if not (r["train_images"] and r["val_images"] and r["test_images"]):
            r["flags"].append("cannot_fill_all_three_splits")

    rows.sort(key=lambda r: r["unique_observations"])

    print(f"{'species_id':<26}{'imgs':>6}{'obs':>6}{'tr':>6}{'va':>5}{'te':>5}"
          f"{'trObs':>7}{'vaObs':>6}{'teObs':>6}  flags")
    for r in rows:
        print(f"{r['species_id']:<26}{r['total_images']:>6}{r['unique_observations']:>6}"
              f"{r['train_images']:>6}{r['val_images']:>5}{r['test_images']:>5}"
              f"{r['train_observations']:>7}{r['val_observations']:>6}"
              f"{r['test_observations']:>6}  {','.join(r['flags'])}")

    def count(flag):
        return sum(1 for r in rows if flag in r["flags"])

    print(f"\nSPECIES: {len(rows)}   median images/species: {median}")
    print(f"  <{LOW_OBS_HARD} observations                 : {count(f'<{LOW_OBS_HARD}_observations')}")
    print(f"  <{LOW_OBS_SOFT} observations                 : {count(f'<{LOW_OBS_SOFT}_observations')}")
    print(f"  below {MIN_IMAGES}-image floor (dropped)    : {count('below_min_images_will_be_dropped')}")
    print(f"  major imbalance (high)             : {count('major_imbalance_high')}")
    print(f"  unresolved duplicate conflicts     : {count('unresolved_duplicate_conflicts')}")
    print(f"  no scientific name                 : {count('suspected_contamination_no_scientific_name')}")
    print(f"  cannot fill all three splits       : {count('cannot_fill_all_three_splits')}")

    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "split_manifest_version": man.get("version"),
        "median_images_per_species": median,
        "species": rows,
    }, indent=1))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
