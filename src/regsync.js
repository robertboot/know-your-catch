// Runtime regulations sync. Offline-first: the app already has the
// bundled feed (data.js); this refreshes it from the published feed when
// online and caches it for the next launch. Any failure is silent — the
// last good data stays in place.
import { applyFeed, REGULATIONS, FEEDS } from './data.js';

// Set this once the feed is hosted (GitHub Pages or a CDN), e.g.
// 'https://robertboot.github.io/know-your-catch/regulations/feed'.
// Empty disables network sync (bundled/cached only).
export const REGS_FEED_URL = '';

const CACHE_KEY = 'kyc_regs_feed_v1';
const TIMEOUT_MS = 8000;

export async function refreshFeeds() {
  if (!REGS_FEED_URL) return { synced: false, reason: 'feed URL not configured' };
  const base = REGS_FEED_URL.replace(/\/$/, '');
  const files = {};
  for (const { file } of FEEDS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(`${base}/${file}`, { signal: ctrl.signal, cache: 'no-cache' });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.schema === 'kyc-regulations/v1' && json.rules) {
        files[file] = json;
        applyFeed(REGULATIONS, json);
      }
    } catch (e) {
      // offline, timeout, bad JSON — keep last good data
    }
  }
  if (Object.keys(files).length) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), files }));
    } catch (e) { /* storage full / disabled */ }
    return { synced: true, count: Object.keys(files).length };
  }
  return { synced: false, reason: 'no feeds fetched' };
}
