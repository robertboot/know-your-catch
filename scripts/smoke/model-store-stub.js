/* A realistic model row for the smoke harness.
 *
 * ModelDetail fetches its own data, and its widest parts — the per-species
 * table and the 135x135 confusion matrix — only exist once a model is
 * loaded. Mounting it signed-out measures the empty state and proves
 * nothing about the page anyone actually reads.
 */
const N = 135;
const LABELS = Array.from({ length: N }, (_, i) =>
  ['red_snapper', 'red_porgy', 'gag_grouper', 'galapagos_shark', 'vermilion_snapper'][i % 5]
  + '_' + String(i).padStart(3, '0'));

const cm = Array.from({ length: N }, (_, i) =>
  Array.from({ length: N }, (_, j) => (i === j ? 90 : (i + j) % 7 === 0 ? 3 : 0)));

const ROW = {
  id: 'stub', version_name: '12.4',
  model_file_path: 'stub/fish_id_model.tflite',
  imported_at: '2026-10-07T12:00:00Z', trained_at: '2026-10-07T10:00:00Z',
  imported_by: 'robertb1023@me.com', is_production: false, notes: null,
  dataset_export_size: 95039,
  labels_json: { labels: LABELS, input_size: 224, input_dtype: 'float32', excluded_species: [] },
  metrics_json: {
    overall_accuracy: 0.883, quantized_accuracy: 0.871, float_accuracy: 0.883,
    confusion_labels: LABELS, confusion_matrix: cm,
    per_species: Object.fromEntries(LABELS.map((l, i) => [l, {
      accuracy: 0.6 + ((i * 7) % 40) / 100, support: 40 + (i % 30),
      correct: 30 + (i % 10),
    }])),
    // Shape must match compute_lookalike_group_confusion() in
    // training/train_fish_id.py — members/matrix/support/correct/accuracy,
    // where accuracy is a parallel ARRAY, not a field on each member.
    lookalike_group_confusion: [{
      name: 'snappers',
      members: LABELS.slice(0, 6),
      matrix: Array.from({ length: 6 }, (_, i) =>
        Array.from({ length: 6 }, (_, j) => (i === j ? 30 : 2))),
      support: Array.from({ length: 6 }, () => 40),
      correct: Array.from({ length: 6 }, () => 30),
      accuracy: [0.55, 0.62, 0.71, 0.80, 0.88, 0.91],
    }],
    train_counts: Object.fromEntries(LABELS.map((l, i) => [l, 60 + i])),
  },
};

export async function getModelVersion() { return { ok: true, row: ROW }; }
export async function listModelVersions() { return { ok: true, rows: [ROW] }; }
export async function getProductionModel() { return null; }
export async function importModelVersion() { return { ok: false, error: 'stub' }; }
export async function promoteModelVersion() { return { ok: false, error: 'stub' }; }
export async function deleteModelVersion() { return { ok: false, error: 'stub' }; }
export async function publishPromotedModel() { return { ok: false, error: 'stub' }; }
export async function modelSignedUrl() { return { ok: false, error: 'stub' }; }
export function publishedModelUrl() { return ''; }
export function publishedManifestUrl() { return ''; }
