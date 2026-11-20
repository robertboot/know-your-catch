/* announcements-store — CRUD + reads for the in-app announcement
   banner. Anyone (including signed-out marketing visitors) can list
   the currently-active banners; only the admin allowlist can write. */
import { client } from './supabase-client.js';

const TABLE = 'announcements';

/* List announcements that should be shown right now.
   The prior version combined .lte('starts_at') with a PostgREST
   .or('ends_at.is.null,...') expression that was silently returning
   zero rows in some environments. Fetch the small table wholesale
   and filter client-side — same net result, no query-shape drift. */
export async function listActiveAnnouncements(session) {
  const c = client();
  if (!c) return { ok: true, rows: [] };
  const { data, error } = await c.from(TABLE)
    .select('id, title, body, cta_label, cta_url, starts_at, ends_at, audience, dismissible, created_at');
  if (error) {
    console.warn('[announcements] fetch failed:', error.message);
    return { ok: false, rows: [], error: error.message };
  }
  const now = Date.now();
  const audience = session ? 'signed_in' : 'signed_out';
  const rows = (data || [])
    .filter(r => {
      const startsMs = new Date(r.starts_at).getTime();
      const endsMs   = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
      return startsMs <= now && now < endsMs;
    })
    .filter(r => r.audience === 'all' || r.audience === audience)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { ok: true, rows };
}

/* Full list, for the admin CRUD panel. Ignores start/end/audience so
   the admin sees drafts, scheduled, and expired banners. */
export async function listAllAnnouncements() {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  const { data, error } = await c.from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

export async function createAnnouncement(fields) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { data, error } = await c.from(TABLE).insert(fields).select('*').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data };
}

export async function updateAnnouncement(id, fields) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { data, error } = await c.from(TABLE)
    .update(fields).eq('id', id).select('*').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data };
}

export async function deleteAnnouncement(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from(TABLE).delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* localStorage-backed dismiss state. Keeps banner dismissals per
   device so the same X-tap sticks across page reloads. Shared
   between the top-of-Home banner and the inbox drawer. */
const LS_KEY = 'kyc_dismissed_announcements';

export function loadDismissedIds() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markDismissed(id) {
  const s = loadDismissedIds();
  s.add(id);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}

export function markManyDismissed(ids) {
  const s = loadDismissedIds();
  for (const id of ids) s.add(id);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
  } catch {}
}

/* Fetch the current user's launch-email history from the
   feature_notifications table. Only rows where the fan-out actually
   ran (notified_at IS NOT NULL) are returned — pending waitlist
   entries don't belong in the inbox. */
export async function listMyLaunchEmails() {
  const c = client();
  if (!c) return { ok: true, rows: [] };
  const { data, error } = await c.from('feature_notifications')
    .select('id, feature, notified_at')
    .not('notified_at', 'is', null)
    .order('notified_at', { ascending: false })
    .limit(50);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}
