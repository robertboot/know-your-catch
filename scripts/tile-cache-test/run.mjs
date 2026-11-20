/* The saved-image cache must hand back the fresh image, not just store it.
 *
 * It used to show the saved copy and quietly file the new download away
 * for "next time", so the ocean map always showed whatever it fetched on
 * the PREVIOUS visit: open it after a fortnight and it drew a
 * fortnight-old Gulf on full signal, under a banner blaming the signal.
 *
 * Runs src/tile-cache.js in a real browser, against real IndexedDB:
 *   1. nothing saved        -> network image, cached:false
 *   2. old copy saved       -> old copy at once, AND `fresh` resolves to
 *                              the new image, and the store is updated
 *   3. old copy, no network -> old copy, `fresh` resolves null (this, and
 *                              only this, is when the "saved" banner is true)
 */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const out = await build({
  entryPoints: [path.join(root, 'src/tile-cache.js')],
  bundle: true, format: 'iife', globalName: 'TC', write: false,
});
const js = out.outputFiles[0].text;

const browser = await chromium.launch();
const page = await browser.newPage();
const URL_ = 'https://img.test/chl-latest.png';
let online = true;
const NEW = Buffer.from('NEW-IMAGE-BYTES-0123456789');
await page.route('https://img.test/**', (r) => {
  if (r.request().url().endsWith('/')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
  return online
    ? r.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: NEW })
    : r.abort();
});
await page.goto('https://img.test/');
await page.addScriptTag({ content: js });

const text = (u) => page.evaluate(async (u) => (u ? await (await fetch(u)).text() : null), u);
const seedOld = () => page.evaluate(async (url) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('kyc-tiles', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  await new Promise((res) => { const t = db.transaction('img', 'readwrite'); t.objectStore('img').put({ url, blob: new Blob(['OLD']), at: Date.now() - 13 * 86400000 }); t.oncomplete = res; });
}, URL_);

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

// 1. cold
let r = await page.evaluate(async (u) => { const x = await TC.imageUrl(u); return { url: x.url, cached: x.cached }; }, URL_);
check('nothing saved: comes from the network', r.cached === false && (await text(r.url)) === NEW.toString());

// 2. stale copy, network up
await seedOld();
r = await page.evaluate(async (u) => { const x = await TC.imageUrl(u); const fresh = await x.fresh; return { url: x.url, cached: x.cached, fresh }; }, URL_);
check('old copy saved: shown at once', r.cached === true && (await text(r.url)) === 'OLD');
check('old copy saved: the fresh image is handed back', (await text(r.fresh)) === NEW.toString());
await page.waitForTimeout(300);
const age = await page.evaluate((u) => TC.cacheAge(u), URL_);
check('old copy saved: the store now holds the fresh one', age != null && age < 60000, `age ${Math.round(age)} ms`);

// 3. stale copy, network down
await seedOld(); online = false;
r = await page.evaluate(async (u) => { const x = await TC.imageUrl(u); const fresh = await x.fresh; return { url: x.url, cached: x.cached, fresh }; }, URL_);
check('no network: old copy shown, fresh is null', r.cached === true && r.fresh === null && (await text(r.url)) === 'OLD');
const age2 = await page.evaluate((u) => TC.cacheAge(u), URL_);
check('no network: the age reported is the old copy’s', age2 > 12 * 86400000, `${(age2 / 86400000).toFixed(1)} days`);

await browser.close();
if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\ntile-cache checks passed');
