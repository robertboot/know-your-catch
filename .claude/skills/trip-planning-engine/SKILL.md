---
name: trip-planning-engine
description: Use when changing where-to-go prediction — find-hotspots, the species habitat model, the ocean snapshot layers, or the admin Trip Planning tab. Records which data layer answers which question, the thresholds and why they are set where they are, and the rules that keep a confident wrong answer off the map.
---

# Where to go

The question is not what to catch. If the sea is safe and the season is
open, a captain knows what they are after — they need to know where to
point the boat. Everything here serves that.

## The modes decide which data is consulted

`src/trip-modes.js` — one copy, read by the admin tab and later the app.

| Mode | What it needs | State |
|---|---|---|
| Trolling — pelagic | temperature and colour breaks | built |
| Reef fishing | platforms, pipelines, hard bottom | not built |
| Deep drop | high-resolution bathymetry and relief | not built |
| Trolling — coastal | nearshore temperature and bait | not built |

Two distinctions, both from Robert, both easy to get wrong:

- **Reef fishing wants structure, but NOT published artificial reef
  numbers.** Everyone has them and they get hammered. Platforms and
  pipelines (BOEM publishes both) are the layer worth recommending.
- **Kings and Spanish are trolled but are not pelagic.** They follow bait
  and nearshore temperature, not the blue-water edge. Filing them with
  tuna sends someone forty miles for a fish that is off the beach.

A mode with no data layer says so. An empty map reads as "nothing biting",
which is a different and much worse claim than "not built yet".

## The layers, and what each one is for

| Layer | Source | Answers |
|---|---|---|
| SST | `jplMURSST41` (~1 km) | where the temperature CHANGES |
| Chlorophyll | `erdMH1chla8day_R2022NRT` | where the water colour changes |
| Bathymetry | `etopo180` (altitude, metres, negative below sea level) | depth, and bottom slope |
| Currents | `nesdisSSH1day` (ugos/vgos) | the Loop Current and its eddies |

All on `coastwatch.pfeg.noaa.gov/erddap`, all keyless, all read as JSON
grids rather than images because **gradients need numbers**.

Fish stack on EDGES, not averages. A 74 °F patch says nothing; 74 meeting
71 over three miles says everything. So nothing here scores the VALUE of a
field — it scores how fast the field changes, in units a person can
argue with: °F per nautical mile, feet of depth per nautical mile, knots.

## Rules that keep a wrong answer off the map

**Nulls propagate.** A missing neighbour — cloud, or land — yields no
gradient rather than a guess. Interpolating across a gap invents an edge
along the coastline, and a beautiful wrong answer is the one failure this
feature cannot afford.

**Corroboration is required.** A temperature wobble over flat bottom in
dead water is noise dressed as a spot however steep it looks; satellites
see cloud edges and sensor seams too. A colour change, real relief, or
moving water has to agree before a spot is drawn.

**A break is a line, not a pixel.** Adjacent cells group into one edge,
reported at the PEAK — a centroid of a curving break lands in flat water.
Spots within `MIN_SEPARATION_NM` collapse to the strongest.

**Flip the sign before taking a bathymetry gradient.** ETOPO altitude is
negative below sea level. A gradient on negative numbers is still a
gradient, but every threshold downstream reads backwards.

**Chlorophyll is scored on log10.** It spans three orders of magnitude and
a plain difference is dominated by green inshore water, hiding the
0.1-to-0.3 edge offshore that actually matters.

### Current thresholds

`MIN_SCORE 65`, `MIN_CELLS 5`, `MIN_SEPARATION_NM 4`, `MAX_SPOTS 8`.
These were 45/3/12 and produced a map of every wobble in the sea surface,
which tells a captain nothing about which one to run to. **Loosening them
is a regression even though more pins look like more value.**

## The species model

`src/species-habitat.js` — published temperature, depth and chlorophyll
ranges for 37 species, plus how much each relates to a break versus to a
piece of bottom.

- Ranges are **trapezoids**: zero outside, one through the middle, linear
  across the shoulders. A hard cutoff at a tenth of a degree lies about
  biology; a bell curve claims precision these ranges do not have.
- Temperature and depth are **gates**, not terms. A fish that cannot be in
  this water does not become likelier because the bottom suits it.
