---
name: inat-photo-fetch
description: Top up training photos from iNaturalist for species that are below the per-species target. Use when the user wants more Fish-ID training images, to re-run the iNat scraper, or asks which species still need photos.
---

# iNaturalist photo fetch (top-up)

Script: `training/fetch_inat_photos.py`. It scrapes research-grade,
permissively-licensed photos into per-species folders under the iCloud
`Fish ID Model` dir. Part of the larger `model-pipeline` (dataset → Colab →
import → promote).

## Run it

```bash
cd ~/know-your-catch/training
python3 fetch_inat_photos.py
```

Re-running is always safe. No flags needed — it self-targets and de-dupes.

## What it does automatically (the things people ask about)

1. **Only fetches species that need more.** A species whose `images/` folder
   already has `TARGET_PER_SPECIES` (default **1000**) photos is skipped
   (`"already has N images, skipping"`). Everything below target gets topped up.
2. **Never re-picks a previous photo ID.** Each iNat photo has a unique photo
   ID; files are saved as `<slug>_<photoID>.jpg`. Before downloading it checks
   if that exact file exists and skips if so. **Requirement: keep the existing
   `images/` folders in place** — that on-disk history is how it knows what it
   already has. Moving/renaming/clearing them defeats the de-dupe.
3. **Rejects byte-identical images (same photo, new photo ID).** iNaturalist
   serves the SAME physical image under many different photo IDs (one shot on
   multiple observations, re-uploads). Those pass the photo-ID check above and
   the admin importer's filename check, so without a content check you get
   thousands of visual duplicates. The fetcher now hashes every download and
   discards one whose bytes match an image already in the folder
   (`"N byte-identical duplicate(s) discarded"`).

## Cleaning duplicates already on disk

If folders were built before the content check existed, run the de-dupe pass
once to purge the byte-identical copies:

```bash
cd ~/know-your-catch/training
python3 dedupe_photos.py            # preview — changes nothing
python3 dedupe_photos.py --apply    # move dupes to each species' _dupes/
python3 dedupe_photos.py --apply --hard   # delete outright
```

It groups each `images/` folder by SHA-256 of the file bytes, keeps one copy
(shortest filename, deterministic), removes the rest, and prunes the matching
`metadata.csv` rows so the CSV stays in sync. Run this **before** re-importing
into the admin so the duplicates never reach Supabase.

Note the importer de-dupes only by `speciesId|filename` (a re-import of the
exact same file is skipped), and `training_images` stores no photo-ID/hash
column — so content de-dupe has to happen on disk, here, before upload.

## Config knobs (top of the script)

- `TARGET_PER_SPECIES = 750` — per-species ceiling; lower it to fetch fewer.
- Species list is the **live admin list by default**: project URL is pre-filled
  and the anon key auto-resolves from env (`SUPABASE_ANON_KEY` /
  `VITE_SUPABASE_ANON_KEY`) or the repo's `../.env.local`. No editing needed if
  `.env.local` exists. Falls back to the bundled built-in list only if no key is
  found. Never put the service_role key here — anon/publishable only.
- `ALLOWED` licenses: `cc0`, `cc-by`, `cc-by-nc`. `MAX_PAGES`, `SLEEP_BETWEEN_CALLS`
  are polite-API limits — leave them.
- `SKIP_COMMON` — common names to skip (e.g. a folder finished under another name).

## Gotchas

- Photos go to `~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID
  Model` (`BASE_DIR`), not the repo. iCloud must be signed in on that Mac.
- Species with no `scientific` name are skipped (iNat query is by scientific name).
- It prints each species' running count, so the console log is the report of what
  still needs images.
