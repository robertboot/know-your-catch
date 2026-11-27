/* A season the agency has closed must never read as open.
 *
 * Alabama greater amberjack closed on Oct 14, 2026 and the app showed
 * "Season Open" in late November. The row was right - "Closed — 2026
 * season was September 1, 2026 - October 14, 2026 ... season now closed" -
 * and the reader was wrong: it took every date range after the word
 * "closed" to be the CLOSURE window, so the season that had run became a
 * closure that was over, and "outside the stated closure" means open.
 *
 * These are the sentences the regulation updater really writes, copied
 * from the live table, each with the answer an angler must see.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'season-')), 'helpers.mjs');
await build({
  entryPoints: [path.join(root, 'src/helpers.js')], bundle: true, format: 'esm',
  platform: 'node', outfile, logLevel: 'error',
  define: { 'import.meta.env': '{}', __KYC_WEB__: 'false', __KYC_ADMIN__: 'false' },
  banner: { js: 'globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };' },
});
const { seasonState } = await import(pathToFileURL(outfile).href);

const D = (s) => new Date(s + 'T15:00:00Z');
const CASES = [
  // [label, season text, date, expected status]
  ['AL amberjack, the report', 'Closed — 2026 season was September 1, 2026 - October 14, 2026 (Alabama state waters open concurrently with federal Gulf waters); season now closed and will not reopen until September 1, 2027', '2026-11-24', 'closed'],
  ['FL Gulf amberjack', 'Closed — 2026 Gulf state waters season (Sept 1 – Oct 13, 2026) has ended; harvest closed as of 12:01 a.m. Oct 14, 2026 and remains closed until the next scheduled opening, Sept 1, 2027', '2026-11-24', 'closed'],
  ['federal amberjack', 'Closed — the 2026 season closed Oct 14, 2026 when the quota was met.', '2026-11-24', 'closed'],
  ['newsletter wording', 'Closed — ran Jun 1 – Oct 26', '2026-11-24', 'closed'],
  ['LA/MS amberjack, bare window', 'September 1 - October 14, 2026', '2026-11-24', 'closed'],
  ['same window, while it ran', 'September 1 - October 14, 2026', '2026-09-20', 'open'],
  ['AL amberjack while it ran', 'Closed — 2026 season was September 1, 2026 - October 14, 2026; season now closed', '2026-09-20', 'closed'], // the row says closed; believe it
  // What already worked and must keep working.
  ['a real closure window, outside it', 'Open — closed Jan 1, 2027 – Feb 28, 2027 and Jun 1, 2027 – Jul 31, 2027.', '2026-11-24', 'open'],
  ['a real closure window, inside it', 'Open — closed Jan 1, 2027 – Feb 28, 2027 and Jun 1, 2027 – Jul 31, 2027.', '2027-01-15', 'closed'],
  ['hogfish Atlantic', 'Closed Nov 1, 2026 – Apr 30, 2027.', '2026-11-24', 'closed'],
  ['hogfish Atlantic, next summer', 'Closed Nov 1, 2026 – Apr 30, 2027.', '2027-06-10', 'open'],
  ['snook, open now', 'Open now. Closed Dec 1, 2026 – Feb 28, 2027 and May 1, 2027 – Aug 31, 2027.', '2026-11-24', 'open'],
  ['snook, in the winter closure', 'Open now. Closed Dec 1, 2026 – Feb 28, 2027 and May 1, 2027 – Aug 31, 2027.', '2026-12-20', 'closed'],
  ['bundled AL amberjack', 'Sept 1 – Dec 31 (closed Jan 1 – Aug 31, 2026)', '2026-06-01', 'closed'],
  ['open window then annual closure', 'Open Aug 1 – Dec 31, 2026; closed annually Jan 1 – Feb 28', '2026-11-24', 'open'],
  ['year-round', 'Year-round.', '2026-11-24', 'open'],
  ['shallow-water grouper', 'Year-round, except closed Feb 1, 2027 – Mar 31, 2027 seaward of the ~20-fathom contour; closed Jan 1, 2027 – Jun 30, 2027 and every year after.', '2026-11-24', 'open'],
  ['prohibited', 'Harvest prohibited in federal Gulf waters.', '2026-11-24', 'closed'],
  // Asides, year-round and wrapped seasons - each of these read wrongly
  // against the live table on 2026-11-27.
  ['TX snook, licence-year aside', 'Year-round (Sep 1, 2025 - Aug 31, 2026 regulation cycle)', '2026-11-27', 'open'],
  ['TX amberjack, cycle aside', 'Year-round in Texas state waters (2025-2026 regulatory cycle, valid Sep 1, 2025 - Aug 31, 2026)', '2027-04-15', 'open'],
  ['FL Atlantic amberjack, open months in an aside', 'Open year-round except closed April 1-30, 2026 (Jan 1 - Mar 31, 2026 and May 1 - Dec 31, 2026)', '2026-11-27', 'open'],
  ['same-month closure, inside it', 'Open year-round in South Atlantic federal waters, except closed April 1-30 each year for spawning', '2027-04-15', 'closed'],
  ['closure inside the aside is kept', 'Year-round (closed November 1 - November 30)', '2026-11-27', 'closed'],
  ['year-round, prohibition in the aside', 'Year-round (harvest prohibited)', '2026-11-27', 'closed'],
  ['year-round closure', 'Year-round closure — Harvest Prohibited', '2026-11-27', 'closed'],
  ['year-round closed to retention', 'Year-round closed to retention (prohibited species)', '2026-11-27', 'closed'],
  ['catch and release only', 'Year-round (catch-and-release only)', '2026-11-27', 'closed'],
  ['"subject to closure" is not a closure', 'Year-round (2026), subject to closure if adjacent federal Gulf shark season closes', '2026-11-27', 'open'],
  ['"no seasonal closure" is not a closure', 'Year-round — no federal recreational seasonal closure.', '2026-11-27', 'open'],
  ['annual window, closed until next May', 'Open May 1 - June 30 annually (currently CLOSED July 1 - December 31, 2026)', '2026-11-27', 'closed'],
  ['dated window, reopens when the closure ends', 'Open Dec 1, 2025 - Oct 14, 2026; Closed Oct 15 - Nov 30, 2026 (annual recreational closure)', '2026-11-27', 'closed'],
  ['...and is open the day after', 'Open Dec 1, 2025 - Oct 14, 2026; Closed Oct 15 - Nov 30, 2026 (annual recreational closure)', '2026-12-02', 'open'],
  ['second clause says open', 'Closed Oct 15 - Nov 30, 2026 (reopens Dec 1, 2026); open Dec 1 - Oct 14 otherwise', '2027-07-15', 'open'],
  ['open stated after the range', 'Open Year-round (state waters closed Jan 1 - Apr 30 annual spawning closure); 2026 season: May 1 - Dec 31, 2026 open, next closure begins Jan 1, 2027', '2026-11-27', 'open'],
  ['winter closure, read in January', 'Closed Nov 1 – Feb 28', '2027-01-15', 'closed'],
  ['winter closure, read in summer', 'Closed Nov 1 – Feb 28', '2027-07-15', 'open'],
  ['FL Gulf gag, regional aside ignored', 'September 1 - September 30, 2026 (closes 12:01 a.m. Oct. 1); regional exception applies for Franklin, Wakulla, Jefferson, and Taylor counties (Apr 1-Jun 30 and Sep 1-Dec 31)', '2026-11-27', 'closed'],
  ['a limit is not a date', 'Year-round; Jan 1 - 2 fish per person', '2026-11-27', 'open'],
];

let failed = 0;
for (const [label, text, date, want] of CASES) {
  const got = seasonState(text, D(date));
  // 'upcoming' is a closed season with a near opener - still not keepable.
  const status = got.status === 'upcoming' ? 'closed' : got.status;
  const ok = status === want;
  if (!ok) failed++;
  console.log(`${ok ? '✔' : '✘'} ${label} @ ${date}: ${got.status}${ok ? '' : `  (wanted ${want})  — ${got.reason}`}`);
}
if (failed) { console.error(`\n${failed} season check(s) failed`); process.exit(1); }
console.log('\nseason-state checks passed');
