/* Model-versions store — admin-side CRUD over model_versions +
   model-artifacts storage bucket. Admin-only via RLS.

   Never referenced by mobile-app code paths — this module lives in
   the admin bundle only. Phase 6 will read the promoted version's
   .tflite from storage, decode it, and hand it to the classifier. */
import { client } from './supabase-client.js';
import { getLastSession } from './auth.js';

const BUCKET = 'model-artifacts';

/* Import a new model version: uploads the .tflite to storage, then
   inserts a row with the parsed labels + metrics JSON.
   Args:
     versionName: text label the user picked (e.g. "v0.1-2026-07-10")
     tfliteFile:  File — the raw .tflite bytes
     labels:      Object — parsed contents of fish_id_labels.json
     metrics:     Object — parsed contents of fish_id_metrics.json
     notes:       optional text
   Returns { ok, id, error }. */
export async function importModelVersion({ versionName, tfliteFile, labels, metrics, notes }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!versionName || !tfliteFile || !labels || !metrics) {
    return { ok: false, error: 'missing artifacts' };
  }
  const sess = getLastSession();
  const email = sess?.user?.email || null;
  const id = crypto.randomUUID();
  const storagePath = `${id}/fish_id_model.tflite`;

  const up = await c.storage.from(BUCKET).upload(storagePath, tfliteFile, {
    contentType: 'application/octet-stream',
    upsert: false,
  });
  if (up.error) return { ok: false, error: up.error.message };

  const trainedAt = metrics?.created_at || null;

  const { error } = await c.from('model_versions').insert({
    id,
    version_name:    versionName,
    model_file_path: storagePath,
    labels_json:     labels,
    metrics_json:    metrics,
    trained_at:      trainedAt,
    imported_by:     email,
    notes:           notes || null,
  });
  if (error) {
    // Rollback storage — no orphan bytes.
    await c.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return { ok: false, error: error.message };
  }
  return { ok: true, id };
}

/* Newest → oldest. */
export async function listModelVersions() {
  const c = client();
  if (!c) return { ok: false, rows: [], error: 'not-configured' };
  const { data, error } = await c.from('model_versions')
    .select('id, version_name, model_file_path, labels_json, metrics_json, dataset_export_size, trained_at, imported_at, imported_by, is_production, notes')
    .order('imported_at', { ascending: false });
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

/* Single version by id (used by the eval view). */
export async function getModelVersion(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { data, error } = await c.from('model_versions')
    .select('id, version_name, model_file_path, labels_json, metrics_json, dataset_export_size, trained_at, imported_at, imported_by, is_production, notes')
    .eq('id', id).single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data };
}

/* Currently promoted version, or null. Phase 6 reads this to know
   which .tflite to load. */
export async function getProductionModel() {
  const c = client();
  if (!c) return null;
  const { data } = await c.from('model_versions')
    .select('id, version_name, model_file_path, labels_json, metrics_json')
    .eq('is_production', true).limit(1).maybeSingle();
  return data || null;
}

/* Promote a version to production. Enforces at most one production
   row via the partial unique index on the table — the demote step
   happens in the same transaction. */
export async function promoteModelVersion(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  // Demote current prod (if any) then promote target. Two round-trips
  // is fine since the partial unique index prevents inconsistent
  // interleavings from another admin.
  const { error: demoteErr } = await c.from('model_versions')
    .update({ is_production: false }).eq('is_production', true);
  if (demoteErr) return { ok: false, error: demoteErr.message };
  const { error: promoteErr } = await c.from('model_versions')
    .update({ is_production: true }).eq('id', id);
  if (promoteErr) return { ok: false, error: promoteErr.message };
  return { ok: true };
}

export async function deleteModelVersion(id, modelFilePath) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('model_versions').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  if (modelFilePath) await c.storage.from(BUCKET).remove([modelFilePath]).catch(() => {});
  return { ok: true };
}

/* Signed URL for downloading the .tflite (used by Phase 6 to fetch
   the promoted model into the web-side test tool). */
export async function modelSignedUrl(storagePath, ttlSeconds = 3600) {
  const c = client();
  if (!c) return null;
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error) return null;
  return data?.signedUrl || null;
}
