/* regulations/public/snapshot.json - the verified regulations, as the
 * public pages will print them, with today's open/closed answer worked
 * out by the app's own season logic.
 *
 * Why a file in the repo rather than a fetch at build time: a build that
 * reads the network can fail or differ from the last one for reasons
 * nobody can see afterwards. A committed file is reviewable, and it
 * makes "did anything change?" a plain git diff - which is exactly the
 * question the daily workflow asks. It commits only when this file
 * differs, and a commit is what makes the site rebuild. So a page's
 * "Open now" is never more than a day behind either a rule change OR a
 * date passing, and there is no daily churn when neither happened.
 *
 * The file deliberately carries no "generated at" stamp: that would
 * differ every day and defeat the diff.
 *
 * Reads with the site's publishable key - the same one every browser
 * that opens the site is handed - so it can only see what the public
 * can: rows with status 'verified'.
 *
 *   node scripts/reg-snapshot.mjs            write the file
 *   node scripts/reg-snapshot.mjs --check    exit 1 if it would change
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAppLogic, ROOT } from './lib/app-logic.mjs';

const URL_ = process.env.SUPABASE_URL || 'https://hfptpsmdfemduhkueyoz.supabase.co';
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const OUT = path.join(ROOT, 'regulations/public/snapshot.json');
if (!KEY) { console.error('SUPABASE_PUBLISHABLE_KEY is not set'); process.exit(2); }

const { SPECIES, JURISDICTIONS, seasonState } = await loadAppLogic();
const speciesIds = new Set(SPECIES.map((s) => s.id));
const jurIds = new Set(JURISDICTIONS.map((j) => j.id));

const res = await fetch(
  `${URL_}/rest/v1/regulations?select=species_id,jurisdiction_id,sector,season_text,min_size_in,max_size_in,bag_limit,boat_limit,notes,verified_at,source_url&status=eq.verified&limit=5000`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
if (!res.ok) { console.error(`regulations fetch failed: ${res.status} ${await res.text()}`); process.exit(2); }
const live = await res.json();
// A sudden near-empty answer is an outage or a policy change, not news.
// Publishing it would delete hundreds of pages from the site.
if (!Array.isArray(live) || live.length < 100) { console.error(`refusing to snapshot ${live?.length} rows`); process.exit(2); }

const today = new Date();
const rows = live
  .filter((r) => speciesIds.has(r.species_id) && jurIds.has(r.jurisdiction_id) && r.season_text)
  .map((r) => {
    const st = seasonState(r.season_text, today);
    return {
      s: r.species_id, j: r.jurisdiction_id, sector: r.sector || 'all',
      season: r.season_text,
      min: r.min_size_in, max: r.max_size_in, bag: r.bag_limit, boat: r.boat_limit,
      notes: r.notes || null,
      verified: r.verified_at ? String(r.verified_at).slice(0, 10) : null,
      source: r.source_url || null,
      status: st.status,
      opens: st.opensOn ? String(st.opensOn).slice(0, 10) : null,
    };
  })
  .sort((a, b) => a.j.localeCompare(b.j) || a.s.localeCompare(b.s) || a.sector.localeCompare(b.sector));

const next = JSON.stringify({ schema: 'reelintel-public-regs/v1', rows }, null, 1) + '\n';
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
if (process.argv.includes('--check')) {
  console.log(next === prev ? 'snapshot is current' : 'snapshot would change');
  process.exit(next === prev ? 0 : 1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, next);
const by = (k) => rows.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
console.log(`${rows.length} rows (${live.length} verified live) · ${next === prev ? 'unchanged' : 'CHANGED'}`);
console.log('status:', JSON.stringify(by('status')));