- **Chlorophyll runs the opposite way to intuition**: predators patrol the
  CLEAN side of a colour change, not the bloom. Bands peak in the tenths
  and fall away at BOTH ends. Bottom fish get no band — water colour is
  not what puts a grouper on a rock.
- **Swordfish break the one-row-per-species model.** Above 100 m at night,
  below 500 m by day, deeper again on a bright moon, and tolerant of 4 °C
  — so surface temperature barely constrains them. They carry a `diel`
  band; a single depth band for a swordfish is wrong twice a day.
- Scored on the CLIENT from values the server wrote on the row, so editing
  the table changes the map without a redeploy and no copy lives in Deno.
- Scored against the month of the day being PLANNED, not today.

## What the log can and cannot do

71 logged catches across 28 species is about two and a half each; a
presence-only habitat model wants thirty before it says anything you could
not have guessed. So published preference drives prediction today and the
log grows into the driver.

When it does: **a catch log records where people FISH, not where fish
ARE.** Everyone runs the same public numbers, so a naive fit learns "near
the pass". Each catch has to be explained against a background of equally
reachable, equally fishable water, or the model just recommends
convenience.

## Dates, and what a date cannot change

Breaks are OBSERVED. There is no satellite image of next Thursday. The day
chosen changes whether you can GET there (Fishability from the forecast,
daylight hours only) and how stale the picture will be when you arrive —
one day means it has drifted miles, four or more means a direction to
look, not a position. Say that on the card. Showing a Tuesday break as a
Saturday waypoint without saying so is the most expensive kind of wrong:
confidently precise.

## Privacy

In the app an angler sees only their OWN catches; hotspots are computed
from EVERYONE'S. Those coexist only if a published spot can never be read
back as one person's number — and with a sparse log, a cell holding one
catch IS that angler's spot. Community data may influence a published spot
only above `MIN_DISTINCT_ANGLERS`, and positions aggregate to the grid.
`catches.loc_precision` (exact | grid_1km | grid_10km) exists for this.

## Colour ranges are measured, never assumed

The Gulf rendered solid red because the SST palette came from a fixed
month table — 29-30 °C water against a table topping out at 29. A month
table cannot win: widen it and breaks smear, narrow it and the first
unusual week saturates. `refresh-ocean-maps` now samples the actual field
and colours between its 2nd and 98th percentiles, clipping the tails so
one cloud-edge pixel cannot flatten everything real, with the span floored
at 3 °C so a uniform sea is not amplified into drama. **The range used is
published beside the image** — a legend that recomputes it is a legend
that can disagree with its own colours.

## What the nightly run can and cannot do

`find-hotspots` takes ONE region per scheduled call, stalest first, and
the cron fires every ten minutes — twelve regions refresh inside two
hours. It used to loop all twelve in one call and was killed by the
scheduler before its first write, which is why `hotspots` was empty for
the life of the feature. See `[[scheduled-jobs]]`; do not put that loop
back.

### A group is a break, not a place

Candidate cells are grouped into connected edges. A group is a whole
WALL — the shelf-edge front runs the width of a region. Taking one peak
per group meant a hundred-mile break produced a single pin at its
hottest pixel, and `MAX_SPOTS` and `MIN_SEPARATION_NM` could never bind.
Each group now offers its strongest cells that stand `MIN_SEPARATION_NM`
apart, and the spacing pass still has the last word.

### Numbers on a card are measured, never extrapolated

`sst_drop_f` is the real spread of surface temperature around the peak,
not the peak gradient times an assumed width. The old form claimed 7.6 °F
on a front holding 3.6.

### Every run records what it did

`hotspot_regions.last_run_at` and `.last_error` carry the outcome of
every run, success included, and the admin tab shows the failures. An
empty map has three completely different causes — never ran, upstream
down, water genuinely flat — and they are indistinguishable without it.

### Tested without the network

`scripts/hotspots-test/run.mjs` runs the real function against
fabricated satellite grids. Run it after any change to the scoring,
grouping or thresholds; `ship.sh` does.

## Related

- [[forecast-scoring]] — Fishability decides whether you GO; this decides
  where. Keep them separate; weather is not a habitat term.
- [[duplicated-knowledge]] — snapshot bounds and basemap URLs have both
  already bitten.
- [[api-cost-control]] — none of this calls a model. Two satellite reads a
  night per region, and it must stay that way.
