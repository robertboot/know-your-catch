/* Publishing must not report success for something that did not land.
 *
 * 2026-10-08: 12.4 was promoted and published, the admin said it worked,
 * and the public bucket served 88 bytes of {"error":"not_found"} as
 * fish_id_model.tflite while the manifest sat there advertising 12.2. The
 * publish checked that two API calls did not error and called it done.
 *
 *   node scripts/publish-test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const src = fs.readFileSync(path.join(root, 'src/model-store.js'), 'utf8');

const grab = (re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const body = [
  grab(/function looksLikeTflite[\s\S]*?\n}/),
  grab(/async function verifyPublishedModel[\s\S]*?\n}/),
  grab(/async function verifyPublishedManifest[\s\S]*?\n}/),
  "const PUBLIC_BUCKET='models-published';",
  "const PUBLIC_MODEL_KEY='fish_id_model.tflite';",
  "const PUBLIC_MANIFEST_KEY='current.json';",
  'export { looksLikeTflite, verifyPublishedModel, verifyPublishedManifest };',
].join('\n');
const js = esbuild.transformSync(body, { loader: 'js' }).code;
const M = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const tflite = (size) => {
  const b = new Uint8Array(size);
  b[4] = 84; b[5] = 70; b[6] = 76; b[7] = 51;   // 'TFL3'
  return b.buffer;
};
// The actual bytes the bucket was serving.
const NOT_FOUND = new TextEncoder()
  .encode('{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}').buffer;

const storage = (files) => ({
  from: () => ({
    download: async (key) => (files[key]
      ? { data: { arrayBuffer: async () => files[key],
                  text: async () => new TextDecoder().decode(files[key]) }, error: null }
      : { data: null, error: { message: 'Object not found' } }),
  }),
});
const json = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer;

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

check('a real model passes the shape check', M.looksLikeTflite(tflite(5_000_000)) === null);
const nf = M.looksLikeTflite(NOT_FOUND);
check('a 404 error body is not mistaken for a model', nf !== null, nf);
check('and the reason says how small it was', /88 bytes/.test(nf || ''), nf);
check('a file with the wrong tag is refused',
  M.looksLikeTflite(new Uint8Array(5_000_000).buffer) !== null);

const okModel = await M.verifyPublishedModel({ storage: storage({ 'fish_id_model.tflite': tflite(4096) }) }, 4096);
check('a model that reads back intact verifies', okModel === null, okModel);

const missing = await M.verifyPublishedModel({ storage: storage({}) }, 4096);
check('a model that is not there fails verification', missing !== null, missing);

const truncated = await M.verifyPublishedModel({ storage: storage({ 'fish_id_model.tflite': tflite(2048) }) }, 4096);
check('a partially uploaded model fails verification', truncated !== null, truncated);

const manOk = await M.verifyPublishedManifest(
  { storage: storage({ 'current.json': json({ version_name: '12.4', labels: new Array(140).fill('x') }) }) },
  '12.4', 140);
check('a matching manifest verifies', manOk === null, manOk);

// Exactly what the bucket was serving: the previous version's manifest.
const stale = await M.verifyPublishedManifest(
  { storage: storage({ 'current.json': json({ version_name: '12.2', labels: new Array(135).fill('x') }) }) },
  '12.4', 140);
check('a stale manifest is caught', stale !== null, stale);

const wrongCount = await M.verifyPublishedManifest(
  { storage: storage({ 'current.json': json({ version_name: '12.4', labels: new Array(135).fill('x') }) }) },
  '12.4', 140);
check('a manifest with the wrong label count is caught', wrongCount !== null, wrongCount);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
