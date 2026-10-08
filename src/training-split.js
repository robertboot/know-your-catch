/* Observation-aware split application — the ONE place the export learns
   which images go to train/val/test.

   Authority: training/split_manifest_v1.json, produced by
   training/make_split.py. It is keyed by training_images.id (make_split
   selects `id` straight from the DB and uses it verbatim — see
   make_split.py fetch_verified/assignments), and that id already IS the
   stableTrainingId for scraped rows (SHA1("{species_id}|{filename}")).
   So we match by row id and do NOT recompute or invent a second identity.

   Pure + dependency-free so it is unit-testable without Supabase or the
   network (see training/tests/test_split_export.mjs). planExport() in
   training-store.js fetches the manifest and calls applySplitManifest().

   FAIL CLOSED: any verified image absent from the manifest, carrying an
   unknown split, or a group that straddles splits makes ok:false — the
   caller must abort the export, never guess or default to train. */

export const VALID_SPLITS = ['train', 'val', 'test'];

/* The committed manifest, fetched at export time from GitHub raw — the
   SAME bytes colab_run.py downloads, so the browser export and the Colab
   run can never disagree about the split. Keep this branch in sync with
   colab_run.py's BRANCH constant. */
export const SPLIT_MANIFEST_BRANCH = 'claude/upload-app-assets-NUxRr';
export const SPLIT_MANIFEST_RAW_URL =
  `https://raw.githubusercontent.com/robertboot/know-your-catch/${SPLIT_MANIFEST_BRANCH}/training/split_manifest_v1.json`;

/**
 * Assign a split to every image from the authoritative manifest and
 * verify integrity on the ACTUAL exported set.
 *
 * @param {Array<{id:string, species_id:string, storage_path?:string, crop_bbox?:any, filename?:string}>} images
 * @param {{assignments:Object<string,string>, groups?:Object<string,string>}} manifest
 * @returns {{
 *   ok:boolean,
 *   plan:Array<object>,              // images + {split, group}
 *   counts:{train:number,val:number,test:number},
 *   missing:string[],                // ids not in manifest.assignments
 *   invalid:Array<{id:string,split:string}>,   // ids with a non train/val/test label
 *   groupOverlap:Array<{group:string,splits:string[]}>,
 *   splitsPresent:string[]
 * }}
 */
export function applySplitManifest(images, manifest) {
  const assignments = (manifest && manifest.assignments) || {};
  const groups = (manifest && manifest.groups) || {};
  const valid = new Set(VALID_SPLITS);

  const missing = [];
  const invalid = [];
  const plan = [];

  for (const img of images) {
    const split = assignments[img.id];
    if (split === undefined || split === null) { missing.push(img.id); continue; }
    if (!valid.has(split)) { invalid.push({ id: img.id, split }); continue; }
    // Fall back to a per-image singleton group only for bookkeeping in
    // the overlap check — the manifest already assigns singletons this
    // way, so a real value is expected for every mapped image.
    plan.push({ ...img, split, group: groups[img.id] || `self:${img.id}` });
  }

  // Group integrity on the exported subset: no observation group may
  // appear in more than one split.
  const groupToSplits = new Map();
  for (const p of plan) {
    let s = groupToSplits.get(p.group);
    if (!s) { s = new Set(); groupToSplits.set(p.group, s); }
    s.add(p.split);
  }
  const groupOverlap = [];
  for (const [group, splits] of groupToSplits) {
    if (splits.size > 1) groupOverlap.push({ group, splits: [...splits] });
  }

  const counts = { train: 0, val: 0, test: 0 };
  for (const p of plan) counts[p.split] += 1;
  const splitsPresent = VALID_SPLITS.filter((s) => counts[s] > 0);

  const ok =
    missing.length === 0 &&
    invalid.length === 0 &&
    groupOverlap.length === 0 &&
    splitsPresent.length === VALID_SPLITS.length;

  return { ok, plan, counts, missing, invalid, groupOverlap, splitsPresent };
}

/* Human-readable abort reason for a fail-closed export. */
export function describeSplitFailure(res) {
  const parts = [];
  if (res.missing.length) {
    parts.push(
      `${res.missing.length} verified image(s) are not in split_manifest_v1.json ` +
      `(first: ${res.missing.slice(0, 5).join(', ')}). Re-run training/make_split.py ` +
      `— it preserves existing assignments and only adds the new ones — then re-export.`
    );
  }
  if (res.invalid.length) {
    parts.push(`${res.invalid.length} image(s) carry a split that is not train/val/test.`);
  }
  if (res.groupOverlap.length) {
    parts.push(
      `${res.groupOverlap.length} observation group(s) span more than one split ` +
      `(first: ${res.groupOverlap[0].group} → ${res.groupOverlap[0].splits.join('/')}).`
    );
  }
  const need = VALID_SPLITS.filter((s) => !res.splitsPresent.includes(s));
  if (need.length) parts.push(`export is missing split(s): ${need.join(', ')}.`);
  return `Export aborted (fail-closed): ${parts.join(' ')}`;
}
