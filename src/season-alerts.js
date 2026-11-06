/* season-alerts — imminent season openings/closings for the angler's
   selected waters.

   Offline-first and fully client-side: it reads the same bundled +
   verified regulations the rest of the app uses (regulationFor) and
   the shared seasonTransition() classifier, so it works with no network
   and no server job. Powers:
     - the "Opening soon" / "Closing soon" sections on Regulation Alerts
     - the in-app bell inbox (season_alert items)

   The species an angler is alerted about = their starred fish ∪ the
   curated POPULAR_SPECIES_IDS, scoped to their one selected
   jurisdiction. */
import { regulationFor } from './regulations-store.js';
import { seasonTransition, speciesById, jurisdictionById } from './helpers.js';
import { POPULAR_SPECIES_IDS } from './data.js';

/* The alert species pool: starred fish first, then the popular set,
   deduped and order-preserving. */
export function alertSpeciesIds(favorites = []) {
  return Array.from(new Set([...(favorites || []), ...POPULAR_SPECIES_IDS]));
}

/* Imminent transitions for a jurisdiction across a set of species.
   Returns [{ speciesId, jurisdictionId, kind:'opening'|'closing',
   date, days }], nearest-first. Species with no reg / no imminent
   change are skipped. */
export function pendingSeasonAlerts(jurisdictionId, speciesIds, today = new Date()) {
  if (!jurisdictionId || !speciesIds || !speciesIds.length) return [];
  const out = [];
  for (const id of speciesIds) {
    const reg = regulationFor(id, jurisdictionId).regulation;
    if (!reg || !reg.open) continue;
    const tr = seasonTransition(reg.open, today);
    if (tr) out.push({ speciesId: id, jurisdictionId, ...tr });
  }
  return out.sort((a, b) => a.days - b.days);
}

/* Stable key for dismiss/dedupe. Includes the event date (day
   granularity) so next year's opening is a fresh, re-alertable item
   rather than one the user dismissed 12 months ago. */
export function seasonAlertKey(a) {
  return `season:${a.jurisdictionId}:${a.speciesId}:${a.kind}:${String(a.date).slice(0, 10)}`;
}

function whenPhrase(days) {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}

/* Inbox-ready rows for the bell drawer — same shape the announcement /
   reg-alert sources produce. `nowIso` is passed in (not read from the
   clock here) so the caller controls the stamp. */
export function seasonAlertInboxItems(jurisdictionId, favorites = [], today = new Date(), nowIso = null) {
  if (!jurisdictionId) return [];
  const jurName = jurisdictionById(jurisdictionId)?.name || jurisdictionId;
  const stamp = nowIso || new Date().toISOString();
  return pendingSeasonAlerts(jurisdictionId, alertSpeciesIds(favorites), today).map(a => {
    const spName = speciesById(a.speciesId)?.commonName || a.speciesId;
    const opening = a.kind === 'opening';
    const dateStr = new Date(a.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const key = seasonAlertKey(a);
    return {
      id: key,
      dismissKey: key,
      kind: 'season_alert',
      seasonKind: a.kind,        // 'opening' | 'closing'
      title: `${spName} — ${opening ? 'opens soon' : 'closes soon'}`,
      body: `${jurName}: season ${opening ? 'opens' : 'closes'} ${dateStr} (${whenPhrase(a.days)}).`,
      stamp,
      source: opening ? 'Season opening' : 'Season closing',
    };
  });
}
