#!/usr/bin/env python3
"""
READ-ONLY near-duplicate audit. Deletes nothing.

Exact duplicates are handled elsewhere (dedupe_photos.py within species,
audit_cross_species_dupes.py across species). This finds the ones a
byte hash cannot: re-encodes, resizes, crops, and successive frames of
the same fish — images that are visually the same but differ in bytes.

METHOD: 64-bit dHash (difference hash) on an 8x9 greyscale reduction,
grouped by exact hash equality. dHash is chosen over aHash/pHash for
being cheap and robust to scale and mild compression; exact-equality
grouping is chosen over a Hamming-radius search because the latter is
O(n^2) over ~95k images. That means this UNDER-reports — near-misses at
Hamming distance 1-4 are not found. It is a floor on the problem, not a
census, and is labelled as such rather than presented as complete.

The finding that matters is a near-duplicate group whose members land in
DIFFERENT splits: that is a train/test leak that survives the
observation-aware split, because two photographers can upload the same
image under different observation ids.

    python3 audit_near_duplicates.py
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
BASE_DIR = Path(os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"))
REPORT = HERE / "near_duplicate_report.json"
MANIFEST = HERE / "split_manifest_v1.json"

sys.path.insert(0, str(HERE))
from build_observation_map import stable_training_id, load_species  # noqa: E402


def dhash(path, size=8):
    """64-bit difference hash. Returns None if unreadable."""
    from PIL import Image
    try:
        with Image.open(path) as im:
            im = im.convert("L").resize((size + 1, size), Image.BILINEAR)
            px = list(im.getdata())
    except Exception:
        return None
    bits = 0
    for row in range(size):
        base = row * (size + 1)
        for col in range(size):
            bits = (bits << 1) | (1 if px[base + col] < px[base + col + 1] else 0)
    return f"{bits:016x}"


def main():
    if not BASE_DIR.is_dir():
        sys.exit(f"photo root not found: {BASE_DIR}")
    primary, alias = load_species()

    assignments = {}
    if MANIFEST.exists():
        assignments = json.loads(MANIFEST.read_text()).get("assignments", {})
        print(f"split manifest: {len(assignments)} assignments loaded")
    else:
        print("WARNING: no split manifest — cross-split leakage cannot be "
              "reported, only near-duplicate groups.")

    by_hash = defaultdict(list)
    scanned = unreadable = 0
    for folder in sorted(BASE_DIR.iterdir()):
        if not folder.is_dir() or folder.name.startswith("_"):
            continue
        images = folder / "images"
        if not images.is_dir():
            continue
        key = folder.name.strip().lower()
        sid = primary.get(key) or alias.get(key)
        if not sid:
            continue
        for img in sorted(images.iterdir()):
            if img.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            h = dhash(img)
            if h is None:
                unreadable += 1
                continue
            scanned += 1
            tid = stable_training_id(f"{sid}|{img.name}")
            by_hash[h].append({
                "species_id": sid, "filename": img.name, "training_id": tid,
                "split": assignments.get(tid),
            })
        print(f"  {folder.name}: {scanned} hashed", flush=True)

    groups = {h: m for h, m in by_hash.items() if len(m) > 1}

    cross_split, cross_species, within = [], [], []
    for h, members in groups.items():
        splits = {m["split"] for m in members if m["split"]}
        species = {m["species_id"] for m in members}
        entry = {"dhash": h, "size": len(members),
                 "splits": sorted(s for s in splits),
                 "species": sorted(species), "members": members}
        if len(splits) > 1:
            cross_split.append(entry)
        if len(species) > 1:
            cross_species.append(entry)
        if len(splits) <= 1 and len(species) <= 1:
            within.append(entry)

    REPORT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "64-bit dHash, exact-equality grouping",
        "known_limitation": ("Hamming-distance near-misses (1-4 bits) are NOT "
                             "detected — this is a floor on the problem, not a census."),
        "images_hashed": scanned,
        "unreadable": unreadable,
        "near_duplicate_groups": len(groups),
        "groups_crossing_splits": len(cross_split),
        "groups_crossing_species": len(cross_species),
        "cross_split_groups": cross_split,
        "cross_species_groups": cross_species[:500],
        # EVERY multi-member near-dup group (compact) so merge_near_dup_splits.py
        # can treat near-dup groups as a grouping constraint alongside
        # observations and consolidate each connected component into ONE split
        # in a single deterministic pass — without a within-split group later
        # becoming a NEW cross-split leak.
        "all_groups": [
            {"dhash": h,
             "members": [{"training_id": m["training_id"], "split": m["split"]}
                         for m in members]}
            for h, members in groups.items()
        ],
    }, indent=1))

    print(f"\nimages hashed              : {scanned}")
    print(f"unreadable                 : {unreadable}")
    print(f"near-duplicate groups      : {len(groups)}")
    print(f"  crossing TRAIN/VAL/TEST  : {len(cross_split)}  <-- leak candidates")
    print(f"  crossing species labels  : {len(cross_species)}")
    print(f"  contained within a split : {len(within)}")
    print(f"\nNOTHING DELETED. wrote {REPORT}")


if __name__ == "__main__":
    main()
