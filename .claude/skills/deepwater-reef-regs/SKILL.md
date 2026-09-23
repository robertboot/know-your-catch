---
name: deepwater-reef-regs
description: Sanity-check deep-water grouper and tilefish regulations across ALL Gulf + Florida jurisdictions. Use whenever adding/editing reef-species regs or when a deep-water species shows "Season Varies".
---

# Deep-water grouper & tilefish regs (Gulf vs Atlantic)

These species keep getting seeded as `open: 'Check current season'` → the app
shows **"Season Varies"**, which is wrong for the Gulf. In the **Gulf of Mexico
(GMFMC)** the deep-water reef complex is generally **OPEN YEAR-ROUND** under
aggregate limits. The **South Atlantic (SAFMC)** is much stricter (quotas,
seasonal closures, some no-harvest). Apply the Gulf rule to **every Gulf
jurisdiction** — not just Alabama.

## Jurisdictions
- **Gulf (year-round rules apply):** `fed_gulf` default, plus `al_state`,
  `fl_state` (FL **Gulf**), `ms_state`, `la_state`, `tx_state` — all follow
  federal Gulf deep-water rules.
- **Atlantic (stricter — keep verify/seasonal):** `fed_satlantic` and
  `fl_atlantic` follow SAFMC. Always add a `fed_satlantic` override rather than
  letting the year-round Gulf default leak to the Atlantic.

## Deep-water GROUPER — Gulf: open year-round
Aggregate: **4-fish/person/day deep-water grouper aggregate** (snowy, yellowedge,
warsaw, speckled hind, misty combined). No min size. Reef gear (non-stainless
circle hooks w/ natural bait, descending device, venting tool).
- `snowy_grouper`, `yellowedge_grouper`, `misty_grouper` → `open: 'Year-round'`, `bagLimit: 4`.
- **`warsaw_grouper` & `speckled_hind` are the exceptions:** Gulf = **1 per VESSEL
  per day** (combined, not per person) → `bagLimit: 1` with a per-vessel note.
  South Atlantic = **no harvest** (`open: 'No harvest'`, `bagLimit: 0`).

## TILEFISH — Gulf: open year-round
Aggregate: **20-reef-fish/person/day**. No min size. Reef gear.
- `golden_tilefish`, `blueline_tilefish` → `open: 'Year-round'`, `bagLimit: 20`.
- `fed_satlantic`: stricter — blueline is ~3/day + season-managed in the SA.
- **Goldface tilefish** (Caulolatilus chrysops) is NOT yet a species in
  `data.js` — add it if you want it listed (Gulf: same year-round / 20-reef rule).

## Where to edit
Seed regs live in `src/data.js` in the `R({ ... })` map. The verified feed
(`regulations/feed/gulf-federal-2026.json`) **overrides** the seed — if a species
is in the feed, fix it there instead. Run `npm run validate-feeds`, then ship
(see the ship-change skill). `seasonState` in `src/helpers.js` treats
`'Year-round'` as open and `'No harvest'` / "prohibited" as closed.
