/* Test Image panel — Phase 6 (web-side).

   Loads the currently-promoted model from Supabase Storage and runs
   inference on a dropped image. Confidence bands per the app spec:
     < 0.6                → 'low'    (would route to manual picker)
     0.6..0.85            → 'medium' (would show candidates)
     >= 0.85              → 'high'   (would prefill species)
   Excluded species are dropped even if the model's top pick lands
   on one — matches Phase 6 iOS runtime behavior.

   The .tflite runtime is @tensorflow/tfjs-tflite (lazy-loaded so a
   normal admin session doesn't pay the ~1 MB WASM cost). Inference
   happens entirely in the browser; no network calls once the model
   is loaded. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../theme.js';
import { SPECIES } from '../data.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, CropStep,
} from '../components.jsx';
import { dataUrlToFile } from '../helpers.js';
import { getProductionModel, modelSignedUrl } from '../model-store.js';
import { saveModelFeedback } from '../training-store.js';
import { SpeciesPickerModal } from './pickers.jsx';

const IMG_SIZE = 224; // must match training-time input size

/* Dequantize a TFLite uint8 softmax output back into a proper [0, 1]
   distribution. Handles three cases the tfjs-tflite runtime can
   plausibly return:
     - Already-dequantized float32 that sums to ~1 → pass through
     - Raw uint8 integers [0, 255] → divide by 255, then renormalize
     - Anything else that clearly isn't a probability distribution →
       renormalize by sum so downstream band comparison works
   Runs client-side each predict — cheap. */
function normalizeScores(raw) {
  const arr = raw instanceof Float32Array ? Array.from(raw) : Array.from(raw, Number);
  if (arr.length === 0) return arr;
  let max = -Infinity, sum = 0;
  for (const v of arr) { if (v > max) max = v; sum += v; }
  // Path A — looks like uint8 (max > 1.5 means we're clearly not on a
  // [0, 1] distribution).
  if (max > 1.5) {
    // Divide by 255 first (standard uint8 → float dequantize proxy
    // when scale/zero_point aren't exposed), then renormalize.
    const scaled = arr.map(v => v / 255);
    const s = scaled.reduce((a, b) => a + b, 0) || 1;
    return scaled.map(v => v / s);
  }
  // Path B — floats but don't sum to ~1 (some tfjs-tflite versions
  // return raw sigmoid-ish values). Rescale by sum to make them a
  // legit probability distribution.
  if (Math.abs(sum - 1) > 0.05 && sum > 0) {
    return arr.map(v => v / sum);
  }
  // Path C — already normalized.
  return arr;
}

/* tfjs-tflite doesn't Vite-bundle cleanly (WASM worker path breaks in
   Rollup). Self-host the UMD JS + WASM under public/models/tflite/
   (copied verbatim from node_modules/@tensorflow/tfjs-tflite/). This
   avoids jsdelivr's wrong MIME + nosniff blocking the follow-on
   scripts, and keeps admin working with no external network deps. */
