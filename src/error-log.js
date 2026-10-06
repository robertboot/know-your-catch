/* Client crash reporting.
 *
 * Two testers hit a blank screen and neither could produce a device
 * log, so there was nothing to debug. The app now reports its own
 * faults. A blank screen is almost always a React render throw, which
 * leaves no trace anywhere else — that is the case this exists for.
 *
 * Deliberately best-effort and silent: reporting a crash must never
 * cause one. Every path is wrapped, failures are swallowed, and the app
 * works normally if the table has not been created.
 */
import { client } from './supabase-client.js';
import { getLastSession, hasGuestAccess } from './auth.js';

const SENT = new Set();          // fingerprints already sent this session
const MAX_PER_SESSION = 8;       // never turn a render loop into a write loop
let sentCount = 0;
let ctx = { screen: null, hasJurisdiction: null, appVersion: null };

/** App.jsx keeps this current so a report says WHERE it happened. */
export function setErrorContext(next) {
  ctx = { ...ctx, ...next };
}

function platform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'web';
}

/* kind + message + first stack frame. Groups the same fault across
   users without lumping unrelated ones together by message alone. */
function fingerprint(kind, message, stack) {
  const frame = String(stack || '').split('\n').map(s => s.trim())
    .find(s => s.startsWith('at ')) || '';
  return `${kind}|${String(message).slice(0, 120)}|${frame.slice(0, 120)}`;
}

/* Faults that are real events but not faults in THIS app, and that
   nobody can act on. They still get recorded — a spike in any of them is
   worth seeing — but as kind 'benign', so the daily brief does not open
   with "1 thing broken" over a deploy that healed itself.

   Two classes so far:

   Stale chunk imports. A tab open during a deploy asks for a hashed file
   that no longer exists, the server answers with index.html, and the
   import fails. chunk-reload.js already catches exactly these and reloads
   the page, so by the time anyone reads the report the user has long since
   recovered.

   Android WebView bridge errors. "Java object is gone" means the page was
   backgrounded inside an in-app browser — Facebook's or Instagram's — and
   the bridge object was collected. The stack says so outright: the frames
   come from iabjs://navigation_performance_logger_android, which is
   Facebook's injected script and not ours. This app is iOS; these are web
   visitors, and there is nothing in our code to change.

   Bare "Script error." A browser reports exactly this, with no file, line
   or stack, when a script from another origin throws — it withholds the
   detail deliberately. Our own bundles are same-origin, so this can only
   be a third-party script or a browser extension, and it is unactionable
   by construction: there is nothing to read and nothing to fix. Matched
   exactly rather than by substring, so a real message that happens to
   contain the phrase still reports. */
const BENIGN = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'is not a valid javascript mime type',
  'expected a javascript module script',
  'chunkloaderror',
  'java object is gone',
  'java exception was raised during method invocation',
];
const isBenign = (msg) => {
  const m = String(msg || '').trim().toLowerCase();
  // Exact, not a substring: "Script error." carries no information at all,
  // but a message that merely mentions one may carry plenty.
  if (m === 'script error.' || m === 'script error') return true;
  return BENIGN.some((p) => m.includes(p));
};

export async function reportError(kind, err, extra = {}) {
  try {
    const message = String(err?.message || err || 'unknown').slice(0, 500);
    if (isBenign(message)) kind = 'benign';
    const stack = String(err?.stack || '').slice(0, 4000);
    const fp = fingerprint(kind, message, stack);
    // One report per distinct fault per session: a component that throws
    // on every render would otherwise hammer the table.
    if (SENT.has(fp) || sentCount >= MAX_PER_SESSION) return;
    SENT.add(fp); sentCount += 1;

    const c = client();
    if (!c) return;
    const uid = getLastSession()?.user?.id || null;
    await c.from('error_log').insert({
      kind, message, stack, fingerprint: fp,
      screen: extra.screen ?? ctx.screen,
      is_guest: !uid && (hasGuestAccess?.() ?? true),
      has_jurisdiction: ctx.hasJurisdiction,
      app_version: ctx.appVersion,
      platform: platform(),
      user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 400),
      user_id: uid,
    });
  } catch { /* reporting must never surface */ }
}

let installed = false;
/** Global handlers. Safe to call more than once. */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Ignore resource load failures (<img> 404s) — noise, not crashes.
    if (e?.target && e.target !== window && e.target.tagName) return;
    reportError('window', e?.error || e?.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    reportError('promise', e?.reason);
  });
}
