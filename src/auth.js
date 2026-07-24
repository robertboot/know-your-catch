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

let _lastSession = null;
const listeners = new Set();

function notify(session) {
  _lastSession = session;
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

/** Sign out — clears the Supabase session. Local data untouched. */
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
