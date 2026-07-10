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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../theme.js';
import { SPECIES } from '../data.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, inputStyle,
} from '../components.jsx';
import { getProductionModel, modelSignedUrl } from '../model-store.js';

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
  const [predictions, setPredictions]   = useState(null);
  const canvasRef                       = useRef(null);
  const fileInputRef                    = useRef(null);

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
        const model = await window.tflite.loadTFLiteModel(new Uint8Array(bytes));
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
    setTestImage({ url: URL.createObjectURL(file), file });
    setPredictions(null);
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

      // Decode → resize → normalize → INT8 tensor to match the model's
      // input signature.
      const canvas = canvasRef.current;
      canvas.width = runtime.inputSize;
      canvas.height = runtime.inputSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, runtime.inputSize, runtime.inputSize);
      // The model expects uint8 [0, 255] with the /255 rescale baked
      // into its graph (see training/train_fish_id.py Rescaling layer).
      const input = tf.tidy(() =>
        tf.browser.fromPixels(canvas).expandDims(0)
      );
      console.log('[test-image] input tensor built', input.shape, input.dtype);

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
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  {predictions && (
                    <div style={{ marginTop: 14 }}>
                      <ConfidenceBanner
                        band={predictions.band}
                        top={predictions.top}
                        thresholds={predictions.thresholds}
                      />
                      <div style={{ marginTop: 10 }}>
                        <SectionLabel style={{ marginBottom: 6 }}>Top 5</SectionLabel>
                        <div style={{ display: 'grid', gap: 4 }}>
                          {predictions.ranked.map((r) => {
                            const sp = SPECIES.find(s => s.id === r.speciesId);
                            const pct = r.score * 100;
                            return (
                              <div key={r.speciesId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontSize: 12, color: T.ink, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {sp?.commonName || r.speciesId}
                                  {r.excluded && <span style={{ marginLeft: 6, fontSize: 9, color: T.closed, fontWeight: 800 }}>EXCLUDED</span>}
                                </div>
                                <div style={{ width: 120, height: 5, background: T.parchmentDeep, borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: T.brass }} />
                                </div>
                                <div style={{ fontSize: 11, color: T.ink, width: 50, textAlign: 'right', fontWeight: 700 }}>
                                  {pct.toFixed(1)}%
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
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
