/* ============================================================
   Forecast extras — Windy-style heat colours, a solunar bite
   index, and NOAA tide-station lookup.
   ============================================================
   Pure helpers only (no network, no React) so they can be unit-
   reasoned and reused. The screens layer does the fetching and
   renders these into the hourly matrix. */

import { sunPosition } from './helpers.js';

/* ---- colour scales -------------------------------------------------
   Each scale maps a value to a translucent fill that sits over the
   dark card, echoing Windy's green→red wind ramp and blue water ramp
   while keeping the light text on top readable. */

function _hex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Piecewise-linear interpolation across [threshold, hex] stops → rgba().
function scaleColor(value, stops, alpha = 0.4) {
  if (value == null || Number.isNaN(value)) return 'transparent';
  if (value <= stops[0][0]) { const [r, g, b] = _hex(stops[0][1]); return `rgba(${r},${g},${b},${alpha})`; }
  const last = stops[stops.length - 1];
  if (value >= last[0]) { const [r, g, b] = _hex(last[1]); return `rgba(${r},${g},${b},${alpha})`; }
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i];
    const [v1, c1] = stops[i + 1];
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0);
      const a = _hex(c0), b = _hex(c1);
      const r = Math.round(a[0] + (b[0] - a[0]) * t);
      const g = Math.round(a[1] + (b[1] - a[1]) * t);
      const bl = Math.round(a[2] + (b[2] - a[2]) * t);
      return `rgba(${r},${g},${bl},${alpha})`;
    }
  }
  return 'transparent';
}

const AIR_STOPS  = [[50, '#2f6fb0'], [65, '#2aa0a0'], [75, '#3fa34d'], [84, '#c9b03a'], [92, '#d98330'], [100, '#c0392b']];
const WIND_STOPS = [[2, '#1f7a3d'], [8, '#3fa34d'], [13, '#c9b03a'], [18, '#d98330'], [24, '#c0392b'], [32, '#7d1d13']];
const WAVE_STOPS = [[0, '#123a5e'], [1, '#17518a'], [2, '#1f77c2'], [4, '#2aa0e0'], [7, '#5ac8f5']];
const CURR_STOPS = [[0, '#123a5e'], [0.3, '#1f77c2'], [0.8, '#2aa0e0'], [1.5, '#5ac8f5']];
const ACT_STOPS  = [[20, '#3a4a5c'], [40, '#2f7d5a'], [60, '#3fa34d'], [80, '#4fd07a'], [95, '#63e08a']];

export const airColor  = (f)   => scaleColor(f, AIR_STOPS, 0.38);
export const sstColor  = (f)   => scaleColor(f, AIR_STOPS, 0.34);
export const windColor = (mph) => scaleColor(mph, WIND_STOPS, 0.42);
export const waveColor = (ft)  => scaleColor(ft, WAVE_STOPS, 0.42);
export const currColor = (kt)  => scaleColor(kt, CURR_STOPS, 0.42);
export const actColor  = (pct) => scaleColor(pct, ACT_STOPS, 0.5);
export const rainColor = (pct) => (pct ? `rgba(42,160,224,${Math.min(0.5, (pct / 100) * 0.55)})` : 'transparent');

/* ---- solunar bite index -------------------------------------------
   A 0–100 estimate (NOT a fetched value): feeding peaks at dawn/dusk
   (sun near the horizon) and is amplified near the new and full moon.
   Deliberately simple and labelled as an estimate in the UI. */
