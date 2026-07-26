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
