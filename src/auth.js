/* Auth — Supabase email + password.

   Flow:
     Sign in:  signInWithPassword → session lands → subscribers fire.
     Sign up:  signUp → if Supabase's Confirm Email is OFF the session
               lands immediately; if ON, needsConfirmation=true and the
               caller shows "check your email to confirm."
     Reset:    resetPassword → email arrives → user opens the link →
               Supabase parses a recovery session into the URL fragment
               of https://reelintel.ai/reset-password → detectSessionInUrl
               picks it up → ResetPasswordPage calls updatePassword. */
import { client } from './supabase-client.js';

/* Where password-reset (and email-confirm) links land. On web
   (reelintel.ai OR www.reelintel.ai OR any Vercel preview) we
   derive from the current origin so the redirect always matches
   what Supabase expects. On iOS (Capacitor WebView, origin
   capacitor://localhost) we fall back to the production apex —
   Safari on the phone opens the link, so the origin the user
   sees is reelintel.ai regardless. */
const RESET_REDIRECT = (() => {
  if (typeof window === 'undefined') return 'https://reelintel.ai/reset-password';
  const o = window.location.origin;
  if (o.startsWith('capacitor://') || o.startsWith('file://')) return 'https://reelintel.ai/reset-password';
  return `${o}/reset-password`;
})();

/* Offline credential marker.

   THE BUG THIS EXISTS FOR: an angler offshore with no signal could not
   get past the sign-in gate. Supabase access tokens expire after ~1
   hour; on expiry `getSession()` tries to refresh, the refresh needs
   network, and with none it resolves to `null`. App.jsx gates the
   ENTIRE app on a truthy session, so a expired-token-plus-no-signal
   combination locked the angler out of their own locally-stored
   catches — on a boat, which is exactly where the app is for.

   So "is this device signed in" is tracked separately from "do we hold
   a live token". This flag is app-owned rather than read out of
   supabase-js's storage key, because that key's name is an internal
   detail (`sb-<ref>-auth-token`) that we should not depend on.

   It is NOT a security control. It gates local, on-device data only —
   every cloud read still carries a real token and is enforced by RLS
   server-side. A stale flag grants access to nothing but the angler's
   own phone. */
const LS_AUTHED_KEY = 'kyc.authedOnce';

export function markAuthedLocally(email) {
  try {
    localStorage.setItem(LS_AUTHED_KEY, JSON.stringify({
      email: email || null, at: new Date().toISOString(),
    }));
  } catch {}
}
export function clearAuthedLocally() {
  try { localStorage.removeItem(LS_AUTHED_KEY); } catch {}
}
/** True when this device has completed a sign-in that was never
    followed by an explicit sign-out. Survives token expiry, offline
    launches, and app restarts. */
export function hasLocalCredential() {
  try { return !!localStorage.getItem(LS_AUTHED_KEY); } catch { return false; }
}
export function localCredentialEmail() {
  try { return JSON.parse(localStorage.getItem(LS_AUTHED_KEY) || 'null')?.email || null; }
  catch { return null; }
}

/* Guest access — the angler chose "Browse without an account" on the
   splash. Non-account features (species, regulations, forecast, maps)
   are free to use with no registration (App Store 5.1.1(v)); cloud
   sync / logbook backup still prompt sign-in on demand. Cleared the
   moment a real sign-in lands so we don't keep a guest marker around a
   signed-in device. */
const LS_GUEST_KEY = 'kyc.guestAccess';
export function markGuestAccess() {
  try { localStorage.setItem(LS_GUEST_KEY, new Date().toISOString()); } catch {}
}
export function clearGuestAccess() {
  try { localStorage.removeItem(LS_GUEST_KEY); } catch {}
}
export function hasGuestAccess() {
  try { return !!localStorage.getItem(LS_GUEST_KEY); } catch { return false; }
}

let _lastSession = null;
const listeners = new Set();

function notify(session) {
  _lastSession = session;
  // Any live session re-arms the offline marker. This also migrates
  // anglers who signed in on a build before the marker existed —
  // otherwise they'd carry no marker and hit the same offshore lockout
  // the first time their token expired without signal.
  if (session) { markAuthedLocally(session.user?.email || null); clearGuestAccess(); }
  for (const fn of listeners) { try { fn(session); } catch {} }
}

/** Subscribe to auth state. Fires immediately with the current session
    (or null) and again on every state change. */
export function subscribe(fn) {
  listeners.add(fn);
  const c = client();
  if (c) c.auth.getSession().then(({ data }) => fn(data.session || null));
  return () => listeners.delete(fn);
}

export function getLastSession() { return _lastSession; }

/** Sign in with email + password. Returns { ok, error?, session? }. */
export async function signInWithPassword({ email, password }) {
  const trimmed = (email || '').trim();
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { data, error } = await c.auth.signInWithPassword({ email: trimmed, password });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data.session) markAuthedLocally(trimmed);
    return { ok: true, session: data.session };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Create a new account. If Supabase's Confirm Email is OFF the
    session lands right away; if ON, needsConfirmation=true and the
    caller shows a "check your email" state. */
export async function signUp({ email, password }) {
  const trimmed = (email || '').trim();
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { data, error } = await c.auth.signUp({
      email: trimmed, password,
      options: { emailRedirectTo: RESET_REDIRECT },
    });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data.session) markAuthedLocally(trimmed);
    return { ok: true, session: data.session, needsConfirmation: !data.session };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Kick off a password-reset email. The user taps the link and lands
    on https://reelintel.ai/reset-password with a recovery session. */
export async function resetPassword({ email }) {
  const trimmed = (email || '').trim();
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { error } = await c.auth.resetPasswordForEmail(trimmed, {
      redirectTo: RESET_REDIRECT,
    });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Called from the /reset-password page after a recovery session has
    landed (via detectSessionInUrl). */
export async function updatePassword({ password }) {
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { error } = await c.auth.updateUser({ password });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Sign out — clears the Supabase session. Local data untouched.

    Clears the offline marker FIRST and unconditionally: signOut() hits
    the network, and if that call fails offline we still want the
    device treated as signed out. Leaving the marker on a failed
    sign-out would leave the angler in the app after asking to leave. */
export async function signOut() {
  clearAuthedLocally();
  const c = client();
  if (!c) return;
  try { await c.auth.signOut(); } catch {}
}

/** Permanently delete the signed-in user's account and all cloud data.
    Invokes the `delete-account` edge function with the caller's JWT;
    the function verifies the token, purges the user's rows + storage
    with the service role, then removes the auth user. On success we
    clear every local auth marker so the device is fully signed out.
    Returns { ok, error? }. The caller is responsible for wiping local
    app state (catches/PBs/photos) and returning to the splash. */
export async function deleteAccount() {
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { data: sessionData } = await c.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return { ok: false, error: 'You are not signed in.' };
    const { data, error } = await c.functions.invoke('delete-account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data && data.ok === false) return { ok: false, error: data.error || 'Deletion failed.' };
    // Fully sign out locally — the auth user is gone server-side.
    clearAuthedLocally();
    clearGuestAccess();
    try { await c.auth.signOut(); } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
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
