/* notifications-store — admin-side helpers for launch-email fan-out.

   Users can opt into a feature waitlist (optIn / listMyOptIns);
   admins can see the list grouped by feature and trigger the
   send-launch-email Edge Function. */
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';

const TABLE = 'feature_notifications';
const EDGE_FUNCTION = 'send-launch-email';

/* User-side: opt into a feature waitlist. Idempotent — unique
   constraint on (user_id, feature) surfaces as a benign error. */
export async function optIn(feature) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  if (!sess?.user?.id) return { ok: false, error: 'not-signed-in' };
  const { error } = await c.from(TABLE).insert({
    user_id: sess.user.id,
    feature,
  });
  // 23505 = unique_violation. Already opted in is not a failure.
  if (error && !error.message.includes('duplicate key')) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function isOptedIn(feature) {
  const c = client();
  if (!c) return false;
  const sess = getLastSession();
  if (!sess?.user?.id) return false;
  const { data } = await c.from(TABLE)
    .select('id')
    .eq('user_id', sess.user.id)
    .eq('feature', feature)
    .limit(1);
  return !!(data && data.length);
}

/* Admin-side: aggregated waitlist counts per feature. Uses a simple
   select-and-fold rather than a view because the row count is tiny
   for the foreseeable future. */
export async function listWaitlists() {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  const { data, error } = await c.from(TABLE).select('feature, notified_at');
  if (error) return { ok: false, rows: [], error: error.message };
  const bucket = new Map();
  for (const row of data || []) {
    const b = bucket.get(row.feature) || { feature: row.feature, waiting: 0, notified: 0 };
    if (row.notified_at) b.notified++; else b.waiting++;
    bucket.set(row.feature, b);
  }
  const rows = Array.from(bucket.values()).sort((a, b) => b.waiting - a.waiting);
  return { ok: true, rows };
}

/* Invoke the send-launch-email Edge Function.
   Modes:
     - { test_only: true } sends one email to the caller's own inbox,
       no waitlist rows touched.
     - default runs the fan-out over feature_notifications and stamps
       notified_at per row on success. */
export async function sendLaunchEmail({ feature, subject, html_body, test_only = false }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  const adminEmail = sess?.user?.email;
  if (!adminEmail) return { ok: false, error: 'not-signed-in' };
  const { data, error } = await c.functions.invoke(EDGE_FUNCTION, {
    body: {
      feature,
      subject,
      html_body,
      admin_email: adminEmail,
      test_only,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...data };
}
