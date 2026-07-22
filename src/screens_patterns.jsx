/* Patterns — what your catch log knows about you.

   Reads state.catchLog + state.pbs and surfaces single-variable
   histograms across the dimensions that reliably move fishing
   success (time of day, month, moon phase, water temp, wind,
   pressure) plus a species-mix leaderboard and a PB progression
   timeline. Everything on-device — no correlations, no ML — just
   counts + peaks. v1 stays honest about sample size so nothing
   reads as an insight when it's actually noise.

   Guardrails:
     - Total < 10  → overall empty state
     - Per species < 5 → per-species empty state
     - Weather-gated (temp/wind/pressure) needs n >= 12 in the pool
     - Moon needs n >= 15 (full lunar cycle is ~28 days)
*/
import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  ChevronRight, BarChart2, TrendingUp, Trophy, Clock, Calendar,
  Fish, Thermometer, Wind, Waves as WavesIcon, ChevronLeft, Download,
  MapPin, CloudSun, Grid3x3,
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { T } from './theme.js';
import { speciesById, formatSize, formatWeight, jurisdictionById } from './helpers.js';
import { Card, PrimaryButton, GhostButton, SectionLabel, H1 } from './components.jsx';
import { isNative } from './native.js';
import { useScreenSize } from './screen-size.js';

const THRESHOLD_OVERALL = 10;
const THRESHOLD_SPECIES = 5;
const THRESHOLD_WEATHER = 12;
const THRESHOLD_MOON    = 15;

/* Simple horizontal bar. Value is 0..1 relative to the group's max.
   Peak (highest in the group) gets the accent tint. */
function Bar({ label, count, ratio, peak, sublabel }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <div style={{ width: 76, fontSize: 12, color: T.inkSoft, textAlign: 'right' }}>{label}</div>
      <div style={{ flex: 1, height: 12, background: T.parchmentDeep, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max(2, Math.round(ratio * 100))}%`, height: '100%',
          background: peak ? T.brass : 'rgba(25, 212, 242, 0.35)',
          borderRadius: 4,
        }} />
      </div>
      <div style={{ width: 40, fontSize: 12, color: T.inkMute, textAlign: 'left' }}>
        {count}{sublabel ? <span style={{ color: T.inkMute }}> {sublabel}</span> : null}
      </div>
    </div>
  );
}

function StatCard({ title, n, icon, children }) {
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <span style={{ color: T.brass, display: 'inline-flex' }}>{icon}</span>}
          <SectionLabel style={{ margin: 0 }}>{title}</SectionLabel>
        </div>
        {n != null && <div style={{ fontSize: 11, color: T.inkMute, fontWeight: 600 }}>n = {n}</div>}
      </div>
      {children}
    </Card>
  );
}

/* Small progress row: current / target, one-line explainer.
   Used in empty states so the angler sees what unlocks each thing. */
function UnlockRow({ current, target, label }) {
  const pct = Math.max(0, Math.min(1, current / target));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 14, color: T.inkSoft, marginBottom: 4, lineHeight: 1.4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: T.parchmentDeep, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(pct * 100)}%`, height: '100%', background: T.brass, borderRadius: 3 }} />
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, minWidth: 44, textAlign: 'right' }}>
          {current} / {target}
        </div>
      </div>
    </div>
  );
}

