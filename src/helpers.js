import { SPECIES, JURISDICTIONS, COMPARISONS, DATA_BUILD_DATE } from './data.js';
import photoManifest from '../photos/manifest.json';

// Proprietary images are served from the repo via GitHub raw (same
// public source the feeds use); licensed fallbacks come from their URL.
const PHOTO_RAW = 'https://raw.githubusercontent.com/robertboot/know-your-catch/claude/upload-app-assets-NUxRr/';

// Best available photo for a species, or null (caller draws the
// FishMark illustration). Honours the manifest's chosen photo.
export function speciesPhoto(id) {
  const e = photoManifest.species && photoManifest.species[id];
  if (!e) return null;
  if (e.primary === 'proprietary' && e.proprietary) {
    return { url: PHOTO_RAW + e.proprietary, proprietary: true };
  }
  if (e.primary === 'fallback' && e.fallback && e.fallback.url) {
    return { url: e.fallback.url, credit: e.fallback.credit, license: e.fallback.license };
  }
  return null;
}

export const speciesById = (id) => SPECIES.find(s => s.id === id);
export const jurisdictionById = (id) => JURISDICTIONS.find(j => j.id === id);

export function getComparison(idA, idB) {
  const k1 = `${idA}:${idB}`;
  const k2 = `${idB}:${idA}`;
  if (COMPARISONS[k1]) return { features: COMPARISONS[k1], reversed: false };
  if (COMPARISONS[k2]) return { features: COMPARISONS[k2], reversed: true };
  return null;
}

export function formatSize(inches, units) {
  if (inches == null) return '—';
  return units === 'metric' ? `${Math.round(inches * 2.54)} cm` : `${inches} in`;
}

export function formatWeight(lb, units) {
  if (lb == null) return '—';
  return units === 'metric' ? `${(lb * 0.4536).toFixed(1)} kg` : `${lb} lb`;
}

