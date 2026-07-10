/* Training-images store — thin CRUD wrapper over the Supabase
   `training_images` table + `training-photos` storage bucket.

   Admin-only. RLS restricts every read/write to the admin email,
   so callers don't need to gate — the network layer refuses.

   NEVER referenced by mobile-app code paths — this module lives
   in the admin bundle only. */
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';

const BUCKET = 'training-photos';

/* Upload one file to storage, then insert a training_images row.
   Storage path: {species_id}/{uuid}.jpg. UUID is generated locally
   so we can return the storage path before Supabase confirms.
   Returns { ok, id, storagePath, error }. */
export async function uploadTrainingImage(file, speciesId) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!file || !speciesId) return { ok: false, error: 'missing file or species' };
  const sess = getLastSession();
  const email = sess?.user?.email || null;

  const id = crypto.randomUUID();
  const ext = (file.name?.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
  const storagePath = `${speciesId}/${id}.${ext}`;

  const up = await c.storage.from(BUCKET).upload(storagePath, file, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };

  const { data, error } = await c.from('training_images').insert({
    id,
    species_id: speciesId,
    storage_path: storagePath,
    source: 'owner_upload',
    status: 'pending',
    uploaded_by: email,
  }).select('id').single();
  if (error) {
    // Rollback storage — no orphan bytes.
    await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data.id, storagePath };
}

/* List training images, optionally filtered by species + status. */
export async function listTrainingImages({ speciesId = null, status = null, limit = 500 } = {}) {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  let q = c.from('training_images')
    .select('id, species_id, storage_path, source, status, rejection_reason, original_species_id, crop_bbox, uploaded_at, uploaded_by, reviewed_at, reviewed_by')
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (speciesId) q = q.eq('species_id', speciesId);
  if (status)    q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/* Approve a batch of ids. Sets status='verified', stamps reviewer. */
export async function approve(ids) {
  return _reviewUpdate(ids, { status: 'verified', rejection_reason: null });
}

/* Reject a batch with a reason. */
export async function reject(ids, reason) {
  return _reviewUpdate(ids, { status: 'rejected', rejection_reason: reason });
}

/* Correct a batch: move to a different species_id, preserve the
   original in original_species_id so we can audit later. */
export async function correctSpecies(ids, newSpeciesId, currentSpeciesId) {
  return _reviewUpdate(ids, {
    status: 'corrected',
    species_id: newSpeciesId,
    original_species_id: currentSpeciesId,
    rejection_reason: null,
  });
}

async function _reviewUpdate(ids, patch) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!Array.isArray(ids) || ids.length === 0) return { ok: false, error: 'no ids' };
  const sess = getLastSession();
  const reviewed_by = sess?.user?.email || null;
  const now = new Date().toISOString();
  const { error } = await c.from('training_images')
    .update({ ...patch, reviewed_at: now, reviewed_by })
    .in('id', ids);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* Delete a training image (storage + row). Used to purge duplicates
   entirely rather than mark rejected — keep for now under a distinct
   entry point in case we want to expose "hard delete" separately. */
export async function deleteTrainingImage(id, storagePath) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('training_images').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  if (storagePath) await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  return { ok: true };
}

/* Fast per-species / status counts for the review dashboard.
   Returns { [speciesId]: { pending, verified, rejected, corrected, total } }. */
export async function countsBySpecies() {
  const c = client();
  if (!c) return { ok: false, counts: {}, error: 'not-configured' };
  const { data, error } = await c
    .from('training_images')
    .select('species_id, status')
    .limit(50000);
  if (error) return { ok: false, counts: {}, error: error.message };
  const counts = {};
  for (const r of data || []) {
    const sid = r.species_id;
    counts[sid] ||= { pending: 0, verified: 0, rejected: 0, corrected: 0, total: 0 };
    counts[sid][r.status] += 1;
    counts[sid].total += 1;
  }
  return { ok: true, counts };
}

/* Signed URL for private-bucket display in the admin UI. Short TTL —
   this UI is transient; the URL only needs to survive one review pass. */
export async function signedUrl(storagePath, ttlSeconds = 3600) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) return null;
  return data?.signedUrl || null;
}
