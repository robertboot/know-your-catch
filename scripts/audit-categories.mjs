// audit-categories.mjs — flag species whose category looks wrong for their
// common name. Heuristic only (surface-for-review, not auto-fix): some flags
// are intentional (bait species live in 'baitfish'; pompano/permit filed by
// habitat as 'inshore'). Run: node scripts/audit-categories.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/data.js', import.meta.url), 'utf8');
const re = /\{\s*id:\s*'([a-z0-9_]+)',\s*commonName:\s*'([^']+)'[\s\S]*?category:\s*'([a-z_]+)'/g;
const rows = [];
let m;
while ((m = re.exec(src))) rows.push({ id: m[1], name: m[2], cat: m[3] });

// Ordered so the most specific noun wins (snapper before tuna, so
// "Blackfin Snapper" isn't mis-flagged as tuna).
const rules = [
  [/snapper/i, 'snappers'],
  [/grouper|graysby|\bhind\b|scamp|\bgag\b|coney/i, 'groupers'],
  [/tilefish/i, 'tilefish'],
  [/marlin|sailfish|spearfish|swordfish/i, 'billfish'],
  [/mackerel|wahoo|barracuda|\bcero\b|kingfish/i, 'mackerels_barracuda'],
  [/\btuna\b|\bbonito\b|blackfin tuna|albacore|skipjack|little tunny/i, 'tuna'],
];
const SHARKY = /shark|\bray\b|skate|dogfish|hammerhead|blacktip|bonnethead|sawfish|guitarfish|stingray|torpedo|cownose|eagle ray|butterfly ray|manta|devil ray|electric/i;

const flags = [];
for (const r of rows) {
  for (const [kw, exp] of rules) {
    if (kw.test(r.name) && r.cat !== exp) { flags.push(`${r.name} (${r.id}): '${r.cat}' → likely '${exp}'`); break; }
  }
  if (r.cat === 'sharks_rays' && !SHARKY.test(r.name)) flags.push(`${r.name} (${r.id}): in 'sharks_rays' but not shark/ray-like — VERIFY`);
}
console.log(`Species: ${rows.length}   Flags: ${flags.length}`);
flags.forEach((f) => console.log('  •', f));