export function daysSince(iso) {
  if (!iso) return 9999;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function isStale(meta) {
  // v1 ships bundled seed data and has no sync. Until a real sync writes a
  // fresh lastSyncDate, the baseline is the build date — that's not "stale,"
  // it's just the shipped data. Staleness only applies post-sync.
  if (!meta?.lastSyncDate || meta.lastSyncDate === DATA_BUILD_DATE) return false;
  return daysSince(meta.lastSyncDate) > 7;
}

// The displayed answer: strip the hedge wording so a season reads as an
// answer, not a punt. Freshness/uncertainty is signalled separately (the
// "as of <date>, unofficial" asterisk + official-source link).
export function cleanSeason(open) {
  if (!open) return null;
  let s = String(open)
    .replace(/\s*\(verify\)/ig, '')
    .replace(/\s*[—-]\s*verify\b.*$/i, '')
    .replace(/\btypical\b/ig, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^check current season$/i.test(s) || /^verify/i.test(s) || s === '') {
    return 'Set in-season — see official source';
  }
  return s;
}

/* ------------------------------------------------------------------
   Date-aware season evaluation.
   Parses the human "open" string against a given date and returns a
   precise state. Conservative by design: if it can't confidently parse
   dates it falls back to the coarse keyword status and never flips a
   stated closure to "open".
   ------------------------------------------------------------------ */
const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

function mkDate(monthStr, day, year) {
  const m = MONTHS[monthStr.slice(0, 3).toLowerCase()];
  if (m == null) return null;
  return new Date(Date.UTC(year, m, day, 12, 0, 0));
}

// Pull every "Mon D – Mon D[, YYYY]" range out of a string with its
// character offset. A trailing year applies to ranges without one.
function parseRanges(text, fallbackYear) {
  const re = new RegExp(`${MONTH_RE}\\s+(\\d{1,2})\\s*[–-]\\s*${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'ig');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const year = m[5] ? +m[5] : fallbackYear;
    const a = mkDate(m[1], +m[2], year);
    const b = mkDate(m[3], +m[4], year);
    if (a && b) out.push({ a, b, idx: m.index });
  }
  return out;
}

const inRange = (d, r) => d >= r.a && d <= r.b;

// status: 'open' | 'closed' | 'upcoming' | 'unknown'
export function seasonState(open, today = new Date()) {
  const fallback = (status) => ({ status, reason: cleanSeason(open) || 'See official source' });
  if (!open) return { status: 'unknown', reason: 'No season on file' };
  const raw = String(open).trim();
  const o = raw.toLowerCase();
  const year = today.getUTCFullYear();

  if (/not federally managed|not managed in gulf/.test(o))
    return { status: 'unknown', reason: 'Not federally managed — follow state rules' };
  if (/^check current season$/i.test(raw) || /^verify/i.test(o))
    return { status: 'unknown', reason: 'Set in-season — confirm with the agency' };

  // An explicit (re)open date — "Opens/Reopens <Mon D>, YYYY" with no end.
  const opensM = raw.match(new RegExp(`opens?\\s+${MONTH_RE}\\s+(\\d{1,2}),?\\s*(\\d{4})`, 'i'));
  if (opensM) {
    const d = mkDate(opensM[1], +opensM[2], +opensM[3]);
    if (d) return today < d
      ? { status: 'upcoming', reason: `Opens ${fmtDate(d)}` }
      : { status: 'open', reason: `Open since ${fmtDate(d)}` };
  }

  // Split ranges into closures vs open windows by the position of the
  // word "closed": ranges at/after it are closures.
  const ranges = parseRanges(raw, year);
  const closedAt = o.indexOf('closed');
  const closedRanges = closedAt < 0 ? [] : ranges.filter(r => r.idx >= closedAt);
  const openRanges = ranges.filter(r => !closedRanges.includes(r));

  const activeClosure = closedRanges.find(r => inRange(today, r));
  if (activeClosure)
    return { status: 'closed', reason: `Closed until ${fmtDate(addDay(activeClosure.b))}` };

  if (openRanges.length) {
    if (openRanges.some(r => inRange(today, r)))
      return { status: 'open', reason: cleanSeason(open) };
    const next = openRanges.filter(r => today < r.a).sort((x, y) => x.a - y.a)[0];
    if (next) return { status: 'upcoming', reason: `Opens ${fmtDate(next.a)}` };
    return { status: 'closed', reason: 'Season has ended for this year' };
  }

  // No open windows: a leading Open/Year-round (or a string that only
  // states closures) is open whenever no closure is active right now.
  if (/^(open|year-round|year round)\b/.test(o) || closedRanges.length)
    return { status: 'open', reason: closedRanges.length ? 'Open (outside the stated closure)' : 'Open' };

  return fallback(regStatus({ open }));
}

function addDay(d) { return new Date(d.getTime() + 86400000); }
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Definitive answer where the data supports one: Open / Closed.
// 'unknown' only when there is genuinely no season on file (then the UI
// shows the best-known info plus the official source to confirm).
export function regStatus(r) {
  if (!r || !r.open) return 'unknown';
  const raw = r.open.trim();
  const o = raw.toLowerCase();
  if (/not federally managed|not managed|see state|follow state/.test(o)) return 'unknown';
  if (/^check current season$/i.test(raw)) return 'unknown';
  // A leading "Open"/"Year-round" governs even if a later clause notes a
  // closed window; an entry that *starts* closed is closed.
  if (/^(open|year-round|year round)\b/.test(o)) return 'open';
  if (o.startsWith('closed')) return 'closed';
  if (o.includes('closed')) return 'closed';
  return 'open';
}

export function differs(a, b) {
  if (!a || !b) return false;
  return a.open !== b.open
    || a.minSize !== b.minSize
    || a.maxSize !== b.maxSize
    || a.bagLimit !== b.bagLimit
    || a.vesselLimit !== b.vesselLimit;
}

/* ------------------------------------------------------------------
   Sun + moon position (offline, pure math).
   sunPosition(date, lat, lon)  -> { altitudeDeg, azimuthDeg }
     altitude: -90..+90; azimuth: 0=N, 90=E, 180=S, 270=W
   moonPhase(date)              -> { phase, illumination, name }
     phase 0..1 (0=new); illumination 0..1; name e.g. "Waxing Gibbous"
   ------------------------------------------------------------------ */
const _RAD = Math.PI / 180;
function _daysJ2000(d) { return d.getTime() / 86400000 - 0.5 + 2440588 - 2451545; }
function _sunRaDec(d) {
  const n = _daysJ2000(d);
  const M = (357.5291 + 0.98560028 * n) * _RAD;
  const L = (280.4665 + 0.98564736 * n) * _RAD;
  const C = (1.9148 * Math.sin(M) + 0.0200 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * _RAD;
  const lambda = L + C, eps = 23.4397 * _RAD;
  return {
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)),
    ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)),
  };
}
export function sunPosition(date, lat, lon) {
  const n = _daysJ2000(date);
  const { dec, ra } = _sunRaDec(date);
  const lst = (280.16 + 360.9856235 * n) * _RAD + lon * _RAD;
  const H = lst - ra;
  const phi = lat * _RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitudeDeg: alt / _RAD, azimuthDeg: ((az / _RAD + 180) % 360 + 360) % 360 };
}

export function moonPhase(date) {
  // Synodic month from a known new moon (2000-01-06 18:14 UTC).
  const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
  const SYN = 29.530588853;
  const days = (date.getTime() - ref) / 86400000;
  const phase = ((days / SYN) % 1 + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const name = phase < 0.03 ? 'New Moon'
    : phase < 0.22 ? 'Waxing Crescent'
    : phase < 0.28 ? 'First Quarter'
    : phase < 0.47 ? 'Waxing Gibbous'
    : phase < 0.53 ? 'Full Moon'
    : phase < 0.72 ? 'Waning Gibbous'
    : phase < 0.78 ? 'Last Quarter'
    : phase < 0.97 ? 'Waning Crescent'
    : 'New Moon';
  return { phase, illumination, name };
}

/* ------------------------------------------------------------------
   Share / quick report
   ------------------------------------------------------------------ */

const _compass = (deg) => {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
};

function _both(pb, units) {
  const out = [];
  if (pb.weight != null) out.push(formatWeight(pb.weight, units));
  if (pb.length != null) out.push(formatSize(pb.length, units));
  return out;
}

export function buildPBReport({ anglerName, species, pb, units }) {
  const name = (anglerName || '').trim() || 'Angler';
  const primary = pb.primaryMetric === 'weight'
    ? formatWeight(pb.weight, units)
    : formatSize(pb.length, units);
  const secondary = pb.primaryMetric === 'weight'
    ? (pb.length != null ? formatSize(pb.length, units) : null)
    : (pb.weight != null ? formatWeight(pb.weight, units) : null);
  const jur = jurisdictionById(pb.jurisdiction);
  const lines = [
    `${name}'s ${species.commonName} — Personal Best`,
    '',
    `🏆 ${primary}${secondary ? ` · ${secondary}` : ''}`,
    `📅 ${pb.date || ''}`.trim(),
  ];
  if (jur) lines.push(`📍 ${jur.name}`);
  if (pb.location) lines.push(`   ${pb.location}`);
  if (pb.gearBait) lines.push(`🎣 ${pb.gearBait}`);
  if (pb.notes) { lines.push(''); lines.push(pb.notes); }
  lines.push('');
  lines.push('Logged with ReelIntel · reelintel.app');
  return lines.filter(l => l != null).join('\n');
}

export function buildCatchReport({ anglerName, species, c, units }) {
  const name = (anglerName || '').trim() || 'Angler';
  const speciesName = species ? species.commonName : (c.speciesId || 'Unknown species');
  const lines = [
    `${name}'s ${speciesName}`,
    '',
  ];
  const measured = [];
  if (c.weight != null) measured.push(`${c.weight} ${units === 'metric' ? 'kg' : 'lb'}`);
  if (c.length != null) measured.push(`${c.length} ${units === 'metric' ? 'cm' : 'in'}`);
  if (measured.length) lines.push(`🐟 ${measured.join(' · ')}`);
  if (c.dateIso) {
    const d = new Date(c.dateIso);
    lines.push(`📅 ${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`);
  }
  const jur = jurisdictionById(c.jurisdiction);
  if (jur) lines.push(`📍 ${jur.name}`);
  if (c.lat != null && c.lon != null) lines.push(`   ${c.lat.toFixed(5)}°, ${c.lon.toFixed(5)}°`);
  if (c.sunAlt != null) lines.push(`🌅 Sun ${c.sunAlt.toFixed(0)}° ${_compass(c.sunAz || 0)}`);
  if (c.moonName) lines.push(`🌙 ${c.moonName} · ${Math.round((c.moonIllum || 0) * 100)}%`);
  if (c.weather) {
    const w = c.weather;
    const wbits = [];
    if (w.tempF != null) wbits.push(`${Math.round(w.tempF)}°F`);
    if (w.windMph != null) wbits.push(`${_compass(w.windDir || 0)} ${Math.round(w.windMph)} mph`);
    if (w.cloudPct != null) wbits.push(`${Math.round(w.cloudPct)}% clouds`);
    if (w.pressureMb != null) wbits.push(`${Math.round(w.pressureMb)} mb`);
    if (wbits.length) lines.push(`🌤  ${wbits.join(' · ')}`);
  }
  if (c.notes) { lines.push(''); lines.push(c.notes); }
  lines.push('');
  lines.push('Logged with ReelIntel · reelintel.app');
  return lines.join('\n');
}

async function _dataUrlToFile(dataUrl, name) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

/* Share via Web Share API; falls back to clipboard.
   Returns: 'shared' | 'copied' | 'cancelled' | 'failed' */
export async function shareReport({ title, text, photoDataUrl, fileName = 'catch.jpg' }) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      if (photoDataUrl && navigator.canShare) {
        const file = await _dataUrlToFile(photoDataUrl, fileName);
        if (file && navigator.canShare({ files: [file], text, title })) {
          await navigator.share({ files: [file], text, title });
          return 'shared';
        }
      }
      await navigator.share({ text, title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
