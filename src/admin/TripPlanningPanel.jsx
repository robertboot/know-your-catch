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

/* The four ways people fish out here, and what each one needs to know.
   Kings and Spanish are TROLLED but are not pelagic: they follow bait and
   nearshore temperature, not the blue-water edge. Filing them with tuna
   would send someone 40 miles for a fish that is off the beach. */
const MODES = [
  {
    key: 'troll_pelagic',
    label: 'Trolling — pelagic',
    blurb: 'Tuna, mahi, wahoo, billfish. Blue water past the shelf.',
    needs: 'Temperature and colour breaks',
    ready: true,
  },
  {
    key: 'bottom',
    label: 'Bottom — red fishing',
    blurb: 'Snapper and grouper on structure, roughly 100–300 ft.',
    needs: 'Platforms, pipelines and hard bottom',
    ready: false,
  },
  {
    key: 'deep_drop',
    label: 'Deep drop',
    blurb: 'Swordfish, tilefish, snowy grouper. 600 ft and down.',
    needs: 'High-resolution bathymetry and bottom relief',
    ready: false,
  },
  {
    key: 'troll_coastal',
    label: 'Trolling — coastal',
    blurb: 'King and Spanish mackerel. Trolled, but not offshore fish.',
    needs: 'Nearshore temperature and bait',
    ready: false,
  },
];

const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toFixed(d));
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

  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

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

  // ---- map ----------------------------------------------------------
  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;
    const map = L.map(mapElRef.current, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 12,
    }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
      maxZoom: 12, pane: 'shadowPane',
    }).addTo(map);
    map.setView([29.2, -87.7], 7);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);
  }, []);

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
  }, [spots, region, selected]);

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

  const activeMode = MODES.find(m => m.key === mode);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel>How are you fishing?</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginTop: 8 }}>
          {MODES.map(m => (
            <button key={m.key} onClick={() => setMode(m.key)}
              style={{
                textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                background: mode === m.key ? T.parchmentDeep : 'transparent',
                border: `1px solid ${mode === m.key ? T.brass : T.cardEdge}`,
                color: T.ink,
              }}>
              <div style={{ fontSize: 13.5, fontWeight: 800 }}>
                {m.label}
                {!m.ready && (
                  <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
                                 color: T.inkMute, textTransform: 'uppercase' }}>no data yet</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: T.inkMute, marginTop: 3, lineHeight: 1.35 }}>{m.blurb}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <SectionLabel>Waters</SectionLabel>
          <select value={regionId} onChange={e => setRegionId(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, background: T.parchmentDeep,
                     color: T.ink, border: `1px solid ${T.cardEdge}`, fontSize: 13, fontWeight: 700 }}>
            {regions.length === 0 && <option value="">No regions configured</option>}
            {regions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <GhostButton onClick={recompute} disabled={running || !regionId}>
            {running ? 'Reading satellites…' : 'Recompute'}
          </GhostButton>
        </div>
        {observedAt && (
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 8 }}>
            Satellite pass {new Date(observedAt).toLocaleString()} ·{' '}
            {spots.length} edge{spots.length === 1 ? '' : 's'} found
            {region ? ` · distances from ${region.port_name}` : ''}
          </div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: T.closed, whiteSpace: 'pre-wrap' }}>{error}</div>
        )}
      </Card>

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
          <Card>
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
