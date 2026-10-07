/* The ERDDAP host walk, on its own.
 *
 * find-hotspots reads four satellite grids from a list of hosts. Getting
 * that walk wrong is invisible until the day a provider goes down — which
 * is exactly the day it has to work. So it is pulled out of the module and
 * exercised against a stubbed fetch: who gets tried, in what order, how
 * often, and what stops the walk.
 *
 * It also asserts the worst case still fits inside the scheduler's ceiling.
 * Adding a host is cheap; adding one that pushes the wall clock past
 * pg_net's timeout kills the run mid-write. See [[scheduled-jobs]].
 *
 *   node scripts/hotspots-test/hosts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'supabase/functions/find-hotspots/index.ts'), 'utf8');
const grab = (re) => src.match(re)[0];
const body = [
  grab(/const ERDDAP_HOSTS[\s\S]*?\n\];/),
  grab(/const RETRY_STATUS = [\s\S]*?\n/),
  grab(/const sleep = [\s\S]*?\n/),
  'const FETCH_TIMEOUT_MS = 50;',
  grab(/async function fetchJson\(path: string[\s\S]*?\n}\n/),
  'export { fetchJson, ERDDAP_HOSTS };',
].join('\n');
const js = esbuild.transformSync(body, { loader: 'ts' }).code;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const { fetchJson, ERDDAP_HOSTS } = mod;

let calls = [];
const run = async (handler, label) => {
  calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return handler(url); };
  try { const v = await fetchJson('x.json?q'); return { label, ok: true, v, calls: [...calls] }; }
  catch (e) { return { label, ok: false, err: String(e).slice(0,90), calls: [...calls] }; }
};
const resp = (status, bodyText) => ({ ok: status === 200, status,
  text: async () => bodyText || '', json: async () => ({ hit: true }) });

const host = (u) => new URL(u).host;
const H = ERDDAP_HOSTS.map(h => new URL(Array.isArray(h) ? h[0] : h).host);
const results = [];

results.push(await run(() => resp(200), 'primary healthy'));
results.push(await run((u) => host(u) === H[0] ? resp(503,'shed') : resp(200), 'primary 503 -> failover'));
results.push(await run((u) => (host(u) === H[0] ? resp(503,'shed') : host(u) === H[1] ? resp(503,'shed') : resp(200)), 'noaa down -> third host'));
results.push(await run((u) => host(u) === H[2] ? resp(404,'not here') : resp(503,'shed'), 'third host lacks dataset'));
results.push(await run(() => resp(503,'shed'), 'both 503'));
results.push(await run(() => resp(400,'bad query'), 'bad query'));
results.push(await run((u) => host(u) === H[0] ? resp(404,'not here') : resp(200), 'primary lacks it -> next host'));
let n = 0;
results.push(await run((u) => { n++; return host(u) === H[0] && n === 1 ? resp(503) : resp(200); }, 'primary flaky, 2nd try ok'));
results.push(await run(() => { throw new Error('ECONNRESET'); }, 'network dead'));

for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label.padEnd(26)} tries=${r.calls.length} hosts=[${[...new Set(r.calls.map(host))].join(', ')}]${r.err ? '  ' + r.err : ''}`);
}

// Assertions
const a = (c, m) => { if (!c) { console.error('ASSERT FAILED: ' + m); process.exit(1); } };
const byLabel = Object.fromEntries(results.map(r => [r.label, r]));
const hostsOf = (r) => [...new Set(r.calls.map(host))];

a(byLabel['primary healthy'].ok && byLabel['primary healthy'].calls.length === 1,
  'a healthy primary is one call');
a(byLabel['primary 503 -> failover'].ok && hostsOf(byLabel['primary 503 -> failover']).length === 2,
  'a shedding primary falls through to host two');
a(byLabel['noaa down -> third host'].ok && hostsOf(byLabel['noaa down -> third host']).length === 3,
  'both NOAA hosts down reaches the third');
a(!byLabel['both 503'].ok, 'everything shedding still fails');
a(byLabel['bad query'].calls.length === 1,
  'a bad query stops at the first host — it is wrong everywhere');
a(byLabel['primary lacks it -> next host'].ok &&
  byLabel['primary lacks it -> next host'].calls.length === 2,
  'a 404 walks on — the next host may well carry it');
a(!byLabel['third host lacks dataset'].ok &&
  byLabel['third host lacks dataset'].calls.filter(u => host(u) === H[2]).length === 1,
  'a 404 from the last host is tried once, not retried');
a(byLabel['primary flaky, 2nd try ok'].ok &&
  hostsOf(byLabel['primary flaky, 2nd try ok']).length === 1,
  'a flaky primary recovers without leaving the host');
a(!byLabel['network dead'].ok && hostsOf(byLabel['network dead']).length === 3,
  'a dead network tries every host');
// Worst case must stay inside the scheduler's ceiling.
const worst = ERDDAP_HOSTS.reduce((t, h) => t + (Array.isArray(h) ? h[1] : 2), 0);
a(worst * 15 <= 90, `worst-case wall clock ${worst * 15}s must stay <= 90s`);
console.log(`\nworst case: ${worst} attempts x 15s = ${worst * 15}s per dataset`);
console.log('all assertions passed');
