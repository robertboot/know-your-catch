/* Trip Planning — where to go, before what to catch.
 *
 * Beta surface for the hotspot engine. The question an offshore crew
 * actually asks at 4am is not "what should I target", it is "where do I
 * point the boat" — and the answer depends entirely on how they intend to
 * fish. A temperature break 40 miles out is the whole answer for a
 * trolling trip and completely irrelevant to a bottom trip, which wants
 * structure and depth instead.
 *
 * So the mode comes first and decides which data is even consulted. Three
 * of the four modes have no data layer yet; they say so plainly rather
 * than rendering an empty map that looks like "no fish today".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { T } from '../theme.js';
import { Card, GhostButton, SectionLabel } from '../components.jsx';
import { client, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-client.js';
import { getLastSession } from '../auth.js';
import { TRIP_MODES } from '../trip-modes.js';
import { fishabilityHour, fishabilityGrade, fishabilityColor } from '../forecast-extras.js';
import { SNAPSHOT_BOUNDS, snapshotUrl } from '../ocean-snapshots.js';
import { habitatScore } from '../species-habitat.js';
import { speciesPhoto } from '../helpers.js';
import { SPECIES, JURISDICTIONS } from '../data.js';
import { BASEMAP_URL, BASEMAP_LABELS_URL, BASEMAP_ATTRIBUTION, BASEMAP_MAX_ZOOM } from '../basemap.js';

const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toFixed(d));

/* Mode cards name the fish, because "pelagic" is a word for people who
   already know the answer. Resolved through SPECIES rather than written
   out again so a rename lands here too. */
const SPECIES_NAME = new Map(SPECIES.map(s => [s.id, s.commonName]));

/* Which of this mode's fish suit this particular water.
 *
 * Scored on the CLIENT, from the measurements the server already wrote on
 * the row, rather than in the edge function. The habitat table is a set of
 * claims about fish that Robert will want to argue with, and this way an
 * edit to it changes what the map says without a redeploy — and there is
 * never a second copy of it living in Deno. Depth is not in the rows yet,
 * so it scores as unknown rather than as wrong.
 *
 * SST_GRAD_GOOD mirrors the edge function's threshold for a strong break;
 * the two must move together. */
