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
import { DAYS_CACHE, homeWater, spotAgeNote, groupByBreak, breakKey } from './home-water.js';
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
export const SPOT_COLORS = {
  temp_break:  '#ff9a3d',
  color_edge:  '#2BE07F',
  convergence: '#c08cff',
};
export const SPOT_LABELS = {
  temp_break:  'Temp break',
  color_edge:  'Color edge',
  convergence: 'Convergence',
};

/* `embedded` drops the screen's own title and outer padding so the map can
   sit inside another page — Plan Your Trip shows it open below the spots
   rather than behind a button, since the map IS the answer there and a tap
   to reach it is a tap to do nothing with. */
export function OceanMapsScreen({ isTablet, initialLayer, state, embedded = false,
                                 focusBreak = null, spotNumbers = null,
                                 highlightBreak = null, onPickSpot = null }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  /* No satellite view by default, current on.
     A composite is a wall of colour that hides everything drawn on it, so
     opening on one meant the spots, catches and current were all invisible
     until the angler worked out that the picture had to come off first.
     Bare water with the current running shows what the map is FOR.
     initialLayer still wins when a caller asks for a specific view — the
     Chlorophyll and Sea temp shortcuts rely on that. */
  const [active, setActive] = useState(
    initialLayer === 'sst' || initialLayer === 'chl' ? initialLayer : null);
  const [status, setStatus] = useState('loading');
  // Non-null when the image on screen came from the device.
  const [overlayAge, setOverlayAge] = useState(null);
  const [dateISO, setDateISO] = useState('');
  // Marker overlays on top of the colour layer. Independent toggles —
  // these ADD to whichever satellite layer is active.
  const [showCatches, setShowCatches] = useState(false);
  const [showSpots, setShowSpots] = useState(true);
  /* Off by default. The flow streaks cover the whole basin, so the first
     thing the angler sees is a screen of current with four pins somewhere
     in it — the spots are what the page is for, and they read best on
     bare water. One tap in the layers panel brings it back. */
  const [showCurrent, setShowCurrent] = useState(false);
  const [showSpecies, setShowSpecies] = useState(false);
  /* Embedded, the controls float on the map instead of stacking above it.
     Stacked, they pushed the map most of a screen down the page — the
     angler scrolled past four rows of switches to reach the thing the
     switches are for. Only one panel is open at a time, and only when
     asked for. */
  const followedRef = useRef(undefined);      // which break the map last moved to
  const [panel, setPanel] = useState(null);   // 'layers' | 'when' | null
  const [full, setFull] = useState(false);
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

  /* Leaflet sizes itself once; a container that changes shape under it
     leaves the tiles half drawn until something nudges it. */
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const t = setTimeout(() => m.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [full]);

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
        .select('id,region_id,kind,lat,lon,score,sst_f,sst_drop_f,chl_mg_m3,length_nm,bearing_deg,cells,dist_nm,from_port_deg,why,observed_at')
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
    /* ONE area per break, not a dot per peak.
       The server publishes several points along a connected break so a
       long wall is not reduced to a single pin. Drawn as three dots that
       reads as three separate marks a few miles apart, which is both
       wrong — it is one feature — and misleadingly precise: a break is a
       zone of water to work, not a waypoint to sit on. So the points are
       grouped back into their break and drawn as the area they describe,
       sized by the break's own length. */
    /* Spots sit ABOVE the current.
       The flow layer appends its canvas to the overlay pane, where the
       spot circles are drawn too — and being appended later it covered
       them, so the one thing the map is recommending was underneath the
       decoration. Their own pane at 450 puts them over the current and
       the zones, and still under markers and popups. */
    if (!map.getPane('spotspane')) {
      map.createPane('spotspane');
      map.getPane('spotspane').style.zIndex = 450;
      map.getPane('spotspane').style.pointerEvents = 'auto';
    }

    const group = L.layerGroup();
    let focusTarget = null;
    let allAreas = [];
    groupByBreak(spots).forEach((h) => {
      /* Numbered by the list above, where the page gives one.
         Three colours for three KINDS of edge asked the angler to learn a
         key before they could read the map; a number ties the shape to the
         card that explains it, which is the thing they actually need. The
         kind colours stay for the standalone map, which has no list. */
      const rank = spotNumbers ? spotNumbers[breakKey(h)] : null;
      const color = rank ? rank.color : (SPOT_COLORS[h.kind] || T.brass);
      /* Emphasised, and separately, moved to.
         The card below the map shows one area at a time, and that one is
         drawn heavier so the pager and the map agree about which is being
         considered — without moving the view, which would hide the other
         three the page just said were up there. Tapping the card is what
         zooms. */
      const bk = breakKey(h);
      const isFocus = (focusBreak != null && bk === focusBreak)
                   || (highlightBreak != null && bk === highlightBreak);
      // The break's own span, in metres, floored so a short one is still
      // an area rather than a dot.
      const radiusM = Math.max(3000, (Number(h.length_nm) || 4) * 1852 / 2);

      /* The break's own shape where the server sent one.
         A break is a ribbon of water that bends, forks and thins; a disc
         both looks wrong and claims the wrong water. Each cell is drawn as
         a soft-edged disc about one cell wide and they merge into the
         organic outline the data actually describes — the same trick the
         species zones use, which is what makes those read as water rather
         than tiles. The circle stays as the fallback for rows published
         before the shape existed. */
      let ring;
      const shape = Array.isArray(h.cells) && h.cells.length >= 3 ? h.cells : null;
      if (shape) {
        // featureGroup, not layerGroup: only the former can report its
        // bounds, and focusing a card has to move the map to the shape.
        const blob = L.featureGroup();
        // One cell is ~2 km at the published stride; overlap them slightly
        // so the union is continuous rather than a string of beads.
        const cellM = 2600;
        /* Two passes: a wide, faint halo under a tighter, solid core.
           The union of discs has no outline of its own to stroke, so the
           glow is what gives the shape an edge — without it a flat wash
           disappears into a chlorophyll composite or a busy seafloor. */
        shape.forEach(([lat, lon]) => {
          L.circle([lat, lon], {
            pane: 'spotspane', radius: cellM * 1.8, stroke: false,
            fillColor: color, fillOpacity: isFocus ? 0.20 : 0.13,
            interactive: false,
          }).addTo(blob);
        });
        shape.forEach(([lat, lon]) => {
          L.circle([lat, lon], {
            pane: 'spotspane', radius: cellM, stroke: false,
            fillColor: color, fillOpacity: isFocus ? 0.55 : 0.42,
            interactive: false,
          }).addTo(blob);
        });
        blob.addTo(group);
        ring = blob;
      } else {
        /* No published shape: draw the feature the row DESCRIBES.
           A break has a length and a heading — a circle throws both away
           and claims a disc of water that is mostly not the break. An
           elongated ribbon along `bearing_deg`, as long as `length_nm`
           and a couple of miles across, is the same information the row
           already carries, drawn as the thing it is. It also means the
           area reads on its own, with every satellite layer switched off. */
        const ribbon = L.featureGroup();
        const half = Math.max(2500, (Number(h.length_nm) || 4) * 1852 / 2);
        const wide = Math.max(1800, half * 0.22);
        const brg = ((Number(h.bearing_deg) || 0) * Math.PI) / 180;
        const mPerDegLat = 111320;
        const mPerDegLon = Math.max(1, 111320 * Math.cos((h.lat * Math.PI) / 180));
        // An ellipse, rotated onto the break's heading. Bearing is from
        // north, clockwise, so the long axis is (sin, cos) not (cos, sin).
        const outline = (gl, gw) => {
          const pts = [];
          for (let d = 0; d < 360; d += 12) {
            const t = (d * Math.PI) / 180;
            const along = Math.cos(t) * gl;
            const across = Math.sin(t) * gw;
            const dx = along * Math.sin(brg) + across * Math.cos(brg);
            const dy = along * Math.cos(brg) - across * Math.sin(brg);
            pts.push([h.lat + dy / mPerDegLat, h.lon + dx / mPerDegLon]);
          }
          return pts;
        };
        // Same halo-under-core as the published shape, so a row with cells
        // and a row without look like the same kind of thing on one map.
        L.polygon(outline(half * 1.25, wide * 2.1), {
          pane: 'spotspane', stroke: false, fillColor: color,
          fillOpacity: isFocus ? 0.18 : 0.12, interactive: false,
        }).addTo(ribbon);
        L.polygon(outline(half, wide), {
          pane: 'spotspane', stroke: true, color, weight: isFocus ? 3 : 2,
          opacity: 0.9, fillColor: color, fillOpacity: isFocus ? 0.50 : 0.38,
          interactive: false,
        }).addTo(ribbon);
        ribbon.addTo(group);
        ring = ribbon;
      }
      /* The map follows the card. Paging to area 3 and leaving the map
         where it was made the arrows feel broken — the number changed,
         the water did not. It still opens showing all of them; it moves
         only once the angler picks one. */
      if (focusBreak != null && bk === focusBreak) focusTarget = ring;
      else if (focusBreak == null && highlightBreak != null && bk === highlightBreak
               && followedRef.current !== undefined && followedRef.current !== bk) {
        focusTarget = ring;
      }
      allAreas.push(ring);
      /* The pin in the middle of the area carries the number, so the
         angler can go from "1" in the list straight to the water without
         matching shapes by colour. */
      const core = rank
        ? L.marker([h.lat, h.lon], {
            /* Leaflet's own marker pane (z 600), NOT the spot pane.
               Inside one pane the discs are drawn in the order they are
               added, so every blob added after this one covered the
               number — the one label on the map that has to be readable
               was underneath the decoration. */
            icon: L.divIcon({
              className: '',
              iconSize: isFocus ? [34, 34] : [28, 28],
              iconAnchor: isFocus ? [17, 17] : [14, 14],
              html: `<div style="width:${isFocus ? 34 : 28}px;`
                  + `height:${isFocus ? 34 : 28}px;border-radius:50%;`
                  + `background:${color};border:3px solid #fff;`
                  + `box-shadow:0 2px 7px rgba(0,0,0,.5);`
                  + `display:flex;align-items:center;justify-content:center;`
                  + `font:900 ${isFocus ? 18 : 15}px/1 system-ui,sans-serif;`
                  + `color:#0b1220">${rank.n}</div>`,
            }),
          }).addTo(group)
        : L.circleMarker([h.lat, h.lon], {
            pane: 'spotspane',
            radius: isFocus ? 8 : 6,
            stroke: true, color: '#ffffff', weight: 2, opacity: 0.9,
            fillColor: color, fillOpacity: 1,
          }).addTo(group);

      /* The key, ON the area rather than under the map.
         A legend at the bottom asks the angler to look away, hold three
         colours in their head and look back. Naming the thing where it is
         drawn means it cannot be missed, which is the whole point of
         saying it. */
      /* No text on the map.
         The card above it names the break and says how far it runs, and
         tapping that card focuses this shape — so a label here repeated
         what was already said and, sitting over the water, was the first
         thing to collide with a neighbour or run off the edge. The shape
         carries the meaning; the list carries the words. */

      const bits = [
        `<div style="font-weight:800;margin-bottom:4px">${rank ? `${rank.n}. ` : ''}`
          + `${SPOT_LABELS[h.kind] || h.kind}</div>`,
        `<div style="margin-bottom:4px">${h.why || ''}</div>`,
      ].join('');
      /* Tapping a numbered pin opens its card below the map rather than a
         popup on it. A popup covers the water it is describing, and the
         card it duplicates is already on screen with the stats and the
         coordinates in it. */
      if (rank && onPickSpot) core.on('click', () => onPickSpot(bk));
      else core.bindPopup(`<div style="font-size:12px;max-width:230px">${bits}</div>`);
    });
    group.addTo(map);
    spotsRef.current = group;
    allAreas = allAreas.filter(Boolean);
    // Bring the tapped one into view, so the card and the area are
    // obviously the same thing rather than two things that happen to
    // share a colour.
    /* All of them, at once.
       Numbering the areas is no use if the angler has to tap each card to
       bring one into view — the point of a numbered list beside a map is
       comparing the options side by side. With a list driving the map, the
       default view is every area it lists. */
    followedRef.current = focusBreak != null ? focusBreak : highlightBreak;
    if (!focusTarget && spotNumbers && allAreas.length) {
      const all = L.featureGroup(allAreas);
      const ab = all.getBounds();
      if (ab && ab.isValid && ab.isValid()) {
        map.fitBounds(ab, { padding: [36, 36], maxZoom: 8 });
      }
    }
    if (focusTarget) {
      // A layerGroup of circles has no bounds of its own; build them from
      // what it contains.
      const b = typeof focusTarget.getBounds === 'function'
        ? focusTarget.getBounds()
        : null;
      if (b && b.isValid && b.isValid()) {
        map.fitBounds(b, { padding: [50, 50], maxZoom: 8 });
      }
    }
  }, [showSpots, spots, focusBreak, spotNumbers, highlightBreak, onPickSpot]);

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
              // Interactive so it can carry a tooltip — the disc is the
              // thing the eye lands on, so it should be the thing that
              // answers when you point at it.
              interactive: true,
              icon: L.divIcon({
                className: '',
                /* Big enough to identify, and NOT cropped.
                   object-fit: cover filled the circle by cutting the nose
                   and tail off the fish — which removes exactly the parts
                   that tell a snapper from an amberjack, so the thumbnail
                   looked deliberate and said nothing. contain fits the
                   whole fish; the disc behind it keeps the marker reading
                   as a marker rather than a floating cut-out, and 88px
                   leaves the fish as large as it was at 68 cropped. */
                // No disc behind the fish. The navy circle was there to
                // make the marker read as a marker, but it also stamped a
                // hard blue coin over the water and hid whatever layer was
                // underneath. The drop shadow does the separating instead,
                // so the fish sits ON the chart rather than in a hole cut
                // out of it.
                html: `<div style="`
                    + `width:88px;height:88px;`
                    + `transform:translate(-50%,-98px);`
                    + `display:flex;align-items:center;justify-content:center">`
                    + `<img src="${photo.url}" alt="" style="`
                    + `width:100%;height:100%;object-fit:contain;display:block;`
                    + `filter:drop-shadow(0 2px 3px rgba(0,0,0,0.85))`
                    + `${isPB ? ' drop-shadow(0 0 4px #FFC857) drop-shadow(0 0 2px #FFC857)' : ''}">`
                    + `</div>`,
                iconSize: [0, 0],
              }),
            })
              // Name on hover, so the map stays a picture until you ask it
              // a question. Labels drawn permanently were what made this
              // unreadable in the first place.
              .bindTooltip(`${isPB ? '★ ' : ''}${name}`, {
                direction: 'top', offset: [0, -92], opacity: 0.95,
                className: 'kyc-catch-tip',
              })
              .addTo(group);
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

  /* Floating chrome: an opaque pill that survives any imagery under it. */
  /* Above Leaflet's own controls, which sit at z-index 1000 — the zoom
     buttons were drawing through the open layers panel. */
  const floatBox = { position: 'absolute', zIndex: 1100 };
  /* Leaflet's zoom buttons own the top-left corner, so nothing of ours
     goes there. In full screen the container insets for the notch and the
     home indicator, which moves Leaflet's own controls with it. */
  /* An absolutely positioned child is placed against the PADDING box, so
     the container's safe-area padding moved the map and left every
     floating control where it was — the layers button stayed in the
     status bar. The offsets carry the inset themselves. Leaflet prints
     its attribution along the bottom edge, so the bottom row clears that
     too. */
  const SAFE_TOP = 'max(env(safe-area-inset-top, 0px), 46px)';
  const SAFE_BOT = 'max(env(safe-area-inset-bottom, 0px), 24px)';
  const topEdge = full ? `calc(${SAFE_TOP} + 10px)` : 12;
  const bottomEdge = full ? `calc(${SAFE_BOT} + 20px)` : 24;
  const below = (edge, px) => (typeof edge === 'number' ? edge + px : `calc(${edge} + ${px}px)`);
  const pillStyle = (on) => ({
    padding: '10px 15px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 13.5, fontWeight: 800, whiteSpace: 'nowrap',
    background: on ? T.brass : 'rgba(6,20,36,0.92)',
    color: on ? T.oceanDeep : T.ink,
    border: `1.5px solid ${on ? T.brass : 'rgba(255,255,255,0.18)'}`,
    boxShadow: '0 2px 10px rgba(0,0,0,.4)',
  });
  const panelLabel = {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 1.1, color: T.inkMute,
    textTransform: 'uppercase', marginBottom: 7,
  };

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

      {/* Stacked above the map — the standalone Ocean Maps screen, which
          is all map and has the room for them. Plan Your Trip floats the
          same controls instead; see below. */}
      {!embedded && (<>
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
      {/* Not when embedded. Plan Your Trip already asks WHEN at the top of
          the page, and a second identical strip directly above the map
          invites the angler to wonder which one is in charge. */}
      {!embedded && outlook?.length > 1 && (
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

      </>)}

      {/* The map, with its controls ON it.
          Floating chrome was ruled out once because text over a
          chlorophyll composite is unreadable at any colour — true of bare
          text, not of a solid pill. Each control here carries its own
          opaque background, so it reads over imagery the way the zoom
          buttons always have, and the map gets the height the switches
          were taking. */}
      <div style={full ? {
        position: 'fixed', inset: 0, zIndex: 4000, background: '#06182b',
        /* The map stops below the status bar and above the home
           indicator. env() alone is not enough: in the Capacitor webview
           it resolved to 0, so the layers button landed under the clock
           and could not be tapped to close the panel it had opened. max()
           keeps a real floor whatever env() reports, and costs nothing
           where env() is larger. */
        paddingTop: SAFE_TOP,
        paddingBottom: SAFE_BOT,
        boxSizing: 'border-box',
      } : {
        position: 'relative', borderRadius: embedded ? 0 : 16, overflow: 'hidden',
        border: embedded ? 'none' : `1px solid ${T.cardEdge}`,
      }}>
        {/* Shorter than it was, because full screen now exists.
            At 62vh the map filled the phone and the first spot card began
            below the fold — the angler had to scroll to find out there was
            anything under it. Two thirds of that leaves the top of the card
            visible, and the full-screen button is right there for when the
            water is the only thing wanted. */}
        <div ref={mapElRef} style={{
          height: full ? '100%' : (embedded ? '42vh' : '58vh'),
          minHeight: full ? 0 : (embedded ? 300 : 380),
          width: '100%', background: '#06182b',
        }} />

        {embedded && (
          <>
            {/* Every layer behind one button.
                The two satellite chips used to float top-left, where they
                sat under the status bar in full screen and, with the
                layers panel open, made two competing menus on one map.
                One button, one panel, both kinds of layer in it. */}
            <button type="button" aria-label="Layers"
                    onClick={() => setPanel(p => (p === 'layers' ? null : 'layers'))}
                    style={{ ...floatBox, top: topEdge, right: 12, ...pillStyle(panel === 'layers'),
                             width: 46, height: 46, borderRadius: 14, fontSize: 19,
                             display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ☰
            </button>

            {panel === 'layers' && (
              <div style={{
                ...floatBox, top: below(topEdge, 54), right: 12, left: 12,
                maxWidth: 340, marginLeft: 'auto',
                background: 'rgba(6,20,36,0.96)', border: `1px solid ${T.cardEdge}`,
                borderRadius: 16, padding: 13,
                maxHeight: '60%', overflowY: 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ ...panelLabel, margin: 0, flex: 1 }}>Layers</span>
                  <button type="button" aria-label="Close layers"
                          onClick={() => setPanel(null)}
                          style={{
                            width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                            border: `1px solid ${T.cardEdge}`, background: 'transparent',
                            color: T.ink, fontSize: 15, fontFamily: 'inherit', lineHeight: 1,
                          }}>✕</button>
                </div>
                <div style={panelLabel}>Satellite layers</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {Object.values(LAYERS).map(l => viewChip(active === l.key, l.label, () => {
                    setActive(prev => (prev === l.key ? null : l.key));
                    if (active !== l.key) clearOverlays();
                  }))}
                </div>

                <div style={{ ...panelLabel, marginTop: 14 }}>Show on the water</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {overlayChip(showSpots, 'Suggested spots', () => toggleOverlay(setShowSpots))}
                  {overlayChip(showCatches, 'My catches', () => toggleOverlay(setShowCatches))}
                  {overlayChip(showCurrent, 'Current', () => toggleOverlay(setShowCurrent))}
                  {overlayChip(showSpecies, 'Species', () => toggleOverlay(setShowSpecies))}
                </div>
                {showSpecies && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
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
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '6px 11px', borderRadius: 999, cursor: 'pointer',
                          fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
                          background: on ? T.parchmentDeep : 'transparent',
                          border: `1.5px solid ${on ? col : T.cardEdge}`,
                          color: on ? T.ink : T.inkMute, fontFamily: 'inherit',
                        }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: col,
                                         opacity: on ? 1 : 0.45 }} />
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {active && (
                  <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 10, lineHeight: 1.45 }}>
                    Nothing can be drawn over a satellite image and still be read — turn the
                    view off to put these back on the water.
                  </div>
                )}
              </div>
            )}

            {/* Which composite, bottom left — the same four choices, out
                of the way until asked for. */}
            <div style={{ ...floatBox, bottom: bottomEdge, left: 12 }}>
              <button type="button" onClick={() => setPanel(p => (p === 'when' ? null : 'when'))}
                      style={pillStyle(panel === 'when')}>
                {dateISO ? `Imagery ${dateISO}` : 'Latest imagery'} ▾
              </button>
              {panel === 'when' && (
                <div style={{
                  display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap', maxWidth: 230,
                }}>
                  {chip(dateISO === '', 'Latest', () => setDateISO(''))}
                  {[8, 16, 24].map(d => chip(
                    dateISO === new Date(Date.now() - d * 86400000).toISOString().slice(0, 10),
                    `−${d}d`,
                    () => setDateISO(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10))))}
                </div>
              )}
            </div>

            {/* More water, one tap away and one tap back. */}
            <button type="button" aria-label={full ? 'Exit full screen' : 'Full screen'}
                    onClick={() => setFull(f => !f)}
                    style={{ ...floatBox, bottom: bottomEdge, right: 12, ...pillStyle(false),
                             width: 44, height: 44, borderRadius: 13, fontSize: 17,
                             display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {full ? '✕' : '⛶'}
            </button>
          </>
        )}
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

      {/* Nothing to legend when nothing is drawn.
         With both layers off this card said "No satellite layer" and then
         spent a screen explaining where the image went, where the spots
         came from and who owns the data — a block of text as tall as the
         map, about an image that is not on it. The scale, the blurb and
         the attribution all describe a layer, so they appear with one. */}
      {cfg && (
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
            {/* The colour key that used to sit here is gone. Each area is
                now named on the map beside itself, so a legend only asked
                the angler to look away, memorise three colours and look
                back — and the one thing a key must not be is missable. */}
            <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5 }}>
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
                {/* Also the plan page's job when embedded — it prints the
                    same sentence above the spot cards. */}
                {!embedded && ageNote && (
                  <div style={{ marginTop: 6, color: T.warn, fontWeight: 700 }}>{ageNote}</div>
                )}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8 }}>
          Data: NOAA CoastWatch / NASA Ocean Color (public domain). 8-day composites — cloud gaps fill in over time.
        </div>
      </Card>
      )}

      {/* The one thing still worth saying with the layers off: that the
          map has no spots to draw, which otherwise looks like a bug. */}
      {!cfg && showSpots && !embedded && (spots === null || spots.length === 0) && (
        <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5, marginTop: 10 }}>
          {spots === null
            ? 'Suggested spots load when you have signal and are saved for offshore.'
            : 'No strong edges found in the last satellite pass — flat, even water across the region.'}
        </div>
      )}
    </div>
  );
}
