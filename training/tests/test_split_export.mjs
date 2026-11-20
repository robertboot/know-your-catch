/* Tests for the observation-aware export split (src/training-split.js).
 *
 * Pure — no Supabase, no network. Verifies the ACTUAL logic planExport()
 * uses to turn split_manifest_v1.json into a train/val/test export:
 *   - train/val/test all export
 *   - images are matched by training_images id (the manifest key)
 *   - an image missing from the manifest FAILS the export (fail-closed)
 *   - a group that straddles splits FAILS
 *   - test images never appear in train or val
 *
 *   node training/tests/test_split_export.mjs
 */
import assert from 'node:assert/strict';
import { applySplitManifest, describeSplitFailure, VALID_SPLITS }
  from '../../src/training-split.js';

let passed = 0;
function ok(name) { console.log(`  PASS  ${name}`); passed += 1; }

// --- Fixtures ---------------------------------------------------------
// Six images across two observation groups + two singletons.
const images = [
  { id: 'id-a1', species_id: 'red_snapper', filename: 'red_snapper_0000.jpg' },
  { id: 'id-a2', species_id: 'red_snapper', filename: 'red_snapper_0001.jpg' },
  { id: 'id-b1', species_id: 'gag_grouper', filename: 'gag_grouper_0000.jpg' },
  { id: 'id-c1', species_id: 'cobia',       filename: 'cobia_0000.jpg' },
  { id: 'id-d1', species_id: 'wahoo',       filename: 'wahoo_0000.jpg' },
  { id: 'id-e1', species_id: 'mahi',        filename: 'mahi_0000.jpg' },
];

const goodManifest = {
  assignments: {
    'id-a1': 'train', 'id-a2': 'train',   // same obs → same split
    'id-b1': 'train',
    'id-c1': 'val',
    'id-d1': 'test',
    'id-e1': 'test',
  },
  groups: {
    'id-a1': 'inat:100', 'id-a2': 'inat:100',   // grouped
    'id-b1': 'self:id-b1',
    'id-c1': 'self:id-c1',
    'id-d1': 'self:id-d1',
    'id-e1': 'inat:200',
  },
};

// --- 1. train/val/test all export, matched by id ---------------------
{
  const res = applySplitManifest(images, goodManifest);
  assert.equal(res.ok, true, 'expected ok');
  assert.deepEqual(res.counts, { train: 3, val: 1, test: 2 });
  assert.deepEqual(res.splitsPresent, VALID_SPLITS);
  // every planned image carries the split its id maps to
  for (const p of res.plan) {
    assert.equal(p.split, goodManifest.assignments[p.id],
      `id ${p.id} split mismatch`);
  }
  ok('train/val/test all export; matched by id');
}

// --- 2. missing manifest id fails the export (fail-closed) -----------
{
  const withExtra = [...images, { id: 'id-NEW', species_id: 'tarpon', filename: 'tarpon_0000.jpg' }];
  const res = applySplitManifest(withExtra, goodManifest);
  assert.equal(res.ok, false, 'expected fail-closed');
  assert.deepEqual(res.missing, ['id-NEW']);
  assert.match(describeSplitFailure(res), /not in split_manifest/);
  ok('missing manifest id fails the export');
}

// --- 3. a group crossing splits fails --------------------------------
{
  const leaky = JSON.parse(JSON.stringify(goodManifest));
  leaky.assignments['id-a2'] = 'val';   // same group inat:100 now train+val
  const res = applySplitManifest(images, leaky);
  assert.equal(res.ok, false, 'expected group-overlap failure');
  assert.equal(res.groupOverlap.length, 1);
  assert.equal(res.groupOverlap[0].group, 'inat:100');
  assert.deepEqual([...res.groupOverlap[0].splits].sort(), ['train', 'val']);
  ok('a group crossing splits fails');
}

// --- 4. test images never appear in train or val ---------------------
{
  const res = applySplitManifest(images, goodManifest);
  const testIds = res.plan.filter(p => p.split === 'test').map(p => p.id).sort();
  assert.deepEqual(testIds, ['id-d1', 'id-e1']);
  for (const p of res.plan) {
    if (p.split === 'train' || p.split === 'val') {
      assert.notEqual(goodManifest.assignments[p.id], 'test',
        `test image ${p.id} leaked into ${p.split}`);
    }
  }
  ok('test images never appear in train or val');
}

// --- 5. a missing split (no test) fails ------------------------------
{
  const noTest = {
    assignments: { 'id-a1': 'train', 'id-a2': 'train', 'id-b1': 'val',
                   'id-c1': 'val', 'id-d1': 'train', 'id-e1': 'train' },
    groups: goodManifest.groups,
  };
  const res = applySplitManifest(images, noTest);
  assert.equal(res.ok, false, 'expected fail — no test split present');
  assert.ok(!res.splitsPresent.includes('test'));
  assert.match(describeSplitFailure(res), /missing split\(s\): test/);
  ok('export with no test split fails');
}

// --- 6. an invalid split label fails ---------------------------------
{
  const bad = {
    assignments: { ...goodManifest.assignments, 'id-c1': 'holdout' },
    groups: goodManifest.groups,
  };
  const res = applySplitManifest(images, bad);
  assert.equal(res.ok, false, 'expected fail — invalid split label');
  assert.equal(res.invalid.length, 1);
  assert.equal(res.invalid[0].split, 'holdout');
  ok('invalid split label fails');
}

console.log(`\n${passed} tests passed.`);
