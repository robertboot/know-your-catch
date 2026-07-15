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
    app path — RLS blocks that at the DB.

    Precedence:
      1. Verified overlay row for (species, jurisdiction)     → 'verified'
      2. Bundled REGULATIONS[species][jurisdiction]           → 'bundled'
      3. Fed fallback: verified overlay for (species,fed_gulf)→ 'verified-fed'
      4. Fed fallback: bundled REGULATIONS[species][fed_gulf] → 'bundled-fed'
      5. Nothing                                              → 'none'

    The fed fallback matters because most Gulf recreational species
    are caught in federal waters, and the state row is often just
    "follow federal" — better to actually show the federal numbers
    than to render a bare "confirm source" pill. Callers can look at
    `.regulation._fromFed` to render a "Federal Gulf" chip. */
export function regulationFor(speciesId, jurisdictionId) {
  if (!speciesId || !jurisdictionId) return { source: 'none', regulation: null };
  // Memo cache: the resolve is pure given (species, jurisdiction,
  // overlay generation) but runs in hot list loops (~95 species per
  // render, per keystroke in search). Cleared whenever the overlay
  // refreshes (see fetchRegulations → _resolveCache.clear()).
  const cacheKey = `${speciesId}|${jurisdictionId}`;
  const hit = _resolveCache.get(cacheKey);
  if (hit) return hit;

  // Resolve one jurisdiction: verified overlay merged per-field with
  // the bundled row (verified wins wherever it has data; bundled
  // fills the nulls, EXCEPT placeholder seasons — a null verified
  // season must not inherit 'Check current season', because that
  // placeholder would then both render as 'Season varies' AND block
  // the fed fallback below). Returns null when neither layer has
  // substantive data, so the caller can fall through to fed.
  const resolveAt = (jurId) => {
    const overlayRow = _verified.get(speciesId)?.[jurId] || null;
    const bundled = BUNDLED_REGS[speciesId]?.[jurId] || null;
    if (overlayRow) {
      const shape = overlayToRenderShape(overlayRow);
      if (bundled) {
        if (shape.open == null && bundled.open != null && !isPlaceholderSeason(bundled.open)) {
          shape.open = bundled.open;
          shape._seasonFromBundled = true;
        }
        for (const [dst, src] of FILL_FIELDS) {
          if (shape[dst] == null && bundled[src] != null) shape[dst] = bundled[src];
        }
        // Gear + sectors only exist in the bundled dataset — the
        // overlay schema has no columns for them.
        if (Array.isArray(bundled.gear) && bundled.gear.length) shape.gear = bundled.gear;
        if (bundled.sectors && !shape.sectors) shape.sectors = bundled.sectors;
      }
      // A verified row that STILL has no substantive data after the
      // merge (e.g. season_text 'Follow federal regulations', all
      // numerics null, empty bundled row) must not shadow the fed
      // fallback — that emptiness check previously only guarded the
      // bundled path.
      if (!hasAnyRegData(shape)) return null;
      return { source: 'verified', regulation: shape, row: overlayRow };
    }
    if (bundled && hasAnyRegData(bundled)) {
      return { source: 'bundled', regulation: bundled, row: null };
    }
    return null;
  };

  let result = resolveAt(jurisdictionId);
  // Fed fallback — only for STATE jurisdictions (fed_gulf falling
  // back to itself would loop). Same resolve, so a verified fed row
  // gets the identical per-field bundled merge it gets when viewed
  // directly as Federal Gulf.
  if (!result && jurisdictionId !== 'fed_gulf') {
    const fed = resolveAt('fed_gulf');
    if (fed) {
      result = {
        source: `${fed.source}-fed`, // 'verified-fed' | 'bundled-fed'
        regulation: { ...fed.regulation, _fromFed: true },
        row: fed.row,
      };
    }
  }
  if (!result) result = { source: 'none', regulation: null, row: null };
  _resolveCache.set(cacheKey, result);
  return result;
}

