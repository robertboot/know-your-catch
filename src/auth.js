/* Auth — Supabase email + password.

   Flow:
     Sign in:  signInWithPassword → session lands → subscribers fire.
     Sign up:  signUp → if Supabase's Confirm Email is OFF (build-22
               default) the session lands immediately; if ON, we get
               needsConfirmation=true and the caller shows "check your
               email to confirm."
     Reset:    resetPassword → email arrives → user opens the link →
               Supabase parses a recovery session into the URL fragment
               of https://reelintel.ai/reset-password → detectSessionInUrl
               picks it up → ResetPasswordPage calls updatePassword.

   Magic-link was tried in earlier builds and never worked reliably on
   device (some combination of email delivery, URL-scheme registration,
   deep-link handler timing, and Supabase redirect allow-list). This
   flow has zero exotic pieces — it's just a POST and back. */
import { client } from './supabase-client.js';
import { dlog } from './debug-log.js';

/* Where password-reset (and email-confirm) links land. Fixed to the
   web deploy — no iOS deep-link involved. Even for anglers on iOS,
   Safari opens reelintel.ai/reset-password, they set the new password,
   and switch back to the app to sign in. */
const RESET_REDIRECT = 'https://reelintel.ai/reset-password';

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
  dlog(`[auth] signInWithPassword called email=${trimmed}`);
  const c = client();
  if (!c) { dlog('[auth] signInWithPassword: NO CLIENT'); return { ok: false, error: 'Supabase is not configured.' }; }
  try {
    const { data, error } = await c.auth.signInWithPassword({ email: trimmed, password });
    if (error) {
      console.error('[auth] signInWithPassword failed', error);
      dlog(`[auth] signInWithPassword ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    dlog(`[auth] signInWithPassword OK email=${data.session?.user?.email || '(no email)'}`);
    return { ok: true, session: data.session };
  } catch (e) {
    console.error('[auth] signInWithPassword threw', e);
    dlog(`[auth] signInWithPassword THREW: ${e?.message || String(e)}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Create a new account. If Supabase's Confirm Email is OFF the
    session lands right away; if ON, needsConfirmation=true and the
    caller shows a "check your email" state.
    Returns { ok, error?, session?, needsConfirmation? }. */
export async function signUp({ email, password }) {
  const trimmed = (email || '').trim();
  dlog(`[auth] signUp called email=${trimmed}`);
  const c = client();
  if (!c) { dlog('[auth] signUp: NO CLIENT'); return { ok: false, error: 'Supabase is not configured.' }; }
  try {
    const { data, error } = await c.auth.signUp({
      email: trimmed, password,
      options: { emailRedirectTo: RESET_REDIRECT },
    });
    if (error) {
      console.error('[auth] signUp failed', error);
      dlog(`[auth] signUp ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    const needsConfirmation = !data.session;
    dlog(`[auth] signUp OK needsConfirmation=${needsConfirmation}`);
    return { ok: true, session: data.session, needsConfirmation };
  } catch (e) {
    console.error('[auth] signUp threw', e);
    dlog(`[auth] signUp THREW: ${e?.message || String(e)}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Kick off a password-reset email. The user taps the link and lands
    on https://reelintel.ai/reset-password with a recovery session in
    the URL fragment. */
export async function resetPassword({ email }) {
  const trimmed = (email || '').trim();
  dlog(`[auth] resetPassword called email=${trimmed}`);
  const c = client();
  if (!c) { dlog('[auth] resetPassword: NO CLIENT'); return { ok: false, error: 'Supabase is not configured.' }; }
  try {
    const { error } = await c.auth.resetPasswordForEmail(trimmed, {
      redirectTo: RESET_REDIRECT,
    });
    if (error) {
      console.error('[auth] resetPassword failed', error);
      dlog(`[auth] resetPassword ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    dlog('[auth] resetPassword OK — email sent');
    return { ok: true };
  } catch (e) {
    console.error('[auth] resetPassword threw', e);
    dlog(`[auth] resetPassword THREW: ${e?.message || String(e)}`);
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Called from the /reset-password page after a recovery session has
    landed (via detectSessionInUrl). */
export async function updatePassword({ password }) {
  dlog('[auth] updatePassword called');
  const c = client();
  if (!c) return { ok: false, error: 'Supabase is not configured.' };
  try {
    const { error } = await c.auth.updateUser({ password });
    if (error) {
      dlog(`[auth] updatePassword ERROR: ${error.message || String(error)}`);
      return { ok: false, error: error.message || String(error) };
    }
    dlog('[auth] updatePassword OK');
    return { ok: true };
  } catch (e) {
    dlog(`[auth] updatePassword THREW: ${e?.message || String(e)}`);
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