/* Bucket helpers ---------------------------------------------------- */
const hourOf = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.getHours(); };
const monthOf = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d.getMonth(); };
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const hourLabel = (h) => {
  if (h == null) return '—';
  const suffix = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${suffix}`;
};
const tempBucket  = (t) => t == null ? null : `${Math.floor(t / 5) * 5}–${Math.floor(t / 5) * 5 + 4}°F`;
const windBucket  = (w) => w == null ? null : `${Math.floor(w / 5) * 5}–${Math.floor(w / 5) * 5 + 4} mph`;
const pressBucket = (p) => p == null ? null : `${Math.floor(p / 10) * 10}–${Math.floor(p / 10) * 10 + 9} mb`;
const moonBucket  = (name) => name || null;

function histogram(rows, bucket, opts = {}) {
  const counts = new Map();
  for (const r of rows) {
    const b = bucket(r);
    if (b == null) continue;
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  const entries = Array.from(counts, ([k, v]) => ({ key: k, count: v }));
  if (opts.sortKey === 'natural') {
    // Preserve natural order via opts.order (e.g. months 0..11)
    entries.sort((a, b) => (opts.order.indexOf(a.key) - opts.order.indexOf(b.key)));
  } else {
    entries.sort((a, b) => b.count - a.count);
  }
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  return { entries, max, total: rows.length };
}

const cloudBucket = (c) => c == null ? null
  : c < 20 ? 'Clear' : c < 45 ? 'Partly cloudy' : c < 75 ? 'Mostly cloudy' : 'Overcast';

/* ============================================================
   Activity heat grid — month (columns) × 4-hour block (rows).
   Cell color intensity scales with catch count. Pure divs, no map.
   ============================================================ */
const HOUR_BLOCKS = [
  { label: '12–4a', lo: 0,  hi: 4  },
  { label: '4–8a',  lo: 4,  hi: 8  },
  { label: '8a–12p',lo: 8,  hi: 12 },
  { label: '12–4p', lo: 12, hi: 16 },
  { label: '4–8p',  lo: 16, hi: 20 },
  { label: '8p–12a',lo: 20, hi: 24 },
];
function ActivityHeatGrid({ catchLog }) {
  const { grid, max } = useMemo(() => {
    const g = HOUR_BLOCKS.map(() => new Array(12).fill(0));
    let mx = 0;
    for (const c of catchLog) {
      const d = new Date(c.dateIso);
      if (isNaN(d)) continue;
      const h = d.getHours(), m = d.getMonth();
      const bi = HOUR_BLOCKS.findIndex(b => h >= b.lo && h < b.hi);
      if (bi < 0) continue;
      g[bi][m] += 1;
      if (g[bi][m] > mx) mx = g[bi][m];
    }
    return { grid: g, max: mx };
  }, [catchLog]);

  const cellColor = (n) => {
    if (!n) return T.parchmentDeep;
    const t = max ? n / max : 0;               // 0..1
    return `rgba(25, 212, 242, ${0.18 + t * 0.82})`; // brass, ramped
  };

  return (
    <StatCard title="When you catch — month × time of day" n={catchLog.length} icon={<Grid3x3 size={14} />}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 340 }}>
          {/* Month header */}
          <div style={{ display: 'grid', gridTemplateColumns: `54px repeat(12, 1fr)`, gap: 2, marginBottom: 2 }}>
            <div />
            {MONTH_NAMES.map(m => (
              <div key={m} style={{ fontSize: 9, color: T.inkMute, textAlign: 'center' }}>{m[0]}</div>
            ))}
          </div>
          {HOUR_BLOCKS.map((b, ri) => (
            <div key={b.label} style={{ display: 'grid', gridTemplateColumns: `54px repeat(12, 1fr)`, gap: 2, marginBottom: 2 }}>
              <div style={{ fontSize: 10, color: T.inkSoft, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 4 }}>{b.label}</div>
              {grid[ri].map((n, ci) => (
                <div key={ci} title={`${MONTH_NAMES[ci]} ${b.label}: ${n}`} style={{
                  aspectRatio: '1 / 1', minHeight: 18, borderRadius: 3,
                  background: cellColor(n),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: n && (n / (max || 1)) > 0.55 ? T.oceanDeep : T.inkMute,
                }}>{n || ''}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
        Brighter = more catches. Reads at a glance where your season and time-of-day sweet spots are.
      </div>
    </StatCard>
  );
}

/* ============================================================
   Best weather — aggregates the weather captured at each catch and
   surfaces the conditions you catch most in. Feeds future AI reports.
   ============================================================ */
function BestWeatherCard({ catchLog }) {
  const withWx = useMemo(() => catchLog.filter(c => c.weather && c.weather.tempF != null), [catchLog]);
  const rows = useMemo(() => {
    if (withWx.length < THRESHOLD_WEATHER) return null;
    const peak = (bucket) => {
      const h = histogram(withWx, bucket);
      return h.entries.length ? h.entries[0] : null;
    };
    return {
      temp:  peak(c => tempBucket(c.weather?.tempF)),
      wind:  peak(c => windBucket(c.weather?.windMph)),
      sky:   peak(c => cloudBucket(c.weather?.cloudPct)),
      press: peak(c => pressBucket(c.weather?.pressureMb)),
    };
  }, [withWx]);

  if (!rows) {
    return (
      <StatCard title="Best weather" icon={<CloudSun size={14} />}>
        <UnlockRow current={withWx.length} target={THRESHOLD_WEATHER}
          label={`Weather is saved with every catch. ${Math.max(0, THRESHOLD_WEATHER - withWx.length)} more catch${THRESHOLD_WEATHER - withWx.length === 1 ? '' : 'es'} with weather needed to spot your best conditions.`} />
      </StatCard>
    );
  }

  const Row = ({ icon, label, e }) => e ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: `1px solid ${T.cardEdge}55` }}>
      <span style={{ color: T.brass, display: 'inline-flex' }}>{icon}</span>
      <div style={{ flex: 1, fontSize: 13, color: T.inkSoft }}>{label}</div>
      <div style={{ fontSize: 15, color: T.ink, fontWeight: 800 }}>{e.key}</div>
      <div style={{ fontSize: 11, color: T.inkMute, width: 42, textAlign: 'right' }}>{e.count}×</div>
    </div>
  ) : null;

  return (
    <StatCard title="Best weather — you catch most in" n={withWx.length} icon={<CloudSun size={14} />}>
      <Row icon={<Thermometer size={16} />} label="Air temp" e={rows.temp} />
      <Row icon={<Wind size={16} />}        label="Wind" e={rows.wind} />
      <Row icon={<CloudSun size={16} />}    label="Sky" e={rows.sky} />
      <Row icon={<WavesIcon size={16} />}   label="Pressure" e={rows.press} />
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
        Captured automatically at each catch. Builds the dataset behind future AI catch reports.
      </div>
    </StatCard>
  );
}

/* ============================================================
   Catch heat map — geographic hot spots. No heat plugin: overlapping
   semi-transparent circle markers build up intensity where catches
   cluster, giving a heat-glow effect from plain Leaflet.
   ============================================================ */
function CatchHeatMap({ catchLog }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const located = useMemo(() => catchLog.filter(c => c.lat != null && c.lon != null), [catchLog]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([26.5, -88], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &middot; &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    layerRef.current.clearLayers();
    for (const c of located) {
      // Two stacked circles per catch: a soft wide glow + a bright
      // core. Where catches overlap, the translucent glows sum into
      // hotter areas — a heat map without a plugin.
      L.circleMarker([c.lat, c.lon], {
        radius: 22, stroke: false, fillColor: '#19D4F2', fillOpacity: 0.10,
      }).addTo(layerRef.current);
      L.circleMarker([c.lat, c.lon], {
        radius: 6, stroke: false, fillColor: '#19D4F2', fillOpacity: 0.55,
      }).addTo(layerRef.current);
    }
    if (located.length === 1) mapRef.current.setView([located[0].lat, located[0].lon], 9);
    else if (located.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(located.map(c => [c.lat, c.lon])), { padding: [40, 40], maxZoom: 11 });
    }
    setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 80);
  }, [located]);

  return (
    <StatCard title="Catch hot spots" n={located.length} icon={<MapPin size={14} />}>
      {/* isolation: isolate confines Leaflet's high z-index panes to
          this container's stacking context — otherwise the map tiles
          / controls paint over the fixed tab bar (zIndex 50). */}
      <div ref={containerRef} style={{ height: 300, borderRadius: 10, overflow: 'hidden', border: `1px solid ${T.cardEdge}`, isolation: 'isolate' }} />
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, textAlign: 'center' }}>
        {located.length} of {catchLog.length} catches have GPS · brighter clusters are your best water
      </div>
    </StatCard>
  );
}

/* Build a "your best conditions" one-liner. Skips dimensions without
   enough sample. Returns null if nothing to say. */
function summarizeConditions({ hourPeak, moonPeak, tempPeak, windPeak, commonName }) {
  const parts = [];
  if (hourPeak) parts.push(`at ${hourPeak}`);
  if (moonPeak) parts.push(`on ${moonPeak.toLowerCase()} moons`);
  if (tempPeak) parts.push(`in ${tempPeak.toLowerCase()} water`);
  if (windPeak) parts.push(`with ${windPeak.toLowerCase()} winds`);
  if (parts.length === 0) return null;
  return `Your ${commonName} hit ${parts.join(', ')}.`;
}

/* Photo / EXIF-free CSV escape. */
const csvEsc = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(catchLog, pbs) {
  const cols = [
    'id','dateIso','speciesId','commonName','length','weight','primaryMetric',
    'lat','lon','jurisdiction','jurisdictionName',
    'sunAlt','sunAz','moonPhase','moonIllum','moonName',
    'tempF','windMph','windDir','cloudPct','precipMm','pressureMb','weatherSource',
    'notes','status','isPB',
  ];
  const pbIds = new Set(Object.values(pbs || {}).map(p => p?.catchId).filter(Boolean));
  const rows = [cols.join(',')];
  for (const c of catchLog) {
    const s = c.speciesId ? speciesById(c.speciesId) : null;
    const jur = jurisdictionById(c.jurisdiction);
    const primaryMetric = (c.weight != null) ? 'weight' : (c.length != null ? 'length' : '');
    rows.push([
      c.id, c.dateIso, c.speciesId || '', s?.commonName || '',
      c.length, c.weight, primaryMetric,
      c.lat, c.lon, c.jurisdiction || '', jur?.name || '',
      c.sunAlt, c.sunAz, c.moonPhase, c.moonIllum, c.moonName || '',
      c.weather?.tempF, c.weather?.windMph, c.weather?.windDir,
      c.weather?.cloudPct, c.weather?.precipMm, c.weather?.pressureMb, c.weather?.source || '',
      c.notes || '', c.status || 'complete', pbIds.has(c.id) ? 'true' : 'false',
    ].map(csvEsc).join(','));
  }
  return rows.join('\n');
}

/* Best-effort native share for the exported file. On iOS Capacitor
   writes to Documents/ + triggers the Share plugin. On web it falls
   back to a Blob-URL anchor download. */
async function exportFile({ filename, mime, content }) {
  if (isNative()) {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      const isText = /^text|json|csv/.test(mime);
      const enc = isText ? Encoding.UTF8 : undefined;
      const w = await Filesystem.writeFile({
        path: filename, data: content, directory: Directory.Documents,
        encoding: enc, recursive: true,
      });
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: 'ReelIntel export', url: w.uri });
        return 'shared';
      } catch {
        return 'saved';
      }
    } catch (e) {
      console.warn('native export failed, falling back', e);
    }
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/* ============================================================
   Main screen
   ============================================================ */
export function PatternsScreen({ state, onPickSpecies }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  // Catches flagged metaNeedsReview confirmed a photo with no
  // location/time and haven't been completed — their defaults would
  // poison every when/where analysis below, so they're excluded
  // until the angler fills in real details (badge in the Logbook).
  const catchLog = (state.catchLog || []).filter(c => !c.metaNeedsReview);
  const pbs = state.pbs || {};
  const [drillId, setDrillId] = useState(null);

  const total = catchLog.length;

  // Species mix — sorted by count, top 5.
  const speciesMix = useMemo(() => {
    const counts = new Map();
    for (const c of catchLog) {
      if (!c.speciesId) continue;
      counts.set(c.speciesId, (counts.get(c.speciesId) || 0) + 1);
    }
    const arr = Array.from(counts, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
    return { top5: arr.slice(0, 5), all: arr, distinct: arr.length };
  }, [catchLog]);

  // PB progression — flatten all pbs.history plus current PB into a
  // chronologically-sorted timeline. Value is the primary metric.
  // MUST stay above the early returns below (drill-down / not-enough-data)
  // so hook order is identical on every render — a hook after a
  // conditional return crashes React ("rendered fewer hooks").
  const pbTimeline = useMemo(() => {
    const out = [];
    for (const [id, pb] of Object.entries(pbs)) {
      const s = speciesById(id);
      if (!s || !pb) continue;
      const history = Array.isArray(pb.history) ? pb.history : [];
      for (const h of history) {
        const val = h.primaryMetric === 'weight' ? h.weight : h.length;
        if (val == null || !h.date) continue;
        out.push({ id, name: s.commonName, val, metric: h.primaryMetric, date: h.date, current: false });
      }
      const val = pb.primaryMetric === 'weight' ? pb.weight : pb.length;
      if (val != null && pb.date) {
        out.push({ id, name: s.commonName, val, metric: pb.primaryMetric, date: pb.date, current: true });
      }
    }
    return out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [pbs]);

  if (drillId) {
    return <SpeciesPatterns
      speciesId={drillId}
      state={state}
      onBack={() => setDrillId(null)}
      onPickSpecies={onPickSpecies}
    />;
  }

  if (total < THRESHOLD_OVERALL) {
    return (
      <div style={{ padding: isTablet ? '26px 22px' : '18px 16px' }}>
        <H1 size={isTablet ? (isLandscape ? 32 : 30) : 22} style={{ marginBottom: 6 }}>Patterns</H1>
        <p style={{ fontSize: isTablet ? 17 : 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: isTablet ? 22 : 18 }}>
          Log more catches to unlock patterns. Every catch adds to what your log knows.
        </p>
        <Card>
          <SectionLabel style={{ marginBottom: 8 }}>Getting started</SectionLabel>
          <UnlockRow current={total} target={THRESHOLD_OVERALL}
            label={`Currently ${total} catch${total === 1 ? '' : 'es'} — need ${THRESHOLD_OVERALL - total} more before we can spot trends.`} />
        </Card>
      </div>
    );
  }

  // Hourly + monthly histograms across everything.
  const hourly  = histogram(catchLog, (c) => hourOf(c.dateIso));
  const monthly = histogram(catchLog, (c) => monthOf(c.dateIso),
    { sortKey: 'natural', order: [0,1,2,3,4,5,6,7,8,9,10,11] });

  const doExport = async (kind) => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') {
      await exportFile({
        filename: `reelintel-catches-${stamp}.csv`,
        mime: 'text/csv',
        content: buildCsv(catchLog, pbs),
      });
    } else {
      await exportFile({
        filename: `reelintel-catches-${stamp}.json`,
        mime: 'application/json',
        content: JSON.stringify({
          exportedAt: new Date().toISOString(),
          count: catchLog.length,
          catches: catchLog,
          pbs,
        }, null, 2),
      });
    }
  };

  return (
    <div style={{ padding: isTablet ? '22px 22px 32px' : '16px 16px 24px' }}>
      <H1 size={isTablet ? (isLandscape ? 32 : 30) : 22} style={{ marginBottom: 6 }}>Patterns</H1>
      <p style={{ fontSize: isTablet ? 17 : 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: isTablet ? 18 : 14 }}>
        What your logbook knows about your fishing — based on {total} catch{total === 1 ? '' : 'es'} across {speciesMix.distinct} species.
      </p>

      {/* Species mix */}
      <StatCard title="Species mix" n={total} icon={<Fish size={14} />}>
        {speciesMix.top5.map((row, i) => {
          const s = speciesById(row.id);
          const label = s?.commonName || row.id;
          const share = Math.round((row.count / total) * 100);
          const enough = row.count >= THRESHOLD_SPECIES;
          return (
            <button key={row.id}
              onClick={() => enough && setDrillId(row.id)}
              disabled={!enough}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                background: 'transparent', border: 'none', padding: '4px 0',
                cursor: enough ? 'pointer' : 'default', textAlign: 'left',
              }}
            >
              <div style={{ width: 76, fontSize: 14, color: T.ink, fontWeight: 700, textAlign: 'right' }}>{label}</div>
              <div style={{ flex: 1, height: 12, background: T.parchmentDeep, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.round((row.count / speciesMix.top5[0].count) * 100)}%`, height: '100%',
                  background: i === 0 ? T.brass : 'rgba(25, 212, 242, 0.35)',
                  borderRadius: 4,
                }} />
              </div>
              <div style={{ width: 82, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 12, color: T.inkMute }}>{row.count} · {share}%</span>
                {enough && <ChevronRight size={14} color={T.brass} />}
              </div>
            </button>
          );
        })}
      </StatCard>

      {/* Time of day */}
      <StatCard title="Best time of day" n={total} icon={<Clock size={14} />}>
        {hourly.entries.slice(0, 6).map(e => (
          <Bar key={e.key} label={hourLabel(e.key)} count={e.count}
            ratio={e.count / hourly.max} peak={e.count === hourly.max} />
        ))}
      </StatCard>

      {/* Best months */}
      <StatCard title="Best months" n={total} icon={<Calendar size={14} />}>
        {monthly.entries.map(e => (
          <Bar key={e.key} label={MONTH_NAMES[e.key]} count={e.count}
            ratio={e.count / monthly.max} peak={e.count === monthly.max} />
        ))}
      </StatCard>

      {/* Activity heat grid — month × time of day */}
      <ActivityHeatGrid catchLog={catchLog} />

      {/* Best weather — conditions you catch most in */}
      <BestWeatherCard catchLog={catchLog} />

      {/* Catch hot-spot map */}
      <CatchHeatMap catchLog={catchLog} />

      {/* PB progression */}
      {pbTimeline.length >= 2 ? (
        <StatCard title="Personal Best progression" n={pbTimeline.length} icon={<Trophy size={14} />}>
          {pbTimeline.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i > 0 ? `1px solid ${T.cardEdge}55` : 'none' }}>
              <div style={{ width: 86, fontSize: 12, color: T.inkSoft }}>{p.date}</div>
              <div style={{ flex: 1, fontSize: 14, color: T.ink, fontWeight: p.current ? 800 : 500 }}>
                {p.name}
              </div>
              <div style={{ fontSize: 14, color: p.current ? T.brass : T.inkSoft, fontWeight: 700 }}>
                {p.metric === 'weight' ? formatWeight(p.val, state.units) : formatSize(p.val, state.units)}
                {p.current && ' ★'}
              </div>
            </div>
          ))}
        </StatCard>
      ) : (
        <StatCard title="Personal Best progression" icon={<Trophy size={14} />}>
          <div style={{ fontSize: 14, color: T.inkMute, lineHeight: 1.5 }}>
            Log at least two personal bests (or one with history) to see progression.
          </div>
        </StatCard>
      )}

      {/* Export */}
      <div style={{ marginTop: 18 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Export</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton onClick={() => doExport('csv')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Download size={14} /> CSV
          </GhostButton>
          <GhostButton onClick={() => doExport('json')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Download size={14} /> JSON
          </GhostButton>
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
          Your catch data is yours. Export any time.
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Species drill-down — per-species patterns
   ============================================================ */
function SpeciesPatterns({ speciesId, state, onBack, onPickSpecies }) {
  const s = speciesById(speciesId);
  const catchLog = state.catchLog || [];
  const rows = useMemo(() => catchLog.filter(c => c.speciesId === speciesId), [catchLog, speciesId]);
  const withWx = useMemo(() => rows.filter(c => c.weather && c.weather.tempF != null), [rows]);

  if (!s) return null;

  if (rows.length < THRESHOLD_SPECIES) {
    return (
      <div style={{ padding: '16px 16px 24px' }}>
        <BackHeader label={s.commonName} onBack={onBack} />
        <Card>
          <SectionLabel style={{ marginBottom: 8 }}>Not enough data yet</SectionLabel>
          <UnlockRow current={rows.length} target={THRESHOLD_SPECIES}
            label={`${THRESHOLD_SPECIES - rows.length} more ${s.commonName} catch${THRESHOLD_SPECIES - rows.length === 1 ? '' : 'es'} needed for personal patterns.`} />
        </Card>
      </div>
    );
  }

  const hourly = histogram(rows, (c) => hourOf(c.dateIso));
  const moon   = histogram(rows, (c) => moonBucket(c.moonName));
  const temp   = histogram(withWx, (c) => tempBucket(c.weather?.tempF));
  const wind   = histogram(withWx, (c) => windBucket(c.weather?.windMph));
  const press  = histogram(withWx, (c) => pressBucket(c.weather?.pressureMb));

  const summary = summarizeConditions({
    hourPeak: hourly.entries[0] ? hourLabel(hourly.entries[0].key) : null,
    moonPeak: (moon.total >= THRESHOLD_MOON && moon.entries[0]) ? moon.entries[0].key : null,
    tempPeak: (withWx.length >= THRESHOLD_WEATHER && temp.entries[0]) ? temp.entries[0].key : null,
    windPeak: (withWx.length >= THRESHOLD_WEATHER && wind.entries[0]) ? wind.entries[0].key : null,
    commonName: s.commonName,
  });

  const wxMissing = rows.length - withWx.length;

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <BackHeader label={s.commonName} onBack={onBack} />

      {summary && (
        <Card style={{ marginBottom: 10, background: 'linear-gradient(140deg, rgba(25,212,242,0.12), rgba(25,212,242,0))', borderColor: T.brass }}>
          <div style={{ fontSize: 15, color: T.ink, lineHeight: 1.5 }}>{summary}</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>Based on {rows.length} logged catch{rows.length === 1 ? '' : 'es'}.</div>
        </Card>
      )}

      <StatCard title="Best hour range" n={rows.length} icon={<Clock size={14} />}>
        {hourly.entries.slice(0, 6).map(e => (
          <Bar key={e.key} label={hourLabel(e.key)} count={e.count}
            ratio={e.count / hourly.max} peak={e.count === hourly.max} />
        ))}
      </StatCard>

      {moon.total >= THRESHOLD_MOON ? (
        <StatCard title="Best moon phase" n={moon.total} icon={<TrendingUp size={14} />}>
          {moon.entries.map(e => (
            <Bar key={e.key} label={e.key} count={e.count}
              ratio={e.count / moon.max} peak={e.count === moon.max} />
          ))}
        </StatCard>
      ) : (
        <UnlockCard title="Best moon phase" icon={<TrendingUp size={14} />}
          need={THRESHOLD_MOON} have={moon.total}
          hint={`${THRESHOLD_MOON - moon.total} more ${s.commonName} catch${THRESHOLD_MOON - moon.total === 1 ? '' : 'es'} needed — the moon cycle is 28 days, so we wait for the full swing before calling anything.`} />
      )}

      {withWx.length >= THRESHOLD_WEATHER ? (
        <>
          <StatCard title="Best water temp" n={withWx.length} icon={<Thermometer size={14} />}>
            {temp.entries.map(e => (
              <Bar key={e.key} label={e.key} count={e.count}
                ratio={e.count / temp.max} peak={e.count === temp.max} />
            ))}
          </StatCard>
          <StatCard title="Best wind band" n={withWx.length} icon={<Wind size={14} />}>
            {wind.entries.map(e => (
              <Bar key={e.key} label={e.key} count={e.count}
                ratio={e.count / wind.max} peak={e.count === wind.max} />
            ))}
          </StatCard>
          <StatCard title="Best pressure range" n={withWx.length} icon={<WavesIcon size={14} />}>
            {press.entries.map(e => (
              <Bar key={e.key} label={e.key} count={e.count}
                ratio={e.count / press.max} peak={e.count === press.max} />
            ))}
          </StatCard>
        </>
      ) : (
        <UnlockCard title="Weather-based patterns" icon={<Thermometer size={14} />}
          need={THRESHOLD_WEATHER} have={withWx.length}
          hint={
            wxMissing > 0
              ? `Weather data missing on ${wxMissing} of your ${s.commonName} catches — open them and re-fetch conditions for better analysis.`
              : `${THRESHOLD_WEATHER - withWx.length} more ${s.commonName} catch${THRESHOLD_WEATHER - withWx.length === 1 ? '' : 'es'} with weather data needed.`
          } />
      )}

      {onPickSpecies && (
        <div style={{ marginTop: 10 }}>
          <GhostButton onClick={() => onPickSpecies(speciesId)} style={{ width: '100%' }}>
            View {s.commonName} details →
          </GhostButton>
        </div>
      )}
    </div>
  );
}

function BackHeader({ label, onBack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: T.brass, cursor: 'pointer', padding: 4, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 15, fontWeight: 700 }}>
        <ChevronLeft size={16} /> All patterns
      </button>
      <H1 size={20}>{label}</H1>
    </div>
  );
}

function UnlockCard({ title, icon, need, have, hint }) {
  return (
    <Card style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {icon && <span style={{ color: T.brass, display: 'inline-flex' }}>{icon}</span>}
        <SectionLabel style={{ margin: 0 }}>{title}</SectionLabel>
      </div>
      <UnlockRow current={have} target={need} label={hint} />
    </Card>
  );
}
