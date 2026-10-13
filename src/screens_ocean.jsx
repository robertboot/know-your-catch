/* ============================================================
   OCEAN MAPS — user-facing chlorophyll + sea-temp satellite maps.

   Free NOAA/NASA satellite ocean layers overlaid on a Gulf +
   Florida-Atlantic map — the same "find the color / find the
   temp break" intel the paid apps charge for:
     - Chlorophyll-a (phytoplankton / "the green") — bait & color breaks
     - Sea-surface temperature (SST) — temp edges / weed lines

   Source: NOAA CoastWatch ERDDAP WMS. A single EPSG:4326 GetMap
   image is overlaid (Leaflet's tiled WMS asks for Web-Mercator
   tiles, which this ERDDAP rejects). All data is public domain.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { T } from './theme.js';
import { H1, Card, SectionLabel } from './components.jsx';
import { SPECIES } from './data.js';
import { speciesPhoto } from './helpers.js';
import { SUPABASE_URL, client } from './supabase-client.js';
import { imageUrl, cacheAge } from './tile-cache.js';
import { describeAge, readMarineCache, writeMarineCache } from './marine-cache.js';
import { BASEMAP_URL, BASEMAP_ATTRIBUTION, BASEMAP_MAX_ZOOM, addBasinLabel } from './basemap.js';
import { createCurrentFlowLayer } from './current-flow.js';
import { SNAPSHOT_BOUNDS, snapshotUrl } from './ocean-snapshots.js';
import { TRIP_MODES } from './trip-modes.js';
import { DAYS_CACHE, homeWater, spotAgeNote } from './home-water.js';
import { fishabilityHour, fishabilityGrade, fishabilityColor } from './forecast-extras.js';
import { createSpeciesZoneLayer, SPECIES_ZONE_COLORS } from './species-zone-layer.js';

/* Which species the zones cover, from the one list the server writes
   against. Three on by default — the ones most Gulf crews troll for —
   because every species at once is a colour wash, not a map. */
const ZONE_SPECIES = TRIP_MODES.find(m => m.key === 'troll_pelagic').species;
const DEFAULT_SPECIES = ['wahoo', 'yellowfin_tuna', 'mahi'];
const SPECIES_PREFS_KEY = 'kyc.app.ocean-species.v1';

function readSpeciesPrefs() {
  try {
    const raw = localStorage.getItem(SPECIES_PREFS_KEY);
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list)) return new Set(list.filter(id => ZONE_SPECIES.includes(id)));
  } catch { /* a broken pref is not worth a broken map */ }
  return new Set(DEFAULT_SPECIES);
}

const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap';
const ERDDAP_WMS = `${ERDDAP_BASE}/wms`;

/* Pre-rendered snapshots written by the refresh-ocean-maps edge
   function every 6h. Same image for every angler, served static off
   the CDN instead of making each user wait on an on-demand ERDDAP
   render. Only the "Latest" view is snapshotted — the −8d/−16d/−24d
   chips are an explicit opt-in to historical data and still go
   straight to ERDDAP, slow path and all. */
/* Basemap tiles, cache-first.
   Leaflet's default layer goes straight to the network and shows nothing
   when that fails — which offshore means a grey void with a chlorophyll
   blob floating in it. This subclass serves a stored tile when there is
   one, stores every tile it fetches, and leaves the tile blank rather
   than broken when neither works. */
const CachedTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img');
    img.alt = '';
    const url = this.getTileUrl(coords);
    imageUrl(url).then(({ url: src }) => {
      if (!src) { done(null, img); return; }   // blank, not a broken icon
      img.onload = () => done(null, img);
      img.onerror = () => done(null, img);
      img.src = src;
    }).catch(() => done(null, img));
    return img;
  },
});
const cachedTileLayer = (url, opts) => new CachedTileLayer(url, opts);

const GULF_CENTER = [26.0, -88.0];
const GULF_ZOOM = 5;
// Bounds and snapshot URLs come from src/ocean-snapshots.js — drawing an
// overlay with bounds other than the ones it was rendered over gives a
// map that looks reasonable and is a hundred miles wrong.
const REGION_BOUNDS = SNAPSHOT_BOUNDS;

/* SST colour range, in °C, by month.

   Fixed defaults saturated: the Gulf sits at 29-32 °C through late
   summer while the palette topped out around 31.7 °C, so the entire
   basin rendered solid red and the temperature BREAKS — the whole point
   of the layer — were invisible. A season-aware window keeps the
   gradient spread across whatever the water is actually doing.

   Month index 0-11. Gulf of America / Florida Atlantic figures. */
