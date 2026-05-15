import { SPECIES, JURISDICTIONS, COMPARISONS, DATA_BUILD_DATE } from './data.js';

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
