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
   row via the partial unique index on the table.

   Two-step (demote-then-promote) with an explicit rollback on the
   promote leg so we never end up with ZERO production rows if the
   second UPDATE fails after the first succeeded. The demote+promote
   are still two round-trips (not one Postgres RPC), but the rollback
   makes the failure mode consistent instead of silently broken.

   Also publishes the promoted model to the models-published public
   bucket the mobile app reads. Publish failures are surfaced as
   { ok:true, publishWarning } so the caller can render a distinct
   warning banner — a stale public bucket is a broken app on device
   even though the DB looks fine. */
export async function promoteModelVersion(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };

  // Capture the previous production row's id BEFORE we demote it, so
  // if the promote leg fails we can restore instead of leaving zero
  // prod rows behind.
  const { data: prevProd, error: prevErr } = await c.from('model_versions')
    .select('id').eq('is_production', true).maybeSingle();
  if (prevErr) return { ok: false, error: `prev prod lookup: ${prevErr.message}` };
  const previousProdId = prevProd?.id || null;

  // If the caller is trying to re-promote the current prod, short-
  // circuit — nothing to do at the DB layer, but still publish so
  // the public bucket reflects the current row's bytes.
  if (previousProdId && previousProdId === id) {
    const pub = await publishPromotedModel();
    if (!pub.ok) return { ok: true, publishWarning: pub.error };
    return { ok: true };
  }

  const { error: demoteErr } = await c.from('model_versions')
    .update({ is_production: false }).eq('is_production', true);
  if (demoteErr) return { ok: false, error: `demote: ${demoteErr.message}` };

  const { error: promoteErr } = await c.from('model_versions')
    .update({ is_production: true }).eq('id', id);
  if (promoteErr) {
    // Rollback: re-promote the previous production row so we don't
    // leave the table with zero prod rows. Best-effort — surface the
    // rollback outcome in the returned error message either way.
    let rolledBack = false;
    if (previousProdId) {
      const { error: rbErr } = await c.from('model_versions')
        .update({ is_production: true }).eq('id', previousProdId);
      rolledBack = !rbErr;
    }
    return {
      ok: false,
      error: `promote: ${promoteErr.message}. ` + (previousProdId
        ? (rolledBack
            ? 'Previous production row restored.'
            : 'ROLLBACK FAILED — no production row is set. Manually promote via SQL.')
        : 'No previous production row existed; state is now "no prod" (as before this attempt).'),
    };
  }

  // Publish to the public bucket the mobile app reads.
  const pub = await publishPromotedModel();
  if (!pub.ok) return { ok: true, publishWarning: pub.error };
  return { ok: true };
}

const PUBLIC_BUCKET = 'models-published';
const PUBLIC_MODEL_KEY    = 'current.tflite';
const PUBLIC_MANIFEST_KEY = 'current.json';

/* Copy the currently-promoted model into the public bucket and write
   an accompanying manifest.json the mobile app polls on launch. The
   manifest is small (~2KB) so the version-check round trip is cheap
   even on cellular. Only the tflite bytes get re-downloaded when the
   version_name actually changes. */
export async function publishPromotedModel() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const prod = await getProductionModel();
  if (!prod) return { ok: false, error: 'no promoted model' };

  // Pull the .tflite bytes from the private admin bucket.
  const { data: modelBlob, error: dlErr } = await c.storage
    .from('model-artifacts').download(prod.model_file_path);
  if (dlErr) return { ok: false, error: `download: ${dlErr.message}` };

  // Overwrite the public copy.
  const upModel = await c.storage.from(PUBLIC_BUCKET)
    .upload(PUBLIC_MODEL_KEY, modelBlob, {
      contentType: 'application/octet-stream',
      cacheControl: 'no-cache',
      upsert: true,
    });
  if (upModel.error) return { ok: false, error: `upload model: ${upModel.error.message}` };

  const manifest = {
    version_name:    prod.version_name,
    input_size:      prod.labels_json?.input_size      ?? 224,
    labels:          prod.labels_json?.labels          || [],
    excluded_species:prod.labels_json?.excluded_species || [],
    min_confidence:  prod.labels_json?.min_confidence  ?? 0.6,
    high_confidence: prod.labels_json?.high_confidence ?? 0.85,
    published_at:    new Date().toISOString(),
  };
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  const upMan = await c.storage.from(PUBLIC_BUCKET)
    .upload(PUBLIC_MANIFEST_KEY, manifestBlob, {
      contentType: 'application/json',
      cacheControl: 'no-cache',
      upsert: true,
    });
  if (upMan.error) return { ok: false, error: `upload manifest: ${upMan.error.message}` };

  return { ok: true };
}

/* Public URLs the mobile app uses. Return the string so callers can
   embed it in build-time constants if we ever want to skip the
   getPublicUrl round-trip on boot. */
export function publishedModelUrl() {
  const c = client();
  if (!c) return null;
  const { data } = c.storage.from(PUBLIC_BUCKET).getPublicUrl(PUBLIC_MODEL_KEY);
  return data?.publicUrl || null;
}

export function publishedManifestUrl() {
  const c = client();
  if (!c) return null;
  const { data } = c.storage.from(PUBLIC_BUCKET).getPublicUrl(PUBLIC_MANIFEST_KEY);
  return data?.publicUrl || null;
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