const TFLITE_LOCAL_BASE = `${import.meta.env.BASE_URL}models/tflite/`;
function loadTfliteRuntime() {
  if (window.tflite) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${TFLITE_LOCAL_BASE}tf-tflite.min.js`;
    s.onload = () => {
      if (!window.tflite) return reject(new Error('tflite global not set'));
      // Point the runtime at the same directory so it can fetch the
      // matching wasm binaries and worker JS.
      window.tflite.setWasmPath(TFLITE_LOCAL_BASE);
      resolve();
    };
    s.onerror = () => reject(new Error('failed to load tfjs-tflite runtime'));
    document.head.appendChild(s);
  });
}

export default function TestImagePanel() {
  const [production, setProduction]     = useState(null); // model_versions row
  const [runtime, setRuntime]           = useState(null); // { tflite, labels, excluded }
  const [loading, setLoading]           = useState(true);
  const [inferring, setInferring]       = useState(false);
  const [error, setError]               = useState('');
  const [testImage, setTestImage]       = useState(null); // { url, file }
  const [cropOpen, setCropOpen]         = useState(false);
  // Preserves the pre-crop image so admin can "Reset crop" if they
  // want to try a different framing without re-picking from disk.
  const [originalImage, setOriginalImage] = useState(null); // { url, file }
  const [predictions, setPredictions]   = useState(null);
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(''); // "Added kingfish to training data"
  const canvasRef                       = useRef(null);
  const fileInputRef                    = useRef(null);

  const speciesOptions = useMemo(
    () => [...SPECIES].filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

  // On mount: fetch which model is promoted, then lazy-load the
  // runtime and the .tflite bytes into memory.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const prod = await getProductionModel();
      if (!alive) return;
      if (!prod) {
        setProduction(null);
        setLoading(false);
        setError('No production model yet. Promote a version on the Models tab first.');
        return;
      }
      setProduction(prod);
      try {
        const url = await modelSignedUrl(prod.model_file_path);
        if (!url) throw new Error('signed url failed');
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`fetch model ${resp.status}`);
        const bytes = await resp.arrayBuffer();

        // The UMD tflite bundle reaches for a global `tf`; hoist the
        // ESM tfjs module namespace onto window so its lookup works,
        // otherwise predict() throws
        // "undefined is not an object (evaluating 'tfjsCore.Tensor')".
        const tf = await import('@tensorflow/tfjs');
        window.tf = tf;
        await loadTfliteRuntime();
        // numThreads: 1 forces the non-threaded WASM variant so we
        // don't try to use SharedArrayBuffer (needs COOP+COEP headers
        // Vercel doesn't set — the runtime crashes the tab rather
        // than falling back on Safari).
        // enableXnnpackDelegate: false — alpha.10's XNNPACK delegate
        // has a known Safari-crash bug during Prepare(). We're fine
        // with the default CPU delegate for admin-side sanity checks.
        const model = await window.tflite.loadTFLiteModel(
          new Uint8Array(bytes),
          { numThreads: 1, enableXnnpackDelegate: false },
        );
        if (!alive) return;
        setRuntime({
          tflite: model,
          labels: prod.labels_json?.labels || [],
          excluded: new Set(prod.labels_json?.excluded_species || []),
          minConfidence:  prod.labels_json?.min_confidence  ?? 0.6,
          highConfidence: prod.labels_json?.high_confidence ?? 0.85,
          inputSize:      prod.labels_json?.input_size      ?? IMG_SIZE,
        });
        setError('');
      } catch (e) {
        if (alive) setError(e?.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const handleFile = (file) => {
    if (!file) return;
    if (testImage?.url) URL.revokeObjectURL(testImage.url);
    if (originalImage?.url && originalImage.url !== testImage?.url) URL.revokeObjectURL(originalImage.url);
    const url = URL.createObjectURL(file);
    setTestImage({ url, file });
    setOriginalImage({ url, file });
    setPredictions(null);
    setError('');
  };

  const clearTest = () => {
    if (testImage?.url) URL.revokeObjectURL(testImage.url);
    if (originalImage?.url && originalImage.url !== testImage?.url) URL.revokeObjectURL(originalImage.url);
    setTestImage(null);
    setOriginalImage(null);
    setPredictions(null);
    setError('');
  };

  const resetToOriginal = () => {
    if (!originalImage) return;
    if (testImage?.url && testImage.url !== originalImage.url) URL.revokeObjectURL(testImage.url);
    setTestImage(originalImage);
    setPredictions(null);
    setError('');
  };

  const applyCrop = async ({ dataUrl }) => {
    setCropOpen(false);
    if (!dataUrl) return;
    // Convert data URL → File so saveFeedback + the existing run()
    // path can consume it the same way as a picker-uploaded file.
    const file = await dataUrlToFile(dataUrl, 'crop.jpg');
    if (!file) { setError('Crop conversion failed.'); return; }
    if (testImage?.url && testImage.url !== originalImage?.url) URL.revokeObjectURL(testImage.url);
    setTestImage({ url: URL.createObjectURL(file), file });
    setPredictions(null);
    setError('');
  };

  // Toast auto-dismiss.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const saveFeedback = async ({ speciesId, source }) => {
    if (!testImage?.file || !predictions?.top) return;
    setSaving(true);
    setError('');
    const originalSpeciesId = predictions.top.speciesId;
    const r = await saveModelFeedback({
      file: testImage.file,
      speciesId,
      originalSpeciesId,
      source,
    });
    setSaving(false);
    if (!r.ok) {
      setError(`Save failed: ${r.error || 'unknown error'}`);
      return;
    }
    const sp = SPECIES.find(s => s.id === speciesId);
    const name = sp?.commonName || speciesId;
    setToast(`Added to training data as ${name}`);
    clearTest();
  };

  const confirmTop = () => {
    if (!predictions?.top) return;
    saveFeedback({ speciesId: predictions.top.speciesId, source: 'model_confirmation' });
  };

  const correctTo = (speciesId) => {
    setPickerOpen(false);
    saveFeedback({ speciesId, source: 'model_correction' });
  };

  const run = async () => {
    console.log('[test-image] run() clicked. runtime=', !!runtime, 'testImage=', !!testImage);
    if (!runtime || !testImage) {
      setError(`Not ready — runtime=${!!runtime}, image=${!!testImage}. Reload the page.`);
      return;
    }
    setInferring(true); setError(''); setPredictions(null);
    try {
      const tf = await import('@tensorflow/tfjs');
      console.log('[test-image] tfjs ready, decoding image');
      const img = new Image();
      img.src = testImage.url;
      await new Promise((r, rj) => { img.onload = r; img.onerror = () => rj(new Error('image decode failed')); });

      // Decode → resize → uint8 RGB tensor matching the model's
      // uint8 input signature. Skip tf.browser.fromPixels (which
      // returns int32 and provokes the tflite runtime to insert an
      // int32→uint8 conversion op that hangs on Safari's CPU
      // fallback path). Instead pull uint8 bytes straight out of the
      // canvas, strip alpha, and hand the runtime a Tensor whose
      // backing values are already what the graph wants — its
      // Uint8Array.from(dataSync()) then becomes a same-range copy.
      const canvas = canvasRef.current;
      canvas.width = runtime.inputSize;
      canvas.height = runtime.inputSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, runtime.inputSize, runtime.inputSize);
      const rgba = ctx.getImageData(0, 0, runtime.inputSize, runtime.inputSize).data;
      const pixelCount = runtime.inputSize * runtime.inputSize;
      const rgb = new Uint8Array(pixelCount * 3);
      for (let i = 0; i < pixelCount; i++) {
        rgb[i * 3]     = rgba[i * 4];
        rgb[i * 3 + 1] = rgba[i * 4 + 1];
        rgb[i * 3 + 2] = rgba[i * 4 + 2];
      }
      const input = tf.tensor4d(rgb, [1, runtime.inputSize, runtime.inputSize, 3], 'int32');
      console.log('[test-image] input tensor built', input.shape, input.dtype, 'first bytes:', Array.from(rgb.slice(0, 6)));

      const out = runtime.tflite.predict(input);
      console.log('[test-image] predict returned', out);
      const rawScores = await out.data();
      console.log('[test-image] got scores, len=', rawScores?.length);
      input.dispose(); out.dispose();

      // The .tflite ships with inference_output_type = tf.uint8 (see
      // training/train_fish_id.py quantize_to_tflite). tfjs-tflite
      // sometimes auto-dequantizes on .data(), sometimes doesn't —
      // depends on version. Normalize defensively: if the raw scores
      // look like uint8 (max > 1.5) OR the whole set doesn't sum to
      // ~1, remap them to a proper softmax distribution.
      const scores = normalizeScores(rawScores);

      // Rank + apply confidence bands + excluded filter.
      const ranked = Array.from(scores)
        .map((score, i) => ({
          speciesId: runtime.labels[i],
          score,
          excluded: runtime.excluded.has(runtime.labels[i]),
        }))
        .sort((a, b) => b.score - a.score);

      const top = ranked[0];
      const band =
        !top || top.excluded || top.score < runtime.minConfidence  ? 'low'
        : top.score < runtime.highConfidence                        ? 'medium'
        : 'high';

      setPredictions({
        ranked: ranked.slice(0, 5),
        top, band,
        thresholds: {
          min:  runtime.minConfidence,
          high: runtime.highConfidence,
        },
      });
    } catch (e) {
      console.error('[test-image] run() failed', e);
      const msg = e?.message || e?.toString?.() || String(e) || 'unknown error';
      setError(`Inference failed: ${msg}`);
    } finally {
      setInferring(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel>Production model</SectionLabel>
        {loading && <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6 }}>Loading model…</div>}
        {!loading && production && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>
              {production.version_name}
              <span style={{
                marginLeft: 8,
                fontSize: 9, letterSpacing: 1, fontWeight: 800,
                background: T.brass, color: T.oceanDeep,
                padding: '2px 7px', borderRadius: 999,
              }}>PRODUCTION</span>
            </div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>
              {runtime ? `${runtime.labels.length} labels · thresholds: low < ${runtime.minConfidence} · high >= ${runtime.highConfidence}` : 'loading…'}
            </div>
          </div>
        )}
        {!loading && !production && (
          <div style={{ marginTop: 6, fontSize: 12, color: T.inkMute }}>
            No promoted model. Go to Models → pick a version → Promote, then come back.
          </div>
        )}
      </Card>

      {runtime && (
        <details style={{
          background: T.parchmentDeep, borderRadius: 8, padding: '8px 12px',
          border: `1px solid ${T.cardEdge}`, fontSize: 12, color: T.inkSoft,
        }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: T.ink }}>
            How does learning work?
          </summary>
          <div style={{ marginTop: 8, lineHeight: 1.55 }}>
            Confirm / Wrong add the photo to <strong>training_images</strong> as verified data — they do
            NOT change the model on the fly. This model file is frozen bytes; it only improves
            when you retrain and promote a new version:
            <ol style={{ margin: '6px 0 6px 18px', padding: 0 }}>
              <li>Corrections accumulate here (source = <code>model_correction</code> / <code>model_confirmation</code>).</li>
              <li>When a confused species has ~30+ examples, Training → Coverage → Export ZIP.</li>
              <li>Run the Colab notebook on the ZIP to produce new artifacts.</li>
              <li>Models → Upload artifacts → Promote. The Test Image page then loads the new model.</li>
            </ol>
            Repeated copies of the same photo don't help — the model needs different angles, lighting,
            and specimens to actually generalize.
          </div>
        </details>
      )}

      {runtime && (
        <>
          <Card
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${T.brass}`,
              textAlign: 'center', padding: 24, cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 700 }}>
              Drop a fish photo, or click to pick
            </div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>
              Inference runs entirely in this browser. No network calls after the model loaded.
            </div>
            <input
              ref={fileInputRef} type="file" accept="image/*" hidden
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </Card>

          {testImage && (
            <Card>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <img src={testImage.url} alt="" style={{
                  width: 240, maxWidth: '40%',
                  borderRadius: 8, border: `1px solid ${T.cardEdge}`, background: T.parchmentDeep,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PrimaryButton onClick={run} disabled={inferring} style={{ width: '100%' }}>
                    {inferring ? 'Running…' : 'Run identification'}
                  </PrimaryButton>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <GhostButton
                      onClick={() => setCropOpen(true)}
                      style={{ flex: 1, padding: '8px 12px', fontSize: 12 }}
                    >
                      Crop
                    </GhostButton>
                    {originalImage && testImage && originalImage.url !== testImage.url && (
                      <GhostButton
                        onClick={resetToOriginal}
                        style={{ flex: 1, padding: '8px 12px', fontSize: 12 }}
                      >
                        Reset crop
                      </GhostButton>
                    )}
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  {predictions && (
                    <div style={{ marginTop: 14 }}>
                      <ConfidenceBanner
                        band={predictions.band}
                        top={predictions.top}
                        thresholds={predictions.thresholds}
                      />
                      <div style={{ marginTop: 10 }}>
                        <SectionLabel style={{ marginBottom: 6 }}>Top 5 — tap the right one</SectionLabel>
                        {/* Each row IS the action: tapping the top row
                            saves as a confirmation, tapping any runner-up
                            saves the photo as that species (correction).
                            The type-to-search picker below covers fish
                            outside the top five. */}
                        <div style={{ display: 'grid', gap: 4 }}>
                          {predictions.ranked.map((r, i) => {
                            const sp = SPECIES.find(s => s.id === r.speciesId);
                            const name = sp?.commonName || r.speciesId;
                            const pct = r.score * 100;
                            const isTop = i === 0;
                            return (
                              <button
                                key={r.speciesId}
                                disabled={saving}
                                onClick={() => saveFeedback({
                                  speciesId: r.speciesId,
                                  source: isTop ? 'model_confirmation' : 'model_correction',
                                })}
                                title={isTop ? `Confirm — this is a ${name}` : `Save this photo as ${name} instead`}
                                style={{
                                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                  background: T.parchmentDeep,
                                  border: `1px solid ${isTop ? T.open : T.cardEdge}`,
                                  borderRadius: 6, padding: '9px 10px',
                                  cursor: saving ? 'not-allowed' : 'pointer',
                                  textAlign: 'left', opacity: saving ? 0.6 : 1,
                                }}
                              >
                                <div style={{ fontSize: 12, color: T.ink, fontWeight: isTop ? 800 : 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {name}
                                  {r.excluded && <span style={{ marginLeft: 6, fontSize: 9, color: T.closed, fontWeight: 800 }}>EXCLUDED</span>}
                                </div>
                                <div style={{ width: 120, height: 5, background: T.card, borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: isTop ? T.open : T.brass }} />
                                </div>
                                <div style={{ fontSize: 11, color: T.ink, width: 50, textAlign: 'right', fontWeight: 700, flexShrink: 0 }}>
                                  {pct.toFixed(1)}%
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, lineHeight: 1.4 }}>
                          Tap a row to save the photo to training data as that species.
                        </div>
                      </div>

                      {/* Correct-and-save flow. Confirm, a Top-5 row
                          tap, and the search picker all land the image
                          in training_images with status='verified' —
                          the only difference is the source flag and,
                          for corrections, the species_id vs
                          original_species_id split. */}
                      <FeedbackButtons
                        top={predictions.top}
                        saving={saving}
                        onConfirm={confirmTop}
                        onWrong={() => setPickerOpen(true)}
                        onDiscard={clearTest}
                      />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}

      {pickerOpen && (
        <SpeciesPickerModal
          speciesOptions={speciesOptions}
          currentSpeciesId={predictions?.top?.speciesId}
          onPick={correctTo}
          onCancel={() => setPickerOpen(false)}
          title="Pick the true species"
        />
      )}

      {cropOpen && testImage && (
        <CropStep
          imageSrc={originalImage?.url || testImage.url}
          onCancel={() => setCropOpen(false)}
          onConfirm={applyCrop}
          title="Crop to the fish before running"
          primaryLabel="Use this crop"
          cancelLabel="Cancel"
        />
      )}
    </div>
  );
}

function FeedbackButtons({ top, saving, onConfirm, onWrong, onDiscard }) {
  const sp = SPECIES.find(s => s.id === top?.speciesId);
  const topName = sp?.commonName || top?.speciesId || 'top pick';
  const confirmDisabled = saving || !top || top.excluded;
  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 2 }}>
        Every labeled example makes the next model better — even the ones the model got right.
      </div>
      <button
        onClick={onConfirm}
        disabled={confirmDisabled}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 8,
          border: 'none', fontSize: 14, fontWeight: 700,
          cursor: confirmDisabled ? 'not-allowed' : 'pointer',
          background: confirmDisabled ? '#2A3E4D' : T.open,
          color: confirmDisabled ? T.inkMute : T.oceanDeep,
        }}
        title={top?.excluded ? 'Excluded species — pick the true one instead' : ''}
      >
        {saving ? 'Saving…' : `Confirm — this is a ${topName}`}
      </button>
      <button
        onClick={onWrong}
        disabled={saving}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 8,
          border: 'none', fontSize: 14, fontWeight: 700,
          cursor: saving ? 'not-allowed' : 'pointer',
          background: saving ? '#2A3E4D' : T.brass,
          color: saving ? T.inkMute : T.oceanDeep,
        }}
      >
        Not in the top 5 — type to search
      </button>
      <button
        onClick={onDiscard}
        disabled={saving}
        style={{
          width: '100%', padding: '10px 14px', borderRadius: 8,
          border: `1px solid ${T.cardEdge}`, fontSize: 13, fontWeight: 600,
          cursor: saving ? 'not-allowed' : 'pointer',
          background: 'transparent', color: T.inkSoft,
        }}
      >
        Discard
      </button>
    </div>
  );
}

