/* Auth — Sign in with Apple → Supabase session.

   Native iOS flow (via @capacitor-community/apple-sign-in):
     1. SignInWithApple.authorize() invokes Apple's native prompt.
        The user confirms with Face/Touch ID or their Apple ID.
     2. Apple returns an identity token (JWT) signed by Apple.
     3. Hand that token to supabase.auth.signInWithIdToken({ provider:
        'apple', token }). Supabase verifies with Apple's public key
        and issues a session that RLS keys on via auth.uid().

   Web fallback (dev + Safari testing on the desktop): use supabase's
   built-in OAuth redirect flow via signInWithOAuth({ provider:
   'apple' }). Requires the Services ID + return URL to be configured
   in Apple + Supabase.

   Session state:
     - subscribe(fn) — fires with the current { session, user } on
       every auth state change (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED).
     - getSession() — snapshot lookup.

   Config prerequisites — see BUILD14_SETUP.md at the repo root. */
import { Capacitor } from '@capacitor/core';
import { client } from './supabase-client.js';

// The Sign-in-with-Apple plugin's Services ID (web) / bundle ID
// (native). Set to match Apple Developer console entries.
const APPLE_BUNDLE_ID   = 'com.reelintel.app';
const APPLE_SERVICES_ID = 'com.reelintel.services';

let _lastSession = null;
const listeners = new Set();

function notify(session) {
  _lastSession = session;
  for (const fn of listeners) { try { fn(session); } catch {} }
}

/** Subscribe to auth state. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  const c = client();
  if (c) c.auth.getSession().then(({ data }) => fn(data.session || null));
  return () => listeners.delete(fn);
}

export function getLastSession() { return _lastSession; }

/** Native Sign in with Apple. On iOS Capacitor. */
async function signInWithAppleNative() {
  const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
  const options = {
    clientId: APPLE_BUNDLE_ID,   // native uses the app bundle id
    redirectURI: `https://${new URL(import.meta.env.VITE_SUPABASE_URL).host}/auth/v1/callback`,
    scopes: 'email name',
    state: Math.random().toString(36).slice(2),
    // On iOS the "nonce" is optional but recommended. Skipped here
    // because Supabase's signInWithIdToken accepts unnonced tokens.
  };
  const res = await SignInWithApple.authorize(options);
  const idToken = res?.response?.identityToken;
  if (!idToken) throw new Error('Apple did not return an identity token');
  const c = client();
  if (!c) throw new Error('Supabase not configured');
  const { data, error } = await c.auth.signInWithIdToken({
    provider: 'apple',
    token: idToken,
  });
  if (error) throw error;
  return data;
}

/** Web fallback: Supabase OAuth redirect. */
async function signInWithAppleWeb() {
  const c = client();
  if (!c) throw new Error('Supabase not configured');
  const { error } = await c.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

/** Preferred entry. Picks the right flow for the runtime. */
export async function signInWithApple() {
  return Capacitor.isNativePlatform() ? signInWithAppleNative() : signInWithAppleWeb();
}

/** Sign out — clears session + storage. Local catch data stays put. */
export async function signOut() {
  const c = client();
  if (!c) return;
  await c.auth.signOut();
}

// Boot-time: wire the Supabase listener once. Any consumer that
// subscribes later gets replayed the most recent session immediately
// via the subscribe() helper above.
(function initAuthListener() {
  const c = client();
  if (!c) return;
  c.auth.getSession().then(({ data }) => notify(data.session || null));
  c.auth.onAuthStateChange((_evt, sess) => notify(sess || null));
})();