export function biteIndex(date, lat, lon, moonIllumination) {
  const alt = sunPosition(date, lat, lon).altitudeDeg;
  const dawnDusk = Math.max(0, 1 - Math.abs(alt) / 6); // 1 at horizon → 0 by ±6°
  const base = alt > 0 ? 0.34 : 0.48;                  // night edges out bright midday
  const moonFactor = (Math.max(moonIllumination, 1 - moonIllumination) - 0.5) * 2; // 0 half → 1 new/full
  const score = base + 0.5 * dawnDusk + 0.14 * moonFactor;
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

/* ---- NOAA tide stations -------------------------------------------
   Curated harmonic-prediction stations across the app's waters (Gulf
   + FL Atlantic). Nearest-by-distance is plenty for a tide curve and
   avoids fetching NOAA's full ~3k-station metadata file on device. */
export const TIDE_STATIONS = [
  { id: '8760922', name: 'Pilottown, LA',        lat: 29.179, lon: -89.258 },
  { id: '8761724', name: 'Grand Isle, LA',       lat: 29.263, lon: -89.957 },
  { id: '8764044', name: 'Berwick, LA',          lat: 29.668, lon: -91.238 },
  { id: '8768094', name: 'Calcasieu Pass, LA',   lat: 29.768, lon: -93.343 },
  { id: '8770570', name: 'Sabine Pass, TX',      lat: 29.728, lon: -93.870 },
  { id: '8771013', name: 'Eagle Point, TX',      lat: 29.480, lon: -94.917 },
  { id: '8771450', name: 'Galveston Pier 21, TX',lat: 29.310, lon: -94.793 },
  { id: '8775870', name: 'Bob Hall Pier, TX',    lat: 27.580, lon: -97.217 },
  { id: '8779770', name: 'Port Isabel, TX',      lat: 26.061, lon: -97.215 },
  { id: '8735180', name: 'Dauphin Island, AL',   lat: 30.250, lon: -88.075 },
  { id: '8737048', name: 'Mobile State Docks, AL',lat: 30.708, lon: -88.043 },
  { id: '8729108', name: 'Panama City, FL',      lat: 30.152, lon: -85.667 },
  { id: '8728690', name: 'Apalachicola, FL',     lat: 29.727, lon: -84.981 },
  { id: '8727520', name: 'Cedar Key, FL',        lat: 29.135, lon: -83.032 },
  { id: '8726520', name: 'St. Petersburg, FL',   lat: 27.760, lon: -82.627 },
  { id: '8726607', name: 'Old Port Tampa, FL',   lat: 27.858, lon: -82.553 },
  { id: '8725520', name: 'Fort Myers, FL',       lat: 26.648, lon: -81.871 },
  { id: '8725110', name: 'Naples, FL',           lat: 26.132, lon: -81.807 },
  { id: '8723214', name: 'Virginia Key, FL',     lat: 25.731, lon: -80.162 },
  { id: '8723970', name: 'Vaca Key, FL',         lat: 24.711, lon: -81.106 },
  { id: '8724580', name: 'Key West, FL',         lat: 24.556, lon: -81.808 },
  { id: '8721604', name: 'Trident Pier, FL',     lat: 28.416, lon: -80.593 },
  { id: '8720218', name: 'Mayport, FL',          lat: 30.398, lon: -81.428 },
];

/* ---- fishability scoring -------------------------------------------
   Turns raw conditions into a 0–100 "should I go?" score weighted for
   catching fish AND a comfortable ride. Sub-scores are exposed so the
   "Why this score?" breakdown can show what helped or hurt. */

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Each sub-score 0–100. Missing marine data falls back gracefully.
// Wind is in mph (the app's unit). Calibrated against typical Gulf days:
// small seas with a short period are calm and fishable, so period only
// bites hard when the seas are also up (steep, uncomfortable chop).
export function subScores(h) {
  // Wind: glassy ≤6 mph is ideal; unfishable by ~28 mph.
  const wind = h.wind == null ? null : Math.round(clamp01((28 - h.wind) / 22) * 100);
  // Wave height: ≤1 ft ideal; rough by ~5.5 ft.
  const seas = h.waveFt == null ? null : Math.round(clamp01((5.5 - h.waveFt) / 4.5) * 100);
  // Wave period, judged in context of wave height:
  //   • small seas (≤2 ft): short period is not uncomfortable → stay generous
  //   • bigger seas: a longer period is needed to ride comfortably
  let period = null;
  if (h.periodS != null) {
    period = (h.waveFt ?? 0) <= 2
      ? Math.round(55 + clamp01((h.periodS - 1) / 6) * 40)  // ~4 s→75, floor 55
      : Math.round(clamp01((h.periodS - 3) / 5) * 100);     // 3 s→0, 8 s+→100
    period = Math.max(0, Math.min(100, period));
  }
  return { wind, seas, period };
}

export function fishabilityHour(h) {
  const s = subScores(h);
  // Total is heavily weighted on the three sailing/fishing factors —
  // wave height, wind, wave period — renormalized over whatever's present.
  const terms = [];
  if (s.seas != null)   terms.push([s.seas, 0.4]);
  if (s.wind != null)   terms.push([s.wind, 0.35]);
  if (s.period != null) terms.push([s.period, 0.25]);
  let score;
  if (terms.length) {
    const wsum = terms.reduce((a, [, w]) => a + w, 0);
    score = terms.reduce((a, [v, w]) => a + v * w, 0) / wsum;
  } else {
    score = 50; // no marine data → neutral, let bite nudge it
  }
  // Small solunar nudge only — the three factors dominate (±5).
  if (h.bite != null) score = score * 0.9 + h.bite * 0.1;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// Continuous red→amber→green ramp so neighbouring scores read as
// neighbouring colours (no hard cliff at a band edge). Solid (alpha 1)
// for legible badges/gauge.
const FISH_STOPS = [[35, '#c0392b'], [55, '#d1642b'], [68, '#d98330'], [76, '#9bb03a'], [85, '#4fa64a'], [95, '#63e08a']];
export function fishabilityColor(score) {
  if (score == null) return '#7d8ca0';
  return scaleColor(score, FISH_STOPS, 1);
}

export function fishabilityLabel(score) {
  if (score == null) return '—';
  if (score >= 90) return 'GREAT';
  if (score >= 75) return 'GOOD';
  if (score >= 60) return 'FAIR';
  return 'POOR';
}

export function ratingWord(score) {
  if (score == null) return '—';
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Fair';
  return 'Poor';
}

/* Best fishing window: scan daylight (+ dawn/dusk) hours over the feed,
   score each, and pick the highest-scoring contiguous run (≥2 h). Prefer
   the earliest strong window so the recommendation is actionable today/
   tomorrow rather than days out. Returns null if nothing qualifies. */
export function bestWindow(hours) {
  if (!hours || !hours.length) return null;
  const scored = hours.map(h => ({
    when: h.when,
    isDay: !!h.isDaylight,
    score: fishabilityHour(h),
  }));
  // Candidate hours: daylight or civil-ish edge (we approximate with isDay).
  let best = null;
  let i = 0;
  while (i < scored.length) {
    if (!scored[i].isDay) { i++; continue; }
    let j = i;
    while (j + 1 < scored.length && scored[j + 1].isDay) j++;
    // Within this daylight block, find the best contiguous sub-run whose
    // hours are all within 12 pts of the block's peak.
    const block = scored.slice(i, j + 1);
    const peak = Math.max(...block.map(b => b.score));
    let runStart = null;
    for (let k = 0; k <= block.length; k++) {
      const good = k < block.length && block[k].score >= peak - 12;
      if (good && runStart == null) runStart = k;
      if (!good && runStart != null) {
        const run = block.slice(runStart, k);
        const avg = run.reduce((a, b) => a + b.score, 0) / run.length;
        if (run.length >= 2 && (!best || avg > best.avg)) {
          best = { startMs: run[0].when, endMs: run[run.length - 1].when + 3600000, avg: Math.round(avg) };
        }
        runStart = null;
      }
    }
    i = j + 1;
  }
  return best;
}

/* Aggregate an hourly series into 6-hour blocks (00/06/12/18 local) for
   the 10-day matrix. Each block averages the hour values it spans and
   carries a fishability score so the outlook reads like Windy's grid. */
export function sixHourBlocks(hours) {
  if (!hours || !hours.length) return [];
  const map = new Map();
  for (const x of hours) {
    if (!x.isoHour) continue;
    const date = x.isoHour.slice(0, 10);
    const slot = Math.floor(parseInt(x.isoHour.slice(11, 13), 10) / 6); // 0..3
    const key = `${date}#${slot}`;
    let b = map.get(key);
    if (!b) { b = { date, slot, when: x.when, code: x.weatherCode, t: [], w: [], g: [], h: [], p: [], wd: [], bi: [] }; map.set(key, b); }
    if (x.temp != null) b.t.push(x.temp);
    if (x.wind != null) b.w.push(x.wind);
    if (x.gust != null) b.g.push(x.gust);
    if (x.waveFt != null) b.h.push(x.waveFt);
    if (x.periodS != null) b.p.push(x.periodS);
    if (x.waveDir != null) b.wd.push(x.waveDir);
    if (x.bite != null) b.bi.push(x.bite);
  }
  const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const max = (a) => a.length ? Math.max(...a) : null;
  return [...map.values()].sort((a, b) => a.when - b.when).map((b) => {
    const temp = avg(b.t), wind = avg(b.w), gust = max(b.g), waveFt = avg(b.h), periodS = avg(b.p), waveDir = avg(b.wd), bite = avg(b.bi);
    return {
      when: b.when, date: b.date, slot: b.slot, code: b.code,
      label: ['12a', '6a', '12p', '6p'][b.slot],
      temp, wind, gust, waveFt, periodS, waveDir,
      score: fishabilityHour({ wind, waveFt, periodS, bite }),
    };
  });
}

export function nearestTideStation(lat, lon) {
  if (lat == null || lon == null) return null;
  let best = null, bestD = Infinity;
  for (const s of TIDE_STATIONS) {
    const dLat = s.lat - lat, dLon = (s.lon - lon) * Math.cos(lat * Math.PI / 180);
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = s; }
  }
  // ~1.5° guard (~100 mi): don't attach a wildly distant station.
  return bestD <= 2.25 ? best : null;
}
