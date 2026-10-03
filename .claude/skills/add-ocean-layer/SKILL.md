---
name: add-ocean-layer
description: Add or fix a NOAA/NASA satellite ocean layer (chlorophyll, SST, etc.) on the Leaflet ocean maps. Use when working on OceanMapsScreen or OceanHeatmapPanel / ERDDAP WMS overlays.
---

# Add an ERDDAP ocean layer

The ocean maps (`src/screens_ocean.jsx`, admin `src/admin/OceanHeatmapPanel.jsx`)
overlay NOAA CoastWatch ERDDAP WMS data on Leaflet. These gotchas were learned
the hard way — follow them exactly or the layer renders blank.

## Non-negotiable ERDDAP rules
- **Do NOT use `L.tileLayer.wms`.** Leaflet tiles request Web-Mercator (EPSG:3857),
  which this ERDDAP rejects. Use a **single `L.imageOverlay`** with one
  `GetMap` request in **EPSG:4326**.
- **`styles=` must be empty.** `boxfill/rainbow` etc. are rejected. No
  `colorscalerange`/`logscale` params either (rejected with empty style).
- **WMS 1.3.0 + EPSG:4326 → bbox is `lat,lon` order** (`${s},${w},${n},${e}`).
- Request at **~native resolution** (e.g. `width=600 height=272` for the
  21°×9.5° region) and let the browser upscale — a big image bakes in hard blocks.
- A blank layer usually means the composite is **cloud-covered** for that window;
  step the date back, don't assume the dataset id is wrong.

## Layer config shape
Add to the `LAYERS` map: `{ dataset, variable, units, legendStops, blurb }`.
WMS layer name is `` `${dataset}:${variable}` ``. Known-good datasets:
- Chlorophyll: `erdMH1chla8day_R2022NRT` / var `chlorophyll` (8-day, current NRT).
- SST: `jplMURSST41` / var `analysed_sst` (Kelvin; label as °F in the legend).

## Land mask
Coarse coastal cells bleed color onto land. Fix with a dark GeoJSON land polygon
on a pane **above** the overlay (`zIndex 440`), coastline labels above that (450).
Draw it via a `landReady` state flag when the GeoJSON `fetch` resolves — never
`setShowLand(v => v)` (a same-value setState bails out and the mask never draws).
