/* Regulations overlay store — verified-only reads for the mobile
   app, admin-only writes.

   Precedence at read time (regulationFor):
     1. Supabase VERIFIED row  → source: 'verified'   (renders normally)
     2. Bundled REGULATIONS    → source: 'bundled'    (renders w/ caveat chip)
     3. Nothing                → source: 'none'       (empty-state deep link)

   DRAFT rows are ONLY surfaced to the admin — mobile clients never
   see them because the RLS policy filters them at the DB layer, not
   here. This module reads .from('regulations').select() which returns
   verified for anonymous callers and everything for the admin.

   Cache: last-known-good verified rows kept in localStorage keyed
   under CACHE_KEY so the first paint after boot reflects overlay
   without a round-trip. */

import { client } from './supabase-client.js';
import { REGULATIONS as BUNDLED_REGS } from './data.js';

const CACHE_KEY = 'kyc_regulations_overlay_v1';

// { [speciesId]: { [jurisdictionId]: <regulation row> } }
let _verified = new Map();

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch { return null; }
}
function saveCache(rows) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      rows, cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

/* Row shape from Supabase → internal shape indexed for lookup. */
function indexRows(rows) {
  const out = new Map();
  for (const r of (rows || [])) {
    if (!r?.species_id || !r?.jurisdiction_id) continue;
    if (!out.has(r.species_id)) out.set(r.species_id, {});
    out.get(r.species_id)[r.jurisdiction_id] = r;
  }
  return out;
}

/* Init from cache on module load (sync) so first paint has overlay. */
_verified = indexRows(loadCache() || []);

/* Convert an overlay row → the bundled-regulation shape mobile
   screens expect (open, minSize, maxSize, bagLimit, boatLimit, notes).
   Keeps existing render code unchanged. */
function overlayToRenderShape(row) {
  if (!row) return null;
  return {
    open:      row.season_text || null,
    minSize:   row.min_size_in != null ? Number(row.min_size_in) : null,
    maxSize:   row.max_size_in != null ? Number(row.max_size_in) : null,
    bagLimit:  row.bag_limit   != null ? Number(row.bag_limit)   : null,
    boatLimit: row.boat_limit  != null ? Number(row.boat_limit)  : null,
    notes:     row.notes || null,
    // Provenance markers so caller can render caveats.
    _verifiedAt:  row.verified_at || null,
    _sourceUrl:   row.source_url  || null,
    _sourceNote:  row.source_note || null,
  };
}

/** Read the current regulation for a (species, jurisdiction) pair
    with source provenance. Never returns a draft row on the mobile
    app path — RLS blocks that at the DB. */
export function regulationFor(speciesId, jurisdictionId) {
  if (!speciesId || !jurisdictionId) return { source: 'none', regulation: null };
  const overlayRow = _verified.get(speciesId)?.[jurisdictionId] || null;
  if (overlayRow) {
    return { source: 'verified', regulation: overlayToRenderShape(overlayRow), row: overlayRow };
  }
  const bundled = BUNDLED_REGS[speciesId]?.[jurisdictionId] || null;
  if (bundled) {
    return { source: 'bundled', regulation: bundled, row: null };
  }
  return { source: 'none', regulation: null, row: null };
}

/** Full pull — pulls whatever RLS lets the caller see. For an
    anonymous mobile user that's verified only; for the admin it's
    everything (drafts included). Callers dedicated to the admin
    workflow should use adminListRegulations() below to get all
    statuses cleanly annotated. */
export async function fetchRegulations() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  try {
    const { data, error } = await c.from('regulations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) return { ok: false, error: error.message };
    const rows = data || [];
    // Only verified rows contribute to the mobile-facing lookup —
    // even in admin mode we want the mobile-side precedence to be
    // predictable.
    const verifiedRows = rows.filter(r => r.status === 'verified');
    _verified = indexRows(verifiedRows);
    saveCache(verifiedRows);
    notify();
    return { ok: true, rows, verifiedCount: verifiedRows.length };
  } catch (e) {
    return { ok: false, error: e?.message || 'fetch failed' };
  }
}

/** Admin-only: fetch every row (draft + verified + stale + disputed)
    for a given jurisdiction. Used by the Regulations admin tab to
    render its species × current-jurisdiction table. */
export async function adminListRegulations({ jurisdictionId = null } = {}) {
  const c = client();
  if (!c) return { ok: false, rows: [] };
  let q = c.from('regulations').select('*').order('species_id');
  if (jurisdictionId) q = q.eq('jurisdiction_id', jurisdictionId);
  const { data, error } = await q;
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/** Admin-only write. Sets drafted_by to the current admin email if
    the row doesn't have one yet. Verified rows should be flipped
    via adminVerifyRegulation() below — this is for draft edits. */
export async function adminUpsertRegulation(row, { sessionEmail = null } = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const payload = {
    species_id:      row.species_id,
    jurisdiction_id: row.jurisdiction_id,
    season_text:     row.season_text ?? null,
    min_size_in:     row.min_size_in ?? null,
    max_size_in:     row.max_size_in ?? null,
    bag_limit:       row.bag_limit   ?? null,
    boat_limit:      row.boat_limit  ?? null,
    notes:           row.notes       ?? null,
    source_note:     row.source_note ?? null,
    source_url:      row.source_url  ?? null,
    // Preserve status if already 'verified' — draft edits alone
    // should not un-verify a row; call adminUnverifyRegulation for that.
    status:          row.status      ?? 'draft',
    drafted_by:      row.drafted_by  ?? (sessionEmail || 'admin'),
  };
  const { data, error } = await c.from('regulations')
    .upsert(payload, { onConflict: 'species_id,jurisdiction_id' })
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  await fetchRegulations();
  return { ok: true, row: data };
}

/** Admin-only verify — REQUIRES a non-empty source_url. */
export async function adminVerifyRegulation(id, { sourceUrl, sessionEmail }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!sourceUrl?.trim()) return { ok: false, error: 'source_url required' };
  const { error } = await c.from('regulations')
    .update({
      status: 'verified',
      verified_by: sessionEmail || 'admin',
      verified_at: new Date().toISOString(),
      source_url: sourceUrl.trim(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  await fetchRegulations();
  return { ok: true };
}

/** Admin-only un-verify — moves back to draft with a reason. */
export async function adminUnverifyRegulation(id, reason) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('regulations')
    .update({
      status: 'draft',
      verified_by: null,
      verified_at: null,
      source_note: reason ? `[un-verified: ${reason}]` : null,
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  await fetchRegulations();
  return { ok: true };
}

/** Admin-only: call the research-regulations edge function for one
    (species, jurisdiction) pair. Returns the raw draft — caller
    decides whether to upsert it. */
export async function draftWithAI({ species, jurisdiction }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!species?.id || !jurisdiction?.id) return { ok: false, error: 'missing species or jurisdiction' };
  const { data, error } = await c.functions.invoke('research-regulations', {
    body: {
      speciesId:           species.id,
      speciesName:         species.commonName,
      scientificName:      species.scientific || null,
      altNames:            species.altNames   || [],
      jurisdictionId:      jurisdiction.id,
      jurisdictionName:    jurisdiction.name,
      jurisdictionAgency:  jurisdiction.agency  || '',
      jurisdictionRegsUrl: jurisdiction.regsUrl || '',
    },
  });
  if (error) return { ok: false, error: error.message };
  if (data?.error) return { ok: false, error: data.detail || data.error };
  return { ok: true, draft: data };
}