function Toast({ message, onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 600, cursor: 'pointer',
        background: T.open, color: T.oceanDeep,
        padding: '12px 18px', borderRadius: 10,
        fontSize: 13, fontWeight: 700,
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      }}
    >
      {message}
    </div>
  );
}

function ConfidenceBanner({ band, top, thresholds }) {
  const sp = SPECIES.find(s => s.id === top?.speciesId);
  const color = band === 'high' ? T.open : band === 'medium' ? T.brass : T.closed;
  const label = band === 'high' ? 'HIGH' : band === 'medium' ? 'MEDIUM' : 'LOW';
  const description =
    band === 'high'
      ? `App would prefill "${sp?.commonName || top.speciesId}" on the catch entry screen.`
      : band === 'medium'
        ? `App would show 2–3 candidates for user confirmation.`
        : `App would route to the manual species picker (no confident ID).`;
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      background: `${color}22`, border: `1.5px solid ${color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
          color: T.oceanDeep, background: color,
          padding: '3px 8px', borderRadius: 4,
        }}>{label}</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>
          {sp?.commonName || top?.speciesId || '—'}
        </span>
        <span style={{ fontSize: 13, color: T.inkSoft, marginLeft: 'auto' }}>
          {top ? `${(top.score * 100).toFixed(1)}%` : '—'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 6, lineHeight: 1.5 }}>
        {description}
        <span style={{ color: T.inkMute }}>
          {' '}(bands: &lt; {thresholds.min * 100}% low, &lt; {thresholds.high * 100}% medium, &gt;= {thresholds.high * 100}% high)
        </span>
      </div>
    </div>
  );
}
