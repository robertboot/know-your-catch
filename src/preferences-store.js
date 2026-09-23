/* preferences-store — per-user notification preferences.

   One row per user in the user_preferences table. Right now it
   holds a single flag: feature_emails_opted_out. When we add SMS
   or push, each channel gets its own column here. */
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';

const TABLE = 'user_preferences';

/* Read the current user's preferences. Missing row => defaults
   (opted in). Return shape stays stable across additions to the
   table, so callers can rely on the boolean without checking for
   the row's existence. */
export async function getMyPreferences() {
  const c = client();
  if (!c) return { ok: false, prefs: null, error: 'not-configured' };
  const sess = getLastSession();
  if (!sess?.user?.id) return { ok: false, prefs: null, error: 'not-signed-in' };
  const { data, error } = await c.from(TABLE)
    .select('feature_emails_opted_out')
    .eq('user_id', sess.user.id)
    .maybeSingle();
  if (error) return { ok: false, prefs: null, error: error.message };
  return {
    ok: true,
    prefs: {
      featureEmailsOptedOut: data?.feature_emails_opted_out ?? false,
    },
  };
}

/* One-way opt out. Once flipped to true, there's no UI to flip
   back — matches the "one-way opt-out" spec. If we ever add a
   re-subscribe surface, this same helper can toggle the flag both
   ways. */
export async function optOutOfFeatureEmails() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  if (!sess?.user?.id) return { ok: false, error: 'not-signed-in' };
  const { error } = await c.from(TABLE).upsert({
    user_id: sess.user.id,
    feature_emails_opted_out: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
