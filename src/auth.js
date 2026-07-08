/* Auth — Supabase magic-link email flow.

   Flow:
     1. User enters email → sendMagicLink({ email }) → supabase sends an
        OTP email whose link is `reelintel://auth?code=...` (the
        emailRedirectTo we hand supabase-js).
     2. User taps the link in Mail on the same device. iOS resolves the
        reelintel:// scheme and hands the URL to our app.
     3. Capacitor App plugin's appUrlOpen listener fires. handleDeepLink
        parses the URL and calls supabase.auth.exchangeCodeForSession
        which lands a session server-side and locally.
     4. Any subscriber (SettingsScreen, sync layer) sees the session flip.

   Sign in with Apple was tried in an earlier build and produced
   AuthenticationServices error 1000 on-device (likely OAuth allow-list
   drift + presentation-context nuance). Magic link is simpler because
   it uses the system Mail app + a plain deep-link — no
   ASWebAuthenticationSession, no OAuth handshake surface. */
import { Capacitor } from '@capacitor/core';
import { client } from './supabase-client.js';
import { dlog } from './debug-log.js';

const REDIRECT_URL = 'reelintel://auth';

let _lastSession = null;
const listeners = new Set();

function notify(session) {
  _lastSession = session;
  for (const fn of listeners) { try { fn(session); } catch {} }
}

/** Subscribe to auth state. Fires immediately with the current session
    (or null) so callers don't have to poll. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  const c = client();
  if (c) c.auth.getSession().then(({ data }) => fn(data.session || null));
  return () => listeners.delete(fn);
}

export function getLastSession() { return _lastSession; }

/** Kick off the magic-link email flow. Returns { ok, error } — the
    caller shows a "check your email" state on ok. */
export async function sendMagicLink({ email }) {
  dlog(`[auth] sendMagicLink() called email=${(email || '').trim()}`);
  const c = client();
  if (!c) {
    dlog('[auth] sendMagicLink: NO CLIENT — env vars missing?');
    return { ok: false, error: 'Supabase is not configured.' };
  }
  const trimmed = (email || '').trim();
  if (!trimmed) return { ok: false, error: 'Enter an email address.' };
  dlog(`[auth] calling signInWithOtp emailRedirectTo=${REDIRECT_URL}`);
  try {
    const { error } = await c.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: REDIRECT_URL },
    });
    if (error) {
      console.error('[auth] signInWithOtp failed', error);
      dlog(`[auth] signInWithOtp ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    dlog('[auth] signInWithOtp OK — email sent');
    return { ok: true };
  } catch (e) {
    console.error('[auth] signInWithOtp threw', e);
    dlog(`[auth] signInWithOtp THREW: ${e?.message || String(e)}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Called from the appUrlOpen listener with the full deep-link URL.
    Extracts the code and completes the session exchange. */
export async function handleDeepLink(url) {
  console.log('[auth] deep-link received:', url);
  dlog(`[auth] appUrlOpen ${url ? url.slice(0, 80) : '(empty)'}`);
  if (!url || !url.startsWith(REDIRECT_URL)) return { ok: false, error: 'not a reelintel:// link' };
  const c = client();
  if (!c) {
    console.error('[auth] deep-link received but Supabase client is null');
    return { ok: false, error: 'Supabase is not configured.' };
  }
  try {
    const { data, error } = await c.auth.exchangeCodeForSession(url);
    if (error) {
      console.error('[auth] exchangeCodeForSession failed', error);
      dlog(`[auth] exchangeCodeForSession ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    console.log('[auth] session exchange succeeded:', data?.session?.user?.email || '(no email)');
    dlog(`[auth] exchangeCodeForSession OK email=${data?.session?.user?.email || '(no email)'}`);
    return { ok: true, session: data?.session || null };
  } catch (e) {
    console.error('[auth] exchange threw', e);
    dlog(`[auth] exchangeCodeForSession THREW: ${e?.message || String(e)}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Sign out — clears Supabase session. Local catch data is untouched. */
export async function signOut() {
  const c = client();
  if (!c) return;
  await c.auth.signOut();
}

// Boot-time: seed the current session + wire Supabase's own auth
// state change listener. Any consumer subscribing later gets replayed
// via subscribe()'s immediate getSession call above.
(function initAuthListener() {
  const c = client();
  if (!c) {
    dlog('[auth] initAuthListener: no client (env missing)');
    return;
  }
  c.auth.getSession().then(({ data }) => {
    dlog(`[auth] boot getSession: ${data.session ? 'signed in as ' + data.session.user?.email : 'signed out'}`);
    notify(data.session || null);
  });
  c.auth.onAuthStateChange((evt, sess) => {
    dlog(`[auth] onAuthStateChange evt=${evt} sess=${sess ? sess.user?.email : 'null'}`);
    notify(sess || null);
  });
})();

// Register the Capacitor App URL-open handler once at module load so
// the app can receive the magic-link tap immediately after iOS
// deep-links back into the app. Silent no-op on web.
(async function initDeepLinkHandler() {
  if (!Capacitor.isNativePlatform()) {
    dlog('[auth] initDeepLinkHandler: web (no Capacitor)');
    return;
  }
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', async (event) => {
      const url = event?.url || '';
      dlog(`[auth] appUrlOpen listener fired url=${url.slice(0, 80)}`);
      if (url.startsWith(REDIRECT_URL)) {
        await handleDeepLink(url);
      } else {
        dlog(`[auth] appUrlOpen ignored (prefix mismatch)`);
      }
    });
    dlog('[auth] initDeepLinkHandler: listener registered');
  } catch (e) {
    console.warn('[auth] failed to register appUrlOpen listener', e);
    dlog(`[auth] initDeepLinkHandler THREW: ${e?.message || String(e)}`);
  }
})();
