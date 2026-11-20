/* Species Suggestions — user-submitted custom species that arrive
   with a client-generated id (custom_XXXX) and are usable in the
   Log-a-Catch flow immediately. Admin approves via the Species
   admin sub-tab; on approval the real species overlay lands via
   species-store.upsertSpecies() and the mobile app's next refresh
   picks it up. Local catches referencing custom_XXXX are remapped
   to the approved species id on sync.

   Offline-first: submit is a fire-and-forget upsert; local state
   is the source of truth for immediate use. Suggestion status is
   pulled on cloudsync so users see rejection reasons + approvals
   catch up to their devices.

   Public API:
     - submitSuggestion({...})   — user submits a suggestion
     - listMySuggestions()       — user reads their own suggestions
     - listSuggestions({status?})— admin reads all (RLS-gated)
     - approveSuggestion(id, patch) — admin approves + upserts species
     - rejectSuggestion(id, reason) — admin rejects
     - mergeSuggestion(id, existingId) — admin merges into existing species */

import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';
import { upsertSpecies } from './species-store.js';

const TABLE = 'species_suggestions';

/* Generate a local client-side species id. Not cryptographically
   important — just needs to be unique per-user long enough to not
   collide with anything in the bundled SPECIES set. */
export function newClientSpeciesId() {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `custom_${rand}`;
}

/* User → submit. Fire-and-forget: caller should NOT await this to
   render the custom species locally. Best-effort — if offline the
   insert will fail and the caller retries from state on next boot. */
export async function submitSuggestion({
  clientSpeciesId,
  commonName,
  scientificName,
  altNames,
  notes,
  photoStoragePath,
}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  const userId = sess?.user?.id || null;
  if (!userId) return { ok: false, error: 'no session' };
  if (!clientSpeciesId || !commonName?.trim()) {
    return { ok: false, error: 'missing required fields' };
  }
  const row = {
    user_id: userId,
    client_species_id: clientSpeciesId,
    common_name: commonName.trim(),
    scientific_name: scientificName?.trim() || null,
    alt_names: altNames?.trim() || null,
    notes: notes?.trim() || null,
    photo_storage_path: photoStoragePath || null,
    status: 'pending',
  };
  const { data, error } = await c.from(TABLE)
    .upsert(row, { onConflict: 'user_id,client_species_id' })
    .select('id, status, approved_species_id, rejection_reason')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data };
}

/* User → read own. Used by cloudsync to update local customSpecies
   entries with status + approved_species_id changes. */
