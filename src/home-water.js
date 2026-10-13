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

/* Collapse the several points the server publishes along ONE break into
 * one entry.
 *
 * find-hotspots offers up to MAX_SPOTS peaks per connected group so a
 * hundred-mile wall is not reduced to a single pin on the map. On a map
 * that is right. In a LIST it reads as three places to choose between
 * when it is one place three times — Orange Beach was shown the same
 * 16 nm Louisiana break at 124, 129 and 133 nm.
 *
 * The grouping signal is exact rather than a distance guess: every peak
 * from one group is built with that group's own span and bearing, so
 * spots sharing region, length and bearing came from the same break.
 */
/* The identity of a break, derived the same way wherever it is needed.
   The list and the map have to agree on what "that one" means, or
   highlighting a card cannot find its area. */
export function breakKey(s) {
  return [s?.region_id, Number(s?.length_nm || 0).toFixed(1),
          Number(s?.bearing_deg || 0).toFixed(1)].join('|');
}

export function groupByBreak(spots) {
  const byBreak = new Map();
  for (const s of spots || []) {
    const key = breakKey(s);
    const seen = byBreak.get(key);
    if (!seen) { byBreak.set(key, { ...s, _points: 1 }); continue; }
    seen._points += 1;
    // Keep the strongest point as the one to steer at, and the nearest
    // run, since any point on the break is a legitimate place to start.
    if (s.score > seen.score) {
      const points = seen._points;
      byBreak.set(key, { ...s, _points: points, _run: (s._run?.dist ?? Infinity) < (seen._run?.dist ?? Infinity) ? s._run : seen._run });
    } else if ((s._run?.dist ?? Infinity) < (seen._run?.dist ?? Infinity)) {
      seen._run = s._run;
    }
  }
  return [...byBreak.values()].sort((a, b) => b.score - a.score);
}

/* What a spot's score MEANS, in words.
 *
 * These used to be rendered through fishabilityGrade, so a 20-score break
 * showed the same red F as a day with a dangerous sea — while the card's
 * own text said "this is the best of it". One scale cannot carry both
 * "the water is unsafe" and "the fishing sign is faint"; the first is a
 * warning and the second is a ranking. MIN_SCORE in find-hotspots is 65,
 * which is the bar for a break worth driving to.
 */
export function spotStanding(score) {
  if (score == null) return { label: 'Unscored', tone: 'mute' };
  if (score >= 65) return { label: 'Strong break', tone: 'good' };
  if (score >= 40) return { label: 'Worth a look', tone: 'fair' };
  return { label: 'Best of a quiet pass', tone: 'mute' };
}

/* How old the spots are, said in a way that parses.
 *
 * The first version read "A day old by then. Breaks drift with the
 * current" under a WHERE TO GO heading, with Today selected — which names
 * nothing as old and says "by then" about now. Two faults: the subject was
 * missing, and "by then" only makes sense about a future day.
 *
 * `observedIso` is the satellite pass, `dayIso` the day being planned for,
 * `isToday` whether that day is today. Returns null when there is nothing
 * worth saying.
 */
export function spotAgeNote(observedIso, dayIso, isToday) {
  if (!observedIso || !dayIso) return null;
  const drift = 'Breaks drift with the current, so treat one as where to start looking '
              + 'rather than a mark to park on.';
  const days = Math.round((Date.parse(dayIso + 'T12:00:00') - Date.parse(observedIso)) / 86400000);
  if (isToday) {
    // Naming the pass is more use than naming its age: the angler knows
    // what last night means and does not have to subtract anything.
    return days <= 1
      ? `These are from last night's satellite pass. ${drift}`
      : `These are from a satellite pass ${days} days ago. ${drift}`;
  }
  if (days < 1) return null;
  return `These spots will be ${days === 1 ? 'a day' : days + ' days'} old by the day you have `
       + `picked. ${drift}`;
}
