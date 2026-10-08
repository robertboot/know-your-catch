/* find-hotspots against synthetic satellite grids.
 *
 * ERDDAP went down the night this was written, which made an obvious gap
 * plain: there was no way to tell "the satellites are unreachable" from
 * "the scoring publishes nothing whatever you feed it". This feeds the real
 * edge function fabricated grids — a temperature front of known steepness
 * standing on a shelf edge, and a flat featureless sea — and asserts what
 * comes out. No network.
 *
 * It caught the one-spot-per-front bug: a hundred-mile wall produced a
 * single pin, because every connected group yielded exactly one spot and
 * MAX_SPOTS could never bind.
 *
 *   node scripts/hotspots-test/run.mjs
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const stub = path.join(here, 'supabase-stub.mjs');
const bundle = path.join(here, '.fn.generated.mjs');

await esbuild.build({
  entryPoints: [path.join(root, 'supabase/functions/find-hotspots/index.ts')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: bundle,
  plugins: [{
    name: 'edge-shims',
    setup(b) {
      b.onResolve({ filter: /^jsr:@supabase\/supabase-js/ }, () => ({ path: stub, external: true }));
      b.onResolve({ filter: /^jsr:@supabase\/functions-js/ }, () => ({ path: 'empty', namespace: 'e' }));
      b.onLoad({ filter: /.*/, namespace: 'e' }, () => ({ contents: '', loader: 'js' }));
    },
  }],
});

const SOUTH = 28.2, NORTH = 30.3, WEST = -88.8, EAST = -86.6;
// ERDDAP .json is a column table — [time, lat, lon, ...values] — not a grid.
function erddap(step, cols, fn, time = '2026-10-06T09:00:00Z') {
  const lats = [], lons = [], rows = [];
  for (let la = SOUTH; la <= NORTH + 1e-9; la += step) lats.push(Number(la.toFixed(4)));
  for (let lo = WEST; lo <= EAST + 1e-9; lo += step) lons.push(Number(lo.toFixed(4)));
  for (const la of lats) for (const lo of lons) rows.push([time, la, lo, ...fn(la, lo)]);
  return { table: { columnNames: ['time', 'latitude', 'longitude', ...cols], rows } };
}
// Distance across the front; positive is the warm, blue, deep side.
const across = (la, lo) => (la - 29.2) + (lo + 87.7);
// K is the sigmoid rate: higher K crosses the same 2 °C in fewer miles.
const front = (K) => ({
  sst: (la, lo) => [24 + 2 / (1 + Math.exp(-across(la, lo) * K))],
  chl: (la, lo) => [0.9 - 0.75 / (1 + Math.exp(-across(la, lo) * K))],
  dep: (la, lo) => [-(60 + 1500 / (1 + Math.exp(-across(la, lo) * K * 0.6)))],
  cur: (la, lo) => { const s = 0.55 * Math.exp(-((across(la, lo) * K * 0.5) ** 2)); return [s, s * 0.4]; },
});
const flat = {
  sst: () => [25.0], chl: () => [0.3],
  dep: (la) => [-(100 + (la - SOUTH) * 30)], cur: () => [0.02, 0.01],
};

// The bundle and this file must share ONE stub instance — it is how the
// writes are observed — so both are imported exactly once, with Deno in
// place first, and the recorded state is reset between runs.
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', CRON_SECRET: 's', SUPABASE_ANON_KEY: 'a' })[k] },
  serve: (h) => { globalThis.__handler = h; },
};
const sb = await import(stub);
await import(bundle);

