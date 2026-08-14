#!/usr/bin/env python3
"""De-duplicate the iNaturalist photo folders by IMAGE CONTENT.

Why this exists: the fetcher skips a photo it has already downloaded *by
iNaturalist photo ID*, and the admin importer skips a file it has already
uploaded *by filename*. Neither looks at the actual pixels. iNaturalist
routinely serves the SAME physical image under several different photo
IDs (one shot attached to multiple observations, re-uploads, etc.), so
byte-identical duplicates slip past both checks — thousands of them.

This walks every species' images/ folder, groups files by a SHA-256 of
their bytes, keeps ONE file per unique image, and removes the rest. The
metadata.csv rows for removed files are dropped too, so the CSV stays in
sync.

Safe by default: it PREVIEWS what it would remove and changes nothing.
Add --apply to actually delete. Duplicates are moved to a per-species
`_dupes/` trash folder (not hard-deleted) unless you also pass --hard.

    cd ~/know-your-catch/training
    python3 dedupe_photos.py            # preview only
    python3 dedupe_photos.py --apply    # move dupes to _dupes/
    python3 dedupe_photos.py --apply --hard   # delete dupes outright

Keeps the copy with the SHORTEST filename (the earliest/most canonical
one is usually shortest), deterministically, so re-running is stable.
"""

import csv
import hashlib
import os
import shutil
import sys

BASE_DIR = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID Model"
)
IMG_EXTS = (".jpg", ".jpeg", ".png")


def file_hash(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def dedupe_species(img_dir, apply_changes, hard):
    """Returns (kept, removed, removed_names)."""
    files = [f for f in os.listdir(img_dir)
             if f.lower().endswith(IMG_EXTS)]
    by_hash = {}
    for name in files:
        p = os.path.join(img_dir, name)
        if not os.path.isfile(p):
            continue
        try:
            digest = file_hash(p)
        except OSError as e:
            print(f"    ! could not read {name}: {e}")
            continue
        by_hash.setdefault(digest, []).append(name)

    removed_names = []
    for digest, names in by_hash.items():
        if len(names) == 1:
            continue
        # Keep the shortest name (ties broken alphabetically) — stable
        # across re-runs. Everything else is a byte-identical duplicate.
        names_sorted = sorted(names, key=lambda n: (len(n), n))
        keep, dupes = names_sorted[0], names_sorted[1:]
        removed_names.extend(dupes)
        if apply_changes:
            for d in dupes:
                src = os.path.join(img_dir, d)
                if hard:
                    os.remove(src)
                else:
                    trash = os.path.join(os.path.dirname(img_dir), "_dupes")
                    os.makedirs(trash, exist_ok=True)
                    shutil.move(src, os.path.join(trash, d))

    kept = len(by_hash)
    return kept, len(removed_names), set(removed_names)


def prune_metadata(sp_dir, removed_names):
    """Drop metadata.csv rows whose filename was removed."""
    meta_path = os.path.join(sp_dir, "metadata.csv")
    if not removed_names or not os.path.exists(meta_path):
        return
    with open(meta_path, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = [r for r in reader if r.get("filename") not in removed_names]
    if not fieldnames:
        return
    with open(meta_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main():
    apply_changes = "--apply" in sys.argv
    hard = "--hard" in sys.argv
    if not os.path.isdir(BASE_DIR):
        raise SystemExit(f"Base folder not found: {BASE_DIR}")

    mode = ("APPLY (hard delete)" if apply_changes and hard else
            "APPLY (move to _dupes/)" if apply_changes else
            "PREVIEW (no changes)")
    print(f"De-dupe by image content — {mode}")
    print(f"Base: {BASE_DIR}\n")

    total_dupes = 0
    total_kept = 0
    species_dirs = sorted(
        d for d in os.listdir(BASE_DIR)
        if os.path.isdir(os.path.join(BASE_DIR, d))
    )
    for sp in species_dirs:
        img_dir = os.path.join(BASE_DIR, sp, "images")
        if not os.path.isdir(img_dir):
            continue
        kept, removed, removed_names = dedupe_species(img_dir, apply_changes, hard)
        total_kept += kept
        total_dupes += removed
        if removed:
            print(f"  {sp}: {kept} unique, {removed} duplicate(s) "
                  f"{'removed' if apply_changes else 'to remove'}")
            if apply_changes:
                prune_metadata(os.path.join(BASE_DIR, sp), removed_names)

    print(f"\n{'Removed' if apply_changes else 'Would remove'} "
          f"{total_dupes} duplicate image(s); {total_kept} unique kept.")
    if not apply_changes and total_dupes:
        print("Re-run with --apply to move them to each species' _dupes/ "
              "folder (or --apply --hard to delete outright).")


if __name__ == "__main__":
    main()
