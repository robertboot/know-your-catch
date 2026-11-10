#!/usr/bin/env node
/* Parity checks for knowledge that exists in more than one place.

   Three production bugs in one week came from exactly this shape — a
   list defined twice, the copies drifting, and nothing failing:

     - `fl_atlantic` and `fed_satlantic` were added to src/data.js but
       not to the edge function's JURISDICTIONS, so the regulations
       auto-updater never generated a single pair for either. Two whole
       regions silently had no data.
     - the admin-only misc bucket leaked into user-facing lists because
       the "is this visible to anglers" rule was inlined at 13 call
       sites and two of them were wrong.
     - logbook thumbnails broke because five render sites resolved
       photos independently and one was missed.

   A comment saying "must match src/data.js" is not a check. This is.

   Run: npm run check   (also runs as part of ios:ship) */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const failures = [];
const fail = (msg) => failures.push(msg);

/* --- 1. Jurisdictions: app vs regulations edge functions ------------ */
{
  // data.js declares JURISDICTIONS before CATEGORIES; take ids only from
  // that block so category ids don't pollute the comparison.
  const dataSrc = read('src/data.js');
  const jStart = dataSrc.indexOf('export const JURISDICTIONS');
  const jEnd = dataSrc.indexOf('export const', jStart + 10);
  const appIds = [...dataSrc.slice(jStart, jEnd).matchAll(/id:\s*'([a-z_]+)'/g)].map(m => m[1]);

  const sharedSrc = read('supabase/functions/_shared/regs-shared.ts');
  const fnIds = [...sharedSrc.matchAll(/id:\s*'([a-z_]+)'/g)].map(m => m[1]);

  if (!appIds.length) fail('could not parse JURISDICTIONS from src/data.js');
  const missingInFn  = appIds.filter(id => !fnIds.includes(id));
  const missingInApp = fnIds.filter(id => !appIds.includes(id));

  if (missingInFn.length) {
    fail(`jurisdictions in src/data.js but NOT in the regulations edge function: ${missingInFn.join(', ')}\n` +
         `      → the auto-updater will never research these regions at all.\n` +
         `      → add them to supabase/functions/_shared/regs-shared.ts`);
  }
  if (missingInApp.length) {
    fail(`jurisdictions in the edge function but NOT in src/data.js: ${missingInApp.join(', ')}\n` +
         `      → it will research regions no angler can select.`);
  }
}

/* --- 2. Angler-visibility rule must not be re-inlined --------------- */
{
  // isAnglerVisible() in helpers.js is the single gate for "should an
  // angler ever see this species". Re-inlining `active !== false` in a
  // user-facing screen is how the misc bucket leaked last time.
  const files = ['src/screens1.jsx', 'src/screens2.jsx', 'src/components.jsx'];
  for (const f of files) {
    const hits = read(f).split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\.active\s*!==\s*false/.test(line));
    for (const { n } of hits) {
      fail(`${f}:${n} inlines \`active !== false\` — use isAnglerVisible() from helpers.js.\n` +
           `      → that rule also has to exclude '_'-prefixed ids and categories.`);
    }
  }
}

/* --- 3. Photos must resolve through PhotoImg ------------------------ */
{
  // photoThumbUrl() is synchronous and cannot mint a signed URL for the
  // private photos bucket, so a raw <img src={photoThumbUrl(...)}>
  // silently breaks for cloud-synced catches with no local file.
  for (const f of ['src/screens1.jsx', 'src/screens2.jsx']) {
    const src = read(f);
    src.split('\n').forEach((line, i) => {
      if (/<img[^>]*src=\{\s*(photoThumbUrl|photoDisplayUrl)\(/.test(line)) {
        fail(`${f}:${i + 1} renders a raw <img> from photoThumbUrl/photoDisplayUrl.\n` +
             `      → use <PhotoImg photo={...} /> so it can fall back to a signed cloud URL.`);
      }
    });
  }
}

if (failures.length) {
  console.error(`\n✘ parity check failed (${failures.length})\n`);
  for (const f of failures) console.error(`  • ${f}\n`);
  process.exit(1);
}
console.log('✔ parity checks passed');
