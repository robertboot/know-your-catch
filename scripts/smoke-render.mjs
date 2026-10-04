#!/usr/bin/env node
/* Mount each admin panel in Chromium; any uncaught error fails the build.
   See scripts/smoke/panels.jsx for why this exists. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = mkdtempSync(join(tmpdir(), 'kyc-smoke-'));
execFileSync('npx', ['esbuild', 'scripts/smoke/panels.jsx', '--bundle',
  '--loader:.js=jsx', '--define:import.meta.env={}',
  `--outfile=${join(out, 'bundle.js')}`, '--log-level=error'], { stdio: 'inherit' });
copyFileSync('scripts/smoke/page.html', join(out, 'page.html'));
copyFileSync('node_modules/leaflet/dist/leaflet.css', join(out, 'leaflet.css'));

const { chromium } = await import('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
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
  console.log(`✓ ${name} renders`);
}
await browser.close();
