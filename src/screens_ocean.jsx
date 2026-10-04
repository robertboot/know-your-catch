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
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { T } from './theme.js';
import { H1, Card, SectionLabel } from './components.jsx';
import { SPECIES } from './data.js';
import { SUPABASE_URL, client } from './supabase-client.js';
import { imageUrl, cacheAge } from './tile-cache.js';
import { describeAge, readMarineCache, writeMarineCache } from './marine-cache.js';
import { BASEMAP_URL, BASEMAP_LABELS_URL, BASEMAP_ATTRIBUTION, BASEMAP_MAX_ZOOM } from './basemap.js';
import { SNAPSHOT_BOUNDS, snapshotUrl } from './ocean-snapshots.js';

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

export function OceanMapsScreen({ isTablet, initialLayer, state }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const landRef = useRef(null);
  const landGeoRef = useRef(null);
  const [active, setActive] = useState(initialLayer === 'sst' ? 'sst' : 'chl');
  const [status, setStatus] = useState('loading');
  // Non-null when the image on screen came from the device.
  const [overlayAge, setOverlayAge] = useState(null);
  const [dateISO, setDateISO] = useState('');
  const [showLand, setShowLand] = useState(true);
  const [landReady, setLandReady] = useState(false); // GeoJSON loaded → (re)draw mask
  // Marker overlays on top of the colour layer. Independent toggles —
  // these ADD to whichever satellite layer is active.
  const [showCatches, setShowCatches] = useState(false);
  const [showSpots, setShowSpots] = useState(true);
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
    // Land mask above the color overlay so data clips to water only.
    map.createPane('landmask');
    map.getPane('landmask').style.zIndex = 440;
    map.getPane('landmask').style.pointerEvents = 'none';
    fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson')
      .then((r) => r.json())
      .then((geo) => { landGeoRef.current = geo; setLandReady(true); })
      .catch(() => {});
    map.createPane('coastline');
    map.getPane('coastline').style.zIndex = 450;
    map.getPane('coastline').style.pointerEvents = 'none';
    cachedTileLayer(BASEMAP_LABELS_URL, {
      maxZoom: BASEMAP_MAX_ZOOM, pane: 'coastline',
    }).addTo(map);
    mapRef.current = map;
    map.setView([26, -85], 6);
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Swap the WMS overlay when the active layer / date changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = LAYERS[active];
    setStatus('loading');
    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null; }

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

  // Draw/remove the angler's own catches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (catchesRef.current) { map.removeLayer(catchesRef.current); catchesRef.current = null; }
    if (!showCatches) return;
    const catches = (state?.catchLog || []).filter(c => c.lat != null && c.lon != null);
    if (!catches.length) return;
    const group = L.layerGroup();
    catches.forEach((c) => {
      const m = L.circleMarker([c.lat, c.lon], {
        radius: 5, stroke: true, color: '#06212f', weight: 1,
        fillColor: '#5ac8f5', fillOpacity: 0.95,
      }).addTo(group);
      const name = SPECIES.find(s => s.id === c.speciesId)?.commonName || 'Catch';
      const when = c.dateIso ? new Date(c.dateIso).toLocaleDateString() : '';
      m.bindPopup(`<div style="font-size:12px"><b>${name}</b>${when ? `<br/>${when}` : ''}</div>`);
    });
    group.addTo(map);
    catchesRef.current = group;
  }, [showCatches, state?.catchLog]);

  // Add/remove the land mask when toggled (or once GeoJSON arrives).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (landRef.current) { map.removeLayer(landRef.current); landRef.current = null; }
    if (showLand && landGeoRef.current) {
      landRef.current = L.geoJSON(landGeoRef.current, {
        pane: 'landmask', interactive: false,
        style: { fillColor: '#1b2433', fillOpacity: 1, color: '#2b3a4f', weight: 0.6 },
      }).addTo(map);
    }
  }, [showLand, landReady]);

  const cfg = LAYERS[active];
  const chip = (activeState, label, onClick) => (
    <button onClick={onClick} style={{
      padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer',
      background: activeState ? T.brass : 'transparent',
      color: activeState ? T.oceanDeep : T.ink,
      border: `1.5px solid ${activeState ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  return (
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px', maxWidth: '100%', overflowX: 'hidden' }}>
      <H1 size={isTablet ? 30 : 22} style={{ marginBottom: 4 }}>Ocean Maps</H1>
      <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkMute, marginBottom: 12 }}>
        Find the color and the temp breaks — free NOAA/NASA satellite layers for the Gulf & Florida Atlantic.
      </div>

      {/* Layer toggle + marker overlays. Satellite layers are exclusive;
          Spots and Catches stack on top of whichever is active. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {Object.values(LAYERS).map(l => chip(active === l.key, l.label, () => setActive(l.key)))}
        <span style={{ width: 1, background: T.cardEdge, margin: '4px 2px' }} />
        {chip(showSpots, 'Suggested spots', () => setShowSpots(v => !v))}
        {chip(showCatches, 'My catches', () => setShowCatches(v => !v))}
      </div>

      {/* Composite date + land overlay */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 700 }}>Composite</span>
        {chip(dateISO === '', 'Latest', () => setDateISO(''))}
        {[8, 16, 24].map(d => chip(false, `−${d}d`, () => setDateISO(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10))))}
        <button
          onClick={() => setShowLand((v) => !v)}
          style={{
            marginLeft: 'auto', padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
            background: showLand ? T.brass : 'transparent',
            color: showLand ? T.oceanDeep : T.ink,
            border: `1.5px solid ${showLand ? T.brass : T.cardEdge}`,
          }}
        >Land {showLand ? 'on' : 'off'}</button>
      </div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
        <div ref={mapElRef} style={{ height: '58vh', minHeight: 380, width: '100%', background: '#06182b' }} />
        {status === 'error' && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 500,
            background: T.closedBg, color: T.closed, border: `1px solid ${T.closed}`,
            padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, maxWidth: 300,
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
            position: 'absolute', top: 10, left: 10, zIndex: 500,
            background: T.warnBg, color: T.warn, border: `1px solid ${T.warn}88`,
            padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, maxWidth: 320,
          }}>
            Saved image · {describeAge(overlayAge)} — no signal, showing what your phone downloaded.
          </div>
        )}
      </div>

      {/* Legend + blurb */}
      <Card style={{ marginTop: 12, borderRadius: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel style={{ margin: 0 }}>{cfg.label} · {cfg.units}</SectionLabel>
          {status === 'loading' && <span style={{ fontSize: 12, color: T.inkMute }}>Loading…</span>}
          {status === 'ok' && (
            <span style={{ fontSize: 12, color: overlayAge != null ? T.warn : T.open, fontWeight: 700 }}>
              {overlayAge != null ? `Saved · ${describeAge(overlayAge)}` : (dateISO ? `Near ${dateISO}` : 'Latest composite')}
            </span>
          )}
        </div>
        <div style={{
          height: 14, borderRadius: 4, marginTop: 10,
          background: active === 'chl'
            ? 'linear-gradient(90deg, #2b2f6b, #1f6f8b, #2bb673, #9acd32, #d4d400, #7a3d00)'
            : 'linear-gradient(90deg, #2b2f6b, #1f6f8b, #2bb673, #d4d400, #d47a00, #c62828)',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {cfg.legendStops.map((s, i) => <span key={i} style={{ fontSize: 10, color: T.inkMute }}>{s}</span>)}
        </div>
        <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginTop: 10 }}>{cfg.blurb}</div>
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
