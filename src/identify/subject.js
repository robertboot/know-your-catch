/* Subject detection — find the fish before classifying it.

   DeepBlue is accurate when the fish fills the frame and unreliable when
   it doesn't. Cropping by hand fixed every failure we saw, so the app
   does that crop itself: Apple Vision returns a saliency box for the
   main subject, we pad it a little and classify that region instead of
   the whole boat scene. Same idea as Google Lens boxing the subject
   before it searches.

   Native-only. On web (and if Vision finds nothing) this returns null
   and the caller falls back to its fixed crop ladder. */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { downscaleImageDataUrl } from '../storage.js';

const SubjectDetector = registerPlugin('SubjectDetector');
const NATIVE = Capacitor.isNativePlatform();

/* Padding around the detected box. Vision hugs the subject tightly and
   fins/tail tips carry real ID signal, so a bare box can clip exactly
   the features the model needs.

   Kept small on purpose. At 0.08 this added 16% to each dimension, so
   any box of ~0.80 or wider inflated to the full frame and the crop
   became a no-op reported as "subject fills frame" — the model was
   still seeing the whole boat scene while the diagnostic claimed a
   successful crop. */
const PAD = 0.03;

let _lastReason = null;
export function lastSubjectReason() { return _lastReason; }

/* Returns { x, y, w, h } normalised 0..1 top-left origin, or null. */
export async function detectSubject(imageDataUrl) {
  _lastReason = null;
  if (!NATIVE) { _lastReason = 'web (no Vision)'; return null; }
  try {
    /* Downscale before crossing the bridge.

       Two reasons. A 4032x3024 camera JPEG is a ~5 MB base64 string and
       marshalling that per identification is slow. And the canvas
       re-encode BAKES IN the EXIF rotation, emitting an upright image
       with no orientation flag — so Vision and the JS crop are provably
       looking at the same pixels. Saliency doesn't benefit from more
       than ~1024px. */
    const small = await downscaleImageDataUrl(imageDataUrl, 1024, 0.85);
    const r = await SubjectDetector.detect({ image: small });
    if (!r?.found) { _lastReason = 'no subject found'; return null; }

    /* Decide "already tight" from the RAW box, before padding — padding
       must never be what makes a crop look unnecessary. */
    if (r.w >= 0.96 && r.h >= 0.96) {
      _lastReason = 'subject fills frame';
      return { x: 0, y: 0, w: 1, h: 1 };
    }

    // Pad, then clamp back inside the frame.
    const x = Math.max(0, r.x - PAD);
    const y = Math.max(0, r.y - PAD);
    const w = Math.min(1 - x, r.w + PAD * 2);
    const h = Math.min(1 - y, r.h + PAD * 2);


    // Guard against a degenerate sliver.
    if (w < 0.05 || h < 0.05) { _lastReason = 'box too small'; return null; }

    // Report the raw box too — if a crop isn't helping, the first thing
    // to know is how much of the frame Vision actually selected.
    _lastReason = `box ${w.toFixed(2)}x${h.toFixed(2)} (raw ${r.w.toFixed(2)}x${r.h.toFixed(2)})`;
    return { x, y, w, h };
  } catch (e) {
    // Plugin missing (older build) or Vision threw — not fatal.
    _lastReason = `detect failed: ${e?.message || e}`;
    return null;
  }
}
