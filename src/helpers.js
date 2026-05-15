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
