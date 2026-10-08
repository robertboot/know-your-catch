/* Legal docs store — admin-editable text served by the static
   /privacy page (and future /terms, /support). Publicly readable
   by design so the anon browser session at reelintel.ai/privacy
   can fetch the current row without auth. Admin writes gated by
   the same email allowlist RLS as regulations / species. */

import { client } from './supabase-client.js';

const TABLE = 'legal_docs';

/** Read a single doc by slug. Returns { ok, doc } — doc null when
    the row doesn't exist (page should render its bundled fallback). */
export async function fetchLegalDoc(slug) {
  const c = client();
  if (!c) return { ok: false, doc: null, error: 'not-configured' };
  const { data, error } = await c.from(TABLE)
    .select('slug, title, body_html, updated_at, updated_by')
    .eq('slug', slug)
    .maybeSingle();
  if (error) return { ok: false, doc: null, error: error.message };
  return { ok: true, doc: data || null };
}

/** Admin-only: list every doc so the admin editor can show a menu.
    Anon callers can technically call this too — the table is public
    read — but only ever from the admin console in practice. */
export async function listLegalDocs() {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  const { data, error } = await c.from(TABLE)
    .select('slug, title, body_html, updated_at, updated_by')
    .order('slug', { ascending: true });
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/** Admin upsert. RLS enforces the allowlisted email server-side. */
export async function upsertLegalDoc({ slug, title, body_html }, { sessionEmail } = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!slug || !title || !body_html) return { ok: false, error: 'missing slug / title / body_html' };
  const { data, error } = await c.from(TABLE)
    .upsert({
      slug,
      title,
      body_html,
      updated_by: sessionEmail || null,
    }, { onConflict: 'slug' })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, doc: data };
}