function sstRangeC(date = new Date()) {
  const m = date.getMonth();
  if (m >= 5 && m <= 8)  return [27, 32];   // Jun-Sep, peak summer
  if (m >= 3 && m <= 4)  return [22, 29];   // Apr-May, warming
  if (m >= 9 && m <= 10) return [22, 29];   // Oct-Nov, cooling
  return [14, 24];                          // Dec-Mar, winter
}

const cToF = (c) => Math.round(c * 9 / 5 + 32);

/* Legend labels derived from the same range the tiles are rendered
   with — hardcoding them is how they drift out of sync with the
   imagery. */
function sstLegendStops() {
  const [lo, hi] = sstRangeC();
  return Array.from({ length: 6 }, (_, i) =>
    `${cToF(lo + ((hi - lo) * i) / 5)}°`);
}

const LAYERS = {
  chl: {
    key: 'chl', label: 'Chlorophyll',
    dataset: 'erdMH1chla8day_R2022NRT', variable: 'chlorophyll',
    units: 'mg/m³',
    legendStops: ['0.03', '0.1', '0.5', '1', '3', '30'],
    blurb: 'Green = phytoplankton blooms. Bait and gamefish stack on the color breaks between blue (clear) and green (rich) water.',
  },
  sst: {
    key: 'sst', label: 'Sea temp',
    dataset: 'jplMURSST41', variable: 'analysed_sst',
    units: '°F (approx)',
    legendStops: sstLegendStops(),
    blurb: 'Warm-to-cool edges (temperature breaks) concentrate pelagics. Look for tight color gradients, not just the warmest water.',
  },
};

/* Suggested-spot colours by edge kind — match the popup copy. */
const SPOT_COLORS = {
  temp_break:  '#ff9a3d',
  color_edge:  '#2BE07F',
  convergence: '#c08cff',
};
const SPOT_LABELS = {
  temp_break:  'Temp break',
  color_edge:  'Color edge',
  convergence: 'Convergence',
};

/* `embedded` drops the screen's own title and outer padding so the map can
   sit inside another page — Plan Your Trip shows it open below the spots
   rather than behind a button, since the map IS the answer there and a tap
   to reach it is a tap to do nothing with. */
