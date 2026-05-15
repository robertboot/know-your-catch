import { SPECIES, JURISDICTIONS, COMPARISONS } from './data.js';

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
  return daysSince(meta?.lastSyncDate) > 7;
}

export function regStatus(r) {
  if (!r) return 'unknown';
  const o = (r.open || '').toLowerCase();
  if (o.includes('closed')) return 'closed';
  if (o.includes('check') || o.includes('verify') || o.includes('limited')) return 'caution';
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
