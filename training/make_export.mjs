/* Headless training export — no browser, no admin page.
 *
 * Does exactly what the admin "Training → Export" does, from the CLI:
 *   1. fetch verified training_images
 *   2. drop species below the 45-image floor (same as the admin)
 *   3. assign train/val/test from training/split_manifest_v1.json
 *      (fail-closed — identical logic to src/training-split.js)
 *   4. mint 24h signed URLs for every photo
 *   5. upload the v2 manifest to the training-exports bucket
 *   6. print the REELINTEL_EXPORT_URL + a ready Colab cell
 *
 * Auth: the service_role key, read the same way make_split.py gets it —
 * `supabase projects api-keys` (you're already logged into the CLI).
 *
 *   cd ~/know-your-catch/training
 *   node make_export.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { applySplitManifest, describeSplitFailure } from '../src/training-split.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'hfptpsmdfemduhkueyoz';
const SUPABASE_URL = process.env.SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const PHOTO_BUCKET = 'training-photos';
const EXPORT_BUCKET = 'training-exports';
const MIN_TRAIN_THRESHOLD = 45;   // src/training-store.js — species below this are excluded

function die(msg) { console.error(`\n[make_export] FATAL: ${msg}`); process.exit(1); }

function serviceKey() {
  // Prefer an explicit env var; else ask the Supabase CLI (same as make_split.py).
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
  try {
    const out = execFileSync('supabase',
      ['projects', 'api-keys', '--project-ref', PROJECT_REF, '--output', 'json'],
      { encoding: 'utf8' });
    const row = JSON.parse(out).find(k => k.name === 'service_role');
    if (row?.api_key) return row.api_key;
    die('service_role key not found in `supabase projects api-keys` output.');
  } catch (e) {
    die(`could not get the service key (set SUPABASE_SERVICE_ROLE_KEY, or run \`supabase login\`): ${e.message}`);
  }
}

async function main() {
  const sb = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false } });

  // 1) Verified rows (paginated).
  console.log('[make_export] fetching verified training_images…');
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('training_images')
      .select('id, species_id, storage_path, crop_bbox')
      .eq('status', 'verified')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) die(`training_images query: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`[make_export]   ${rows.length} verified rows`);

  // 2) Coverage filter + build the image list with tidy synthetic filenames.
  const bySpecies = new Map();
  for (const r of rows) {
    if (!bySpecies.has(r.species_id)) bySpecies.set(r.species_id, []);
    bySpecies.get(r.species_id).push(r);
  }
  const species = [], excluded = [], images = [], verifiedPerSpecies = {};
  for (const sid of [...bySpecies.keys()].sort()) {
    const list = bySpecies.get(sid);
    // Synthetic, non-trainable buckets ('_unassigned' etc.) carry no
    // species — never export them, regardless of count.
    if (sid.startsWith('_')) { excluded.push(sid); continue; }
    if (list.length < MIN_TRAIN_THRESHOLD) { excluded.push(sid); continue; }
    species.push(sid);
    verifiedPerSpecies[sid] = list.length;
    list.forEach((row, i) => {
      const ext = (row.storage_path.split('.').pop() || 'jpg');
      images.push({
        id: row.id, species_id: sid, storage_path: row.storage_path,
        crop_bbox: row.crop_bbox, filename: `${sid}_${String(i).padStart(4, '0')}.${ext}`,
      });
    });
  }
  console.log(`[make_export]   ${species.length} species kept, ${excluded.length} excluded (<${MIN_TRAIN_THRESHOLD})`);

  // 3) Apply the authoritative split (fail-closed).
  const manifest = JSON.parse(readFileSync(path.join(HERE, 'split_manifest_v1.json'), 'utf8'));
  const res = applySplitManifest(images, manifest);
  if (!res.ok) die(describeSplitFailure(res));
  console.log(`[make_export]   split: train ${res.counts.train} / val ${res.counts.val} / test ${res.counts.test} — 0 group overlap`);

  // 4) Signed URLs for every photo (chunked).
  console.log('[make_export] minting signed photo URLs…');
  const paths = res.plan.map(p => p.storage_path);
  const urlByPath = new Map();
  for (let i = 0; i < paths.length; i += 500) {
    const slice = paths.slice(i, i + 500);
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(slice, 86400);
    if (error) die(`createSignedUrls: ${error.message}`);
    data.forEach((d, j) => { if (d?.signedUrl) urlByPath.set(slice[j], d.signedUrl); });
    process.stdout.write(`\r  ${Math.min(i + 500, paths.length)}/${paths.length}`);
  }
  process.stdout.write('\n');
  const missingUrls = paths.filter(p => !urlByPath.get(p)).length;
  if (missingUrls) die(`${missingUrls} photos returned no signed URL (orphaned storage rows?).`);

  // 5) Build the v2 manifest colab_run.py consumes.
  const counts = {};
  for (const sid of species) counts[sid] = { verified: verifiedPerSpecies[sid], train: 0, val: 0, test: 0 };
  for (const p of res.plan) counts[p.species_id][p.split] += 1;

  const out = {
    version: 2,
    created_at: new Date().toISOString(),
    split_source: 'split_manifest_v1.json',
    split_manifest_version: manifest.version ?? null,
    split_seed: manifest.salt || 'split_manifest_v1',
    split_counts: res.counts,
    grouping: manifest.grouping || 'inat observation id where recoverable, else per-image singleton',
    species, excluded, counts,
    photos: res.plan.map(p => ({
      id: p.id,
      path: `${p.split}/${p.species_id}/${p.filename}`,
      species_id: p.species_id,
      split: p.split,
      crop_bbox: p.crop_bbox || null,
      storage_path: p.storage_path,
      url: urlByPath.get(p.storage_path),
    })),
  };

  // 6) Upload manifest + mint a download URL.
  const today = new Date().toISOString().slice(0, 10);
  const key = `${today}/${crypto.randomUUID()}.json`;
  console.log('[make_export] uploading manifest…');
  const up = await sb.storage.from(EXPORT_BUCKET)
    .upload(key, JSON.stringify(out), { contentType: 'application/json', upsert: false });
  if (up.error) die(`manifest upload: ${up.error.message}`);
  const signed = await sb.storage.from(EXPORT_BUCKET).createSignedUrl(key, 6 * 3600);
  if (signed.error) die(`manifest signed url: ${signed.error.message}`);
  const exportUrl = signed.data.signedUrl;

  const cell =
`import os, urllib.request
os.environ["REELINTEL_EXPORT_URL"] = ${JSON.stringify(exportUrl)}
urllib.request.urlretrieve(
  "https://raw.githubusercontent.com/robertboot/know-your-catch/claude/upload-app-assets-NUxRr/training/colab_run.py",
  "/content/colab_run.py")
exec(open("/content/colab_run.py").read())
`;
  const cellPath = path.join(HERE, 'colab_cell.py');
  writeFileSync(cellPath, cell);

  console.log('\n=================== EXPORT READY ===================');
  console.log(`photos: ${out.photos.length}  |  train ${res.counts.train} / val ${res.counts.val} / test ${res.counts.test}`);
  console.log(`manifest: ${EXPORT_BUCKET}/${key}`);
  console.log(`\nColab cell written to: ${cellPath}`);
  console.log('Copy it CLEANLY to your clipboard (avoids copy-paste corruption):');
  console.log('    cat training/colab_cell.py | pbcopy');
  console.log('then paste into a fresh GPU Colab cell (Runtime → T4) and run.');
  console.log('====================================================\n');
}

main().catch(e => die(e?.stack || e?.message || String(e)));
