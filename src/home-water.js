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
