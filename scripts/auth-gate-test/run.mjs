/* Who gets into the app, and into the website.
 *
 * The website requires an account; the app does not. Guest access exists
 * for App Store guideline 5.1.1(v) and a durable local credential exists
 * for a phone offshore with an expired token — neither is a reason to let
 * an anonymous browser into somebody's logbook.
 *
 * This is a privacy boundary, so it gets a test rather than a comment.
 *
 *   node scripts/auth-gate-test/run.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.auth.generated.mjs');
const src = path.resolve(here, '../../src/auth.js');

// auth.js pulls in the Supabase client; only the pure rule is wanted here.
const fs = await import('node:fs');
const body = fs.readFileSync(src, 'utf8').match(/export function isAdmitted[\s\S]*?\n}/)[0];
fs.writeFileSync(out, esbuild.transformSync(body, { loader: 'js' }).code);
const { isAdmitted } = await import(out);

let failed = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failed++;
};

const SESSION = { user: { email: 'a@b.com' } };

// --- the website ---------------------------------------------------
check('web: a signed-in angler is let in',
  isAdmitted({ isWeb: true, session: SESSION }) === true);
check('web: a stranger is NOT let in',
  isAdmitted({ isWeb: true }) === false);
check('web: guest access does not open the door',
  isAdmitted({ isWeb: true, guestAccess: true }) === false);
check('web: a leftover local credential does not open the door',
  isAdmitted({ isWeb: true, localCredential: true }) === false);
check('web: neither does both together',
  isAdmitted({ isWeb: true, localCredential: true, guestAccess: true }) === false);

// --- the app -------------------------------------------------------
check('app: a signed-in angler is let in',
  isAdmitted({ isWeb: false, session: SESSION }) === true);
check('app: guest access still works — App Store 5.1.1(v)',
  isAdmitted({ isWeb: false, guestAccess: true }) === true);
check('app: an expired token offshore still gets in on the local credential',
  isAdmitted({ isWeb: false, localCredential: true }) === true);
check('app: a fresh install with nothing is held at the splash',
  isAdmitted({ isWeb: false }) === false);

fs.rmSync(out, { force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
