/* "Where to go" has to mean where YOU can go.
 *
 * The Home card shipped taking the highest-scoring break in a table that
 * covers the whole Gulf and the Florida Atlantic, and printing the run
 * from whichever harbour that spot's REGION is keyed to. An angler
 * starred to Orange Beach was sent 385 nm east, "72 nm NNE of Port
 * Canaveral". Every number was correct. None was about the reader, and
 * nothing in the app could tell.
 *
 * These are real coordinates, so a regression reads as a place.
 *
 *   node scripts/where-to-go-test/run.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.picker.generated.mjs');
await esbuild.build({
  entryPoints: [path.resolve(here, '../../src/home-water.js')],
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error',
});
const { pickReachableSpot, runFrom, homeWater, MAX_RUN_NM, reachableSpots, groupByBreak, spotStanding } = await import(out);

const ORANGE_BEACH = { lat: 30.27, lon: -87.55 };
const SPOTS = [
  // Off Cape Canaveral — the one that was being shown. Highest score.
  { id: 'canaveral', score: 92, lat: 29.0, lon: -80.0 },
  // Off Louisiana — reachable, same water.
  { id: 'la_gulf',   score: 71, lat: 29.0, lon: -89.0 },
  // Just south of Perdido Pass.
  { id: 'al_gulf',   score: 64, lat: 29.6, lon: -87.7 },
];

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

const pick = pickReachableSpot(SPOTS, ORANGE_BEACH);
check('it does not send Orange Beach to Cape Canaveral',
  pick?.id !== 'canaveral',
  pick ? `${pick.id} at ${Math.round(pick._run.dist)} nm` : 'nothing');
check('it picks the best spot within reach', pick?.id === 'la_gulf', pick?.id);
check('the run is measured from the angler, not a region port',
  pick && Math.abs(pick._run.dist - 112) < 25,
  pick ? `${Math.round(pick._run.dist)} nm` : '—');
check('the far spot really is out of range',
  runFrom(ORANGE_BEACH.lat, ORANGE_BEACH.lon, 29.0, -80.0).dist > MAX_RUN_NM,
  `${Math.round(runFrom(ORANGE_BEACH.lat, ORANGE_BEACH.lon, 29.0, -80.0).dist)} nm to Canaveral`);

// Nothing within reach must render nothing, never the nearest far thing.
check('nothing reachable returns nothing',
  pickReachableSpot([SPOTS[0]], ORANGE_BEACH) === null);

// An angler on the Atlantic side should get the Atlantic spot.
check('a Canaveral angler gets the Canaveral spot',
  pickReachableSpot(SPOTS, { lat: 28.4, lon: -80.6 })?.id === 'canaveral');

check('a home water with no coordinates returns nothing',
  pickReachableSpot(SPOTS, null) === null);
check('rows missing coordinates are skipped, not crashed on',
  pickReachableSpot([{ score: 99 }, ...SPOTS], ORANGE_BEACH)?.id === 'la_gulf');

// The starred spot is the angler's declared home water and must win.
check('the starred spot decides the home water',
  homeWater({ fishingSpots: [{ starred: true, lat: 30.27, lon: -87.55, name: 'Orange Beach' }],
              catchLog: [{ lat: 25, lon: -80 }] }).label === 'Orange Beach');

/* One break, listed three times.
   These are the real rows Orange Beach was shown: the same 16 nm
   Louisiana break at 124, 129 and 133 nm, which the list rendered as
   three places to choose between. Peaks from one group carry that
   group's own span and bearing, which is what identifies them. */
const ONE_BREAK = [
  { id: 'a', region_id: 'la_gulf', score: 20, lat: 28.77, lon: -89.18, length_nm: 16.2, bearing_deg: 71.4 },
  { id: 'b', region_id: 'la_gulf', score: 8,  lat: 28.71, lon: -89.36, length_nm: 16.2, bearing_deg: 71.4 },
  { id: 'c', region_id: 'la_gulf', score: 7,  lat: 28.74, lon: -89.27, length_nm: 16.2, bearing_deg: 71.4 },
  // A genuinely different break in the same region.
  { id: 'd', region_id: 'la_gulf', score: 55, lat: 29.10, lon: -88.60, length_nm: 7.5, bearing_deg: 12.0 },
];
const grouped = groupByBreak(reachableSpots(ONE_BREAK, ORANGE_BEACH));
check('one break becomes one card', grouped.length === 2, `${grouped.length} cards from 4 spots`);
check('the strongest point represents its break',
  grouped.find(g => g.length_nm === 16.2)?.score === 20);
check('and it counts the points along it',
  grouped.find(g => g.length_nm === 16.2)?._points === 3);
check('a different break is kept separate',
  grouped.some(g => g.length_nm === 7.5));
check('the nearest run on the break is the one shown',
  Math.round(grouped.find(g => g.length_nm === 16.2)._run.dist) <= 125,
  `${Math.round(grouped.find(g => g.length_nm === 16.2)._run.dist)} nm`);

/* The score means something different from the sea-state grade. A 20 is a
   faint fishing sign; an F on the day strip is a sea to stay out of. */
check('a marginal spot is not branded a failure',
  !/^F$/.test(spotStanding(20).label) && spotStanding(20).label === 'Faint · best today',
  spotStanding(20).label);
// "pass" means the satellite pass, and an angler out of Perdido Pass
// reads it as the inlet. It must not appear in a badge.
check('no badge says "pass"',
  ![20, 50, 78, null].some(v => /\bpass\b/i.test(spotStanding(v).label)),
  [20, 50, 78].map(v => spotStanding(v).label).join(' / '));
check('a real break reads as one', spotStanding(78).label === 'Strong break');
check('the middle band is distinct', spotStanding(50).label === 'Worth a look');
check('an unscored spot says so', spotStanding(null).label === 'Unscored');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
