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

export async function reportError(kind, err, extra = {}) {
  try {
    const message = String(err?.message || err || 'unknown').slice(0, 500);
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
