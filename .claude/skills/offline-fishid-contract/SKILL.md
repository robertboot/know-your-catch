---
name: offline-fishid-contract
description: REELINTEL OFFLINE FISH ID — PRODUCTION CONTRACT. Read BEFORE touching model-loader.js, identify/adapter.js, model lifecycle, WASM assets, model caching, or model publishing. Build 201 / commit 16b106c is the verified known-good baseline; these are non-negotiable requirements, not preferences.
---

# ReelIntel Offline Fish ID — Production Contract

**KNOWN-GOOD BASELINE: Build 201 / commit `16b106c`, verified on-device
2026-08-19** — app deleted, fresh install, Airplane Mode BEFORE first
launch, never contacted Supabase/Claude/CDN, and DeepBlue initialized
automatically and identified known fish. That test is the authority
behind every rule below.

## Local runtime — NON-NEGOTIABLE

App Fish ID runtime is **@litertjs/core 2.5.3 (LiteRT.js)**, CPU/WASM.
**NOT @tensorflow/tfjs-tflite.** Do not migrate the production app path
back. Reason: tfjs-tflite 0.0.1-alpha.10 failed on iOS Capacitor inside
loadTFLiteModel with `TypeError: undefined is not an object (evaluating
'l._malloc')` — the Emscripten bootstrap never worked on the
capacitor:// origin, and every historical "success" was secretly the
CDN. The old bootstrap (CDN HEAD probe, WebAssembly.instantiate patch,
instantiateStreaming override, .wasm fetch rewrites) must not return.

## Bundled runtime

All LiteRT WASM assets ship inside the app at `models/litert/`
(internal + compat variants). NO CDN. NO remote probe. NO network
request of any kind for local inference.

## DeepBlue baseline

Bundled model at `models/deepblue/`: **DeepBlue 12.2** —
MobileNetV3Large, 135 species, 224×224, float32 input, float16 weights,
TFLite. It is the guaranteed offline baseline; the app package is the
one place a model can never be deleted from.

## Model lifecycle

```
VALID CACHED UPDATE  → use (CACHED_UPDATE)
unavailable / invalid / RUNTIME-LOAD FAILURE
                     → quarantine cache → BUNDLED DeepBlue
```

Remote checks happen only AFTER a usable local model is READY. Network
availability must NEVER determine whether basic Fish ID works.

## Startup

`initModel()` runs automatically at boot (App.jsx, short defer). It must
not depend on opening Fish ID, Settings, Log Catch, pressing Check for
Updates, or the network. A finished init that produced no model is never
cached past a retry. Loads are timeout-bounded — `loading` is not a
terminal state.

## Bad cache

Structural failure, runtime-load failure, incompatible labels/IO, or
corruption ⇒ quarantine (session flag + files removed) and bundled
DeepBlue loads automatically. A bad cache must NEVER prevent bundled
DeepBlue from operating. "Model unavailable" is legal only when cached
AND bundled both fail.

## Check for Updates

Means: check for a NEWER model. It is never required to initialize the
normal Fish ID capability. (It was, for six builds. Never again.)

## Remote update

local READY → background manifest check → newer? → download → validate
(size, TFL3, labels, input_size) → RUNTIME-LOAD validate → persist →
activate. ANY failure ⇒ keep the current working local model.

## MANDATORY OFFLINE ACCEPTANCE TEST

Required before shipping any change touching model-loader, adapter,
Fish ID runtime, WASM, model lifecycle, caching, or publishing:

```
DELETE APP → INSTALL FRESH BUILD → AIRPLANE MODE BEFORE FIRST LAUNCH
→ OPEN APP → DO NOT PRESS CHECK FOR UPDATES → FISH ID KNOWN PHOTOS
```

Required result: `engine = DEEPBLUE_LOCAL`, identification succeeds,
Settings shows "DeepBlue · Offline Ready ✓ · built-in · 135 species".
**If this fails: DO NOT SHIP.** Simulator/browser results do not count.

## Preprocessing contract

224×224 · RGB · aspect-preserving letterbox · neutral gray (#808080 /
128) padding · float32 · range [0,255] · normalization inside the model
graph. Training and app must change together or not at all — see
[[duplicated-knowledge]] and training/tests/test_exif_parity.py.

## LiteRT model shape (staticize)

DeepBlue exports dynamic batch; LiteRT 2.5.3 has no resize API.
`staticizeModelBytes()` patches `[-1,224,224,3]` → `[1,...]` and the
output batch ints — METADATA ONLY, weights untouched, idempotent,
validates the expected layout and **fails closed** on anything
unexpected (a future model that doesn't match is rejected, never
half-patched). Future model exports should move to static batch 1 in
train_fish_id.py and must be tested against this path.

## DO NOT REPEAT (each of these shipped, broke, and cost builds)

1. Do not rely on a downloaded model as the only offline model.
2. Do not require Check for Updates to initialize Fish ID.
3. Do not cache a failed init promise indefinitely.
4. Do not let a bad cached model prevent bundled fallback.
5. Do not use CDN runtime dependencies for an advertised offline feature.
6. Do not reintroduce tfjs-tflite into the production app path without
   explicit approval and fresh device testing.
7. Do not call cloud identification "DeepBlue".
8. Diagnostics must distinguish DEEPBLUE_LOCAL / CLAUDE_CLOUD /
   MANUAL-NONE.
9. Do not claim offline capability from simulator/browser tests.
10. The fresh-install Airplane-Mode device test is the final authority.

Bonus, debugging: WebKit `Error.stack` omits name AND message — log
`e.name: e.message` first, or you will chase anonymous frames for five
builds (we did).

## Admin exception

Admin Test Image tooling (`src/admin/TestImagePanel.jsx`,
`src/admin/fishIdRuntime.js`) still independently uses tfjs-tflite and
`public/models/tflite/`. That is ADMIN TEST TOOLING, not production app
inference. Keep the distinction; migrating admin to LiteRT is fine,
un-migrating the app is not.
