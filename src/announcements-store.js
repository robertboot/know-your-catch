/* announcements-store — CRUD + reads for the in-app announcement
   banner. Anyone (including signed-out marketing visitors) can list
   the currently-active banners; only the admin allowlist can write. */
import { client } from './supabase-client.js';

const TABLE = 'announcements';

/* List announcements that should be shown right now:
   - starts_at <= now
   - ends_at IS NULL OR ends_at > now
   - audience matches the session state
   Client-side sort so we can pick the most recent to render first
   without an ORDER BY that would need extra RLS thought. */
export async function listActiveAnnouncements(session) {
  const c = client();
  if (!c) return { ok: true, rows: [] };
  const nowIso = new Date().toISOString();
  const { data, error } = await c.from(TABLE)
    .select('id, title, body, cta_label, cta_url, starts_at, ends_at, audience, dismissible, created_at')
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`);
  if (error) return { ok: false, rows: [], error: error.message };
  const audience = session ? 'signed_in' : 'signed_out';
  const rows = (data || [])
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
   device so the same X-tap sticks across page reloads. */
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
