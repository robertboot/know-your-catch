/* Parity check: the Python port of stableTrainingId() in
   build_observation_map.py must produce byte-identical ids to the JS in
   src/training-store.js. If these diverge, the observation map silently
   maps to nothing and the split degrades to random-by-image without any
   error being raised.

   Run: node training/tests/test_stable_id_parity.mjs */
import { webcrypto } from 'node:crypto';

async function stableTrainingIdJS(key) {
  const buf = await webcrypto.subtle.digest('SHA-1', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CASES = [
  'red_snapper|red_snapper_12345.jpg',
  'atlantic_bonito|atlantic_bonito_999.jpg',
  'gag_grouper|gag grouper with spaces.JPG',
  'squid|squid_1.png',
  'ünïcödé_species|ünïcödé_1.jpg',
];
const out = {};
for (const c of CASES) out[c] = await stableTrainingIdJS(c);
console.log(JSON.stringify(out, null, 1));
