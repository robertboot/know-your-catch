#!/usr/bin/env python3
"""
EXIF orientation parity test.

Asserts that an EXIF-rotated JPEG is presented UPRIGHT by the training
pipeline, and that the pre-fix decoder did NOT do this — so the test
would have failed before the fix and passes after it.

Why this exists: tf.io.decode_image ignores the EXIF Orientation tag.
A browser <img>, which is what the app decodes with, applies it. An
iPhone photo tagged Orientation=6 therefore trained on its side and
served upright. Train and val were skewed identically, so no metric
could reveal it.

The app side is asserted by a companion JS test
(src/identify/__tests__/exif-parity.test.js) because EXIF handling
there belongs to the browser, not to our code — this file asserts the
Python half and pins the exact property both halves must share.

Run:
    python3 training/tests/test_exif_parity.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def make_rotated_jpeg(tmp: Path) -> Path:
    """A 40x20 landscape image (so orientation is unambiguous) written
    with EXIF Orientation=6, meaning 'rotate 90 CW for display'. A
    correct decoder yields a 20x40 PORTRAIT array.

    Uses PIL's own EXIF writer rather than piexif so the test has no
    dependency beyond Pillow, which the pipeline already requires.
    """
    from PIL import Image

    img = Image.new("RGB", (40, 20), (10, 20, 30))
    # Mark the left edge so a flip is distinguishable from a rotation.
    # 8px wide, not 1px: JPEG's chroma subsampling erases a single-pixel
    # red line against a dark ground entirely, and the test then fails
    # for a reason that has nothing to do with orientation.
    for y in range(20):
        for x in range(8):
            img.putpixel((x, y), (255, 0, 0))

    exif = img.getexif()
    exif[0x0112] = 6          # 0x0112 = Orientation, 6 = rotate 90 CW
    out = tmp / "rotated.jpg"
    img.save(out, "JPEG", exif=exif, quality=95)
    return out


def main():
    import tempfile

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("SKIP: Pillow not installed — cannot author a fixture.")
        return 0

    # Imported lazily: _decode_upright lives in train_fish_id, which pulls
    # numpy/TensorFlow. Those are present in Colab (where preflight runs
    # before training) but not on a plain Mac. Skip cleanly there instead
    # of crashing with an empty-output FAIL.
    try:
        from train_fish_id import _decode_upright
    except Exception as e:
        print(f"SKIP: cannot import _decode_upright ({e}) — needs the training "
              f"deps (numpy/TensorFlow); this check runs in Colab.")
        return 0

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        path = make_rotated_jpeg(tmp)

        # --- The property under test -------------------------------
        upright = _decode_upright(str(path))
        h, w = upright.shape[0], upright.shape[1]
        ok_shape = (h, w) == (40, 20)

        print(f"source stored as     : 40x20 landscape, EXIF Orientation=6")
        print(f"_decode_upright gives: {w}x{h} "
              f"({'PORTRAIT — correct' if ok_shape else 'WRONG'})")

        # --- Prove the old path was broken -------------------------
        naive_shape = None
        try:
            import tensorflow as tf
            naive = tf.io.decode_image(tf.io.read_file(str(path)), channels=3,
                                       expand_animations=False).numpy()
            naive_shape = (naive.shape[1], naive.shape[0])
            print(f"tf.io.decode_image   : {naive.shape[1]}x{naive.shape[0]} "
                  f"(ignores EXIF — this was the bug)")
        except ImportError:
            print("tf.io.decode_image   : skipped (TensorFlow not installed)")

        if not ok_shape:
            print("\nFAIL: EXIF orientation was not applied.")
            return 1

        if naive_shape is not None and naive_shape == (w, h):
            print("\nFAIL: the naive decoder agrees with the fixed one, so "
                  "this fixture does not actually exercise EXIF.")
            return 1

        # Red marker must land on the TOP edge after a 90 CW rotation.
        # Threshold loosely — JPEG shifts the exact values.
        red = (upright[:, :, 0] > 150) & (upright[:, :, 1] < 120)
        top_row_red = int(red[0, :].sum())
        print(f"marker on top edge   : {top_row_red}/{w} px red")
        if top_row_red < w // 2:
            print("\nFAIL: image is the right shape but rotated the wrong way.")
            return 1

        print("\nPASS: EXIF-rotated JPEG decodes upright in the training "
              "pipeline, and the pre-fix decoder demonstrably did not.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
