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
    .select('id, version_name, model_file_path, labels_json, metrics_json, imported_at')
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
/* A publish moves megabytes over whatever signal the admin is on. Every
   step gets a ceiling so a stall becomes a message rather than a button
   that sits there doing nothing — which is exactly how this looked from
   an iPad on cellular. */
const STEP_TIMEOUT_MS = 90_000;
function withTimeout(promise, label, ms = STEP_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

export async function publishPromotedModel(onStep = () => {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const prod = await getProductionModel();
  if (!prod) return { ok: false, error: 'no promoted model' };

  // Pull the .tflite bytes from the private admin bucket.
  onStep('Fetching the model…');
  let modelBlob, dlErr;
  try {
    ({ data: modelBlob, error: dlErr } = await withTimeout(
      c.storage.from('model-artifacts').download(prod.model_file_path), 'fetching the model'));
  } catch (e) { return { ok: false, error: e.message }; }
  if (dlErr) return { ok: false, error: `download: ${dlErr.message}` };

  /* Is what came back actually a model?
   *
   * A missing object does not throw here — Storage hands back a small
   * JSON error body, and uploading THAT as fish_id_model.tflite is how
   * the public bucket ended up serving 88 bytes of
   * {"error":"not_found"} while this function reported success. */
  const modelBytes = await modelBlob.arrayBuffer();
  const shapeProblem = looksLikeTflite(modelBytes);
  if (shapeProblem) {
    return { ok: false, error: `the promoted artifact is not a model (${shapeProblem}) — ` +
      `nothing published. Re-import ${prod.version_name}.` };
  }

  // Overwrite the public copy.
  onStep(`Uploading ${(modelBytes.byteLength / 1048576).toFixed(1)} MB…`);
  let upModel;
  try {
    upModel = await withTimeout(c.storage.from(PUBLIC_BUCKET)
      .upload(PUBLIC_MODEL_KEY, modelBlob, {
        contentType: 'application/octet-stream',
        cacheControl: 'no-cache',
        upsert: true,
      }), 'uploading the model');
  } catch (e) { return { ok: false, error: e.message }; }
  if (upModel.error) return { ok: false, error: `upload model: ${upModel.error.message}` };

  /* Read it back before the manifest goes anywhere near the bucket.
   *
   * An upload call that does not error is not the same as an object that
   * exists. The manifest is what tells every phone a new version is
   * available, so it must be the LAST thing written and must only be
   * written once the model it describes is confirmed downloadable. Then
   * a half-finished publish leaves the old manifest beside the new
   * model, and phones simply keep using the version they have — instead
   * of fetching a model whose species list they do not have. */
  onStep('Checking it landed…');
  let check;
  try { check = await withTimeout(verifyPublishedModel(c, modelBytes.byteLength), 'checking the model', 30_000); }
  catch (e) { return { ok: false, error: e.message }; }
  if (check) {
    return { ok: false, error: `model did not publish (${check}) — manifest left untouched, ` +
      'so the app keeps serving the previous version rather than a mismatched one.' };
  }

  const manifest = {
    version_name:    prod.version_name,
    input_size:      prod.labels_json?.input_size      ?? 224,
    // float16/float32 models take a float32 input tensor; legacy INT8
    // models took uint8. Default to uint8 so older published models keep
    // their existing behavior.
    input_dtype:     prod.labels_json?.input_dtype      ?? 'uint8',
    labels:          prod.labels_json?.labels          || [],
    excluded_species:prod.labels_json?.excluded_species || [],
    // Confidence bands — the ONE authoritative config. These four keys
    // are read at runtime by identifyPhoto.js getBands(); its in-code
    // BAND_FALLBACK holds the SAME four values, so manifest and runtime
    // agree by construction. The defaults deliberately preserve the
    // historical intended behaviour (medium floor 0.40) rather than the
    // stale 0.6 that shipped before — retuning happens AFTER we have
    // held-out test metrics, not here. A trained bundle may override any
    // key via labels_json.
    min_confidence:  prod.labels_json?.min_confidence  ?? 0.40,
    high_confidence: prod.labels_json?.high_confidence ?? 0.85,
    high_margin:     prod.labels_json?.high_margin     ?? 0.20,
    lookalike_floor: prod.labels_json?.lookalike_floor ?? 0.25,
    published_at:    new Date().toISOString(),
  };
  const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  onStep('Writing the species list…');
  let upMan;
  try {
    upMan = await withTimeout(c.storage.from(PUBLIC_BUCKET)
      .upload(PUBLIC_MANIFEST_KEY, manifestBlob, {
        contentType: 'application/json',
        cacheControl: 'no-cache',
        upsert: true,
      }), 'writing the species list');
  } catch (e) { return { ok: false, error: e.message }; }
  if (upMan.error) return { ok: false, error: `upload manifest: ${upMan.error.message}` };

  // And read the manifest back too, for the same reason.
  const manCheck = await verifyPublishedManifest(c, prod.version_name, manifest.labels.length);
  if (manCheck) return { ok: false, error: `manifest did not publish (${manCheck})` };

  return { ok: true, version: prod.version_name, labels: manifest.labels.length,
           bytes: modelBytes.byteLength };
}

/* A .tflite starts with a 4-byte length prefix then the ASCII tag TFL3.
   Returns a reason string when the bytes are not a model, or null. */
function looksLikeTflite(buf) {
  if (!buf || buf.byteLength < 1024) {
    return `${buf ? buf.byteLength : 0} bytes — far too small`;
  }
  const v = new Uint8Array(buf);
  const magic = String.fromCharCode(v[4], v[5], v[6], v[7]);
  if (magic !== 'TFL3') return `bad flatbuffer tag ${JSON.stringify(magic)}`;
  return null;
}

/* Read back WITHOUT downloading the model again.
 *
 * The first version of this verified by downloading the published copy
 * in full. On a phone that turned one publish into ~27 MB of traffic —
 * download the artifact, upload it, download it again — with no timeout
 * and no progress, so the button simply sat there looking dead.
 *
 * list() returns the stored size from metadata, and a 16-byte ranged
 * request is enough to see the TFL3 tag. Together they answer the only
 * question that matters — is a whole, real model sitting at that path —
 * for a few hundred bytes. */
async function verifyPublishedModel(c, expectedBytes) {
  const { data: entries, error } = await c.storage.from(PUBLIC_BUCKET)
    .list('', { search: PUBLIC_MODEL_KEY, limit: 100 });
  if (error) return `cannot list the bucket: ${error.message}`;
  const entry = (entries || []).find(e => e.name === PUBLIC_MODEL_KEY);
  if (!entry) return 'it is not in the bucket';
  const size = entry.metadata?.size;
  if (Number.isFinite(size) && size !== expectedBytes) {
    return `published ${size} bytes, expected ${expectedBytes}`;
  }

  const { data: urlData } = c.storage.from(PUBLIC_BUCKET).getPublicUrl(PUBLIC_MODEL_KEY);
  if (urlData?.publicUrl) {
    try {
      const r = await fetch(`${urlData.publicUrl}?v=${Date.now()}`, { headers: { Range: 'bytes=0-15' } });
      if (!r.ok) return `it is not fetchable: HTTP ${r.status}`;
      const head = new Uint8Array(await r.arrayBuffer());
      if (head.length >= 8) {
        const magic = String.fromCharCode(head[4], head[5], head[6], head[7]);
        if (magic !== 'TFL3') return `what published is not a model (tag ${JSON.stringify(magic)})`;
      }
    } catch (e) {
      return `it is not fetchable: ${e.message}`;
    }
  }
  return null;
}

async function verifyPublishedManifest(c, version, labelCount) {
  const { data, error } = await c.storage.from(PUBLIC_BUCKET).download(PUBLIC_MANIFEST_KEY);
  if (error) return `cannot read it back: ${error.message}`;
  let m;
  try { m = JSON.parse(await data.text()); } catch (e) { return `unreadable: ${e.message}`; }
  if (m.version_name !== version) {
    return `published version ${m.version_name}, expected ${version}`;
  }
  if (!Array.isArray(m.labels) || m.labels.length !== labelCount) {
    return `published ${m.labels?.length} labels, expected ${labelCount}`;
  }
  return null;
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
