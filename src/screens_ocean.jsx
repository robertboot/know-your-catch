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

const ERDDAP_WMS = 'https://coastwatch.pfeg.noaa.gov/erddap/wms';
const GULF_CENTER = [26.0, -88.0];
const GULF_ZOOM = 5;
const REGION_BOUNDS = [[22.0, -98.5], [31.5, -77.5]]; // [SW, NE] lat,lon

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
    legendStops: ['68°', '72°', '77°', '82°', '86°', '89°'],
    blurb: 'Warm-to-cool edges (temperature breaks) concentrate pelagics. Look for tight color gradients, not just the warmest water.',
  },
};

export function OceanMapsScreen({ isTablet }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const landRef = useRef(null);
  const landGeoRef = useRef(null);
  const [active, setActive] = useState('chl');
  const [status, setStatus] = useState('loading');
  const [dateISO, setDateISO] = useState('');
  const [showLand, setShowLand] = useState(true);

  // Init the map once.
  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return undefined;
    const map = L.map(mapElRef.current, {
      center: GULF_CENTER, zoom: GULF_ZOOM, minZoom: 5, maxZoom: 10,
      zoomControl: true, attributionControl: true,
      maxBounds: REGION_BOUNDS, maxBoundsViscosity: 1.0,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    // Land mask above the color overlay so data clips to water only.
    map.createPane('landmask');
    map.getPane('landmask').style.zIndex = 440;
    map.getPane('landmask').style.pointerEvents = 'none';
    fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson')
      .then((r) => r.json())
      .then((geo) => { landGeoRef.current = geo; setShowLand((v) => v); })
      .catch(() => {});
    map.createPane('coastline');
    map.getPane('coastline').style.zIndex = 450;
    map.getPane('coastline').style.pointerEvents = 'none';
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19, pane: 'coastline',
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
    const [[s, w], [n, e]] = REGION_BOUNDS;
    const params = new URLSearchParams({
      service: 'WMS', version: '1.3.0', request: 'GetMap',
      crs: 'EPSG:4326', bbox: `${s},${w},${n},${e}`,
      width: '600', height: '272',
      layers: `${cfg.dataset}:${cfg.variable}`, styles: '',
      format: 'image/png', transparent: 'true',
    });
    if (dateISO) params.set('time', `${dateISO}T12:00:00Z`);
    const url = `${ERDDAP_WMS}/${cfg.dataset}/request?${params.toString()}`;
    const layer = L.imageOverlay(url, REGION_BOUNDS, { opacity: 0.72, attribution: 'Ocean data: NOAA CoastWatch / NASA' });
    layer.on('load', () => setStatus('ok'));
    layer.on('error', () => setStatus('error'));
    layer.addTo(map);
    overlayRef.current = layer;
  }, [active, dateISO]);

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
  }, [showLand]);

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

      {/* Layer toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {Object.values(LAYERS).map(l => chip(active === l.key, l.label, () => setActive(l.key)))}
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
            This layer didn't load — the composite may be cloud-covered for this window. Try an earlier date.
          </div>
        )}
      </div>

      {/* Legend + blurb */}
      <Card style={{ marginTop: 12, borderRadius: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel style={{ margin: 0 }}>{cfg.label} · {cfg.units}</SectionLabel>
          {status === 'loading' && <span style={{ fontSize: 12, color: T.inkMute }}>Loading…</span>}
          {status === 'ok' && <span style={{ fontSize: 12, color: T.open, fontWeight: 700 }}>{dateISO ? `Near ${dateISO}` : 'Latest composite'}</span>}
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
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8 }}>
          Data: NOAA CoastWatch / NASA Ocean Color (public domain). 8-day composites — cloud gaps fill in over time.
        </div>
      </Card>
    </div>
  );
}
