// Zero-dependency validator for regulations feed files against the v1
// contract. Run: npm run validate-feeds  (used by CI before publish).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const feedDir = join(here, 'feed');

const JURISDICTIONS = ['fed_gulf', 'al_state', 'fl_state', 'ms_state', 'la_state', 'tx_state'];
const CONFIDENCE = ['verified', 'partial', 'closure_confirmed_reopen_pending', 'unconfirmed', 'not_managed'];
const LENGTH = ['TL', 'FL', 'CFL', 'LJFL', null];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

let errors = 0;
const fail = (f, msg) => { console.error(`✗ ${f}: ${msg}`); errors++; };

for (const file of readdirSync(feedDir).filter(f => f.endsWith('.json'))) {
  let feed;
  try { feed = JSON.parse(readFileSync(join(feedDir, file), 'utf8')); }
  catch (e) { fail(file, `invalid JSON — ${e.message}`); continue; }

  if (feed.schema !== 'kyc-regulations/v1') fail(file, 'schema must be "kyc-regulations/v1"');
  if (!JURISDICTIONS.includes(feed.jurisdiction)) fail(file, `bad jurisdiction "${feed.jurisdiction}"`);
  if (!Number.isInteger(feed.effectiveYear) || feed.effectiveYear < 2024) fail(file, 'bad effectiveYear');
  if (!DATE.test(feed.verifiedDate || '')) fail(file, 'verifiedDate must be YYYY-MM-DD');
  if (!feed.rules || typeof feed.rules !== 'object') { fail(file, 'missing rules'); continue; }

  for (const [sid, r] of Object.entries(feed.rules)) {
    const at = `${file} » ${sid}`;
    if (typeof r.open !== 'string' || !r.open.trim()) fail(at, 'open must be a non-empty string');
    if (typeof r.verified !== 'boolean') fail(at, 'verified must be boolean');
    if (!CONFIDENCE.includes(r.confidence)) fail(at, `confidence "${r.confidence}" invalid`);
    if (typeof r.source !== 'string' || !/^https?:\/\//.test(r.source)) fail(at, 'source must be a URL');
    if (!DATE.test(r.lastUpdated || '')) fail(at, 'lastUpdated must be YYYY-MM-DD');
    for (const k of ['minSize', 'maxSize', 'bagLimit', 'vesselLimit']) {
      if (r[k] != null && typeof r[k] !== 'number') fail(at, `${k} must be number or null`);
    }
    if (r.lengthType !== undefined && !LENGTH.includes(r.lengthType)) fail(at, `lengthType "${r.lengthType}" invalid`);
    if (r.verified === true && r.confidence === 'not_managed') fail(at, 'not_managed cannot be verified:true');
  }
  if (!errors) console.log(`✓ ${file} — ${Object.keys(feed.rules).length} rules`);
}

if (errors) { console.error(`\n${errors} error(s).`); process.exit(1); }
console.log('All feed files valid.');
