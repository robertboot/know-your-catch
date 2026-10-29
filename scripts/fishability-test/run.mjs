/* The grade has to match the water, not the grid cell.
 *
 * Oct 22 2026: Orange Beach graded A+ on a morning an angler called a
 * C-. The data the grade was built from said 5 kt and 1 ft, so the
 * scoring was faithful — the gap is that a wave model reports a smoothed
 * ~8 km significant height and is slow to carry the chop a fresh breeze
 * stands up. subScores now adds the sea the WIND implies (JONSWAP,
 * fetch-limited) when the model has not already counted it.
 *
 * These cases pin both edges: a windy day must come down, and a calm or
 * long-swell day must not be dragged down with it.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(mkdtempSync(path.join(tmpdir(), 'fish-')), 'fx.mjs');
execFileSync('npx', ['esbuild', 'src/forecast-extras.js', '--bundle', '--format=esm',
  `--outfile=${out}`, '--loader:.json=json',
  '--define:import.meta.env={"VITE_SUPABASE_URL":"","VITE_SUPABASE_ANON_KEY":"","BASE_URL":"/"}'],
  { cwd: root, stdio: 'pipe' });
const { fishabilityHour, fishabilityGrade, windSeaFromWind } = await import(out);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};
const score = (h) => fishabilityHour(h);
const g = (h) => fishabilityGrade(score(h));

// The morning that started this. The numbers were real; the grade was
// right FOR THEM, and must stay right — this change must not turn flat
// calm into a mediocre day.
const calmMorning = { wind: 5.1, gust: 6.8, waveFt: 1.0, periodS: 5.1, code: 0 };
check('flat calm still grades A or better', score(calmMorning) >= 90,
      `${score(calmMorning)} ${g(calmMorning)}`);

// A long swell is a nice day, not a bad one — the first cut of this
// change dropped it to F.
const swellDay = { wind: 8, gust: 10, waveFt: 2.0, periodS: 9, code: 0 };
check('8 kt on a 2 ft nine-second swell stays B or better', score(swellDay) >= 80,
      `${score(swellDay)} ${g(swellDay)}`);

// The case the model used to miss: a fresh breeze the wave grid has not
// caught up with. 15 kt builds ~2.5 ft at 4 s over a 20 nm fetch.
const freshBreeze = { wind: 15, gust: 20, waveFt: 1.2, periodS: 5, code: 0 };
check('15 kt over a 1 ft modelled sea no longer grades above C',
      score(freshBreeze) <= 76, `${score(freshBreeze)} ${g(freshBreeze)}`);

const blowing = { wind: 20, gust: 26, waveFt: 2.0, periodS: 5, code: 0 };
check('20 kt grades F', score(blowing) < 60, `${score(blowing)} ${g(blowing)}`);

// More wind can never read as a better day.
let monotonic = true, prev = 101;
for (let w = 4; w <= 26; w += 2) {
  const s = score({ wind: w, gust: w * 1.3, waveFt: 1.0, periodS: 5, code: 0 });
  if (s > prev) monotonic = false;
  prev = s;
}
check('more wind never improves the grade', monotonic);

// The growth law itself, against figures a captain would recognise.
const w15 = windSeaFromWind(15, 20), w25 = windSeaFromWind(25, 20);
check('15 kt over 20 nm builds 2-3 ft at 3.5-4.5 s',
      w15.ft > 2 && w15.ft < 3 && w15.s > 3.5 && w15.s < 4.5,
      `${w15.ft.toFixed(1)} ft @ ${w15.s.toFixed(1)} s`);
check('25 kt over 20 nm builds 3.5-5 ft',
      w25.ft > 3.5 && w25.ft < 5, `${w25.ft.toFixed(1)} ft @ ${w25.s.toFixed(1)} s`);

// A measured split must not be counted twice: the API's total already
// contains its own wind wave.
const measured = { wind: 15, gust: 19, waveFt: 2.2, periodS: 4.5,
                   windWaveFt: 2.0, windWavePeriodS: 4, code: 0 };
const estimated = { wind: 15, gust: 19, waveFt: 2.2, periodS: 4.5, code: 0 };
check('a measured wind wave is not added on top of the total',
      Math.abs(score(measured) - score(estimated)) <= 12,
      `measured ${score(measured)} vs estimated ${score(estimated)}`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
