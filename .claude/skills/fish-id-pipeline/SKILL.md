---
name: fish-id-pipeline
description: Change how a photo becomes a species ID (DeepBlue on-device model, preprocessing, cloud fallback, auto-crop). Use before touching identifyPhoto.js, identify/adapter.js, or anything about ID accuracy — it records what was already tried and measured.
---

# Fish ID pipeline

Read this before changing ID behaviour. Several approaches below were
built, shipped and measured on device, then reverted. Re-proposing one
costs a day of TestFlight round-trips.

## The pipeline

```
photo → identifyPhoto.js
          └─ classify()            src/identify/adapter.js
               ├─ imageToRgb()     letterbox to input_size, RGB bytes
               └─ model.predict()  DeepBlue tflite, via model-loader.js
          └─ mapLabelsToSpecies → constrainToJurisdiction → rankAndBand
```

Cloud (`identify-fish` edge function, Claude vision) exists but is
**only** used when there is no local answer at all — a first launch
where the model hasn't downloaded.

## What was measured, and what it cost

| Attempt | Result on device | Verdict |
|---|---|---|
| Cloud (Claude) as primary | Wrong on species DeepBlue got right | Removed from answer path |
| Cloud as second opinion when local score low | Overrode correct local answers with wrong ones | Removed |
| Confidence gate on local score | Model returned **0.75 on the wrong species** | Confidence does not track correctness — no threshold is safe |
| Multi-crop ladder (centre 90/70/50%) | Best-crop let one flattering framing carry a wrong label | Removed |
| Mean across crops | Diluted; still no real crop | Removed |
| Vision **saliency** auto-crop | Box measured **0.92×0.99** — the whole frame | Removed |
| Vision **foreground segmentation** (iOS 17 subject lifting) | Box measured **0.77×0.99** — selected the **angler**, full height | Removed |

The two Vision approaches fail for one reason worth remembering:
**saliency finds what stands out, segmentation finds the foreground
subject, and on a photo of a person holding a fish both answer "the
person".** Neither knows what a fish is.

## What is actually true

- **DeepBlue is accurate when the fish fills the frame** and unreliable
  when it doesn't. A grouper at ~25% of frame returned Cubera Snapper at
  0.75; the same photo cropped by hand gave Black Grouper at 0.85.
- **Manual crop works.** The "Crop & try again" button is the reliable
  path and should stay prominent.
- **Aspect must be preserved.** The original `drawImage(img,0,0,size,size)`
  squashed 3:4 into a square, distorting body proportions — a primary ID
  cue. `imageToRgb` now letterboxes with neutral grey. Keep this.

## If asked for Google-Lens-style auto-selection again

It needs an **object detector trained on labelled fish bounding boxes** —
a Colab training job alongside DeepBlue, not a live patch. No Apple
first-party API isolates a fish. Say so plainly rather than trying a
third heuristic.

The hooks are already in place: `lastSubjectNote()`, `lastSubjectFound()`
and `lastSubjectBox()` in `adapter.js` are constants returning
"disabled"/false/null, and `screens1.jsx` already draws `_subjectBox`
over the results photo when present. A real detector is a one-file change.

## Diagnostics

`identifyPhoto` attaches `_diag` and `_cropTrace`; the results screen
renders them as a grey monospace line under the confidence ring. Ask for
that line before theorising — it reports the local score, what detection
did, and which path answered. Two rounds of guessing were wasted before
it existed.

## iOS native plugin gotchas

If a Capacitor plugin is added in the app target (`ios/App/App/*.swift`):

1. **It must be added to `project.pbxproj`.** This project has no
   `PBXFileSystemSynchronizedRootGroup`, so a file dropped in the folder
   is never compiled. Four entries needed: `PBXFileReference`,
   `PBXBuildFile`, group membership, Sources build phase.
2. **It must be registered explicitly.** Capacitor auto-discovers plugins
   shipped inside Swift packages but not ones defined in the app target.
   Register in `MainViewController.capacitorDidLoad()` via
   `bridge?.registerPluginInstance(...)`. Symptom otherwise:
   `"X" plugin is not implemented on ios`.
3. **Pass orientation to Vision.** `.cgImage` is the raw sensor buffer;
   iPhone portrait shots are stored landscape with a rotation flag that
   the JS `<img>` path applies. Mismatched coordinate spaces otherwise.
   Downscaling in JS first also bakes the rotation in, which is simpler.
4. **Don't send full-res across the bridge.** A 4032×3024 JPEG is a ~5 MB
   base64 string per call.
