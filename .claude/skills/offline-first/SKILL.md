---
name: offline-first
description: Use before adding or changing anything that gates the app, saves a catch, or touches the network — auth checks, photo writes, model loads, cloud sync. The app is used offshore with no signal, and two shipped bugs came from forgetting that.
---

# Offline-first is a hard requirement

Robert's standing constraint, verbatim:

> "USER APP STAYS OFFLINE-FIRST. Fish ID, catch-logging, regs, quiz must
> all work fully in airplane mode."

The app is used on a boat. That is not an edge case to degrade
gracefully into — it is the primary environment.

## The two failures that shipped

**1. The sign-in gate locked anglers out of their own phone.**
`App.jsx` gated the entire app on a live Supabase session. Access tokens
expire hourly, and `getSession()` refreshes over the network — offshore
that resolves to `null`. The angler lost access to catches stored
locally on their own device.

There was a *second* gate behind it: the splash auto-dismiss also
required `session`, so fixing only the render gate would have admitted
them and then left them staring at the splash forever. **Grep for every
site that reads the same condition**, not just the one in the bug report.

Fix shape: track "this device signed in and never signed out" separately
from "we hold a live token" (`hasLocalCredential()` in `auth.js`). It is
not a security control — it gates local on-device data only; cloud reads
still carry a real token and RLS enforces server-side.

**2. A catch save hung on a cloud upload.**
`savePhoto()` awaited a Supabase Storage upload that has no client
timeout. Its own doc comment said "fire-and-forget… so a slow network
never blocks the save" — the code did the opposite. See
[[debug-before-fixing]] for how the symptom (dead button) named the
cause (hang, not failure).

## The rule

**Ask what happens at ONE bar, not zero.** Zero is the easy case — code
short-circuits on `navigator.onLine === false`. A slow-but-alive
connection is what hangs, and it is what a boat actually has.

Before shipping anything that touches the network:

- Does a local-first operation `await` a network call? It must not.
  Fire-and-forget with `.catch()`, or add a timeout.
- Does a gate read a value that requires the network to refresh?
  Sessions, signed URLs, and remote config all do.
- Is the model cached? DeepBlue caches to Filesystem, but only after it
  has been fetched once — any screen that can reach `identifyPhoto` must
  warm it (`wantsModel` in `App.jsx`), or an angler who never opened the
  Fish-ID tab has no model at all offshore.
- Never persist a resolved `capacitor://` URI. The container UUID
  changes per install; store the relative path and rebuild.

## Testing it

Airplane mode, force-quit, relaunch. Then: sign-in gate, log a catch
with a photo, run a Fish ID, open regulations. All four must work.

Note that Simulator and a desk wifi connection both hide the failure
that matters. The hang needs a *weak* connection, not no connection.
