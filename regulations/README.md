# Regulations data service

The independent layer that sources, verifies, and publishes fishing rules
the app consumes. Built here for now; can graduate to its own repo.

## Principle

Compliance data gets people fined. **Detection is automated; publication
is gated by a human.** Nothing reaches the app without passing schema
validation and (for `verified: true`) a human check against the official
source.

```
official sources ──▶ monitor (scheduled) ──▶ proposed change (PR)
   eCFR API,                                      │
   NOAA bulletins,                          human verify + schema CI
   state pages/PDFs                               │
                                                  ▼
                                   regulations/feed/<jurisdiction>-<year>.json
                                                  │
                                          published feed URL (versioned)
                                                  │
                                   app pulls on launch, caches offline,
                                   shows value + verified + source + date
```

## Layout

- `schema.json` — JSON Schema (v1) every feed file must pass.
- `feed/<jurisdiction>-<year>.json` — the curated, versioned rules. One
  file per jurisdiction/year. This is the source of truth and the
  published artifact.

Each rule carries provenance: `source`, `lastUpdated`, `verified`, and a
`confidence` (`verified` | `partial` | `closure_confirmed_reopen_pending`
| `unconfirmed` | `not_managed`). The app renders a confident "Verified —
official" box for `verified: true`, the cautious seed box otherwise.

## How the app consumes it

`src/data.js` bundles seed values (offline floor) then overlays the feed
files (`applyFeed`). Feed wins; seed fills gaps (e.g. reef-fish gear
lists). A runtime sync that refreshes the bundled feed from the published
URL is the next step.

## Adding / updating a feed (current manual process)

1. Collect figures from official sources only (eCFR, NOAA bulletins,
   state agencies). Mark anything unconfirmed `confidence: "unconfirmed"`
   and `verified: false` — never guess.
2. Edit/create `feed/<jurisdiction>-<year>.json`.
3. `npm run validate-feeds` (schema check) must pass.
4. Commit with the source links in the message; review the diff.

## Roadmap to automation

- [x] Versioned, schema-validated feed files + app overlay
- [ ] `npm run validate-feeds` in CI on every PR
- [ ] Scheduled monitor: poll eCFR API + NOAA bulletin index, diff against
      current feed, open a PR with proposed changes + confidence flags
- [ ] Publish feed to a stable versioned URL; app runtime sync + offline cache
- [ ] Source-change alerts (hash watch on state HTML/PDF pages)
