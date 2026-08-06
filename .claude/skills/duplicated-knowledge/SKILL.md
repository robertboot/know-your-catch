---
name: duplicated-knowledge
description: Use when adding to or changing a list/rule that exists in more than one place — jurisdictions, species categories, model labels, cron definitions, photo rendering. Three production bugs in one week came from copies drifting apart.
---

# Duplicated knowledge

Three separate production bugs in one week, all the same shape: the same
knowledge lived in two or more places, the copies drifted, and nothing
failed until a user noticed.

| Bug | Duplication |
|---|---|
| Florida Atlantic + Federal South Atlantic had **no regulation data at all** | Jurisdictions listed in `src/data.js` AND in `supabase/functions/_shared/regs-shared.ts`. Added to the first only, so the auto-updater never queued a single pair. |
| Admin-only "misc" bucket appeared in user-facing lists | "Is this visible to an angler?" inlined at **13** call sites; two checked only `active !== false` and missed `_`-prefixed ids/categories. |
| Logbook + Home thumbnails showed broken images | Photo resolution written at **5** render sites. Fixed four; the fifth needed its own build. |

In every case there was a comment saying the copies had to match. **A
comment is not a check.**

## The rule

If you add to a list or change a rule, ask: *does this exist anywhere
else?* Then either

1. **Collapse it** to one source and import it (best) — e.g.
   `isAnglerVisible()` in `helpers.js` replaced 13 inlined filters, or
2. **Assert it** in `scripts/check-parity.mjs` if a second copy is
   genuinely unavoidable (the edge functions can't import from `src/`,
   so jurisdictions must be duplicated — but the copies are now checked).

`npm run check` runs those assertions and is the first step of
`npm run ios:ship`, so a drift fails the ship rather than reaching a user.

## Known duplications in this repo

| Knowledge | Copies | Guarded? |
|---|---|---|
| Jurisdictions | `src/data.js`, `supabase/functions/_shared/regs-shared.ts` | yes — parity check |
| Angler visibility | `isAnglerVisible()` in `helpers.js` | yes — check rejects re-inlining |
| Photo resolution | `PhotoImg` in `components.jsx` | yes — check rejects raw `<img>` |
| SST colour range | `src/screens_ocean.jsx`, `supabase/functions/refresh-ocean-maps` | **no** — add a rule if it drifts |
| Species categories | `src/data.js` + live Supabase `species` table | **no** — cloud overlay assigns `_admin` on mismatch |
| Updater grid definition | `adminRegsCoverage()` in `regulations-store.js`, `auto-update-regulations/index.ts` | **no** — both must filter live species by `is_active !== false` and exclude `category === 'bait'`; if they drift the coverage tile reports progress against a grid the cron isn't working |

A fourth instance of the same shape, worth naming because it was a
*comment* that drifted rather than code: `regulations-auto-update-schema.sql`
still says the grid is "95 species × 6 jurisdictions ≈ 570 pairs". It is
164 × 8 = 1312. Nothing broke, but any cadence or cost estimate taken
from that comment is wrong by 2.3×. Stale comments about magnitudes are
duplicated knowledge too.

## When adding a check

Verify it FAILS on the real bug before trusting it. Re-introduce the
defect, confirm a non-zero exit naming the problem and the fix, then
restore. A check that has only ever passed proves nothing — that step is
what confirmed the jurisdiction rule actually worked.
