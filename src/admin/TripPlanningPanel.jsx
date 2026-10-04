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
import { SPECIES } from '../data.js';
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
    .map(id => ({ id, score: habitatScore(id, { sstF: spot.sst_f, edgeStrength, month: monthIdx }) }))
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
function scoreColor(s) {
  if (s == null) return '#7d8ca0';
  if (s >= 85) return '#63e08a';
  if (s >= 70) return '#4fa64a';
  if (s >= 55) return '#d9b038';
  return '#e07b2f';
}

export default function TripPlanningPanel() {
  const [mode, setMode] = useState('troll_pelagic');
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
  const [opacity, setOpacity] = useState({ sst: 0.72, chl: 0.55 });
  const [showCatches, setShowCatches] = useState(true);
  const [catches, setCatches] = useState([]);
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

  // ---- spots for the chosen region ----------------------------------
  const load = useCallback(async () => {
    if (!regionId) return;
    const c = client();
    if (!c) return;
    setLoading(true); setError('');
    // Newest satellite pass only. Mixing passes would put a Tuesday break
    // beside a Friday one on the same map with nothing saying so.
    const { data: latest } = await c.from('hotspots')
      .select('observed_at').eq('region_id', regionId)
      .order('observed_at', { ascending: false }).limit(1);
    const obs = latest?.[0]?.observed_at || null;
    setObservedAt(obs);
    if (!obs) { setSpots([]); setLoading(false); return; }
    const { data, error: err } = await c.from('hotspots')
      .select('*').eq('region_id', regionId).eq('observed_at', obs)
      .order('score', { ascending: false });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSpots(data || []);
  }, [regionId]);

  useEffect(() => { load(); }, [load]);

  // ---- conditions for the chosen day ---------------------------------
  // The edges are OBSERVED and cannot be forecast; the weather can. So the
  // day you pick does not change which breaks exist — it changes whether
  // you can get to them, and how stale the satellite will be by then.
  useEffect(() => {
    if (!region) return;
    let alive = true;
    const lat = (region.south + region.north) / 2;
    const lon = (region.west + region.east) / 2;
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
  }, [region]);

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
    map.setView([29.2, -87.7], 7);
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
    if (!region || !showCatches) { setCatches([]); return; }
    let alive = true;
    (async () => {
      const c = client();
      if (!c) return;
      const { data } = await c.from('catches')
        .select('*')
        .gte('lat', region.south).lte('lat', region.north)
        .gte('lon', region.west).lte('lon', region.east)
        .limit(500);
      if (alive) setCatches((data || []).filter(r => r.lat != null && r.lon != null));
    })();
    return () => { alive = false; };
  }, [region, showCatches]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    const group = L.layerGroup().addTo(map);
    layerRef.current = group;

    if (region) {
      L.rectangle([[region.south, region.west], [region.north, region.east]], {
        color: T.brass, weight: 1, fill: false, dashArray: '4 6', opacity: 0.5,
      }).addTo(group);
      L.circleMarker([region.port_lat, region.port_lon], {
        radius: 5, color: '#ffffff', weight: 2, fillColor: T.brass, fillOpacity: 1,
      }).bindTooltip(region.port_name, { direction: 'top' }).addTo(group);
    }

    // Catches first so a spot marker is never hidden behind one.
    for (const c of catches) {
      const name = SPECIES_NAME.get(c.species_id) || c.species_id || 'Catch';
      const when = c.caught_at || c.date_iso;
      const label = `${name}${when ? ` · ${String(when).slice(0, 10)}` : ''}`;
      // The species photo, same source the app uses, so a catch on this map
      // is recognisable at a glance instead of being one more dot among the
      // spots. Falls back to a plain mark where a species has no photo —
      // a broken image icon would read as a fault.
      const photo = speciesPhoto(c.species_id);
      const marker = photo?.url
        ? L.marker([c.lat, c.lon], {
            icon: L.divIcon({
              className: '',
              iconSize: [26, 26],
              iconAnchor: [13, 13],
              html: `<img src="${photo.url}" alt="" style="width:26px;height:26px;`
                  + `border-radius:50%;object-fit:cover;display:block;`
                  + `border:1.5px solid ${T.brass};box-shadow:0 1px 4px rgba(0,0,0,.5)">`,
            }),
          })
        : L.circleMarker([c.lat, c.lon], {
            radius: 4, color: '#ffffff', weight: 1, opacity: 0.7,
            fillColor: T.brass, fillOpacity: 0.55,
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

    if (spots.length) {
      map.fitBounds(L.latLngBounds(spots.map(s => [s.lat, s.lon]))
        .extend(region ? [region.port_lat, region.port_lon] : undefined), { padding: [40, 40] });
    } else if (region) {
      map.fitBounds([[region.south, region.west], [region.north, region.east]], { padding: [20, 20] });
    }
  }, [spots, region, selected, catches]);

  // ---- recompute -----------------------------------------------------
  const recompute = async () => {
    if (!regionId || running) return;
    setRunning(true); setError('');
    try {
      const token = getLastSession()?.access_token;
      const r = await fetch(`${SUPABASE_URL}/functions/v1/find-hotspots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ region: regionId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      const mine = (body.regions || []).find(x => x.region === regionId);
      if (mine?.error) throw new Error(mine.error);
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
      {/* Waters sits with the page title, not in a card of its own: it is
          the scope of everything below, not another setting to scroll past. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    marginTop: -4, marginBottom: 2 }}>
        <select value={regionId} onChange={e => setRegionId(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, background: T.parchmentDeep,
                   color: T.ink, border: `1px solid ${T.cardEdge}`, fontSize: 14, fontWeight: 800 }}>
          {regions.length === 0 && <option value="">No regions configured</option>}
          {regions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <GhostButton onClick={recompute} disabled={running || !regionId}>
          {running ? 'Reading satellites…' : 'Recompute'}
        </GhostButton>
      </div>

      <Card>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <SectionLabel>How</SectionLabel>
          <select value={mode} onChange={e => setMode(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, background: T.parchmentDeep,
                     color: T.ink, border: `1px solid ${T.cardEdge}`, fontSize: 13.5, fontWeight: 800,
                     flex: '1 1 220px', maxWidth: 340 }}>
            {TRIP_MODES.map(m => (
              <option key={m.key} value={m.key}>
                {m.label}{m.ready ? '' : ' — no data yet'}
              </option>
            ))}
          </select>
        </div>
        {/* The fish, not the jargon: "pelagic" is a word for people who
            already know the answer. */}
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 7, lineHeight: 1.5 }}>
          {speciesNames(activeMode?.species)}
        </div>
      </Card>

      <Card style={{ minWidth: 0, overflow: 'hidden' }}>
        <SectionLabel>When are you going?</SectionLabel>
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
              {region ? ` · distances from ${region.port_name}` : ''}
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
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => setShowCatches(v => !v)}
                  style={{
                    padding: '5px 11px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5,
                    fontWeight: 800, color: T.ink,
                    background: showCatches ? T.parchmentDeep : 'transparent',
                    border: `1px solid ${showCatches ? T.brass : T.cardEdge}`,
                  }}>
                  Past catches{showCatches && catches.length ? ` (${catches.length})` : ''}
                </button>
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
                No edges recorded for these waters. Press Recompute to read the latest satellite
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
