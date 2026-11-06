/* Last-known marine + weather data, kept on the device.
 *
 * The app is sold as built for offshore and the conditions screens were
 * the one part that simply stopped working there: every reading came
 * from a live fetch with no fallback, so twenty miles out the forecast
 * was a blank screen and the Fishability grade was a dash.
 *
 * What this does NOT do is pretend. A cached forecast is shown with the
 * time it was fetched and how old that makes it, because a two-day-old
 * wind reading presented as current is worse offshore than no reading:
 * the angler can plan around stale data they know is stale.
 *
 * Stored in localStorage rather than Filesystem: these payloads are tens
 * of kilobytes, they are read on first paint, and an async Filesystem
 * read would put a frame of blankness in front of the thing this exists
 * to prevent.
 */

const PREFIX = 'kyc.marine.';
// A week. Past that the numbers are not "stale", they are history — a
// seven-day-old sea state tells you nothing about today.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* One cache entry per place, so moving between saved spots does not
   throw away the forecast for the one you were just looking at. */
const keyFor = (kind, lat, lon) =>
  `${PREFIX}${kind}.${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;

export function readMarineCache(kind, lat, lon) {
  if (lat == null || lon == null) return null;
  try {
    const raw = localStorage.getItem(keyFor(kind, lat, lon));
    if (!raw) return null;
    const hit = JSON.parse(raw);
    if (!hit?.at || !hit?.data) return null;
    const age = Date.now() - hit.at;
    if (age > MAX_AGE_MS) return null;
    return { data: hit.data, at: hit.at, ageMs: age };
  } catch { return null; }
}

export function writeMarineCache(kind, lat, lon, data) {
  if (lat == null || lon == null || !data) return;
  try {
    localStorage.setItem(keyFor(kind, lat, lon), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Quota is the only realistic failure here. Drop the oldest marine
    // entries and try once more — losing a cached forecast is survivable,
    // throwing from a save path is not.
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(PREFIX));
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(k => localStorage.removeItem(k));
      localStorage.setItem(keyFor(kind, lat, lon), JSON.stringify({ at: Date.now(), data }));
    } catch { /* give up quietly; the screen still works, just live-only */ }
  }
}

/* "2 hours ago" / "yesterday" — for the staleness line. Deliberately
   coarse: the angler needs to know whether to trust it, not the minute. */
export function describeAge(ms) {
  if (ms == null) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/* Fetch with a deadline. A boat has one bar, not zero — the failure that
   strands people is a request that never returns, not one that refuses.
   Without this the screen sits on a spinner over a perfectly good cached
   forecast. */
export async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}
