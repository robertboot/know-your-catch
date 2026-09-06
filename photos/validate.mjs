// Zero-dependency validator for the photo manifest. Run:
// npm run validate-photos  (CI runs it before build).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let errors = 0;
const fail = (m) => { console.error(`✗ ${m}`); errors++; };

let m;
try { m = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8')); }
catch (e) { console.error('✗ manifest.json invalid JSON — ' + e.message); process.exit(1); }

if (m.schema !== 'kyc-photos/v1') fail('schema must be "kyc-photos/v1"');
if (!m.species || typeof m.species !== 'object') { fail('missing species'); }
else {
  for (const [id, e] of Object.entries(m.species)) {
    if (typeof e.name !== 'string' || !e.name) fail(`${id}: name required`);
    if (!['proprietary', 'fallback', 'none'].includes(e.primary)) fail(`${id}: bad primary "${e.primary}"`);
    if (e.primary === 'proprietary' && !e.proprietary) fail(`${id}: primary=proprietary but no proprietary path`);
    if (e.primary === 'fallback') {
      const f = e.fallback;
      if (!f || typeof f !== 'object') fail(`${id}: primary=fallback but no fallback object`);
      else {
        if (!/^https?:\/\//.test(f.url || '')) fail(`${id}: fallback.url must be a URL`);
        if (!f.credit) fail(`${id}: fallback.credit required (attribution)`);
        if (!f.license) fail(`${id}: fallback.license required`);
      }
    }
  }
}

if (errors) { console.error(`\n${errors} error(s).`); process.exit(1); }
console.log(`All photo entries valid — ${Object.keys(m.species || {}).length} species.`);
