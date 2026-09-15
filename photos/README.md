# Photo database

The labeled fish-photo set. Two purposes: (1) show a real photo in the
app where we have one; (2) become the training set for the on-device
identification model later.

## Model

`manifest.json` (schema in `schema.json`, checked by `npm run
validate-photos`) holds one entry per species:

- `primary`: `proprietary` | `fallback` | `none`
- `proprietary`: repo path under `photos/proprietary/` (owned imagery)
- `fallback`: `{ url, credit, license }` — a licensed external photo,
  shown with its **required attribution**. Use only properly licensed
  sources (NOAA imagery is public domain; otherwise CC/Wikimedia with
  credit). Never an unlicensed scrape.
- `none`: the app draws its `FishMark` illustration.

App display today uses the licensed `fallback` photo when present
(`speciesPhoto()` in `src/helpers.js`); wiring proprietary files into
the build (copy to served assets) is the documented next step.

## Backend (admin)

`admin/index.html` is the management site — a single static, dependency-
free page. It runs in the operator's browser and commits straight to
GitHub via a fine-grained token (Contents: read/write). No server to
run or secure; Git is the database (history, review, rollback). It
manages this manifest **and** the regulation feed files
(`regulations/feed/*.json`, schema-checked on commit and again in CI).

Open it from the hosted site or directly; paste a token, Connect, edit,
commit. Tradeoffs: single-operator (token, not accounts); large photo
sets should later move to object storage/CDN rather than the repo.
