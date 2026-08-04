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

const SubjectDetector = registerPlugin('SubjectDetector');
const NATIVE = Capacitor.isNativePlatform();

/* Padding around the detected box. Vision hugs the subject tightly and
   fins/tail tips carry real ID signal, so a bare box can clip exactly
   the features the model needs. */
const PAD = 0.08;

let _lastReason = null;
export function lastSubjectReason() { return _lastReason; }

/* Returns { x, y, w, h } normalised 0..1 top-left origin, or null. */
export async function detectSubject(imageDataUrl) {
  _lastReason = null;
  if (!NATIVE) { _lastReason = 'web (no Vision)'; return null; }
  try {
    const r = await SubjectDetector.detect({ image: imageDataUrl });
    if (!r?.found) { _lastReason = 'no subject found'; return null; }

    // Pad, then clamp back inside the frame.
    const x = Math.max(0, r.x - PAD);
    const y = Math.max(0, r.y - PAD);
    const w = Math.min(1 - x, r.w + PAD * 2);
    const h = Math.min(1 - y, r.h + PAD * 2);

    // A box that's already almost the whole frame isn't worth cropping to.
    if (w >= 0.96 && h >= 0.96) { _lastReason = 'box ~= full frame'; return null; }
    // Guard against a degenerate sliver.
    if (w < 0.05 || h < 0.05) { _lastReason = 'box too small'; return null; }

    _lastReason = `box ${w.toFixed(2)}x${h.toFixed(2)}`;
    return { x, y, w, h };
  } catch (e) {
    // Plugin missing (older build) or Vision threw — not fatal.
    _lastReason = `detect failed: ${e?.message || e}`;
    return null;
  }
}