// [render-shape key, bundled key] pairs for the per-field merge.
// boatLimit maps from the bundled dataset's vesselLimit name.
const FILL_FIELDS = [
  ['minSize', 'minSize'],
  ['maxSize', 'maxSize'],
  ['bagLimit', 'bagLimit'],
  ['boatLimit', 'vesselLimit'],
  ['notes', 'notes'],
];

const _resolveCache = new Map();

/** Placeholder season strings — hedges, not data. Single predicate
    shared by hasAnyRegData and the merge above so 'what counts as a
    placeholder' can't drift between the two. */
export function isPlaceholderSeason(text) {
  if (!text) return true;
  return /check current season|not federally managed|not managed|see state|follow state|follow federal|see federal|verify with/i.test(String(text));
}

/** True when a regulation row carries at least one substantive
    field the UI can render. A row that only has a placeholder
    "check current season" open string and nothing else counts as
    empty — the fed fallback should kick in. */
function hasAnyRegData(reg) {
  if (!reg) return false;
  if (reg.minSize   != null) return true;
  if (reg.maxSize   != null) return true;
  if (reg.bagLimit  != null) return true;
  if (reg.boatLimit != null) return true;
  if (reg.vesselLimit != null) return true;
  if (Array.isArray(reg.gear) && reg.gear.length > 0) return true;
  if (reg.notes && reg.notes.trim()) return true;
  if (reg.open && !isPlaceholderSeason(reg.open)) return true;
  return false;
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
    _resolveCache.clear();
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

/** Admin-only: purge stale pre-automation drafts — draft rows the
    auto-updater has never checked (last_checked_at is null). These
    are leftovers from the manual no-web-search drafting era; the
    updater regenerates each pair with live research as its rotation
    reaches it, so deleting them costs nothing (drafts are invisible
    to app users anyway). Verified / stale / disputed rows are never
    touched. */
export async function adminPurgeStaleDrafts() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  // Two junk classes, both strictly AI-authored (manual rows are
  // never touched):
  //   1. Every AI draft — old no-web-search leftovers AND re-checked
  //      ones (the updater's coalesce used to carry old junk values
  //      forward, so 'checked' does not mean 'clean').
  //   2. Verified-but-EMPTY AI rows — bulk-verified drafts from the
  //      old era with no season and no numerics. The app already
  //      ignores them (hasAnyRegData), but they clutter the report
  //      as 'Live' rows with nothing in them.
  // The updater re-researches every deleted pair on rotation.
  const del1 = await c.from('regulations')
    .delete()
    .eq('status', 'draft')
    .eq('drafted_by', 'ai')
    .select('id');
  if (del1.error) return { ok: false, error: del1.error.message };
  const del2 = await c.from('regulations')
    .delete()
    .eq('status', 'verified')
    .eq('drafted_by', 'ai')
    .is('season_text', null)
    .is('min_size_in', null)
    .is('max_size_in', null)
    .is('bag_limit', null)
    .is('boat_limit', null)
    .select('id');
  if (del2.error) return { ok: false, error: del2.error.message };
  return { ok: true, count: (del1.data || []).length + (del2.data || []).length };
}

/** Admin-only: how many junk AI rows exist (all jurisdictions) —
    the purge button's badge count. Mirrors the two delete filters
    in adminPurgeStaleDrafts. */
