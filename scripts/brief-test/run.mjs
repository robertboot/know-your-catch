/* The daily brief must not call a dead pipeline healthy.
 *
 * 2026-10-07: find-hotspots failed on every region, every ten minutes,
 * for thirteen hours. The board read "nothing needs attention". It had no
 * check that asked whether the data ARRIVED — only whether jobs errored,
 * and find-hotspots answers HTTP 200 with its failures in the body.
 *
 *   node scripts/brief-test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '.brief.generated.mjs');
await esbuild.build({
  entryPoints: [path.join(root, 'src/admin/HomeDashboard.jsx')],
  bundle: true, format: 'esm', platform: 'neutral', outfile: out,
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  // Anything that needs a browser or a native shell is stubbed away —
  // buildBrief is pure, and dragging the whole app in to reach it only
  // adds ways for the test to fail for reasons that are not the test.
  external: ['react', 'react-dom', 'leaflet', '@supabase/supabase-js',
             'lucide-react', '@capacitor/core', '@capacitor/filesystem'],
  define: {
    __KYC_WEB__: 'false', __KYC_ADMIN__: 'true',
    // Vite normally supplies these; outside it they are undefined and
    // the module throws on load before any test can run.
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    'import.meta.env.MODE': '"test"',
    'import.meta.env.DEV': 'false',
  },
  logLevel: 'silent',
});
const { buildBrief } = await import(out);

const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};
const texts = (items) => items.map(i => i.text).join(' | ');

// Exactly the state the live system was in while the board said all clear.
const REGIONS = ['al_gulf', 'fl_west', 'gulf_deep'].map(id => ({
  id, last_run_at: ago(0.1),
  last_error: 'ERROR · 14:01Z · no grids · Error: every erddap host failed — '
    + 'coastwatch.pfeg=timeout@20s upwell.pfeg=timeout@20s erddap.marine=timeout@20s',
}));

const down = buildBrief({ health: { ocean: {
  regions: REGIONS, failing: REGIONS, neverRun: [],
  zoneObservedAt: ago(9), imageCapturedAt: ago(1),
} } });
check('a dead satellite pipeline is reported at all', down.length > 0, `${down.length} items`);
check('it is reported as BROKEN, not a nudge',
  down.some(i => i.sev === 'critical'), down[0]?.sev);
check('it names suggested spots', /Suggested spots/i.test(texts(down)));
check('it says NOAA is unreachable rather than blaming us',
  down.some(i => /NOAA is unreachable/i.test(i.detail || '')),
  down.find(i => /NOAA/.test(i.detail || ''))?.detail?.slice(0, 80));
check('stale species maps are called out', /\b9 days old\b/.test(texts(down)));

// A region failing for a reason that is NOT the upstream must read differently.
const ourFault = [{ id: 'al_gulf', last_run_at: ago(0.1),
  last_error: 'ERROR · 09:00Z · sst+ chl+ depth+ cur+ · TypeError: x is not a function' }];
const bug = buildBrief({ health: { ocean: {
  regions: ourFault, failing: ourFault, neverRun: [],
  zoneObservedAt: ago(0), imageCapturedAt: ago(0),
} } });
check('a real bug is not excused as a NOAA outage',
  !/NOAA is unreachable/i.test(bug.map(i => i.detail).join(' ')),
  bug[0]?.detail?.slice(0, 60));

/* A publish that half-finished. The app fails safe and falls back to the
   bundled model, so nothing breaks loudly — which is exactly why the
   board has to say it. Real case: 12.4 promoted, manifest advertising
   12.2, and fish_id_model.tflite serving 88 bytes of a 404 body. */
const badPublish = buildBrief({ health: {
  promotedVersion: '12.4', promotedLabels: 140,
  published: { manifest: { version_name: '12.2', labels: new Array(135).fill('x') },
               head: { ok: true, bytes: 88 } },
} });
check('a missing published model is reported', badPublish.length > 0, `${badPublish.length} items`);
check('and reported as BROKEN', badPublish.some(i => i.sev === 'critical'), badPublish[0]?.sev);

// Right model, wrong species list — the one that renames every fish.
const wrongLabels = buildBrief({ health: {
  promotedVersion: '12.4', promotedLabels: 140,
  published: { manifest: { version_name: '12.4', labels: new Array(135).fill('x') },
               head: { ok: true, bytes: 9_000_000 } },
} });
check('a mismatched species list is reported',
  wrongLabels.some(i => /species list does not match/i.test(i.text)),
  wrongLabels[0]?.text);

const goodPublish = buildBrief({ health: {
  promotedVersion: '12.4', promotedLabels: 140,
  published: { manifest: { version_name: '12.4', labels: new Array(140).fill('x') },
               head: { ok: true, bytes: 9_000_000 } },
} });
check('a clean publish says nothing', goodPublish.length === 0, texts(goodPublish));

// Healthy must still be quiet, or the board becomes noise and gets ignored.
const healthy = buildBrief({ health: { ocean: {
  regions: [{ id: 'al_gulf', last_run_at: ago(0.1), last_error: 'ok · 09:00Z · sst+ chl+ depth+ cur+ · cells=300 spots=8 zones=11' }],
  failing: [], neverRun: [], zoneObservedAt: ago(0), imageCapturedAt: ago(0),
} } });
check('a healthy pipeline stays silent', healthy.length === 0, texts(healthy));

fs.rmSync(out, { force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