async function run(sc, { drop = [], body = {}, regions = 1 } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    const pick = (name, doc) => (drop.includes(name)
      ? { ok: false, status: 503, text: async () => 'shed', json: async () => ({}) }
      : { ok: true, status: 200, text: async () => '', json: async () => doc });
    if (u.includes('jplMURSST41')) return pick('sst', erddap(0.02, ['analysed_sst'], sc.sst));
    if (u.includes('chla8day')) return pick('chl', erddap(0.04, ['chlorophyll'], sc.chl));
    if (u.includes('etopo180')) return pick('depth', erddap(0.0666, ['altitude'], sc.dep));
    if (u.includes('nesdisSSH1day')) return pick('cur', erddap(0.25, ['ugos', 'vgos'], sc.cur));
    if (u.includes('open-meteo')) return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
    throw new Error('unexpected url ' + u);
  };
  sb.writes.hotspots = []; sb.writes.hotspot_zones = []; sb.writes.updates = [];
  sb.seed.hotspot_regions = Array.from({ length: regions }, (_, i) => ({
    id: `r${i}`, label: `Region ${i}`, south: SOUTH, north: NORTH, west: WEST, east: EAST,
    port_name: 'Perdido Pass', port_lat: 30.27, port_lon: -87.55, active: true, last_run_at: null,
  }));
  const res = await globalThis.__handler(new Request('http://x/find-hotspots', {
    method: 'POST',
    headers: { 'x-cron-secret': 's', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const reply = await res.json();
  return {
    spots: sb.writes.hotspots, zones: sb.writes.hotspot_zones,
    note: sb.writes.updates[0]?.patch?.last_error || '',
    ran: sb.writes.updates.length, reply,
  };
}

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

const sharp = await run(front(120));
check('a sharp front publishes several spots along it', sharp.spots.length >= 4,
  `${sharp.spots.length} spots`);
check('spots stand at least 4 nm apart', (() => {
  for (let i = 0; i < sharp.spots.length; i++) {
    for (let j = i + 1; j < sharp.spots.length; j++) {
      const a = sharp.spots[i], b = sharp.spots[j];
      const d = Math.hypot((a.lat - b.lat) * 60, (a.lon - b.lon) * 60 * Math.cos(a.lat * Math.PI / 180));
      if (d < 4) return false;
    }
  }
  return true;
})());
check('every spot explains itself', sharp.spots.every(s => /temperature break/.test(s.why) && /nm .* of Perdido Pass/.test(s.why)),
  sharp.spots[0]?.why?.slice(0, 80));
// The synthetic front spans exactly 2 degC = 3.6 degF. A card may not claim
// more temperature than the water holds.
check('the stated drop never exceeds the real one',
  sharp.spots.every(s => s.sst_drop_f <= 3.6 + 0.01),
  `largest claimed ${Math.max(...sharp.spots.map(s => s.sst_drop_f)).toFixed(2)} degF of 3.60`);
check('species zones publish', sharp.zones.length >= 5, `${sharp.zones.length} rows`);
check('a current row is published', sharp.zones.some(z => z.mode_key === '_currents'));

const calm = await run(flat);
check('dead-flat water publishes no spots', calm.spots.length === 0, calm.note);

/* A sea with a FEW scattered hot cells is the common case, and the one
   the "never show an empty map" promise exists for. MIN_CELLS used to
   throw those away before the marginal pool was built, so the fallback
   had nothing to fall back to and the map read as broken. Real case:
   2026-10-07, gulf_deep found 7 cells, gulf_sw found 1, and both
   published nothing. */
const faint = await run(front(26));
check('a faint break still offers the best of it',
  faint.spots.length > 0, `${faint.spots.length} spots — ${faint.note}`);
check('and it says so rather than overselling',
  faint.spots.every(s => /best of it/i.test(s.why)),
  faint.spots[0]?.why?.slice(0, 90));

const noCorroboration = await run(front(120), { drop: ['chl', 'depth', 'cur'] });
check('losing every corroborating grid is reported, not silent',
  /ERROR/.test(noCorroboration.note) && /corroborating/.test(noCorroboration.note),
  noCorroboration.note.slice(0, 90));

const sstDown = await run(front(120), { drop: ['sst'] });
check('losing temperature fails the region', /ERROR/.test(sstDown.note), sstDown.note.slice(0, 70));
// Every host silent is the one failure a retry cannot explain, so the
// function has to say whether it can reach anything at all.
check('total host failure triggers the outbound probe',
  /probe: open-meteo=/.test(sstDown.note),
  sstDown.note.replace(/^.*probe/, 'probe').slice(0, 120));

const partial = await run(front(120), { drop: ['chl'] });
check('it still publishes with colour missing', partial.spots.length > 0, partial.note);

// One region per scheduled call is the whole reason this file exists: the
// old all-in-one run was killed by the scheduler before its first write.
const scheduled = await run(front(120), { regions: 5 });
check('a scheduled call takes exactly one region', scheduled.ran === 1,
  `${scheduled.ran} of 5, ${scheduled.reply.remaining} reported remaining`);
check('it reports what is left', scheduled.reply.remaining === 4);

const byHand = await run(front(120), { regions: 5, body: { all: true } });
check('the Regenerate button keeps going', byHand.ran === 5,
  `${byHand.ran} of 5, ${byHand.reply.remaining} remaining`);
check('nothing left to report after a full pass', byHand.reply.remaining === 0);

/* Request size, against the REAL region boxes.
   gulf_deep asked for 87,500 points in one JSON document and timed out on
   every host — which reads as "the provider is down" when it is really "we
   asked for too much". The cap is the fix; this is the guard on it. */
const REAL_REGIONS = [
  ['al_gulf', 28.2, 30.3, -88.8, -86.6], ['fl_panhandle', 28.5, 30.5, -87.5, -84.5],
  ['fl_west', 24.8, 28.5, -84.5, -81.6], ['la_gulf', 27, 29.8, -92, -88.8],
  ['tx_lower', 22, 27.5, -98.5, -95.5], ['gulf_sw', 22, 27.5, -95.5, -92],
  ['gulf_deep', 22, 27, -92, -85], ['gulf_ne', 27, 28.5, -88.8, -84.5],
  ['fl_keys', 22, 25.5, -85, -79.9], ['se_bahamas', 22, 25.5, -79.9, -77.5],
  ['fl_atlantic', 25.5, 31.5, -81.6, -77.5], ['tx_upper', 27.5, 29.8, -98.5, -92],
];
const fnSrc = await import('node:fs').then(m => m.readFileSync(
  path.join(root, 'supabase/functions/find-hotspots/index.ts'), 'utf8'));
const MAX_SIDE = Number(fnSrc.match(/const MAX_GRID_SIDE = (\d+)/)[1]);
const strideFor = (base, deg, s, n, w, e) => Math.max(base,
  Math.ceil((n - s) / deg / MAX_SIDE), Math.ceil((e - w) / deg / MAX_SIDE));
let biggest = 0, biggestId = '';
for (const [id, s0, n, w, e] of REAL_REGIONS) {
  const st = strideFor(2, 0.01, s0, n, w, e);
  const pts = Math.round((n - s0) / (0.01 * st)) * Math.round((e - w) / (0.01 * st));
  if (pts > biggest) { biggest = pts; biggestId = id; }
}
check('no region asks for an oversized grid', biggest <= MAX_SIDE * MAX_SIDE,
  `worst is ${biggestId} at ${biggest} points, cap ${MAX_SIDE * MAX_SIDE}`);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
