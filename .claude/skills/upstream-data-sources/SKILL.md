---
name: upstream-data-sources
description: Use when adding or debugging a fetch from an outside data provider — NOAA ERDDAP, Open-Meteo, NASA Ocean Color. Records how these fail, why one hard-coded host is a single point of failure, and how to tell "the provider is down" from "our code publishes nothing".
---

# Depending on someone else's server

Every number in this app that is not the angler's own comes from a free
public server run by someone with no obligation to us. Write the fetch
accordingly.

## ERDDAP answers 503 as normal behaviour

NOAA's ERDDAP **sheds load by returning 503** when its memory use is
high. That is documented, deliberate, and an ordinary Tuesday on a busy
public node like `coastwatch.pfeg.noaa.gov`. A 503 is not an outage.

So any single fetch must retry. One un-retried 503 on a mandatory grid
threw away a whole region's run.

Retry only the shed and transient statuses — `429, 500, 502, 503, 504`
— plus timeouts. A `400` means our query is wrong, and asking again
louder will not fix it.

### Telling shedding apart from an outage

Shedding returns 503 for **data** requests. If `/erddap/index.html` is
also 503, the host is down. On 2026-10-07 coastwatch.pfeg returned 503
for everything, index included, for hours.

## One host is a single point of failure

Hard-coding one address means one outage empties the feature with nothing
to fall back to. Keep a list and walk it:

    const ERDDAP_HOSTS = [
      'https://coastwatch.pfeg.noaa.gov/erddap/griddap',
      'https://upwell.pfeg.noaa.gov/erddap/griddap',
    ];

`upwell.pfeg` is a **separate machine** — confirm this, do not assume it
from the name; they resolve to different addresses — serving the same
dataset ids, so failover needs no second set of names.

Rules learned building this:

- The fetcher takes a **path** and chooses the host itself. If call sites
  pass full URLs, one of them will pin itself to one server and nobody
  will notice until that server is down.
- A `4xx` stops the walk. A malformed query is malformed everywhere, and
  a dataset a host does not carry 404s — walking on wastes the budget.
- Where a URL has to be built before it is fetched, build it with a `{H}`
  token and let the fetcher substitute. Assert the token never reaches
  anything stored.
- Budget it. Hosts × attempts × per-fetch timeout must fit inside the
  caller's ceiling — see `[[scheduled-jobs]]`.
- Make everything optional that can be. Only one grid in `find-hotspots`
  is mandatory; the rest are `.catch(() => null)`.

## "Optional" that silently empties the result is not optional

`find-hotspots` requires a temperature break to be corroborated by
colour, depth or current before it will publish. All three are optional
fetches. When a shedding server dropped all three, every cell failed
corroboration and the region published nothing — **which on the map is
identical to calm water.**

If losing an optional input makes the output empty, say so. That region
now throws with the reason and comes back in half an hour.

## Test the pipeline without the network

When the provider is down there is no way to tell "the satellites are
unreachable" from "the scoring publishes nothing whatever you feed it" —
unless you can run the real code against fabricated inputs.

`scripts/hotspots-test/run.mjs` bundles the actual edge function with
esbuild, stubs `Deno` and the Supabase client, serves synthetic ERDDAP
column tables, and asserts what gets written. It runs in `ship.sh`.

It immediately found a bug no amount of staring had: a hundred-mile front
produced one pin, because every connected group yielded exactly one spot.

**Write this test when you add a provider, not after it breaks.**

## Never state a number you extrapolated

The spot card said "about 7.6° across it" on water holding 3.6°. It took
the peak gradient and multiplied by four miles. A peak gradient is a
local maximum; assuming it holds for four miles invents temperature.

Measure what you are about to claim. The test asserts a card can never
claim more temperature than the synthetic water contains. This matters
beyond accuracy — Rob has been explicit that the app must not overstate.

## Ask for less before you wait longer

All three ERDDAP hosts timed out, every run. That reads as "the provider
is down". It was really **we asked for too much**.

The stride was a fixed number of grid cells, so a region's request grew
with its box. `gulf_deep` is 5° by 7°, which at MUR's 0.01° and stride 2
is **87,500 points in one JSON document** — slow to assemble and slow to
send even from a healthy server. Capping the request at 140 points a side
brought the worst region down to 14,000.

So, before reaching for a longer timeout:

- **Size the request, not the patience.** A region twice as wide needs a
  coarser stride, not twice the wait. `scripts/hotspots-test/run.mjs`
  guards this against the real region boxes, so adding a region cannot
  quietly reintroduce an oversized one.
- Know what resolution the ANSWER needs. A 0.05° cell is 3 nm — finer
  than any break worth driving to — and the gradient is per nautical mile
  whatever the stride. The extra points bought nothing and cost the run.
- A timeout is not evidence about the server. Distinguish it from a
  refusal (503), a missing dataset (404) and a dead connection, and
  report **every host's** outcome, not just the last one:

      every erddap host failed — coastwatch.pfeg=503
      upwell.pfeg=timeout@20s erddap.marine=404

  Throwing only the final error made three different failures read as one
  bare `AbortError: The signal has been aborted`, which says nothing.

## An image and a grid are not the same request

`refresh-ocean-maps` pulls a rendered **PNG** for the map; `find-hotspots`
pulls the **numbers** for the scoring. Both are sea-surface temperature,
both from ERDDAP, and they are not interchangeable: a colour-mapped
picture cannot yield "71.8 °F break, 2.1° across it, running 4 nm". You
cannot measure a picture.

This is worth saying out loud because it looks like waste and is asked
about. What IS genuine duplication: both jobs ask NOAA for the same
variable. The grids `find-hotspots` already pulls cover the whole Gulf,
so the picture could be rendered from them and the second fetch dropped —
halving what we ask of a server that sheds load. Not yet done; it needs a
PNG encoder in Deno and the colour bar is currently ERDDAP's.

**What is NOT duplication:** the app and the admin console read the SAME
rows (`hotspots`, `hotspot_zones`). Nothing is fetched twice for the web.

## Related

- `[[scheduled-jobs]]`, `[[api-cost-control]]`, `[[trip-planning-engine]]`,
  `[[offline-first]]`.
