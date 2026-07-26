/* ============================================================
   OCEAN HEAT MAP — admin prototype (NOT in the iOS build).

   Free satellite ocean data overlaid on a Gulf map, the same
   layers the paid subscription apps charge for:
     - Chlorophyll-a (phytoplankton / "the green") — bait & color breaks
     - Sea-surface temperature (SST) — temp edges / weed lines

   Source: NOAA CoastWatch ERDDAP, served via its built-in WMS
   endpoint. WMS is used (rather than a hand-placed image overlay)
   because ERDDAP's WMS reprojects each tile to the map's Web-Mercator
   CRS — so the overlay lines up with the coastline automatically and
   there's no equirectangular-vs-Mercator distortion to correct.

   All data is public domain (NOAA / NASA). We only re-display it;
   attribution is shown on the map. Nothing here ships to the phone
   yet — this lives only in the admin so we can evaluate the look and
   the data quality before wiring it into the app's Patterns tab.

   PROTOTYPE NOTES / knobs to tune are in LAYERS below. If a layer
   renders blank, the composite is likely cloud-covered for that
   window, or the COLORSCALERANGE needs widening for the season.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { T } from '../theme.js';
import { Card, SectionLabel } from '../components.jsx';

const ERDDAP_WMS = 'https://coastwatch.pfeg.noaa.gov/erddap/wms';

// Gulf of Mexico + South Florida view.
const GULF_CENTER = [26.0, -88.0];
const GULF_ZOOM   = 5;
// The app's coverage: US Gulf Coast (TX→FL) + Florida Atlantic waters,
// with a little offshore margin (Gulf Stream break off the FL east coast).
// Locking the map to this box means Leaflet only ever requests tiles/WMS
// data for this region instead of the whole globe — no wasted NOAA pulls.
const REGION_BOUNDS = [[22.0, -98.5], [31.5, -77.5]]; // [SW, NE] lat,lon

/* Each layer maps to an ERDDAP gridded dataset's WMS service.
   - dataset/variable → WMS layer name is `${dataset}:${variable}`
   - style: ERDDAP WMS styles are `boxfill/<palette>`
   - range: COLORSCALERANGE (data units); log for chlorophyll
   - legend: what we print under the map (our own labels, so SST can
     read in °F even though MUR SST is stored in Kelvin). */
const LAYERS = {
  chl: {
    key: 'chl',
    label: 'Chlorophyll',
    // MODIS-Aqua R2022 NRT, 8-day composite, 2003-present (near-real-time).
    // Replaces the retired science-quality erdMH1chla8day (ended 2022). The
    // 8-day composite has far fewer cloud gaps than a daily layer, and NRT
    // keeps it current — the best of both.
    dataset: 'erdMH1chla8day_R2022NRT',
    variable: 'chlorophyll',        // MODIS erdMH1 family uses `chlorophyll`
    palette: 'rainbow',
    range: '0.03,30',
    log: true,
    units: 'mg/m³',
    legendStops: ['0.03', '0.1', '0.5', '1', '3', '30'],
    blurb: 'Green = phytoplankton blooms. Bait and gamefish stack on the color breaks between blue (clear) and green (rich) water.',
  },
  sst: {
    key: 'sst',
    label: 'Sea temp',
    dataset: 'jplMURSST41',         // MUR SST — gap-filled daily, 1 km
    variable: 'analysed_sst',
    palette: 'thermal',
    range: '293,305',               // Kelvin (~68–89 °F) — MUR stores SST in K
    log: false,
    units: '°F (approx)',
    legendStops: ['68°', '72°', '77°', '82°', '86°', '89°'],
    blurb: 'Warm-to-cool edges (temperature breaks) concentrate pelagics. Look for tight color gradients, not just the warmest water.',
  },
};