export async function listMySuggestions() {
  const c = client();
  if (!c) return { ok: false, rows: [] };
  const sess = getLastSession();
  const userId = sess?.user?.id || null;
  if (!userId) return { ok: true, rows: [] };
  const { data, error } = await c.from(TABLE)
    .select('id, client_species_id, common_name, scientific_name, status, approved_species_id, rejection_reason, submitted_at, reviewed_at')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false });
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/* Admin → read all. RLS-gated. */
export async function listSuggestions({ status = null, limit = 200 } = {}) {
  const c = client();
  if (!c) return { ok: false, rows: [] };
  let q = c.from(TABLE)
    .select('id, user_id, client_species_id, common_name, scientific_name, alt_names, notes, photo_storage_path, status, approved_species_id, rejection_reason, submitted_at, reviewed_by, reviewed_at')
    .order('submitted_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/* Admin → approve. Upserts the real species overlay via species-store
   AND flips the suggestion row to status='approved' with the real
   species id in approved_species_id so client sync can remap catches. */
export async function approveSuggestion(id, patch = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  const reviewerEmail = sess?.user?.email || null;

  // Load the suggestion to compute defaults for the new species.
  const { data: row, error: loadErr } = await c.from(TABLE)
    .select('id, common_name, scientific_name, alt_names, notes')
    .eq('id', id).maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row)   return { ok: false, error: 'suggestion not found' };

  // Species id — slug of the accepted common name.
  const commonName = (patch.commonName ?? row.common_name).trim();
  const scientific = (patch.scientificName ?? row.scientific_name ?? '').trim();
  const altNamesText = (patch.altNames ?? row.alt_names ?? '').trim();
  const altNames = altNamesText
    ? altNamesText.split(',').map(a => a.trim()).filter(Boolean)
    : [];
  const newSpeciesId = slugifySpeciesId(commonName);

  // Ride the same species overlay path admin uses for edits.
  const speciesShape = {
    id: newSpeciesId,
    commonName,
    scientific: scientific || undefined,
    altNames: altNames.length ? altNames : undefined,
    category: patch.category || 'reef',
    active: true,
  };
  const up = await upsertSpecies(speciesShape);
  if (!up.ok) return { ok: false, error: `species upsert: ${up.error}` };

  const { error: updErr } = await c.from(TABLE)
    .update({
      status: 'approved',
      approved_species_id: newSpeciesId,
      reviewed_by: reviewerEmail,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true, approvedSpeciesId: newSpeciesId };
}

/* Admin → reject with a reason. Reason is surfaced on the user's
   device via the sync-back of suggestion rows. */
export async function rejectSuggestion(id, reason) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  const reviewerEmail = sess?.user?.email || null;
  const { error } = await c.from(TABLE)
    .update({
      status: 'rejected',
      rejection_reason: reason || 'other',
      reviewed_by: reviewerEmail,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* Admin → merge into an existing species. Adds the suggestion's
   common_name (if new) to the existing species' altNames so future
   searches find it. Also stamps approved_species_id=<existing> so
   the client remaps catches the same way as an approval. */
export async function mergeSuggestion(id, existingSpeciesId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const sess = getLastSession();
  const reviewerEmail = sess?.user?.email || null;

  // Merging just remaps catches to the existing species — no schema
  // change beyond stamping the suggestion row. Admin can separately
  // edit the existing species via the Species admin tab if they want
  // the alt name saved there permanently.
  const { error } = await c.from(TABLE)
    .update({
      status: 'merged',
      approved_species_id: existingSpeciesId,
      reviewed_by: reviewerEmail,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* Boot / cloudsync helper — reconciles local state.customSpecies +
   state.catchLog with the latest server-side suggestion statuses.

   Returns { customSpecies, catchLog, changed } — the updated arrays
   plus a flag the caller uses to decide whether to `update()` state.
   Doesn't mutate the passed-in arrays.

   Behavior:
     - Rows still pending: leave the local entry as-is (status may
       remain 'pending' — that's fine, mobile UX shows the pill).
     - Rows approved / merged: stamp status + approvedSpeciesId
       into the local entry, AND remap every catchLog row whose
       speciesId equals the client id → approvedSpeciesId.
     - Rows rejected: stamp status + rejectionReason. Local entries
       stay so the mobile app can render a "why not" hint. Catches
       stay on the custom id (still usable locally; won't sync into
       the training set for that species). */
export async function reconcileSuggestions({ customSpecies = [], catchLog = [] } = {}) {
  const res = await listMySuggestions();
  if (!res.ok) return { customSpecies, catchLog, changed: false };

  const byClientId = new Map();
  for (const r of res.rows) {
    if (r.client_species_id) byClientId.set(r.client_species_id, r);
  }
  if (byClientId.size === 0) return { customSpecies, catchLog, changed: false };

  let changed = false;
  const nextCustom = customSpecies.map((entry) => {
    if (!entry?.id) return entry;
    const server = byClientId.get(entry.id);
    if (!server) return entry;
    const nextStatus = server.status;
    const nextApproved = server.approved_species_id || null;
    const nextReason   = server.rejection_reason  || null;
    if (
      entry.status === nextStatus &&
      (entry.approvedSpeciesId || null) === nextApproved &&
      (entry.rejectionReason  || null) === nextReason
    ) return entry;
    changed = true;
    return {
      ...entry,
      status: nextStatus,
      approvedSpeciesId: nextApproved,
      rejectionReason:   nextReason,
    };
  });

  // Remap catch rows whose speciesId matches any approved/merged
  // custom id → the real approved id.
  const remap = new Map();
  for (const server of byClientId.values()) {
    if ((server.status === 'approved' || server.status === 'merged') && server.approved_species_id) {
      remap.set(server.client_species_id, server.approved_species_id);
    }
  }
  let nextCatchLog = catchLog;
  if (remap.size > 0) {
    let anyRemapped = false;
    nextCatchLog = catchLog.map((c) => {
      const to = remap.get(c.speciesId);
      if (!to) return c;
      anyRemapped = true;
      return { ...c, speciesId: to };
    });
    if (anyRemapped) changed = true;
  }

  return { customSpecies: nextCustom, catchLog: nextCatchLog, changed };
}

function slugifySpeciesId(name) {
  const base = (name || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!base) return `species_${crypto.randomUUID().slice(0, 8)}`;
  // Suffix with a short random tail to avoid slug collisions if a
  // suggestion happens to slug to something already in SPECIES.
  return `${base}_${crypto.randomUUID().slice(0, 6)}`;
}
