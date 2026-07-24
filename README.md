# Know Your Catch

**Identify it. Know the rules. Stay legal.**

Gulf Coast offshore angler tool — photo identification, structured lookalike comparison, jurisdiction-aware regulations, and personal best tracking. Designed to work offline.

This is the **lean v1 prototype**. See [Roadmap](#roadmap) for what's intentionally out of scope and how it grows from here.

---

## Quick start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. The app is mobile-first — for the real experience, open the local URL on your phone (same Wi-Fi) or use Chrome / Safari DevTools mobile emulation. Width is capped at 440 px.

```bash
npm run build      # production build to dist/
npm run preview    # serve the production build locally
```

---

## What works

- **Photo capture flow** with on-device "analyzing" UI, then three result paths:
  - **High confidence** → confirmed result with model evidence + lookalike cross-check
  - **Medium confidence** → side-by-side disambiguation across candidates
  - **Low confidence** → honest "couldn't identify" + manual fallback
- **Manual identification** — browse by category, search by name (common, scientific, regional/alternate names)
- **Lookalike comparison** — structured discriminating features called out per pair (no prose)
- **Regulations engine** — six jurisdictions (5 Gulf states + federal), auto-shows federal column when rules differ from picked state, gear requirements for reef fish, HMS permit flags, sector-specific notes (private rec vs. for-hire)
- **Personal Bests** — length + weight tracked, user picks "the PB," auto-detects new records, history of beaten PBs preserved, optional photo
- **Disclaimer modal** on first launch, versioned (re-acceptance required when text is updated)
- **Persistent local state** via `localStorage` (PBs, notes, settings, jurisdiction)
- **Offline-ready** — no network calls. All data bundled.

---

## The photo ID model — integration point

**Right now, photo identification is a stub.** It returns canned sample results that rotate based on the image bytes — enough to drive the UI flow and demo all three confidence paths, but it isn't doing real inference.

The integration point is exactly one file: **`src/identifyPhoto.js`**. Read the comment block at the top. When the real on-device ML model is built (TensorFlow Lite, Core ML, ONNX Runtime), replace the body of `identifyPhoto()`. The contract:

```js
identifyPhoto(imageDataUrl: string) -> Promise<{
  confidence: 'high' | 'medium' | 'low',
  candidates: [
    { speciesId: string, score: number, evidence: string[] }
  ]
}>
```

The rest of the app does not change.

---

## Project layout

```
know-your-catch/
├── README.md                    you are here
├── package.json
├── vite.config.js
├── index.html
└── src/
    ├── main.jsx                 React entry
    ├── App.jsx                  routing, navigation, modals
    ├── index.css                global reset
    ├── theme.js                 colors (the T constant)
    ├── data.js                  ALL data tables (species, regs, lookalikes, jurisdictions)
    ├── storage.js               localStorage-backed app state
    ├── helpers.js               formatters, regStatus, differs, etc.
    ├── components.jsx           primitives + FishMark + modals
    ├── screens1.jsx             home, identify, photo flow, categories, search
    ├── screens2.jsx             species detail, regs, compare, PBs, settings
    └── identifyPhoto.js         🔌 ML INTEGRATION POINT 🔌
```

10 source files. Intentional: small enough to navigate, large enough that no one file is a wall.

---

## Editing data

The seed regulations in `src/data.js` are **placeholder values** labelled "verify." They reflect roughly what's been on the books in recent seasons but **must not be relied on for actual fishing decisions**. Replace this file with authoritative current data before any real use.

- **`SPECIES`** — array of species objects (id, commonName, altNames, scientific, category, keyIds, lookalikes, habitat, typicalSize, reefFish, hms)
- **`COMPARISONS`** — keyed by sorted pair `"speciesA:speciesB"`, value is array of `{ feature, a, b }` rows
- **`REGULATIONS`** — built by `buildRegs()` to deduplicate common values. Spec defaults at the top, override per-jurisdiction underneath.
- **`JURISDICTIONS`** — five states + federal Gulf
- **`CATEGORIES`** — the eleven categories used in browsing

Bump `DATA_VERSION` and `DATA_BUILD_DATE` when you push data updates. Bump `DISCLAIMER_VERSION` when the disclaimer text changes (forces re-acceptance).

---

## Design choices, briefly

- **Single file per concern, not micro-files.** All data in `data.js`. All components in `components.jsx`. Screens split into two files only because the combined file is 1300+ lines.
- **No CSS framework.** Inline styles with a shared `T` (theme) object. Fewer abstractions, easier for Claude Code to edit cleanly.
- **No routing library.** A simple `screenStack` array in `App.jsx`. Push, pop, reset. Enough for a 16-screen mobile app.
- **High-contrast light theme.** Tuned for outdoor sun on a phone screen. Dark mode skipped intentionally (glare on water washes out dark themes).
- **Colorblind-safe status pills.** Open / Closed / Verify use shape AND color (circle / square / triangle), not color alone.
- **Photo storage via base64 in localStorage.** Fine for the prototype; should move to IndexedDB or native filesystem for production (localStorage caps around 5 MB).

---

## What was intentionally cut (and lives in v2)

| Cut from v1 | Where it goes in v2 |
|---|---|
| Real ML model for photo ID | Train and embed; `identifyPhoto.js` is the swap point |
| User accounts | Sign in with Apple required; account unlocks cloud sync |
| Cloud sync for PBs | Tied to accounts. Local-only until then |
| Admin web dashboard | Web app you log into to edit regs centrally |
| Correction reports backend | v1 uses `mailto:` link; v2 has structured intake + review |
| User-facing regulation overrides | Reconsider once central data is reliable |
| GPS-based jurisdiction suggestion | Add only with strong UX guardrails |
| Native iOS build | Wrap in React Native or rebuild in SwiftUI |

---

## Roadmap

**Now:** the prototype here. Polish, gather feedback, lock the data model.
**Next:** ship to TestFlight (React Native shell around this code, or direct port) with real regulation data verified against agencies. Still no ML.
**Then:** integrate on-device photo ID model. Add accounts + sync + admin dashboard.
**Later:** correction-report backend, expanded species set, additional regions.

---

## Disclaimer

This software is provided as an informational tool. Fishing regulations change frequently and the data shipped here is seed/sample data. Verify all rules with the appropriate state or federal agency before harvesting any fish. The publisher accepts no liability for citations, fines, or other consequences arising from use of this software.
