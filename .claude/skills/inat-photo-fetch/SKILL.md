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

## What it does automatically (the two things people ask about)

1. **Only fetches species that need more.** A species whose `images/` folder
   already has `TARGET_PER_SPECIES` (default **750**) photos is skipped
   (`"already has N images, skipping"`). Everything below target gets topped up.
2. **Never re-picks a previous photo.** Each iNat photo has a unique photo ID;
   files are saved as `<slug>_<photoID>.jpg`. Before downloading it checks if
   that exact file exists and skips if so. **Requirement: keep the existing
   `images/` folders in place** — that on-disk history is how it knows what it
   already has. Moving/renaming/clearing them defeats the de-dupe.

## Config knobs (top of the script)

- `TARGET_PER_SPECIES = 750` — per-species ceiling; lower it to fetch fewer.
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — fill both to pull the **live** species
  list (includes admin-added species). Blank → bundled built-in list only.
  Use the anon / `sb_publishable_...` key (public), never the service_role key.
- `ALLOWED` licenses: `cc0`, `cc-by`, `cc-by-nc`. `MAX_PAGES`, `SLEEP_BETWEEN_CALLS`
  are polite-API limits — leave them.
- `SKIP_COMMON` — common names to skip (e.g. a folder finished under another name).

## Gotchas

- Photos go to `~/Library/Mobile Documents/com~apple~CloudDocs/Reel Intel/Fish ID
  Model` (`BASE_DIR`), not the repo. iCloud must be signed in on that Mac.
- Species with no `scientific` name are skipped (iNat query is by scientific name).
- It prints each species' running count, so the console log is the report of what
  still needs images.
