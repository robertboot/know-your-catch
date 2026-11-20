#!/usr/bin/env python3
"""
Find EXACT-content images filed under two or more different species.

The same bytes carrying two different labels is unlearnable: the network
is told identical pixels are two things, so it learns the feature is
meaningless. Worse, if the copies land in different splits it is also
a direct train/test leak.

THIS SCRIPT NEVER DECIDES WHICH LABEL IS RIGHT. When labels conflict
there is no evidence in the pixels to adjudicate with — a human has to
look. Every conflict is written out for review and, optionally, emitted
as SQL that QUARANTINES the rows (status='rejected' with an explicit
reason) rather than deleting anything.

    python3 audit_cross_species_dupes.py            # report only
    python3 audit_cross_species_dupes.py --sql      # also write quarantine SQL
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
BASE_DIR = Path(os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"))
REPORT = HERE / "cross_species_conflicts.json"
SQL_OUT = HERE.parent / "supabase" / "quarantine-cross-species-dupes.sql"

sys.path.insert(0, str(HERE))
from build_observation_map import stable_training_id, load_species  # noqa: E402


def sha256(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sql", action="store_true",
                    help="also emit quarantine SQL for the conflicts")
    args = ap.parse_args()

    if not BASE_DIR.is_dir():
        sys.exit(f"photo root not found: {BASE_DIR}")
    primary, alias = load_species()

    by_hash = defaultdict(list)
    scanned = 0
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
        for img in sorted(images.iterdir()):
            if img.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            try:
                if img.stat().st_size == 0:
                    continue
                h = sha256(img)
            except OSError:
                continue
            scanned += 1
            by_hash[h].append({
                "species_id": species_id,
                "folder": folder.name,
                "filename": img.name,
                "training_id": stable_training_id(f"{species_id}|{img.name}"),
            })

    conflicts = []
    pairs = defaultdict(int)
    for h, members in by_hash.items():
        species = {m["species_id"] for m in members}
        if len(species) > 1:
            conflicts.append({"sha256": h, "species": sorted(species),
                              "members": members})
            for a in sorted(species):
                for b in sorted(species):
                    if a < b:
                        pairs[f"{a} | {b}"] += 1

    affected = sum(len(c["members"]) for c in conflicts)
    REPORT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "images_scanned": scanned,
        "duplicate_hashes_crossing_species": len(conflicts),
        "images_involved": affected,
        "note": "No label was auto-selected. Every entry needs human review.",
        "conflicts": conflicts,
    }, indent=1))

    print(f"images scanned                    : {scanned}")
    print(f"duplicate hashes across species   : {len(conflicts)}")
    print(f"images involved                   : {affected}")
    print(f"ALL are ambiguous — none auto-resolved (labels conflict)")
    print(f"\nspecies pairs involved ({len(pairs)}):")
    for p, c in sorted(pairs.items(), key=lambda t: -t[1])[:20]:
        print(f"  {c:>6}  {p}")
    if len(pairs) > 20:
        print(f"  … and {len(pairs)-20} more pairs")
    print(f"\nwrote {REPORT}")

    if args.sql and conflicts:
        ids = sorted({m["training_id"] for c in conflicts for m in c["members"]})
        lines = [
            "-- Quarantine cross-species EXACT duplicates for human review.",
            "--",
            "-- These images exist byte-identically under two or more species",
            "-- labels. Identical pixels with contradictory labels are",
            "-- unlearnable, and if the copies straddle a split they are also a",
            "-- direct train/test leak.",
            "--",
            "-- NOTHING IS DELETED and NO LABEL IS CHOSEN — the pixels contain",
            "-- no evidence for which species is correct. These rows are moved",
            "-- OUT of the verified set so they cannot reach training, and are",
            "-- tagged so a human can adjudicate them in the Review queue.",
            "--",
            f"-- Generated {datetime.now(timezone.utc).isoformat()} by",
            "-- training/audit_cross_species_dupes.py",
            f"-- {len(ids)} rows across {len(conflicts)} conflicting hashes.",
            "",
            "update training_images",
            "set status = 'rejected',",
            "    rejection_reason = 'cross-species duplicate — needs review'",
            "where id in (",
        ]
        lines += [f"  '{i}'{',' if n < len(ids)-1 else ''}"
                  for n, i in enumerate(ids)]
        lines += [
            ");",
            "",
            "-- Verify: expect 0 rows still verified.",
            "select count(*) as still_verified",
            "from training_images",
            "where status = 'verified'",
            f"  and id in ({', '.join(repr(i) for i in ids[:5])}"
            f"{', …' if len(ids) > 5 else ''});",
            "",
        ]
        SQL_OUT.write_text("\n".join(lines))
        print(f"wrote {SQL_OUT} ({len(ids)} rows to quarantine)")


if __name__ == "__main__":
    main()