const SST_GRAD_GOOD = 1.5;
function speciesForSpot(spot, mode, monthIdx) {
  const ids = TRIP_MODES.find(m => m.key === mode)?.species || [];
  const edgeStrength = Math.min(1, (spot.sst_grad_f_nm || 0) / SST_GRAD_GOOD);
  return ids
    .map(id => ({ id, score: habitatScore(id, {
      sstF: spot.sst_f, chlMgM3: spot.chl_mg_m3, edgeStrength, month: monthIdx,
    }) }))
    .filter(x => x.score != null && x.score > 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}
const speciesNames = (ids) =>
  (ids || []).map(id => SPECIES_NAME.get(id)).filter(Boolean).join(' · ');
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const compass = (deg) => (deg == null ? '' : COMPASS[Math.round(deg / 22.5) % 16]);

/* Score colour. Deliberately the same ramp idea as Fishability: a score
   and its colour must never disagree, or the map says one thing and the
   card says another. */
/* The pelagic list comes from TRIP_MODES — one copy; the zone rows the
   server writes are keyed by these same ids. Colours one per species,
   chosen to stay tellable-apart over blue water. */
const PELAGIC_SPECIES = TRIP_MODES.find(m => m.key === 'troll_pelagic').species;
const SPECIES_ZONE_COLORS = {
  mahi:          '#2BE07F',
  yellowfin_tuna:'#ffd23d',
  blackfin_tuna: '#c08cff',
  bigeye_tuna:   '#7c3aed',
  bluefin_tuna:  '#5ac8f5',
  wahoo:         '#ff5a3d',
  blue_marlin:   '#4f7bff',
  white_marlin:  '#0d9488',
  sailfish:      '#ff9a3d',
  swordfish:     '#ff7ab8',
};

function scoreColor(s) {
  if (s == null) return '#7d8ca0';
  if (s >= 85) return '#63e08a';
  if (s >= 70) return '#4fa64a';
  if (s >= 55) return '#d9b038';
  return '#e07b2f';
}

export default function TripPlanningPanel() {
  // Pelagic trolling is THE mode now — the HOW selector is gone. Like the
  // Sirius app, the map answers one question: where is each trolled
  // species most likely to be.
  const mode = 'troll_pelagic';
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [spots, setSpots] = useState([]);
  const [observedAt, setObservedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [overlayErr, setOverlayErr] = useState('');
  // Opacity per layer, not one shared slider: reading a temperature break
  // against the colour line means fading one UNDER the other, and a single
  // control can only fade both together.
  // OFF by default. The species zones are the subject of this map, and
  // even at 20% the satellite wash sat on top of them — raise a slider
  // when you want to read a break against the zones.
  const [opacity, setOpacity] = useState({ sst: 0, chl: 0 });
  // 'mine' | 'all' | 'off'. Defaults to mine: on a map of 71 points the
  // useful question is "where have I been", and everyone else's marks
  // answer a different one.
  const [catchView, setCatchView] = useState('mine');
  const [catches, setCatches] = useState([]);
  // Species map — one zone row per pelagic species, each its own colour.
  const [zoneRows, setZoneRows] = useState([]);   // hotspot_zones rows, keyed by species
  const [speciesOn, setSpeciesOn] = useState(() => new Set(['mahi', 'yellowfin_tuna', 'wahoo', 'blackfin_tuna', 'sailfish']));
  const [showCurrents, setShowCurrents] = useState(false); // off by default — opt in
  const zonesLayerRef = useRef(null);
  const currentsLayerRef = useRef(null);
  const [pbIds, setPbIds] = useState(() => new Set());
  const [anglers, setAnglers] = useState(() => new Map());
  const [sstRange, setSstRange] = useState(null);
  // A planner without a date is just a map. Default to today because that
  // is the trip you might still make, but the useful case is Thursday on a
  // Sunday evening — which is why the strip runs out to the end of the
  // marine forecast rather than stopping at tomorrow.
  const [dayIso, setDayIso] = useState(() => new Date().toISOString().slice(0, 10));
  const [cond, setCond] = useState(null);
  const [condErr, setCondErr] = useState('');

  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const overlayRef = useRef([]);

  const region = useMemo(
    () => regions.find(r => r.id === regionId) || null,
    [regions, regionId],
  );

  // ---- regions -----------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const c = client();
      if (!c) { setError('Supabase is not configured in this build.'); return; }
      const { data, error: err } = await c.from('hotspot_regions')
        .select('*').eq('active', true).order('label');
      if (!alive) return;
      if (err) { setError(`${err.message} — has supabase/hotspots-schema.sql been run?`); return; }
      setRegions(data || []);
      if (data?.length) setRegionId(prev => prev || data[0].id);
    })();
    return () => { alive = false; };
  }, []);

  // ---- spots, ALL regions -------------------------------------------
  // The map is the whole Gulf now; each region contributes its latest
  // pass's spots. 72h window keeps a cloudy region's older-but-current
  // edges without letting a stale week back in.
  const load = useCallback(async () => {
    const c = client();
    if (!c) return;
    setLoading(true); setError('');
    const since = new Date(Date.now() - 72 * 3600000).toISOString();
    const { data, error: err } = await c.from('hotspots')
      .select('*').gte('observed_at', since)
      .order('score', { ascending: false }).limit(60);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSpots(data || []);
    setObservedAt((data || []).reduce((a, s) => (a && a > s.observed_at ? a : s.observed_at), null));
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- conditions for the chosen day ---------------------------------
  // The edges are OBSERVED and cannot be forecast; the weather can. So the
  // day you pick does not change which breaks exist — it changes whether
  // you can get to them, and how stale the satellite will be by then.
  // Ribbon grades the user's own FISHING WATERS — the jurisdiction picked
  // during app setup (read from the app's saved state; admin shares the
  // origin). Offshore grading point per jurisdiction, ~30-60 nm out —
  // graded where the boat goes, not at the capitol building.
  const waters = useMemo(() => {
    const PTS = {
      al_state:     { lat: 29.8, lon: -87.9 },
      ms_state:     { lat: 29.9, lon: -88.6 },
      la_state:     { lat: 28.6, lon: -90.0 },
      tx_state:     { lat: 27.8, lon: -96.4 },
      fl_state:     { lat: 27.5, lon: -83.6 },
      fl_atlantic:  { lat: 27.8, lon: -79.9 },
      fed_gulf:     { lat: 27.5, lon: -88.5 },
      fed_satlantic:{ lat: 28.5, lon: -79.5 },
    };
    try {
      const st = JSON.parse(localStorage.getItem('kyc_app_state_v1') || 'null');
      const jid = st?.jurisdiction;
      const jur = JURISDICTIONS.find(j => j.id === jid);
      if (jur && PTS[jid]) return { ...PTS[jid], name: jur.name };
    } catch { /* fall through to central Gulf */ }
    return { lat: 27.5, lon: -88.5, name: 'the central Gulf' };
  }, []);

  useEffect(() => {
    let alive = true;
    const { lat, lon } = waters;
    (async () => {
      setCondErr('');
      try {
        const wx = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
          + `&hourly=wind_speed_10m,wind_gusts_10m,weather_code`
          + `&forecast_days=10&timezone=auto&wind_speed_unit=kn&cell_selection=sea`;
        const mr = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
          + `&hourly=wave_height,wave_period&forecast_days=10&timezone=auto&cell_selection=sea`;
        const [a, b] = await Promise.all([fetch(wx), fetch(mr).catch(() => null)]);
        if (!a.ok) throw new Error(`weather ${a.status}`);
        const j = await a.json();
        const m = b && b.ok ? await b.json() : null;
        if (!alive) return;
        const times = j.hourly?.time || [];
        const byDay = {};
        for (let i = 0; i < times.length; i++) {
          const d = times[i].slice(0, 10);
          // Daylight hours only. A 3am gale does not stop a trip that
          // leaves at seven, and averaging it in says the day is unfishable
          // when it is not.
          const hr = Number(times[i].slice(11, 13));
          if (hr < 6 || hr > 18) continue;
          (byDay[d] ||= []).push({
            wind: j.hourly.wind_speed_10m?.[i],
            gust: j.hourly.wind_gusts_10m?.[i],
            weatherCode: j.hourly.weather_code?.[i],
            waveFt: m?.hourly?.wave_height?.[i] != null ? m.hourly.wave_height[i] * 3.28084 : null,
            periodS: m?.hourly?.wave_period?.[i] ?? null,
          });
        }
        const out = {};
        for (const [d, hrs] of Object.entries(byDay)) {
          const avg = (k) => {
            const v = hrs.map(h => h[k]).filter(x => x != null);
            return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
          };
          const scores = hrs.map(fishabilityHour).filter(x => x != null);
          out[d] = {
            wind: avg('wind'),
            gust: Math.max(...hrs.map(h => h.gust ?? 0)) || null,
            waveFt: avg('waveFt'),
            periodS: avg('periodS'),
            // Worst-case weighted, same as the 6-hour blocks: a day with one
            // ugly stretch is not the average of its hours.
            score: scores.length
              ? Math.round(0.6 * (scores.reduce((x, y) => x + y, 0) / scores.length)
                           + 0.4 * Math.min(...scores))
              : null,
          };
        }
        setCond(out);
      } catch (e) {
        if (alive) { setCond(null); setCondErr(String(e?.message || e)); }
      }
    })();
    return () => { alive = false; };
  }, []);

  const days = useMemo(() => {
    const out = [];
    const t0 = new Date(); t0.setHours(12, 0, 0, 0);
    for (let i = 0; i < 10; i++) {
      const d = new Date(t0.getTime() + i * 86400000);
      out.push({
        iso: d.toISOString().slice(0, 10),
        label: i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' }),
        sub: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      });
    }
    return out;
  }, []);

  const today = cond?.[dayIso] || null;
  // How old the satellite will be on the day being planned. A break drifts
  // with the current; past about four days it is a hint, not a position.
  const edgeAgeDays = observedAt
    ? Math.round((new Date(dayIso + 'T12:00:00') - new Date(observedAt)) / 86400000)
    : null;

  // ---- map ----------------------------------------------------------
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(BASEMAP_URL, {
      attribution: BASEMAP_ATTRIBUTION, maxZoom: BASEMAP_MAX_ZOOM,
    }).addTo(map);
    L.tileLayer(BASEMAP_LABELS_URL, {
      maxZoom: BASEMAP_MAX_ZOOM, pane: 'shadowPane',
    }).addTo(map);
    map.fitBounds(SNAPSHOT_BOUNDS, { padding: [10, 10] });
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
  }, []);

  // The satellite picture underneath, straight off the snapshots the
  // refresh-ocean-maps function renders every six hours. Same images the
  // app shows, same bounds, so what you see here is what a user would see.
  //
  // Both layers can be on together. That is the point: a temperature break
  // ON a colour change is the clean-water line, and you can only see the
  // two line up by looking at them together.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const l of overlayRef.current || []) map.removeLayer(l);
    overlayRef.current = [];
    setOverlayErr('');

    const added = [];
    for (const key of ['chl', 'sst']) {          // sst last → sits on top
      if (!(opacity[key] > 0)) continue;
      const url = snapshotUrl(key);
      if (!url) { setOverlayErr('Supabase is not configured in this build.'); continue; }
      const layer = L.imageOverlay(url, SNAPSHOT_BOUNDS, {
        opacity: opacity[key], attribution: 'Ocean data: NOAA CoastWatch / NASA',
      });
      // Say so. A silently missing overlay looks exactly like water with
      // nothing in it, which is the wrong conclusion to let someone draw.
      layer.on('error', () => {
        map.removeLayer(layer);
        setOverlayErr(`No ${key === 'sst' ? 'temperature' : 'chlorophyll'} snapshot yet — `
          + 'the refresh-ocean-maps job writes it every six hours.');
      });
      layer.addTo(map);
      added.push(layer);
    }
    overlayRef.current = added;
  }, [opacity]);

  // Species zones for the region — one small row per pelagic species,
  // written nightly by find-hotspots from habitat priors (temperature
  // band, season, depth) × edge strength.
  useEffect(() => {
    let alive = true;
    (async () => {
      setZoneRows([]);
      const c = client();
      if (!c) return;
      // ALL regions — the species map covers the whole satellite footprint.
      const { data } = await c.from('hotspot_zones')
        .select('*').in('mode_key', [...PELAGIC_SPECIES, '_currents']);
      if (alive) setZoneRows(data || []);
    })();
    return () => { alive = false; };
  }, []);

  // Draw each toggled-on species in its own colour, on a pane UNDER the
  // catch/spot markers. Opacity ranks WITHIN the species (relative, like
  // Sirius): the densest mahi water this week is full-strength even in a
  // mediocre week.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getPane('zonespane')) {
      map.createPane('zonespane');
      map.getPane('zonespane').style.zIndex = 405;
      map.getPane('zonespane').style.pointerEvents = 'none';
    }
    if (zonesLayerRef.current) { map.removeLayer(zonesLayerRef.current); zonesLayerRef.current = null; }
    const rows = zoneRows.filter(z => speciesOn.has(z.mode_key) && z.cells?.length);
    if (!rows.length) return;
    const group = L.layerGroup();
    // One soft RASTER per species instead of hundreds of circles: paint
    // the cells into a tiny canvas at grid resolution and let the browser
    // stretch it — bilinear scaling melts the grid into the smooth
    // organic areas the Sirius map draws. Circles overlapped into
    // polka-dot soup the moment two neighbours were both hot.
    //
    // Rows are per REGION; merge each species' rows into ONE canvas
    // first, or the region-box overlaps double-paint at every seam.
    const bySpecies = new Map();
    for (const z of rows) {
      const m = bySpecies.get(z.mode_key) || { mode_key: z.mode_key, step_deg: z.step_deg, cells: [] };
      m.cells = m.cells.concat(z.cells);
      bySpecies.set(z.mode_key, m);
    }
    for (const z of bySpecies.values()) {
      z.cells.sort((a, b) => b[2] - a[2]); // best-first across the whole Gulf
      const color = SPECIES_ZONE_COLORS[z.mode_key] || T.brass;
      const [cr, cg, cb] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
      const step = z.step_deg || 0.06;
      const lats = z.cells.map(c => c[0]), lons = z.cells.map(c => c[1]);
      const latMin = Math.min(...lats), latMax = Math.max(...lats);
      const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
      const W = Math.round((lonMax - lonMin) / step) + 1;
      const H = Math.round((latMax - latMin) / step) + 1;
      if (W < 1 || H < 1 || W * H > 400000) continue;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(W, H);
      const n = z.cells.length; // best-first from the server
      z.cells.forEach(([lat, lon], idx) => {
        const x = Math.round((lon - lonMin) / step);
        const y = Math.round((latMax - lat) / step); // canvas y grows downward
        if (x < 0 || x >= W || y < 0 || y >= H) return;
        const a = idx < n * 0.15 ? 150 : idx < n * 0.40 ? 105 : 60;
        const p = (y * W + x) * 4;
        img.data[p] = cr; img.data[p + 1] = cg; img.data[p + 2] = cb;
        img.data[p + 3] = Math.max(img.data[p + 3], a);
      });
      ctx.putImageData(img, 0, 0);
      L.imageOverlay(canvas.toDataURL(), [
        [latMin - step / 2, lonMin - step / 2],
        [latMax + step / 2, lonMax + step / 2],
      ], { pane: 'zonespane', opacity: 1, interactive: false }).addTo(group);
    }
    group.addTo(map);
    zonesLayerRef.current = group;
  }, [zoneRows, speciesOn]);

  // Current arrows — geostrophic (loop current + eddies, from sea-surface
  // height). Drawn above the zones, below the markers. dir is where the
  // water flows TOWARD; the glyph '➤' points east at 0 rotation, so
  // rotate by (dir - 90).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getPane('currentspane')) {
      map.createPane('currentspane');
      map.getPane('currentspane').style.zIndex = 406;
      map.getPane('currentspane').style.pointerEvents = 'none';
    }
    if (currentsLayerRef.current) { map.removeLayer(currentsLayerRef.current); currentsLayerRef.current = null; }
    // ALL regions' current rows, deduped at the box overlaps (same 0.25°
    // grid everywhere, so identical lat,lon = the same measurement).
    const curRows = zoneRows.filter(z => z.mode_key === '_currents' && z.cells?.length);
    if (!showCurrents || !curRows.length) return;
    const seen = new Set();
    const vectors = [];
    for (const z of curRows) {
      for (const cell of z.cells) {
        const k = `${cell[0]},${cell[1]}`;
        if (seen.has(k)) continue;
        seen.add(k);
        vectors.push(cell);
      }
    }
    const group = L.layerGroup();
    for (const [lat, lon, kt, dir] of vectors) {
      const size = 13 + Math.min(13, kt * 9);          // faster = bigger arrow
      const op = 0.5;                                  // flat 50% — informative, never loud
      // Dark glyph with a light halo — the pale blue read as nothing on
      // the pale GEBCO basemap.
      L.marker([lat, lon], {
        pane: 'currentspane', interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          html: `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;`
              + `transform:rotate(${dir - 90}deg);color:#12324f;opacity:${op};`
              + `font-size:${size}px;line-height:1;font-weight:900;`
              + `text-shadow:0 0 2px rgba(255,255,255,.9),0 0 5px rgba(255,255,255,.6)">➤</div>`,
        }),
      }).addTo(group);
    }
    group.addTo(map);
    currentsLayerRef.current = group;
  }, [zoneRows, showCurrents]);

  // Who logged what. Several of these 71 catches are testers entering mock
  // data, and a spot built from invented fish is worse than no spot at all.
  useEffect(() => {
    let alive = true;
    const c = client();
    if (!c) return;
    c.rpc('admin_angler_emails').then(({ data }) => {
      if (alive && data) setAnglers(new Map(data.map(r => [r.user_id, r.email])));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // The scale the image was actually drawn with, published beside it. A
  // legend that recomputes the range is a legend that can disagree with
  // its own colours.
  useEffect(() => {
    let alive = true;
    const url = snapshotUrl('sst');
    if (!url) return;
    fetch(url.replace(/\.png$/, '.json'))
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && j?.lo != null) setSstRange(j); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Where fish have actually come from. The satellite says where the water
  // changes; the logbook says where that mattered.
  useEffect(() => {
    if (catchView === 'off') { setCatches([]); return; }
    const [[bS, bW], [bN, bE]] = SNAPSHOT_BOUNDS;
    let alive = true;
    (async () => {
      const c = client();
      if (!c) return;
      // Personal bests alongside the catches: a pb row carries the id of the
      // catch that set it, which is the only honest way to know which mark
      // on the map is somebody's best — heaviest-in-the-table would be our
      // opinion, not theirs.
      const [{ data }, { data: pbRows }] = await Promise.all([
        c.from('catches')
          .select('*')
          .gte('lat', bS).lte('lat', bN)
          .gte('lon', bW).lte('lon', bE)
          .limit(500),
        c.from('pbs').select('data, deleted_at').limit(2000),
      ]);
      if (!alive) return;
      setPbIds(new Set((pbRows || [])
        .filter(r => !r.deleted_at && r.data?.catchId)
        .map(r => r.data.catchId)));
      setCatches((data || []).filter(r => r.lat != null && r.lon != null));
    })();
    return () => { alive = false; };
  }, [catchView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;

    // Every region's port, lightly — reference points on a whole-Gulf map,
    // not the subject. The dashed region boxes are gone: nine rectangles
    // over one map read as a broken grid, not as information.
    const seenPorts = new Set();
    for (const r of regions) {
      const k = `${r.port_lat},${r.port_lon}`;
      if (seenPorts.has(k)) continue;
      seenPorts.add(k);
      L.circleMarker([r.port_lat, r.port_lon], {
        radius: 4, color: '#ffffff', weight: 1.5, fillColor: T.brass, fillOpacity: 0.9,
      }).bindTooltip(r.port_name, { direction: 'top' }).addTo(group);
    }

    // Catches first so a spot marker is never hidden behind one.
    const myId = getLastSession()?.user?.id || null;
    // The live table uses user_id; older rows carry angler_id. Reading only
    // one would quietly show an empty "Mine".
    const ownerOf = (c) => c.user_id || c.angler_id || null;
    const shown = catchView === 'mine' && myId
      ? catches.filter(c => ownerOf(c) === myId)
      : catches;
    for (const c of shown) {
      const owner = ownerOf(c);
      const mine = !myId || owner === myId;
      const name = SPECIES_NAME.get(c.species_id) || c.species_id || 'Catch';
      const when = c.caught_at || c.date_iso;
      const label = `${name}${when ? ` · ${String(when).slice(0, 10)}` : ''}`
        + (pbIds.has(c.id) ? ' · personal best' : '')
        + (mine ? '' : ` · ${anglers.get(owner) || 'another angler'}`);
      // The species photo, same source the app uses, so a catch on this map
      // is recognisable at a glance instead of being one more dot among the
      // spots. Falls back to a plain mark where a species has no photo —
      // a broken image icon would read as a fault.
      const photo = speciesPhoto(c.species_id);
      const isPB = pbIds.has(c.id);
      // The star sits beside the photo rather than on it: a badge over the
      // fish hides the one thing the icon exists to show.
      const star = isPB
        ? '<span style="position:absolute;left:19px;top:-4px;font-size:13px;'
          + 'line-height:1;text-shadow:0 1px 3px rgba(0,0,0,.7)">\u2b50</span>'
        : '';
      const marker = photo?.url
        ? L.marker([c.lat, c.lon], {
            icon: L.divIcon({
              className: '',
              iconSize: [26, 26],
              iconAnchor: [13, 13],
              html: `<div style="position:relative;width:26px;height:26px">`
                  + `<img src="${photo.url}" alt="" style="width:26px;height:26px;`
                  + `border-radius:50%;object-fit:cover;display:block;`
                  + `border:1.5px solid ${isPB ? '#f5c542' : T.brass};`
                  + `box-shadow:0 1px 4px rgba(0,0,0,.5);`
                  // Other anglers' catches sit back a little so your own
                  // track still reads as a track.
                  + `opacity:${mine ? 1 : 0.55}">${star}</div>`,
            }),
          })
        : L.circleMarker([c.lat, c.lon], {
            radius: 4, color: '#ffffff', weight: 1, opacity: mine ? 0.7 : 0.4,
            fillColor: T.brass, fillOpacity: mine ? 0.55 : 0.3,
          });
      marker.bindTooltip(label, { direction: 'top' }).addTo(group);
    }

    for (const s of spots) {
      // Radius carries the score so the map ranks at a glance; the ring
      // marks the one you have selected in the list.
      L.circleMarker([s.lat, s.lon], {
        radius: 6 + (s.score / 100) * 8,
        color: selected === s.id ? '#ffffff' : scoreColor(s.score),
        weight: selected === s.id ? 3 : 1.5,
        fillColor: scoreColor(s.score),
        fillOpacity: 0.55,
      })
        .bindPopup(`<b>${Math.round(s.score)}</b> &middot; ${s.why}`)
        .on('click', () => setSelected(s.id))
        .addTo(group);
    }

  }, [spots, regions, selected, catches, pbIds, catchView, anglers]);

  // ---- recompute -----------------------------------------------------
  const recompute = async () => {
    if (running) return;
    setRunning(true); setError('');
    try {
      const token = getLastSession()?.access_token;
      // No region in the body → the function runs every active region.
      // Nine regions × four satellite grids: minutes, not seconds.
      const r = await fetch(`${SUPABASE_URL}/functions/v1/find-hotspots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({}),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      const bad = (body.regions || []).filter(x => x.error);
      if (bad.length) throw new Error(`${bad.length} region(s) failed — first: ${bad[0].region}: ${bad[0].error}`);
      await load();
    } catch (e) {
      // The reply, verbatim. A scraped satellite run fails for reasons no
      // generic message covers, and guessing wastes a round trip.
      setError(String(e?.message || e));
    } finally {
      setRunning(false);
    }
  };

  const activeMode = TRIP_MODES.find(m => m.key === mode);
  // The month of the DAY BEING PLANNED. Scoring a Thursday in November
  // against October's seasons is the sort of error nobody notices until a
  // closed-season fish is being recommended.
  const planMonth = Number(dayIso.slice(5, 7));

  return (
    // minmax(0,1fr): without it the day ribbon widens the page instead of
    // scrolling inside its own card, and the admin header scrolls off-screen.
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)',
                  maxWidth: '100%', minWidth: 0 }}>
      {/* One map, the whole Gulf + Florida Atlantic — no waters picker.
          The species zones cover every region at once. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    marginTop: -4, marginBottom: 2 }}>
        <div style={{ flex: 1 }} />
        <GhostButton onClick={recompute} disabled={running}>
          {running ? 'Reading satellites…' : 'Regenerate'}
        </GhostButton>
      </div>

      <Card style={{ minWidth: 0, overflow: 'hidden' }}>
        <SectionLabel>When are you going?</SectionLabel>
        <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 4 }}>
          Graded for your fishing waters — {waters.name}, set when you set up the app.
        </div>
        {/* The ribbon scrolls. On iPad the tenth day was half off the edge
            with nothing to say it was reachable, so: momentum scrolling,
            snap points, and days that cannot shrink below a readable width. */}
        <div style={{
          display: 'flex', gap: 6, marginTop: 8, paddingBottom: 6,
          // width + minWidth:0 together are what actually make this scroll.
          // overflowX alone does nothing when the element is free to grow —
          // it just got wider than the page and took the header with it.
          width: '100%', maxWidth: '100%', minWidth: 0,
          overflowX: 'auto', overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'x proximity',
          scrollbarWidth: 'thin',
        }}>
          {days.map(d => {
            const c = cond?.[d.iso];
            const col = c?.score != null ? fishabilityColor(c.score) : T.cardEdge;
            const on = dayIso === d.iso;
            return (
              <button key={d.iso} onClick={() => setDayIso(d.iso)}
                style={{
                  flex: '0 0 auto', minWidth: 74, padding: '8px 10px', borderRadius: 10,
                  scrollSnapAlign: 'start',
                  cursor: 'pointer', textAlign: 'center', color: T.ink,
                  background: on ? T.parchmentDeep : 'transparent',
                  border: `1px solid ${on ? T.brass : T.cardEdge}`,
                  borderBottom: `3px solid ${col}`,
                }}>
                <div style={{ fontSize: 12.5, fontWeight: 800 }}>{d.label}</div>
                <div style={{ fontSize: 10.5, color: T.inkMute }}>{d.sub}</div>
                <div style={{ fontSize: 13, fontWeight: 900, marginTop: 2, color: col }}>
                  {c?.score != null ? fishabilityGrade(c.score) : '—'}
                </div>
              </button>
            );
          })}
        </div>
        {today && (
          <div style={{ fontSize: 13, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
            {fmt(today.wind)} kt{today.gust ? ` gusting ${fmt(today.gust)}` : ''}
            {today.waveFt != null ? ` · ${fmt(today.waveFt, 1)} ft` : ''}
            {today.periodS != null ? ` at ${fmt(today.periodS, 1)} s` : ''}
            {today.score != null && today.score < 60 && (
              <span style={{ color: T.closed, fontWeight: 800 }}>
                {' '}· too rough to be worth planning around
              </span>
            )}
          </div>
        )}
        {condErr && (
          <div style={{ fontSize: 12.5, color: T.inkMute, marginTop: 8 }}>
            Conditions unavailable ({condErr}). The spots below are unaffected — they come
            from the satellite, not the forecast.
          </div>
        )}
      </Card>
      {(observedAt || error) && (
        <Card>
          {observedAt && (
            <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5 }}>
              Satellite pass {new Date(observedAt).toLocaleString()} ·{' '}
              {spots.length} edge{spots.length === 1 ? '' : 's'} found
              
              {/* Breaks cannot be forecast — they are observed, and they drift
                  with the current. Saying how stale the picture will be on the
                  chosen day is the difference between a position and a hint. */}
              {edgeAgeDays != null && edgeAgeDays >= 1 && (
                <div style={{ marginTop: 4, color: edgeAgeDays >= 4 ? T.warn : T.inkMute }}>
                  {edgeAgeDays === 1
                    ? 'One day old by your trip — expect it to have moved a few miles.'
                    : `${edgeAgeDays} days old by your trip — ${
                        edgeAgeDays >= 4
                          ? 'treat these as a direction to look, not a position.'
                          : 'expect it to have drifted with the current.'}`}
                </div>
              )}
            </div>
          )}
          {error && (
            <div style={{ marginTop: observedAt ? 8 : 0, fontSize: 12.5, color: T.closed,
                          whiteSpace: 'pre-wrap' }}>{error}</div>
          )}
        </Card>
      )}


      {!activeMode?.ready ? (
        <Card>
          <div style={{ padding: '6px 2px' }}>
            <p style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: T.ink }}>
              {activeMode?.label} has no data layer yet.
            </p>
            <p style={{ margin: 0, fontSize: 13.5, color: T.inkMute, lineHeight: 1.5 }}>
              It needs {activeMode?.needs?.toLowerCase()}. Showing an empty map here would read as
              “nothing biting”, which is a different and much worse claim than “not built yet”.
            </p>
          </div>
        </Card>
      ) : (
        <>
            <Card style={{ minWidth: 0 }}>
            <div style={{ display: 'grid', gap: 7, marginBottom: 10 }}>
              {[['sst', 'Temperature'], ['chl', 'Chlorophyll']].map(([k, lab]) => (
                <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: T.ink, minWidth: 92 }}>{lab}</span>
                  <input type="range" min="0" max="1" step="0.05" value={opacity[k]}
                    onChange={e => setOpacity(o => ({ ...o, [k]: Number(e.target.value) }))}
                    style={{ flex: 1, maxWidth: 240, accentColor: T.brass }} />
                  <span style={{ fontSize: 11.5, color: T.inkMute, minWidth: 34, textAlign: 'right' }}>
                    {Math.round(opacity[k] * 100)}%
                  </span>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>Species map</span>
                {PELAGIC_SPECIES.map((sp) => {
                  const on = speciesOn.has(sp);
                  const hasData = zoneRows.some(z => z.mode_key === sp && z.cells?.length);
                  return (
                    <button key={sp}
                      onClick={() => setSpeciesOn(prev => {
                        const next = new Set(prev);
                        if (next.has(sp)) next.delete(sp); else next.add(sp);
                        return next;
                      })}
                      title={hasData ? '' : 'No habitable water in this region this week'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5,
                        fontWeight: 800, color: T.ink, opacity: hasData || !zoneRows.length ? 1 : 0.45,
                        background: on ? T.parchmentDeep : 'transparent',
                        border: `1px solid ${on ? (SPECIES_ZONE_COLORS[sp] || T.brass) : T.cardEdge}`,
                      }}>
                      <span style={{ width: 9, height: 9, borderRadius: 5, background: SPECIES_ZONE_COLORS[sp] || T.brass, display: 'inline-block' }} />
                      {SPECIES_NAME.get(sp) || sp}
                    </button>
                  );
                })}
                <button onClick={() => setShowCurrents(v => !v)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5,
                    fontWeight: 800, color: T.ink,
                    background: showCurrents ? T.parchmentDeep : 'transparent',
                    border: `1px solid ${showCurrents ? '#cfeaff' : T.cardEdge}`,
                  }}>
                  <span style={{ color: '#cfeaff' }}>➤</span> Currents
                </button>
                <span style={{ fontSize: 11.5, color: T.inkMute, flexBasis: '100%' }}>
                  Where each species' water is this week — temperature band, season, depth and the
                  edges, from last night's satellite pass. Deeper colour = that species' best water.
                  Arrows are the surface current (loop current and eddies); bigger = faster.
                  {!zoneRows.length && ' No zones for this region yet — Regenerate, or wait for tonight.'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>Catches</span>
                {[['mine', 'Mine'], ['all', 'Everyone'], ['off', 'Off']].map(([k, lab]) => (
                  <button key={k} onClick={() => setCatchView(k)}
                    style={{
                      padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5,
                      fontWeight: 800, color: T.ink,
                      background: catchView === k ? T.parchmentDeep : 'transparent',
                      border: `1px solid ${catchView === k ? T.brass : T.cardEdge}`,
                    }}>{lab}</button>
                ))}
                {sstRange && (
                  <span style={{ fontSize: 11.5, color: T.inkMute }}>
                    Temperature scale {(sstRange.lo * 9 / 5 + 32).toFixed(0)}–
                    {(sstRange.hi * 9 / 5 + 32).toFixed(0)} °F, set from today's water
                  </span>
                )}
              </div>
            </div>
            {overlayErr && (
              <div style={{ fontSize: 12.5, color: T.inkMute, marginBottom: 8 }}>{overlayErr}</div>
            )}
            <div ref={mapElRef}
                 style={{ height: 460, width: '100%', borderRadius: 10, overflow: 'hidden',
                          background: T.parchmentDeep }} />
          </Card>

          <Card>
            <SectionLabel>Where to go</SectionLabel>
            {loading && <div style={{ fontSize: 13, color: T.inkMute, marginTop: 8 }}>Loading…</div>}
            {!loading && spots.length === 0 && (
              <div style={{ fontSize: 13.5, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
                No edges recorded for these waters. Press Regenerate to read the latest satellite
                pass — a flat, well-mixed sea genuinely has no breaks worth driving to, so an
                empty result can also be the right answer.
              </div>
            )}
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {spots.map((s, i) => (
                <button key={s.id} onClick={() => setSelected(s.id)}
                  style={{
                    textAlign: 'left', padding: '11px 13px', borderRadius: 10, cursor: 'pointer',
                    background: selected === s.id ? T.parchmentDeep : 'transparent',
                    border: `1px solid ${selected === s.id ? T.brass : T.cardEdge}`,
                    borderLeft: `3px solid ${scoreColor(s.score)}`, color: T.ink,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 17, fontWeight: 900, color: scoreColor(s.score) }}>
                      {Math.round(s.score)}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800 }}>
                      {fmt(s.dist_nm)} nm {compass(s.from_port_deg)}
                    </span>
                    <span style={{ fontSize: 12, color: T.inkMute }}>
                      {fmt(s.lat, 3)}°, {fmt(s.lon, 3)}°
                    </span>
                    {i === 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 800,
                                     letterSpacing: 0.8, textTransform: 'uppercase', color: T.brass }}>
                        best
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: T.inkMute, marginTop: 4, lineHeight: 1.45 }}>
                    {s.why}
                  </div>
                  {(() => {
                    const fish = speciesForSpot(s, mode, planMonth);
                    if (!fish.length) return null;
                    return (
                      <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
                        <span style={{ color: T.inkMute }}>Suits </span>
                        {fish.map((f, k) => (
                          <span key={f.id} style={{ color: T.ink, fontWeight: 700 }}>
                            {k ? ', ' : ''}{SPECIES_NAME.get(f.id) || f.id}
                            <span style={{ color: T.inkMute, fontWeight: 600 }}>
                              {' '}{Math.round(f.score * 100)}%
                            </span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 5, opacity: 0.85 }}>
                    {fmt(s.sst_grad_f_nm, 2)} °F/nm
                    {s.chl_grad != null ? ` · colour change ${fmt(s.chl_grad, 2)}` : ' · no colour change'}
                    {s.length_nm != null ? ` · ${fmt(s.length_nm)} nm long` : ''}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
