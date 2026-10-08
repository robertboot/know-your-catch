#!/usr/bin/env node
/* Mount each admin panel in Chromium; any uncaught error fails the build.
   See scripts/smoke/panels.jsx for why this exists. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'kyc-smoke-'));
const esbuild = (await import('esbuild')).default;
await esbuild.build({
  entryPoints: ['scripts/smoke/panels.jsx'],
  bundle: true, outfile: join(out, 'bundle.js'), logLevel: 'error',
  loader: { '.js': 'jsx' }, define: { 'import.meta.env': '{}' },
  plugins: [{
    // The detail view fetches its own row, and its widest parts — the
    // per-species table and the confusion matrix — only exist once one is
    // loaded. Point the store at a fixture so the page under test is the
    // one people actually read, not its empty state. esbuild's --alias
    // takes package names, not relative paths, hence a plugin.
    name: 'model-store-fixture',
    setup(b) {
      b.onResolve({ filter: /(^|\/)model-store\.js$/ }, () => ({
        path: resolve('scripts/smoke/model-store-stub.js'),
      }));
    },
  }],
});
copyFileSync('scripts/smoke/page.html', join(out, 'page.html'));
copyFileSync('node_modules/leaflet/dist/leaflet.css', join(out, 'leaflet.css'));

const { chromium } = await import('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// A 1280-wide laptop window with a little chrome. Narrower than the
// monitor the admin is usually read on, which is the point: anything that
// overflows here overflows for someone.
// A 1280-wide laptop window with a little chrome. Narrower than the
// monitor the admin is usually read on, which is the point: anything that
// overflows here overflows for someone. SMOKE_WIDTH overrides it when
// chasing a width-specific report.
const VIEWPORT_W = Number(process.env.SMOKE_WIDTH) || 1180;
const page = await browser.newPage({ viewport: { width: VIEWPORT_W, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
await page.goto(`file://${join(out, 'page.html')}`);

const names = await page.evaluate(() => window.__panels);
for (const name of names) {
  await page.evaluate((n) => window.__mount(n), name);
  // Effects and the first paint, plus a beat for anything deferred.
  await page.waitForTimeout(600);
  const mine = errors.splice(0);
  if (mine.length) {
    console.error(`✗ ${name} threw on render:`);
    for (const e of mine) console.error(`    ${e}`);
    await browser.close();
    process.exit(1);
  }
  // Width, not just errors. A panel wider than the window pushes its own
  // controls out of reach, and a section you cannot scroll to is a section
  // that does not exist.
  const ovf = await page.evaluate(() => window.__overflow());
  if (ovf.offenders.length) {
    console.error(`✗ ${name} runs off the side at ${ovf.viewport}px `
      + `(document scrolls to ${ovf.docScrollWidth}px):`);
    for (const o of ovf.offenders) {
      console.error(`    <${o.tag}${o.cls ? ' class="' + o.cls + '"' : ''}> `
        + `width ${o.width} right edge ${o.right}  ${o.text ? '“' + o.text + '”' : ''}`);
    }
    await browser.close();
    process.exit(1);
  }
  console.log(`✓ ${name} renders, fits ${ovf.viewport}px`);
}

/* The models DETAIL view, which is the widest page in the admin and the
   one the empty-state mount above never reaches. */
const opened = await page.evaluate(() => window.__mountModelDetail());
if (!opened) {
  console.error('✗ ModelDetail: could not open a model from the list — '
    + 'the fixture or the list markup changed, so this page is going unchecked');
  await browser.close();
  process.exit(1);
}
{
  const mine = errors.splice(0);
  if (mine.length) {
    console.error('✗ ModelDetail threw on render:');
    for (const e of mine) console.error(`    ${e}`);
    await browser.close();
    process.exit(1);
  }
  const ovf = await page.evaluate(() => window.__overflow());
  if (ovf.offenders.length) {
    console.error(`✗ ModelDetail runs off the side at ${ovf.viewport}px `
      + `(document scrolls to ${ovf.docScrollWidth}px):`);
    for (const o of ovf.offenders) {
      console.error(`    <${o.tag}${o.cls ? ' class="' + o.cls + '"' : ''}> `
        + `width ${o.width} right edge ${o.right}  ${o.text ? '“' + o.text + '”' : ''}`);
    }
    console.error('  ancestors (innermost first):');
    for (const c of (ovf.chain || [])) {
      console.error(`    ${c.tooWide ? '>>' : '  '} <${c.tag}> w=${c.width} right=${c.right} `
        + `scrollW=${c.scrollWidth} display=${c.display} minW=${c.minWidth} `
        + `cols=${c.gridCols}  “${c.text}”`);
    }
    await browser.close();
    process.exit(1);
  }
  console.log(`✓ ModelDetail renders, fits ${ovf.viewport}px`);
}
await browser.close();