export default function OceanHeatmapPanel() {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const [active, setActive] = useState('chl');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [dateISO, setDateISO] = useState('');      // '' = latest available composite

  // Init the map once.
  useEffect(() => {
    if (mapRef.current || !mapElRef.current) return;
    const map = L.map(mapElRef.current, {
      center: GULF_CENTER,
      zoom: GULF_ZOOM,
      minZoom: 5,
      maxZoom: 10,
      zoomControl: true,
      attributionControl: true,
      // Hard-lock panning to the coverage region so no off-area tiles load.
      maxBounds: REGION_BOUNDS,
      maxBoundsViscosity: 1.0,
    });
    // Dark base to match the admin theme.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // Fixed center/zoom frames the Gulf + FL Atlantic and does NOT depend on
    // the container being sized (fitBounds against a 0-height container
    // zoomed all the way out — the whole-hemisphere view).
    map.setView([26, -85], 6);
    setTimeout(() => map.invalidateSize(), 200);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Swap the WMS overlay when the active layer changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cfg = LAYERS[active];
    setStatus('loading');

    if (overlayRef.current) { map.removeLayer(overlayRef.current); overlayRef.current = null; }

    const layer = L.tileLayer.wms(`${ERDDAP_WMS}/${cfg.dataset}/request?`, {
      layers: `${cfg.dataset}:${cfg.variable}`,
      styles: `boxfill/${cfg.palette}`,
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      // ERDDAP-specific WMS params (Leaflet forwards unknown options as
      // query params on the request).
      colorscalerange: cfg.range,
      logscale: cfg.log ? 'true' : 'false',
      numcolorbands: 100,
      opacity: 0.72,
      attribution: 'Ocean data: NOAA CoastWatch / NASA',
      // When a date is chosen, request that composite (ERDDAP snaps TIME to
      // the nearest available). Empty → ERDDAP serves the latest. Lets the
      // angler step back off a cloud-covered "latest" to a clearer window.
      ...(dateISO ? { time: `${dateISO}T12:00:00Z` } : {}),
    });
    // Forgiving status: WMS tiles fail individually all the time (a single
    // cloud-covered or timed-out tile), and one stray 'tileerror' should
    // NOT declare the whole layer dead — that flashed a false "didn't load"
    // even when the composite rendered fine. A single successful tile means
    // the layer works; only when the entire visible set fails (load cycle
    // completes with zero tiles loaded) do we surface the error.
    let anyTileLoaded = false;
    layer.on('tileload', () => { anyTileLoaded = true; setStatus('ok'); });
    layer.on('load', () => setStatus(anyTileLoaded ? 'ok' : 'error'));
    layer.addTo(map);
    overlayRef.current = layer;
  }, [active, dateISO]);

  const cfg = LAYERS[active];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <SectionLabel>Ocean heat maps — prototype</SectionLabel>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>
            Free NOAA/NASA satellite layers. Admin-only for now — not in the app yet.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.values(LAYERS).map(l => (
            <button
              key={l.key}
              onClick={() => setActive(l.key)}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
                background: active === l.key ? T.brass : 'transparent',
                color: active === l.key ? T.oceanDeep : T.ink,
                border: `1.5px solid ${active === l.key ? T.brass : T.cardEdge}`,
              }}
            >{l.label}</button>
          ))}
        </div>
      </div>

      {/* Composite date scrubber. Empty = latest available; pick a day to
          step back off a cloud-covered window. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 700 }}>Composite date</span>
        <button
          onClick={() => setDateISO('')}
          style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer',
            background: dateISO === '' ? T.brass : 'transparent',
            color: dateISO === '' ? T.oceanDeep : T.ink,
            border: `1.5px solid ${dateISO === '' ? T.brass : T.cardEdge}`,
          }}
        >Latest</button>
        {[8, 16, 24].map(d => (
          <button
            key={d}
            onClick={() => {
              const dt = new Date(Date.now() - d * 86400000);
              setDateISO(dt.toISOString().slice(0, 10));
            }}
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: 'transparent', color: T.inkSoft, border: `1.5px solid ${T.cardEdge}`,
            }}
          >−{d}d</button>
        ))}
        <input
          type="date"
          value={dateISO}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDateISO(e.target.value)}
          style={{
            padding: '5px 8px', borderRadius: 8, fontSize: 12,
            background: T.oceanDeep, color: T.ink, border: `1.5px solid ${T.cardEdge}`,
            colorScheme: 'dark',
          }}
        />
      </div>

      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
        <div ref={mapElRef} style={{ height: '62vh', minHeight: 420, width: '100%', background: '#06182b' }} />
        {status === 'error' && (
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 500,
            background: T.closedBg, color: T.closed, border: `1px solid ${T.closed}`,
            padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, maxWidth: 320,
          }}>
            This layer didn't load. The composite may be cloud-covered for this window,
            or the dataset id needs updating (see LAYERS in OceanHeatmapPanel.jsx).
          </div>
        )}
      </div>

      {/* Legend + blurb for the active layer. */}
      <Card style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <SectionLabel style={{ margin: 0 }}>{cfg.label} · {cfg.units}</SectionLabel>
          {status === 'loading' && <span style={{ fontSize: 12, color: T.inkMute }}>Loading tiles…</span>}
          {status === 'ok' && (
            <span style={{ fontSize: 12, color: T.open, fontWeight: 700 }}>
              {dateISO ? `Composite near ${dateISO}` : 'Latest composite'}
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
          {cfg.legendStops.map((s, i) => (
            <span key={i} style={{ fontSize: 10, color: T.inkMute }}>{s}</span>
          ))}
        </div>
        <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginTop: 10 }}>{cfg.blurb}</div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8 }}>
          Data: NOAA CoastWatch / NASA Ocean Color (public domain). Prototype — daily
          caching and temperature-break detection come next.
        </div>
      </Card>
    </div>
  );
}