export async function adminCountStaleDrafts() {
  const c = client();
  if (!c) return { ok: false, count: 0 };
  const [drafts, emptyVerified] = await Promise.all([
    c.from('regulations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft')
      .eq('drafted_by', 'ai'),
    c.from('regulations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'verified')
      .eq('drafted_by', 'ai')
      .is('season_text', null)
      .is('min_size_in', null)
      .is('max_size_in', null)
      .is('bag_limit', null)
      .is('boat_limit', null),
  ]);
  if (drafts.error) return { ok: false, count: 0, error: drafts.error.message };
  if (emptyVerified.error) return { ok: false, count: 0, error: emptyVerified.error.message };
  return { ok: true, count: (drafts.count || 0) + (emptyVerified.count || 0) };
}

/** Admin-only: latest auto-updater runs for the report header.
    Table may not exist until the auto-update migration runs. */
export async function adminListAutoRuns(limit = 5) {
  const c = client();
  if (!c) return { ok: false, rows: [] };
  try {
    const { data, error } = await c.from('regs_auto_runs')
      .select('ran_at, checked, published, drafted, unchanged, failed')
      .order('ran_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: data || [] };
  } catch (e) {
    return { ok: false, rows: [], error: e?.message || 'failed' };
  }
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

/** Admin-only verify — REQUIRES a non-empty source_url. When an admin
    co-signs an auto-published row this also clears auto_published so
    the badge flips from "Auto-verified" to plain "Verified". */
export async function adminVerifyRegulation(id, { sourceUrl, sessionEmail }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!sourceUrl?.trim()) return { ok: false, error: 'source_url required' };
  const { error } = await c.from('regulations')
    .update({
      status: 'verified',
      verified_by: sessionEmail || 'admin',
      verified_at: new Date().toISOString(),
      auto_published: false,
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

/* Staleness bands — hard-coded threshold days. A verified regulation
   is 'fresh' for the first 90 days, 'aging' 90-365 days, then 'stale'
   past a year (annual regs cycle at FWC / NOAA). Any non-verified row
   (draft / stale / disputed) always reports tier='stale'. */
const FRESH_DAYS_MAX = 90;
const AGING_DAYS_MAX = 365;

/** Age of a regulation for display. `regulation` here is the raw
    Supabase row shape (verified_at, drafted_at, status). Also
    accepts the render-shape from regulationFor().row.
    Returns { days, tier: 'fresh'|'aging'|'stale', asOfIso, source }.
      days   — integer days since verified (or drafted if never
               verified); null if we have no timestamp
      tier   — bucketed age
      asOfIso — the ISO timestamp we're aging against
      source  — 'verified' | 'drafted' | 'unknown' — which timestamp
                was used. Callers wanting the display line ("Verified
                X ago") should key off this. */
export function regulationAge(row) {
  if (!row) return { days: null, tier: 'stale', asOfIso: null, source: 'unknown' };
  const status = row.status || 'draft';
  const isVerified = status === 'verified';
  const iso = isVerified ? row.verified_at : (row.drafted_at || row.updated_at || null);
  if (!iso) {
    return { days: null, tier: isVerified ? 'aging' : 'stale', asOfIso: null,
             source: isVerified ? 'verified' : 'drafted' };
  }
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  // Non-verified rows are always 'stale' for the admin sort/filter
  // regardless of their draft age.
  const tier = !isVerified                ? 'stale'
             : days > AGING_DAYS_MAX      ? 'stale'
             : days > FRESH_DAYS_MAX      ? 'aging'
             :                              'fresh';
  return { days, tier, asOfIso: iso, source: isVerified ? 'verified' : 'drafted' };
}

/** Human-readable age phrase for the admin row. */
export function regulationAgePhrase(row) {
  const { days, tier, source } = regulationAge(row);
  if (days == null) {
    if (source === 'verified') return 'Verified — timestamp missing';
    return `${row?.status === 'stale' ? 'Marked stale' : (row?.status === 'draft' ? 'Drafted' : 'Unknown')}`;
  }
  const ago = daysAgoPhrase(days);
  if (source === 'verified') {
    return tier === 'stale' ? `Verified ${ago} — refresh recommended`
         : `Verified ${ago}`;
  }
  // Non-verified rows.
  if (row?.status === 'stale')    return `Marked stale ${ago} — needs re-draft + verify`;
  if (row?.status === 'draft')    return `AI-drafted ${ago} — needs verification`;
  if (row?.status === 'disputed') return `Disputed ${ago} — resolve before publishing`;
  return `Updated ${ago}`;
}

function daysAgoPhrase(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Latest auto-updater run summary for the pipeline-health card at
    the top of the admin Regulations tab. Returns null when nothing
    has run yet. */
export async function getLatestAutoRun() {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.from('regs_auto_runs')
    .select('ran_at, checked, published, drafted, unchanged, failed')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

/** True if a verified row was published by the auto-updater rather
    than co-signed by a human admin. Two signals: auto_published flag
    (canonical since the auto-updater added it) OR verified_by set
    to the sentinel string 'auto-updater'. Belt + suspenders in case
    a row got flipped one way but not the other during the migration. */
export function isAutoVerified(row) {
  if (!row) return false;
  if (row.status !== 'verified') return false;
  return row.auto_published === true || row.verified_by === 'auto-updater';
}

/** "checked 3h ago" phrasing for the last_checked_at column. Written
    in hours-resolution up to a day so the ongoing auto-update
    rotation reads at a glance. Falls back to daysAgoPhrase past 24h. */
export function regulationLastCheckedPhrase(row) {
  if (!row?.last_checked_at) return null;
  const ms = Date.now() - new Date(row.last_checked_at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1)   return 'checked just now';
  if (minutes < 60)  return `checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `checked ${daysAgoPhrase(days)}`;
}

/** Admin-only bulk-mark-stale — takes any status='verified' row with
    verified_at older than `olderThanDays` and flips status to 'stale'.
    Returns { ok, count, error }. Called from the annual refresh-cycle
    helper in the admin tab. */
export async function adminMarkAllStale({ jurisdictionId = null, olderThanDays = 365 } = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured', count: 0 };
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  let q = c.from('regulations')
    .update({ status: 'stale' })
    .eq('status', 'verified')
    .lt('verified_at', cutoff)
    .select('id');
  if (jurisdictionId) q = q.eq('jurisdiction_id', jurisdictionId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message, count: 0 };
  await fetchRegulations();
  return { ok: true, count: (data || []).length };
}

/** Admin-only: preview count of rows that would be marked stale by
    adminMarkAllStale. Used to render the "Mark all verified older
    than 1 year as stale (N)" label. */
export async function adminCountStalable({ jurisdictionId = null, olderThanDays = 365 } = {}) {
  const c = client();
  if (!c) return { ok: false, count: 0 };
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  let q = c.from('regulations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'verified')
    .lt('verified_at', cutoff);
  if (jurisdictionId) q = q.eq('jurisdiction_id', jurisdictionId);
  const { count, error } = await q;
  if (error) return { ok: false, count: 0, error: error.message };
  return { ok: true, count: count || 0 };
}

/* ------------------------------------------------------------------
   Admin bulk actions
   ------------------------------------------------------------------ */

/** Bulk mark rows stale by primary key ids. Returns { ok, count }.
    Silent no-op on empty list. */
export async function adminBulkMarkStale(ids) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured', count: 0 };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true, count: 0 };
  const { data, error } = await c.from('regulations')
    .update({ status: 'stale' })
    .in('id', ids)
    .select('id');
  if (error) return { ok: false, error: error.message, count: 0 };
  await fetchRegulations();
  return { ok: true, count: (data || []).length };
}

/** Bulk delete DRAFT rows by ids. Verified rows are refused —
    deleting a verified row requires the per-row Delete action so
    a bulk mistake can't wipe out compliance-approved data. Returns
    { ok, count, skipped } where skipped is the count of ids that
    were verified/stale/disputed and thus skipped. */
export async function adminBulkDeleteDrafts(ids) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured', count: 0, skipped: 0 };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true, count: 0, skipped: 0 };
  // Load and split so we can report the skip count honestly.
  const { data: existing, error: loadErr } = await c.from('regulations')
    .select('id, status').in('id', ids);
  if (loadErr) return { ok: false, error: loadErr.message, count: 0, skipped: 0 };
  const draftIds = (existing || []).filter(r => r.status === 'draft').map(r => r.id);
  const skipped  = (existing || []).length - draftIds.length;
  if (draftIds.length === 0) {
    return { ok: true, count: 0, skipped };
  }
  const { error } = await c.from('regulations').delete().in('id', draftIds);
  if (error) return { ok: false, error: error.message, count: 0, skipped };
  await fetchRegulations();
  return { ok: true, count: draftIds.length, skipped };
}

/** Cascade AI drafts for ONE species across many jurisdictions.
    Serial with a 500ms gap so we don't hammer the LLM. Each result
    is upserted as status='draft' (unless the row is already verified,
    in which case status is preserved and the AI draft overwrites
    only the numeric/text fields — but source is retained so the
    admin can compare against their prior verified state).

    onProgress({ index, total, jurisdiction, phase }) fires:
      phase='start' before each per-jurisdiction call
      phase='ok'    after a successful upsert
      phase='fail'  after a failure (result.error carries the reason)

    Caller passes a cancelToken = { cancelled: false } which the
    cascade checks between jurisdictions so Cancel-after-current
    works. Returns { ok, succeeded: string[], failed: [{jurisdictionId, error}] }. */
export async function runRegsCascade({ species, jurisdictions, onProgress, cancelToken }) {
  const succeeded = [];
  const failed = [];
  const total = jurisdictions.length;
  for (let i = 0; i < total; i++) {
    if (cancelToken?.cancelled) break;
    const jur = jurisdictions[i];
    try { onProgress?.({ index: i, total, jurisdiction: jur, phase: 'start' }); } catch {}
    const draft = await draftWithAI({ species, jurisdiction: jur });
    if (!draft.ok) {
      failed.push({ jurisdictionId: jur.id, error: draft.error || 'draft failed' });
      try { onProgress?.({ index: i, total, jurisdiction: jur, phase: 'fail', error: draft.error }); } catch {}
    } else {
      // Fetch any existing row so we don't clobber a verified status
      // — but the AI's numbers still land as an updated draft so admin
      // can compare before re-verifying.
      const c = client();
      let existingStatus = 'draft';
      let existingSourceUrl = '';
      try {
        const { data: cur } = await c.from('regulations')
          .select('status, source_url')
          .eq('species_id', species.id)
          .eq('jurisdiction_id', jur.id)
          .maybeSingle();
        if (cur) { existingStatus = cur.status; existingSourceUrl = cur.source_url || ''; }
      } catch {}
      const payload = {
        species_id: species.id,
        jurisdiction_id: jur.id,
        season_text: draft.draft.seasonText,
        min_size_in: draft.draft.minSizeIn,
        max_size_in: draft.draft.maxSizeIn,
        bag_limit:   draft.draft.bagLimit,
        boat_limit:  draft.draft.boatLimit,
        notes:       draft.draft.notes,
        source_note: draft.draft.sourceNote,
        // Preserve verified status if the row is already verified —
        // cascade shouldn't silently unverify existing compliance
        // work. Otherwise land as draft.
        status:      existingStatus === 'verified' ? 'verified' : 'draft',
        drafted_by:  'ai',
        source_url:  existingSourceUrl || '',
      };
      const up = await adminUpsertRegulation(payload);
      if (!up.ok) {
        failed.push({ jurisdictionId: jur.id, error: up.error });
        try { onProgress?.({ index: i, total, jurisdiction: jur, phase: 'fail', error: up.error }); } catch {}
      } else {
        succeeded.push(jur.id);
        try { onProgress?.({ index: i, total, jurisdiction: jur, phase: 'ok' }); } catch {}
      }
    }
    // 500ms gap between jurisdictions — enough to spread rate-limit
    // hits and give the cancel checker a chance without dragging
    // out the cascade meaningfully (6 juris × 10s > any 500ms noise).
    if (i < total - 1) await new Promise(res => setTimeout(res, 500));
  }
  return {
    ok: failed.length === 0,
    succeeded,
    failed,
    cancelled: !!cancelToken?.cancelled,
  };
}

/* Admin preference — auto-draft regs on species Save. Kept in
   localStorage since the admin console runs in a single browser
   typically; if cross-device sync is ever needed this can move to
   user_state via USER_STATE_KEYS. */
const AUTO_DRAFT_KEY = 'kyc_admin_auto_draft_regs_v1';
export function getAutoDraftRegsPref() {
  try { return localStorage.getItem(AUTO_DRAFT_KEY) === '1'; }
  catch { return false; }
}
export function setAutoDraftRegsPref(v) {
  try { localStorage.setItem(AUTO_DRAFT_KEY, v ? '1' : '0'); }
  catch {}
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
