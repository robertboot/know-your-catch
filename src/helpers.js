import { SPECIES, JURISDICTIONS, COMPARISONS, DATA_BUILD_DATE } from './data.js';
import photoManifest from '../photos/manifest.json';
import { speciesPhotoOverride } from './species-store.js';

// Proprietary images are served from the repo via GitHub raw (same
// public source the feeds use); licensed fallbacks come from their URL.
const PHOTO_RAW = 'https://raw.githubusercontent.com/robertboot/know-your-catch/claude/upload-app-assets-NUxRr/';

// Best available photo for a species, or null (caller draws the
// FishMark illustration). Preference order:
//   1. Admin-uploaded Supabase override (species_photos primary row)
//   2. Bundled manifest — proprietary file in the repo
//   3. Bundled manifest — external fallback URL
//   4. null → FishMark placeholder illustration
export function speciesPhoto(id) {
  const override = speciesPhotoOverride(id);
  if (override) return override;
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
// Separators cover what both humans and the AI-draft pipeline write:
// en/em dash, hyphen, and the words to / through / thru / until.
// ("June 1 through August 31" was previously unparseable, which sent
// perfectly good verified seasons into the 'unknown' bucket.)
const RANGE_SEP = `(?:\\s*[–—-]\\s*|\\s+(?:to|through|thru|until)\\s+)`;
function parseRanges(text, fallbackYear) {
  const re = new RegExp(`${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s*\\d{4})?${RANGE_SEP}${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'ig');
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

  // Parse ranges FIRST — "Open Jun 1 – Aug 31" must be treated as a
  // window, not as a bare "Opens Jun 1" start date. The opens-date
  // path below only runs when the string has no parseable range.
  const ranges = parseRanges(raw, year);

  // An explicit (re)open date — "Opens/Reopens <Mon D>[, YYYY]" with
  // no end date anywhere in the string. Year optional: AI drafts and
  // agency pages often write "Opens May 22" for the current season.
  // Assume the year that puts the date closest to today (a January
  // "Opens Dec 1" means last month, not eleven months out).
  if (ranges.length === 0) {
    const opensM = raw.match(new RegExp(`opens?\\s+${MONTH_RE}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i'));
    if (opensM) {
      let d = mkDate(opensM[1], +opensM[2], opensM[3] ? +opensM[3] : year);
      if (d && !opensM[3]) {
        const half = 182 * 86400000;
        if (d - today > half)      d = mkDate(opensM[1], +opensM[2], year - 1);
        else if (today - d > half) d = mkDate(opensM[1], +opensM[2], year + 1);
      }
      if (d) return today < d
        ? { status: 'upcoming', reason: `Opens ${fmtDate(d)}` }
        : { status: 'open', reason: `Open since ${fmtDate(d)}` };
    }
  }

  // Split ranges into closures vs open windows by the position of the
  // word "closed": ranges at/after it are closures.
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

/* Normalize a PB's photos into an array (max 3). Honours the legacy
   single `photo` field so old records keep displaying after the upgrade. */
export function pbPhotos(pb) {
  if (!pb) return [];
  if (Array.isArray(pb.photos)) return pb.photos.filter(Boolean).slice(0, 3);
  if (pb.photo) return [pb.photo];
  return [];
}

/* Same idea for a catch log entry. */
export function catchPhotos(c) {
  if (!c) return [];
  if (Array.isArray(c.photos)) return c.photos.filter(Boolean).slice(0, 3);
  if (c.photo) return [c.photo];
  return [];
}

/* Build a maps.apple.com universal link for a pair of coordinates.
   Opens Apple Maps natively on iOS / macOS and maps.apple.com in the
   browser elsewhere. Falls back to null for non-finite inputs. */
export function appleMapsLink(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const q = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `https://maps.apple.com/?ll=${q}&q=${encodeURIComponent(q)}`;
}

/* ------------------------------------------------------------------
   Share / quick report
   ------------------------------------------------------------------ */

/* Fetch weather for a specific moment in time and location. Branches
   by age so backdated uploads (photo taken last week) get correct
   historical weather instead of today's:

     age < 2h  → open-meteo /v1/forecast?current=…  (weather.source: 'live')
     age >= 2h → open-meteo /v1/archive with start_date=end_date=YYYY-MM-DD,
                 pick hourly index closest to the target time
                 (weather.source: 'archive')
     archive returns empty hourly array (recent-lag 2h–5d gap) →
                 /v1/forecast?past_days=7 + hourly + start/end_date filter
                 (weather.source: 'forecast_past_days')

   AbortController budget: 5s. On failure returns null; catch still
   saves. Future timestamps (broken camera clocks) clamp to now.

   Weather shape: { tempF, windMph, windDir, cloudPct, precipMm,
                    pressureMb, source }. Consumers key on source to
   badge archived rows in the UI. */
export async function fetchWeatherForTime({ lat, lon, when }) {
  if (lat == null || lon == null) return null;
  const now = Date.now();
  let ts = when instanceof Date ? when.getTime() : new Date(when).getTime();
  if (!Number.isFinite(ts)) return null;
  if (ts > now) {
    console.warn('fetchWeatherForTime: future timestamp clamped to now', new Date(ts).toISOString());
    ts = now;
  }
  const ageMs = now - ts;

  const wxUnits = 'temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto';
  const hourly  = 'hourly=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);

  const runFetch = async (url) => {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    return await r.json();
  };
  const closestHourlyIdx = (times, target) => {
    let best = -1, bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  };

  try {
    // Live branch: <2h old.
    if (ageMs < 2 * 60 * 60 * 1000) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl&${wxUnits}`;
      const j = await runFetch(url);
      const c = j.current || {};
      clearTimeout(timer);
      return {
        tempF: c.temperature_2m, windMph: c.wind_speed_10m, windDir: c.wind_direction_10m,
        cloudPct: c.cloud_cover, precipMm: c.precipitation, pressureMb: c.pressure_msl,
        source: 'live',
      };
    }

    // Archive branch: >=2h old.
    const day = new Date(ts).toISOString().slice(0, 10);
    const archiveUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${day}&end_date=${day}&${hourly}&${wxUnits}`;
    let j = await runFetch(archiveUrl);
    const hoursA = j.hourly?.time || [];
    if (hoursA.length > 0) {
      const idx = closestHourlyIdx(hoursA, ts);
      clearTimeout(timer);
      if (idx < 0) return null;
      const h = j.hourly;
      return {
        tempF:     h.temperature_2m?.[idx] ?? null,
        windMph:   h.wind_speed_10m?.[idx] ?? null,
        windDir:   h.wind_direction_10m?.[idx] ?? null,
        cloudPct:  h.cloud_cover?.[idx] ?? null,
        precipMm:  h.precipitation?.[idx] ?? null,
        pressureMb: h.pressure_msl?.[idx] ?? null,
        source: 'archive',
      };
    }

    // Recent-lag fallback: archive doesn't cover the past ~5 days yet.
    // The forecast endpoint's past_days window fills that gap.
    const fallbackUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=7&start_date=${day}&end_date=${day}&${hourly}&${wxUnits}`;
    j = await runFetch(fallbackUrl);
    const hoursB = j.hourly?.time || [];
    clearTimeout(timer);
    if (hoursB.length === 0) return null;
    const idx = closestHourlyIdx(hoursB, ts);
    if (idx < 0) return null;
    const h = j.hourly;
    return {
      tempF:     h.temperature_2m?.[idx] ?? null,
      windMph:   h.wind_speed_10m?.[idx] ?? null,
      windDir:   h.wind_direction_10m?.[idx] ?? null,
      cloudPct:  h.cloud_cover?.[idx] ?? null,
      precipMm:  h.precipitation?.[idx] ?? null,
      pressureMb: h.pressure_msl?.[idx] ?? null,
      source: 'forecast_past_days',
    };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

/* Guard: catch strings if a conditions/coordinate line accidentally
   slips into a share payload. This is user privacy — we never share
   catch location, weather, or celestial data. Warns loudly in dev so
   a regression shows up during smoke testing. */
function _assertNoLeak(lines) {
  const bad = lines.find(l => typeof l === 'string' && /\b(lat|lon|°|coord|wind|cloud|pressure|moon|sun)\b/i.test(l));
  if (bad) console.warn('Share leaked conditions — bug:', bad);
}

const _fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { dateStyle: 'medium' });
};

/* PB report. Format is fixed per Section 6 spec:

     🏆 Personal Best Catch

     {name} landed a {size} {species}

     📍 Waters: {jur.name}
     📅 Date: {formatted}

     Shared with ReelIntel
     Fish smarter. Catch more.

   Size line prefers weight, falls back to length; if neither, the
   size descriptor drops and it reads "landed a {species}". */
export function buildPBReport({ anglerName, species, pb, units }) {
  const name = (anglerName || '').trim() || 'Angler';
  const speciesName = species ? species.commonName : 'a fish';
  const sizeStr = pb?.weight != null ? formatWeight(pb.weight, units)
                : pb?.length != null ? formatSize(pb.length, units)
                : null;
  const jur = jurisdictionById(pb?.jurisdiction);
  const dateStr = _fmtDate(pb?.date || pb?.dateIso);

  const lines = [
    '🏆 Personal Best Catch',
    '',
    sizeStr
      ? `${name} landed a ${sizeStr} ${speciesName}`
      : `${name} landed a ${speciesName}`,
    '',
  ];
  if (jur)      lines.push(`📍 Waters: ${jur.name}`);
  if (dateStr)  lines.push(`📅 Date: ${dateStr}`);
  lines.push('');
  lines.push('Shared with ReelIntel');
  lines.push('Fish smarter. Catch more.');
  _assertNoLeak(lines);
  return lines.join('\n');
}

/* Regular catch report. Format:

     {name} landed a {species}

     🐟 Size: {size} {unit}
     📍 Waters: {jur.name}
     📅 Date: {formatted}

     Shared with ReelIntel
     Fish smarter. Catch more.

   Size line drops entirely if neither weight nor length is set. */
export function buildCatchReport({ anglerName, species, c, units }) {
  const name = (anglerName || '').trim() || 'Angler';
  const speciesName = species ? species.commonName : 'a fish';
  const sizeStr = c?.weight != null ? formatWeight(c.weight, units)
                : c?.length != null ? formatSize(c.length, units)
                : null;
  const jur = jurisdictionById(c?.jurisdiction);
  const dateStr = _fmtDate(c?.dateIso);

  const lines = [
    `${name} landed a ${speciesName}`,
    '',
  ];
  if (sizeStr) lines.push(`🐟 Size: ${sizeStr}`);
  if (jur)     lines.push(`📍 Waters: ${jur.name}`);
  if (dateStr) lines.push(`📅 Date: ${dateStr}`);
  lines.push('');
  lines.push('Shared with ReelIntel');
  lines.push('Fish smarter. Catch more.');
  _assertNoLeak(lines);
  return lines.join('\n');
}

/* Species search ranker — extracted so IdentifyScreen and the
   SpeciesPickerModal behave the same when a user types.
   Rank order: startsWith(commonName) > contains(commonName) >
   contains(altNames) > contains(scientific). Returns an array of
   { s, rank, matchedAlt } sorted by rank then alphabetical.
   Empty query returns [] — callers should render their full list
   themselves in that case. */
export function rankSpeciesSearch(query, list) {
  const lower = (query || '').trim().toLowerCase();
  if (!lower) return [];
  const rows = [];
  for (const s of list) {
    const cn  = (s.commonName || '').toLowerCase();
    const sci = (s.scientific || '').toLowerCase();
    const alt = (s.altNames || []).map(a => a.toLowerCase());
    let rank = -1;
    let matchedAlt = null;
    if      (cn.startsWith(lower)) rank = 0;
    else if (cn.includes(lower))   rank = 1;
    else if (alt.some(a => a.includes(lower))) {
      rank = 2;
      matchedAlt = (s.altNames || []).find(a => a.toLowerCase().includes(lower));
    }
    else if (sci.includes(lower))  rank = 3;
    if (rank >= 0) rows.push({ s, rank, matchedAlt });
  }
  return rows.sort((a, b) =>
    a.rank - b.rank || (a.s.commonName || '').localeCompare(b.s.commonName || '')
  );
}

export async function dataUrlToFile(dataUrl, name) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

/* Share via Web Share API with up to 3 photos attached. Preference
   order: files+text via navigator.share → text-only navigator.share
   → clipboard fallback. Returns 'shared' | 'copied' | 'cancelled' |
   'failed'.

   photoDataUrls: array of resolved data URLs (nulls filtered out
   by the caller). fileName is the stem — index appended per photo. */
export async function shareReport({ title, text, photoDataUrls = [], fileName = 'catch' }) {
  const urls = (Array.isArray(photoDataUrls) ? photoDataUrls : []).filter(Boolean).slice(0, 3);
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      if (urls.length && navigator.canShare) {
        const files = (await Promise.all(urls.map((u, i) => dataUrlToFile(u, `${fileName}-${i + 1}.jpg`))))
          .filter(Boolean);
        if (files.length && navigator.canShare({ files, text, title })) {
          await navigator.share({ files, text, title });
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
