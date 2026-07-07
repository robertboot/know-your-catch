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
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  const trimmed = (email || '').trim();
  if (!trimmed) return { ok: false, error: 'Enter an email address.' };
  const { error } = await c.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: REDIRECT_URL },
  });
  if (error) {
    console.error('[auth] signInWithOtp failed', error);
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true };
}

/** Called from the appUrlOpen listener with the full deep-link URL.
    Extracts the code and completes the session exchange. */
export async function handleDeepLink(url) {
  if (!url || !url.startsWith(REDIRECT_URL)) return { ok: false, error: 'not a reelintel:// link' };
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { data, error } = await c.auth.exchangeCodeForSession(url);
    if (error) {
      console.error('[auth] exchangeCodeForSession failed', error);
      return { ok: false, error: error.message || String(error) };
    }
    return { ok: true, session: data?.session || null };
  } catch (e) {
    console.error('[auth] exchange threw', e);
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
  if (!c) return;
  c.auth.getSession().then(({ data }) => notify(data.session || null));
  c.auth.onAuthStateChange((_evt, sess) => notify(sess || null));
})();

// Register the Capacitor App URL-open handler once at module load so
// the app can receive the magic-link tap immediately after iOS
// deep-links back into the app. Silent no-op on web.
(async function initDeepLinkHandler() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', async (event) => {
      const url = event?.url || '';
      if (url.startsWith(REDIRECT_URL)) {
        await handleDeepLink(url);
      }
    });
  } catch (e) {
    console.warn('[auth] failed to register appUrlOpen listener', e);
  }
})();
