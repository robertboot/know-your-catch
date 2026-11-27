/* The app's own species list and season logic, loaded into a Node script.
 *
 * Anything that states whether a season is open - the public regulation
 * pages, the snapshot they are built from - must use the SAME function
 * the app uses. A second reader of the same sentence is how the
 * newsletter once announced a season had "opened yesterday" on the day
 * it closed, and how the app showed five closed seasons as open while
 * the newsletter had them right. src/helpers.js is browser code with
 * asset imports, so it is bundled here rather than imported.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadAppLogic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kyc-logic-'));
  const entry = path.join(dir, 'entry.mjs');
  fs.writeFileSync(entry, [
    `export { SPECIES, JURISDICTIONS } from ${JSON.stringify(path.join(root, 'src/data.js'))};`,
    `export { seasonState, cleanSeason } from ${JSON.stringify(path.join(root, 'src/helpers.js'))};`,
  ].join('\n'));
  const outfile = path.join(dir, 'logic.mjs');
  await build({
    entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
    define: { 'import.meta.env': '{}', __KYC_WEB__: 'false', __KYC_ADMIN__: 'false' },
    banner: { js: 'globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };' },
  });
  return import(pathToFileURL(outfile).href);
}

export const ROOT = root;
