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

## Related

- `[[scheduled-jobs]]`, `[[api-cost-control]]`, `[[trip-planning-engine]]`,
  `[[offline-first]]`.