export function OceanMapsScreen({ isTablet, initialLayer, state, embedded = false }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const [active, setActive] = useState(initialLayer === 'sst' ? 'sst' : 'chl');
  const [status, setStatus] = useState('loading');
  // Non-null when the image on screen came from the device.
  const [overlayAge, setOverlayAge] = useState(null);
  const [dateISO, setDateISO] = useState('');
  // Marker overlays on top of the colour layer. Independent toggles —
  // these ADD to whichever satellite layer is active.
  const [showCatches, setShowCatches] = useState(false);
  const [showSpots, setShowSpots] = useState(true);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showSpecies, setShowSpecies] = useState(false);
  const [speciesOn, setSpeciesOn] = useState(readSpeciesPrefs);
  const [zoneRows, setZoneRows] = useState(null);

  /* The exclusivity rule, in one place so the chips cannot drift from it.
     clearOverlays runs when a composite is chosen; toggleOverlay takes the
     composite away when an overlay goes ON — but not when one goes off, so
     clearing the last overlay leaves you on bare water rather than
     surprising you with a satellite image. */
  const clearOverlays = () => {
    setShowSpots(false); setShowCatches(false);
    setShowCurrent(false); setShowSpecies(false);
  };
  const toggleOverlay = (setter) => setter(prev => {
    if (!prev) setActive(null);
    return !prev;
  });
  const [outlook, setOutlook] = useState(null);   // ten-day, from the Home fetch
  const [dayPick, setDayPick] = useState(0);      // index into outlook
  const zonesRef = useRef(null);
  const [currentCells, setCurrentCells] = useState(null);
  const flowRef = useRef(null);
  const [spots, setSpots] = useState(null);      // hotspot rows (null = not loaded)
  const [spotsAge, setSpotsAge] = useState(null); // ms, when serving from cache
  const catchesRef = useRef(null);
  const spotsRef = useRef(null);

  // Init the map once.
  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return undefined;
    const map = L.map(mapElRef.current, {
      center: GULF_CENTER, zoom: GULF_ZOOM, minZoom: 5, maxZoom: 10,
      zoomControl: true, attributionControl: true,
      maxBounds: REGION_BOUNDS, maxBoundsViscosity: 1.0,
    });
    cachedTileLayer(BASEMAP_URL, {
      attribution: BASEMAP_ATTRIBUTION, maxZoom: BASEMAP_MAX_ZOOM,
    }).addTo(map);
    /* No land overlay. A Natural Earth polygon was drawn over the top to
       clip the satellite composites to water, which meant a third-party
       GeoJSON fetched from a CDN on every open — a network call on a map
       that is meant to work offshore — to redraw a coastline the basemap
       already has. The composites are bounded to the region anyway. */
    map.createPane('coastline');
    map.getPane('coastline').style.zIndex = 450;
    map.getPane('coastline').style.pointerEvents = 'none';
    addBasinLabel(L, map);
    /* No label layer on the data maps. Esri's reference tiles print the
       basin name as pixels, and swapping from the ocean reference to the
       land one did not drop it — so "Gulf of Mexico" sat next to the
       "GULF OF AMERICA" we draw ourselves. Two names for one sea, one of
       them not the one these users use.

       The coastline and our own basin label carry it. Town names are a
       real loss, and worth taking back if a reference layer turns up that
       does not name the water. */
    mapRef.current = map;
    map.setView([26, -85], 6);
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Swap the WMS overlay when the active layer / date changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null; }
    // No layer chosen: bare basemap, and no "didn't load" to explain —
    // nothing was asked for.
    if (!active) { setStatus('ok'); setOverlayAge(null); return; }
    const cfg = LAYERS[active];
    setStatus('loading');

    const liveUrl = () => {
      const [[s, w], [n, e]] = REGION_BOUNDS;
      const params = new URLSearchParams({
        service: 'WMS', version: '1.3.0', request: 'GetMap',
        crs: 'EPSG:4326', bbox: `${s},${w},${n},${e}`,
        width: '600', height: '272',
        layers: `${cfg.dataset}:${cfg.variable}`, styles: '',
        format: 'image/png', transparent: 'true',
      });
      if (dateISO) params.set('time', `${dateISO}T12:00:00Z`);

      /* SST goes through griddap .transparentPng instead of WMS.

         This ERDDAP's WMS rejects any style override — it answers
         "STYLE=boxfill/rainbow is invalid (must be \"\")" — and without
         a style it ignores colorBarMinimum/Maximum too, so the range
         can't be set at all. That left the whole 29-32 °C summer Gulf
         pinned at the top of the default scale, solid red. griddap
         honours .colorBar, which is the only way to fix it. */
      if (cfg.key === 'sst') {
        const [lo, hi] = sstRangeC();
        const t = dateISO ? `(${dateISO}T12:00:00Z)` : '(last)';
        const [[sLat, wLon], [nLat, eLon]] = REGION_BOUNDS;
        const subset = `${cfg.variable}[${t}][(${sLat}):(${nLat})][(${wLon}):(${eLon})]`;
        return `${ERDDAP_BASE}/griddap/${cfg.dataset}.transparentPng?${subset}&.colorBar=Rainbow|||${lo}|${hi}|`;
      }
      return `${ERDDAP_WMS}/${cfg.dataset}/request?${params.toString()}`;
    };

    /* The data overlay, cache-first like the tiles. A stored image is
       shown immediately and refreshed behind the screen, so the map is
       useful the moment it opens and current the moment there is signal. */
    const addOverlay = (url, onError) => {
      imageUrl(url).then(({ url: src, cached }) => {
        if (!src) { onError?.(); return; }
        const layer = L.imageOverlay(src, REGION_BOUNDS, {
          opacity: 0.72, attribution: 'Ocean data: NOAA CoastWatch / NASA',
        });
        layer.on('load', () => setStatus('ok'));
        layer.on('error', () => { map.removeLayer(layer); onError?.(); });
        layer.addTo(map);
        overlayRef.current = layer;
        if (cached) cacheAge(url).then(ms => setOverlayAge(ms)).catch(() => {});
        else setOverlayAge(null);
      }).catch(() => onError?.());
    };

    // "Latest" reads the pre-rendered snapshot; if it's missing (bucket
    // not provisioned yet, or a refresh that never landed) we fall back
    // to a live ERDDAP render so the screen still works.
    const snap = !dateISO ? snapshotUrl(cfg.key) : null;
    if (snap) {
      addOverlay(snap, () => {
        setStatus('loading');
        addOverlay(liveUrl(), () => setStatus('error'));
      });
    } else {
      addOverlay(liveUrl(), () => setStatus('error'));
    }
  }, [active, dateISO]);

  /* Suggested spots — the server-side find-hotspots cron reads the same
     satellite grids nightly and writes the steepest temp/colour edges
     with a plain-sentence `why`. The phone only reads rows (Sirius-style
     suggestions without the subscription). Offline-first: last good rows
     are cached and shown with their age when there's no signal. */
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = readMarineCache('hotspots', 0, 0);
      if (cached && alive) { setSpots(cached.data); setSpotsAge(cached.ageMs); }
      const c = client();
      if (!c) return;
      const since = new Date(Date.now() - 72 * 3600000).toISOString();
      const { data, error } = await c.from('hotspots')
        .select('kind,lat,lon,score,sst_f,sst_drop_f,chl_mg_m3,length_nm,dist_nm,from_port_deg,why,observed_at')
        .gte('observed_at', since)
        .order('score', { ascending: false })
        .limit(60);
      if (!alive || error || !data) return;
      setSpots(data);
      setSpotsAge(null);
      writeMarineCache('hotspots', 0, 0, data);
    })();
    return () => { alive = false; };
  }, []);

  /* Surface current, the same geostrophic field the admin map animates.
     Cached like everything else here: the vectors are a few kilobytes and
     an eddy edge is worth seeing with no signal. Only fetched when the
     layer is first switched on — most trips never ask for it, and this is
     a map that has to be careful about what it downloads. */
  useEffect(() => {
    if (!showCurrent || currentCells) return;
    let alive = true;
    (async () => {
      // Versioned key. Every phone that opened this layer before the
      // zones became readable has a cached patch of current off Alabama —
      // one region's worth, written when that was all the app could see —
      // and a cache entry is good for a week, so those devices would keep
      // drawing it. Bumping the name retires them all at once; nobody has
      // to clear anything.
      const cached = readMarineCache('currents.v2', 0, 0);
      if (cached && alive) setCurrentCells(cached.data);
      const c = client();
      if (!c) return;
      // EVERY region's row, merged. There is one per region, so taking
      // the first returned whichever row the database happened to hand
      // back — in practice Alabama — and drew a patch of flow off Mobile
      // with the rest of the Gulf blank.
      const { data } = await c.from('hotspot_zones')
        .select('cells, step_deg')
        .eq('mode_key', '_currents');
      if (!alive || !data?.length) return;
      const merged = {
        step_deg: data[0].step_deg || 0.25,
        cells: data.flatMap(r => r.cells || []),
      };
      if (!merged.cells.length) return;
      setCurrentCells(merged);
      writeMarineCache('currents.v2', 0, 0, merged);
    })();
    return () => { alive = false; };
  }, [showCurrent, currentCells]);

  /* How old the drawn spots will be on the selected day. Null when there
     is nothing to say — same day, or no spots. */
  const ageNote = useMemo(() => {
    if (!spots?.length || !outlook?.length) return null;
    const observed = spots.reduce((a, sp) => (a && a > sp.observed_at ? a : sp.observed_at), null);
    const day = outlook[Math.min(dayPick, outlook.length - 1)]?.date;
    return spotAgeNote(observed, day, dayPick === 0);
  }, [spots, outlook, dayPick]);

  /* The ten-day outlook, for the day strip.
     Read from the cache only — Home writes it on every open, and this
     screen is read on the way out of the pass where there is no signal.
     If it is not there the strip simply does not render, the same way the
     Home card renders nothing rather than an empty box. */
  useEffect(() => {
    const w = homeWater(state);
    const hit = readMarineCache(DAYS_CACHE, w.lat, w.lon);
    if (hit?.data?.length) setOutlook(hit.data);
  }, [state]);

  /* Species zones — where the mahi water is, rather than where the edges
     are. Same table as the currents, one row per region per species, and
     cached the same way: the whole set is a few tens of kilobytes and is
     worth having aboard with no signal. Fetched once, when the layer is
     first switched on. */
  useEffect(() => {
    if (!showSpecies || zoneRows) return;
    let alive = true;
    (async () => {
      const cached = readMarineCache('zones.v1', 0, 0);
      if (cached && alive) setZoneRows(cached.data);
      const c = client();
      if (!c) return;
      const { data } = await c.from('hotspot_zones')
        .select('mode_key, cells, step_deg')
        .in('mode_key', ZONE_SPECIES);
      if (!alive || !data?.length) return;
      setZoneRows(data);
      writeMarineCache('zones.v1', 0, 0, data);
    })();
    return () => { alive = false; };
  }, [showSpecies, zoneRows]);

  // Paint them. The painter is shared with the admin tab so the two can
  // never drift — see src/species-zone-layer.js.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getPane('zonespane')) {
      map.createPane('zonespane');
      map.getPane('zonespane').style.zIndex = 405;
      map.getPane('zonespane').style.pointerEvents = 'none';
    }
    if (zonesRef.current) { map.removeLayer(zonesRef.current); zonesRef.current = null; }
    if (!showSpecies) return;
    const group = createSpeciesZoneLayer(L, zoneRows, speciesOn, { pane: 'zonespane' });
    if (!group) return;
    group.addTo(map);
    zonesRef.current = group;
    return () => { if (zonesRef.current) { map.removeLayer(zonesRef.current); zonesRef.current = null; } };
  }, [showSpecies, zoneRows, speciesOn]);

  // Remember the picks. A crew that trolls for wahoo should not have to
  // say so every time they open the map.
  useEffect(() => {
    try { localStorage.setItem(SPECIES_PREFS_KEY, JSON.stringify([...speciesOn])); } catch { /* never worth a crash */ }
  }, [speciesOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (flowRef.current) { map.removeLayer(flowRef.current); flowRef.current = null; }
    if (!showCurrent || !currentCells?.cells?.length) return;
    const layer = createCurrentFlowLayer(currentCells.cells, { step: currentCells.step_deg || 0.25 });
    layer.addTo(map);
    layer.setOpacity(0.85);
    flowRef.current = layer;
    return () => { if (flowRef.current) { map.removeLayer(flowRef.current); flowRef.current = null; } };
  }, [showCurrent, currentCells]);

  // Draw/remove the suggested-spot markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (spotsRef.current) { map.removeLayer(spotsRef.current); spotsRef.current = null; }
    if (!showSpots || !spots?.length) return;
    const group = L.layerGroup();
    spots.forEach((h) => {
      const color = SPOT_COLORS[h.kind] || T.brass;
      // Glow + core, same pattern as the patterns-map hot spots.
      L.circleMarker([h.lat, h.lon], { radius: 14, stroke: false, fillColor: color, fillOpacity: 0.18 }).addTo(group);
      const core = L.circleMarker([h.lat, h.lon], {
        radius: 6, stroke: true, color: '#06212f', weight: 1, opacity: 0.6,
        fillColor: color, fillOpacity: 0.9,
      }).addTo(group);
      const bits = [
        `<div style="font-weight:800;margin-bottom:4px">${SPOT_LABELS[h.kind] || h.kind} · score ${Math.round(h.score)}</div>`,
        `<div style="margin-bottom:4px">${h.why || ''}</div>`,
        h.dist_nm != null ? `<div style="opacity:.75">${Math.round(h.dist_nm)} nm at ${Math.round(h.from_port_deg || 0)}° from port</div>` : '',
      ].join('');
      core.bindPopup(`<div style="font-size:12px;max-width:230px">${bits}</div>`);
    });
    group.addTo(map);
    spotsRef.current = group;
  }, [showSpots, spots]);

  /* Which catches hold a species record.
     The log is the source: the biggest one of each species that carries a
     measurement. state.pbs is the angler's own record card and can predate
     the log entirely, so matching against it would ring nothing for a spot
     logged before they started measuring. */
  const pbCatchIds = useMemo(() => {
    const best = new Map();                 // speciesId -> { id, value }
    for (const c of state?.catchLog || []) {
      if (!c.speciesId) continue;
      const value = Number(c.length) || Number(c.weight) || 0;
      if (!value) continue;
      const seen = best.get(c.speciesId);
      if (!seen || value > seen.value) best.set(c.speciesId, { id: c.id, value });
    }
    return new Set([...best.values()].map(b => b.id));
  }, [state?.catchLog]);

  // Draw/remove the angler's own catches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (catchesRef.current) { map.removeLayer(catchesRef.current); catchesRef.current = null; }
    if (!showCatches) return;
    const catches = (state?.catchLog || []).filter(c => c.lat != null && c.lon != null);
    if (!catches.length) return;

    /* Names appear once the map is close enough for them not to collide.
       Below this the dots are often within a few pixels of each other and
       a label per dot is a wall of text, not information. */
    const LABEL_ZOOM = 9;

    const group = L.layerGroup();
    const draw = () => {
      group.clearLayers();
      const named = map.getZoom() >= LABEL_ZOOM;
      catches.forEach((c) => {
        const isPB = pbCatchIds.has(c.id);
        const name = SPECIES.find(s => s.id === c.speciesId)?.commonName || 'Catch';
        const when = c.dateIso ? new Date(c.dateIso).toLocaleDateString() : '';

        // A record gets a gold ring around the dot, drawn as its own circle
        // so the dot keeps its size and the ring reads as a surround.
        if (isPB) {
          L.circleMarker([c.lat, c.lon], {
            radius: 9, stroke: true, color: '#FFC857', weight: 2.5,
            fill: false, interactive: false,
          }).addTo(group);
        }
        const m = L.circleMarker([c.lat, c.lon], {
          radius: 5, stroke: true, color: '#06212f', weight: 1,
          fillColor: '#5ac8f5', fillOpacity: 0.95,
        }).addTo(group);
        m.bindPopup(`<div style="font-size:12px"><b>${name}</b>${isPB ? ' · PB' : ''}`
          + `${when ? `<br/>${when}` : ''}</div>`);

        /* The species PICTURE, not its name.
           Names turned a shelf full of catches into overlapping text —
           twenty labels fighting for the same water, and the map became
           something to read rather than something to look at. A thumbnail
           says the same thing at a glance, takes one position instead of a
           whole line, and does not collide with its neighbour. The name is
           still a tap away in the popup. */
        if (named) {
          const photo = speciesPhoto(c.speciesId);
          if (photo?.url) {
            L.marker([c.lat, c.lon], {
              interactive: false,
              icon: L.divIcon({
                className: '',
                // 68px, not 34. At half this a snapper and an amberjack are
                // the same orange smudge, which is a decoration rather than
                // an identification — the point is to read the species off
                // the map without tapping.
                html: `<img src="${photo.url}" alt="" style="`
                    + `width:68px;height:68px;border-radius:50%;object-fit:cover;`
                    + `transform:translate(-50%,-80px);display:block;`
                    + `border:${isPB ? '3px solid #FFC857' : '2px solid rgba(255,255,255,0.85)'};`
                    + `box-shadow:0 3px 10px rgba(0,0,0,0.55)">`,
                iconSize: [0, 0],
              }),
            }).addTo(group);
          }
        }
      });
    };

    draw();
    group.addTo(map);
    catchesRef.current = group;
    // Labels appear and disappear with zoom, so redraw on the way in and out.
    map.on('zoomend', draw);
    return () => { map.off('zoomend', draw); };
  }, [showCatches, state?.catchLog, pbCatchIds]);


  const cfg = active ? LAYERS[active] : null;
  /* Two groups that cannot coexist, so they are drawn as two different
     KINDS of control — the shape teaches the rule before anyone taps.
     A satellite view is pick-one-or-none, so it is a segmented control
     with a radio dot. The overlays are pick-any, so they are checkboxes.
     Users already know those two shapes; a row of identical pills that
     silently switch each other off teaches nothing and feels broken. */
  const chip = (activeState, label, onClick) => (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer',
      background: activeState ? T.brass : 'transparent',
      color: activeState ? T.oceanDeep : T.ink,
      border: `1.5px solid ${activeState ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  const viewChip = (on, label, onClick) => (
    <button onClick={onClick} aria-pressed={on} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto',
      padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer',
      background: on ? T.brass : 'transparent', color: on ? T.oceanDeep : T.ink,
      border: `1.5px solid ${on ? T.brass : T.cardEdge}`, fontFamily: 'inherit',
    }}>
      <span aria-hidden style={{
        width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
        border: `2px solid ${on ? T.oceanDeep : T.inkMute}`,
        background: on ? T.oceanDeep : 'transparent',
        boxShadow: on ? `inset 0 0 0 2px ${T.brass}` : 'none',
      }} />
      {label}
    </button>
  );

  const overlayChip = (on, label, onClick) => (
    <button onClick={onClick} aria-pressed={on} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto',
      padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
      background: on ? T.parchmentDeep : 'transparent', color: on ? T.ink : T.inkSoft,
      border: `1.5px solid ${on ? T.brass : T.cardEdge}`, fontFamily: 'inherit',
    }}>
      <span aria-hidden style={{
        width: 13, height: 13, borderRadius: 3, flexShrink: 0,
        border: `2px solid ${on ? T.brass : T.inkMute}`,
        background: on ? T.brass : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.oceanDeep, fontSize: 10, fontWeight: 900, lineHeight: 1,
      }}>{on ? '✓' : ''}</span>
      {label}
    </button>
  );

  return (
    <div style={{
      padding: embedded ? 0 : (isTablet ? '22px 22px' : '16px 16px'),
      maxWidth: '100%', overflowX: 'hidden',
    }}>
      {!embedded && (
        <>
          <H1 size={isTablet ? 30 : 22} style={{ marginBottom: 4 }}>Ocean Maps</H1>
          <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkMute, marginBottom: 12 }}>
            Find the color and the temp breaks — free NOAA/NASA satellite layers for the Gulf &amp; Florida Atlantic.
          </div>
        </>
      )}

      {/* Layer toggle + marker overlays. Satellite layers are exclusive;
          Spots and Catches stack on top of whichever is active. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {/* A satellite composite and anything drawn on top are mutually
            exclusive, in both directions.
            Chlorophyll and sea temp are solid colour edge to edge, so a
            dot, a blob or a current streak over one is just one more
            colour — unreadable, and worse, readable-looking. So picking a
            composite clears the overlays, and switching any overlay on
            takes the picture away. Tapping the composite you are already
            on also turns it off, which is how you get to bare water.
            The four overlays are free to combine with each other. */}
        <div style={{ width: '100%' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1,
                        color: T.inkMute, textTransform: 'uppercase', marginBottom: 6 }}>
            Satellite view · one at a time
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.values(LAYERS).map(l => viewChip(active === l.key, l.label, () => {
              setActive(prev => (prev === l.key ? null : l.key));
              if (active !== l.key) clearOverlays();
            }))}
          </div>

          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1,
                        color: T.inkMute, textTransform: 'uppercase', margin: '12px 0 6px' }}>
            Show on the water · any
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {overlayChip(showSpots, 'Suggested spots', () => toggleOverlay(setShowSpots))}
            {overlayChip(showCatches, 'My catches', () => toggleOverlay(setShowCatches))}
            {overlayChip(showCurrent, 'Current', () => toggleOverlay(setShowCurrent))}
            {overlayChip(showSpecies, 'Species', () => toggleOverlay(setShowSpecies))}
          </div>
            {/* Which species, directly under the switch that turns them on.
                These were below the map, which put the control a scroll away
                from the thing it controls. Each pill carries its own colour,
                which is the only legend the zones get — a separate key is one
                more thing to look away at on a moving boat. */}
        {showSpecies && (
          <div style={{ display: 'flex', gap: 7, marginTop: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {ZONE_SPECIES.map((id) => {
              const on = speciesOn.has(id);
              const col = SPECIES_ZONE_COLORS[id] || T.brass;
              const name = SPECIES.find(sp => sp.id === id)?.commonName
                || id.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
              return (
                <button key={id} type="button" onClick={() => setSpeciesOn((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                })} style={{
                  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
                  background: on ? T.parchmentDeep : 'transparent',
                  border: `1.5px solid ${on ? col : T.cardEdge}`,
                  color: on ? T.ink : T.inkMute, fontFamily: 'inherit',
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: col,
                                 opacity: on ? 1 : 0.45 }} />
                  {name}
                </button>
              );
            })}
          </div>
        )}

          {/* Say what just happened. A control that silently switches
              another one off reads as a bug; one line turns it into a
              rule the angler can predict. */}
          {active && (
            <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 8, lineHeight: 1.45 }}>
              Nothing can be drawn over a satellite image and still be read — turn the view off
              to put spots, catches, current or species back on the water.
            </div>
          )}
        </div>
      </div>

      {/* Composite date + land overlay */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 700 }}>Composite</span>
        {chip(dateISO === '', 'Latest', () => setDateISO(''))}
        {[8, 16, 24].map(d => chip(false, `−${d}d`, () => setDateISO(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10))))}
      </div>

      {/* WHEN to go. The spots answer where; without this the map is a
          picture of right now and the angler still has to guess the day.
          Grades come from the same fishabilityHour the Home card and the
          Forecast screen use — one scoring model, so the three screens
          cannot disagree about the same week. Picking a day only changes
          what this strip reports: the spots are an OBSERVATION of a
          satellite pass, not a forecast, and pretending they move with
          the day would be inventing data. */}
      {outlook?.length > 1 && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {outlook.slice(0, 7).map((d, i) => {
            const score = fishabilityHour({
              wind: d.windMax, gust: d.windMax != null ? d.windMax * 1.3 : null,
              waveFt: d.waveFtMax, periodS: d.periodMaxS, code: d.code,
            });
            const on = i === dayPick;
            const dt = new Date(d.date + 'T12:00:00');
            return (
              <button key={d.date} type="button" onClick={() => setDayPick(i)} style={{
                flex: '0 0 auto', width: 58, textAlign: 'center', padding: '7px 0 8px',
                borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                background: on ? T.parchmentDeep : 'transparent',
                border: `1.5px solid ${on ? T.brass : T.cardEdge}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>
                  {i === 0 ? 'Today' : dt.toLocaleDateString(undefined, { weekday: 'short' })}
                </div>
                <div style={{ fontSize: 10, color: T.inkMute, marginTop: 1 }}>
                  {dt.getMonth() + 1}/{dt.getDate()}
                </div>
                <div style={{ fontSize: 15, fontWeight: 900, marginTop: 4,
                              color: score == null ? T.inkMute : fishabilityColor(score) }}>
                  {score == null ? '—' : fishabilityGrade(score)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
        <div ref={mapElRef} style={{ height: '58vh', minHeight: 380, width: '100%', background: '#06182b' }} />
      </div>

      {/* Under the map, in the flow — not floating on it. Over imagery
          these were unreadable whatever the colour: a chlorophyll
          composite is every colour at once, so there is no text that
          survives on top of it. Below the map they sit on the app's own
          background and simply read. */}
      {status === 'error' && (
        <div style={{
          marginTop: 10, background: T.closedBg, color: T.closed,
          border: `1px solid ${T.closed}`, padding: '10px 13px', borderRadius: 10,
          fontSize: 12.5, fontWeight: 700, lineHeight: 1.5,
        }}>
          This layer didn't load — the composite may be cloud-covered for this window, or you have no
          signal and nothing saved for it yet. Try an earlier date.
        </div>
      )}

      {/* Same rule as the forecast: imagery from the device says so, with
          its age. A three-day-old chlorophyll edge is still worth seeing —
          a three-day-old edge you believe is today's is not. */}
      {overlayAge != null && status === 'ok' && (
        <div style={{
          marginTop: 10, background: T.warnBg, color: T.warn,
          border: `1px solid ${T.warn}88`, padding: '10px 13px', borderRadius: 10,
          fontSize: 12.5, fontWeight: 700, lineHeight: 1.5,
        }}>
          Saved image · {describeAge(overlayAge)} — no signal, showing what your phone downloaded.
        </div>
      )}

      {/* Legend + blurb */}
      <Card style={{ marginTop: 12, borderRadius: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel style={{ margin: 0 }}>
            {cfg ? `${cfg.label} · ${cfg.units}` : 'No satellite layer'}
          </SectionLabel>
          {cfg && status === 'loading' && <span style={{ fontSize: 12, color: T.inkMute }}>Loading…</span>}
          {cfg && status === 'ok' && (
            <span style={{ fontSize: 12, color: overlayAge != null ? T.warn : T.open, fontWeight: 700 }}>
              {overlayAge != null ? `Saved · ${describeAge(overlayAge)}` : (dateISO ? `Near ${dateISO}` : 'Latest composite')}
            </span>
          )}
        </div>
        {/* No scale to show when no layer is drawn — a legend for an image
            that is not on the map is just furniture. */}
        {cfg && (
          <>
            <div style={{
              height: 14, borderRadius: 4, marginTop: 10,
              background: active === 'chl'
                ? 'linear-gradient(90deg, #2b2f6b, #1f6f8b, #2bb673, #9acd32, #d4d400, #7a3d00)'
                : 'linear-gradient(90deg, #2b2f6b, #1f6f8b, #2bb673, #d4d400, #d47a00, #c62828)',
            }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              {cfg.legendStops.map((s, i) => <span key={i} style={{ fontSize: 10, color: T.inkMute }}>{s}</span>)}
            </div>
          </>
        )}
        <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginTop: 10 }}>
          {cfg ? cfg.blurb : 'Satellite layers are off — the map is showing spots and catches on bare water. Tap Chlorophyll or Sea temp to bring an image back.'}
        </div>
        {showSpots && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.cardEdge}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              {Object.entries(SPOT_LABELS).map(([k, lbl]) => (
                <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: SPOT_COLORS[k], display: 'inline-block' }} />
                  {lbl}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5, marginTop: 8 }}>
              {spots === null
                ? 'Suggested spots load when you have signal and are saved for offshore.'
                : spots.length === 0
                  ? 'No strong edges found in the last satellite pass — flat, even water across the region.'
                  : `Computed nightly from the same NOAA grids above — the steepest temperature and color edges, scored and explained. Tap a dot for the why.${spotsAge != null ? ` Saved · ${describeAge(spotsAge)}.` : ''}`}
                {/* How old will these be on the day you go?
                    A break is an OBSERVATION of one satellite pass, not a
                    forecast — it drifts with the current, and by Thursday a
                    Sunday pass has moved miles. The map cannot say where it
                    went, so it must at least say how stale it is rather than
                    draw a four-day-old line as if it were this morning's. */}
                {ageNote && (
                  <div style={{ marginTop: 6, color: T.warn, fontWeight: 700 }}>{ageNote}</div>
                )}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8 }}>
          Data: NOAA CoastWatch / NASA Ocean Color (public domain). 8-day composites — cloud gaps fill in over time.
        </div>
      </Card>
    </div>
  );
}
