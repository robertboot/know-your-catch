/* Which water are we scoring?
 *
 * Home, Forecast and Ocean Maps all have to answer this the same way, or
 * the grade on one screen describes a different patch of sea from the
 * grade on another — and the angler has no way to tell. Home already
 * resolved it one way and Forecast another; this is the one copy.
 * See [[duplicated-knowledge]].
 *
 * Order matters: the starred spot is the angler's declared home water and
 * beats a stale GPS fix or an incidental catch position.
 */
export function homeWater(state, jurisdiction) {
  const starred = (state?.fishingSpots || []).find(s => s.starred);
  if (starred && Number.isFinite(starred.lat) && Number.isFinite(starred.lon)) {
    return { lat: starred.lat, lon: starred.lon, label: starred.name };
  }
  const recent = (state?.catchLog || []).find(c => c.lat != null && c.lon != null);
  if (recent) return { lat: recent.lat, lon: recent.lon, label: 'Last catch location' };
  const c = jurisdiction?.center;
  if (c) return { lat: c.lat, lon: c.lon, label: jurisdiction.name || 'Selected waters' };
  return { lat: 27.5, lon: -84, label: 'Gulf of Mexico' };
}

/* The cache every screen reads the ten-day outlook from.
 *
 * Written wherever the forecast is fetched, read by Ocean Maps so the day
 * strip works with no signal — which is the only state that matters, since
 * the day strip exists to be read on the way out of the pass. Keyed on
 * the water, not on 0,0, because an angler with two home ports has two
 * different weeks. */
export const DAYS_CACHE = 'days.v1';

/* Pick the best spot the angler can actually reach, and measure the run
 * from THEIR water.
 *
 * Pulled out of the Home card so it can be tested. The card shipped
 * taking the highest-scoring break in a table covering the whole Gulf and
 * the Florida Atlantic, and printing dist_nm from the row — which is
 * measured from whichever harbour the spot's REGION is keyed to. An
 * angler in Orange Beach was told "72 nm NNE", 385 nm away, from a port
 * they have never left. Every number on the card was correct; none of
 * them was about the reader.
 */
const NM_PER_DEG = 60;

export function runFrom(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * NM_PER_DEG;
  const dLon = (bLon - aLon) * NM_PER_DEG * Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  return { dist: Math.hypot(dLat, dLon), brg: (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360 };
}

/* A long offshore day. Beyond this the honest answer is "nothing near
   you", and the card renders nothing rather than something irrelevant. */
export const MAX_RUN_NM = 150;

/* Every spot within reach, best first, each carrying the run from the
   angler's own water. The Home card takes the first of these; the Plan
   Your Trip page shows the list. */
export function reachableSpots(rows, home, maxNm = MAX_RUN_NM) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return [];
  return (rows || [])
    .filter(r => r && r.score != null && Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map(r => ({ ...r, _run: runFrom(home.lat, home.lon, r.lat, r.lon) }))
    .filter(r => r._run.dist <= maxNm)
    .sort((a, b) => b.score - a.score);
}

export function pickReachableSpot(rows, home, maxNm = MAX_RUN_NM) {
  if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lon)) return null;
  return reachableSpots(rows, home, maxNm)[0] || null;
}

/* Compass point for a bearing. Here because the Home card, the trip page
   and the spot sheet all name a direction, and three copies of a lookup
   table is how two of them end up off by one sector. */
const COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                 'S','SSW','SW','WSW','W','WNW','NW','NNW'];
export const compassPoint = (deg) =>
  (deg == null || !Number.isFinite(deg)) ? '' : COMPASS[Math.round(deg / 22.5) % 16];
