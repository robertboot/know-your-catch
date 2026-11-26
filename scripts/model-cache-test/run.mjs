/* The cached model and its species list must belong together.
 *
 * DeepBlue 12.4 was rolled back for calling a snapper a red porgy and a
 * gag grouper a shark, then identified the same photo correctly on a
 * re-run. That pattern — wrong, then right, with the admin console
 * correct throughout — is not a bad model. It is the app's two-file
 * cache torn between writes: new model bytes, old species list, every
 * output index read against the wrong names.
 *
 *   node scripts/model-cache-test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = fs.readFileSync(path.join(root, 'src/model-loader.js'), 'utf8');

// validModelPair is pure; lift it out rather than booting the whole loader.
const fn = src.match(/function validModelPair\(bytes, manifest\)[\s\S]*?\n}/)[0];
const js = esbuild.transformSync(fn + '\nexport { validModelPair };', { loader: 'js' }).code;
const { validModelPair } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

// A minimally plausible .tflite: TFL3 magic at offset 4.
const model = (size) => {
  const b = new Uint8Array(size);
  b[4] = 84; b[5] = 70; b[6] = 76; b[7] = 51;   // 'TFL3'
  return b.buffer;
};
const manifest = (extra = {}) => ({
  version_name: '12.4', input_size: 224,
  labels: ['red_snapper', 'red_porgy', 'gag_grouper'],
  ...extra,
});

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

check('a matched pair loads',
  validModelPair(model(5000), manifest({ cached_model_bytes: 5000 })) === null);

// The actual incident: the model updated, the species list did not.
const torn = validModelPair(model(5000), manifest({ cached_model_bytes: 4200 }));
check('a torn pair is refused', torn !== null, torn);
check('and the reason names both sizes',
  /5000/.test(torn || '') && /4200/.test(torn || ''), torn);

// An upgrade must not throw away every existing cache.
check('a pre-stamp manifest still loads',
  validModelPair(model(5000), manifest()) === null,
  'older builds cached no size; they are trusted rather than discarded');

check('a truncated model is still refused',
  validModelPair(model(100), manifest({ cached_model_bytes: 100 })) !== null);
check('a non-flatbuffer is still refused',
  validModelPair(new Uint8Array(5000).buffer, manifest({ cached_model_bytes: 5000 })) !== null);
check('a manifest with no labels is still refused',
  validModelPair(model(5000), { version_name: 'x', input_size: 224, labels: [] }) !== null);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
