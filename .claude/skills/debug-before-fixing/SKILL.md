---
name: debug-before-fixing
description: Use when a bug is reported from the iOS app and the cause isn't directly visible in code. Enforces measuring before changing, because each wrong guess costs a TestFlight round-trip.
---

# Debug before fixing

Every speculative fix here costs a build, an upload, 5–30 minutes of
Apple processing, and Robert's time re-testing. A guess is not cheap.

## The rule

**Do not ship a fix for a cause you have not observed.** If the cause
isn't visible in the code, ship *instrumentation* first and ask for the
output. One extra round-trip to know beats three to guess.

## What this cost when ignored

Real sequence from the fish-ID work, in order:

1. Guessed EXIF rotation from a screenshot. Wrong — it was
   `object-fit: cover` against a fixed height.
2. Guessed routing (cloud never consulted). Real, but secondary.
3. Guessed a confidence threshold would gate bad answers. Wrong — the
   model returned **0.75 on the wrong species**.
4. Only then added a diagnostic line. It immediately showed the actual
   cause, and every subsequent fix was aimed correctly.

Three builds and a frustrated user before measuring. The diagnostic took
one build.

## How to instrument

- Attach a `_diag` string to the result object and render it in the UI
  (grey monospace under the relevant element). On-device, there is no
  console to read.
- Report the *specific* reason on every silent bail. A function that
  returns `null` for offline, signed-out, rate-limited and thrown-error
  alike makes a working path indistinguishable from a broken one.
- Prefer explicit booleans over inferring state by string-matching a
  human-readable note. That exact shortcut broke once here.
- Print the numbers you're reasoning about — box dimensions, scores,
  which branch ran. "It didn't work" is not data; `raw 0.77x0.99` is.

## Read the symptom's SHAPE before guessing a cause

The symptom often names the failure mode on its own:

| Symptom | What it means | Not |
|---|---|---|
| Button does nothing, no error, no crash | a promise that never settles — a **hang** | a failure |
| Thing silently vanishes, flow continues | a rejected promise nobody caught | a hang |
| Wrong answer, high confidence | model/data problem | a routing or threshold problem |

This distinction was the whole 2026-08-10 catch-photo bug. `savePhoto`
awaited a Supabase Storage upload with no timeout, so on a weak signal
it hung forever. Two builds saw two different faces of the same line:

- overlay closed *before* the save → the photo vanished silently
- overlay made to wait for the save → LOG CATCH looked like a dead button

The first fix made the failure visible without fixing what was failing —
correct, but treating the symptom. The dead button was the clue that
said *hang*, and a hang points at an `await`, not at error handling.

**When a local-first operation depends on the network, ask what happens
with one bar of signal — not zero.** Offline is the easy case; code
usually short-circuits on `navigator.onLine === false`. A slow, alive
connection is the one that hangs, and it's the one anglers actually have
on a boat.

## An empty answer is not an empty table

**Nothing came back** and **there is nothing there** look identical and
mean completely different things. Before reporting absence, prove it is
absence.

2026-10-07, stated to Rob as fact, repeatedly, for most of a day: "the
hotspot tables are completely empty." They were not. `hotspot_zones`
grants select to `authenticated` only, and the reads were anonymous.
**PostgREST returns `[]` for rows RLS hides — not an error, not a 403.**
132 rows were sitting there the whole time. The admin console, signed
in, was drawing them across the whole Gulf; he sent a screenshot of it
while being told the table was empty.

The cost was not just the wrong answer. A whole night's diagnosis was
built on it, and he had to argue against a confident claim to get back
to the truth.

So, whenever a query returns nothing:

- **Check the permissions before reporting the absence.** Who is this
  query running as, and what is that role allowed to see? For Supabase,
  read the policy — `to anon` and `to authenticated` are different
  answers to the same question.
- **Cross-check against something that disagrees.** A row count of zero
  next to a UI drawing that data means the read is wrong, not the UI.
  Take the contradiction seriously the first time.
- An empty result from one credential proves one thing: that credential
  sees nothing.
- The same trap wears other clothes: a filtered query whose filter is
  wrong, a soft-delete column, a schema search path, a stale replica.

## Say which parts you verified and which you inferred

Rob, after the above: *"it hurts me more when you tell me something that
ends up being wrong, than you not being completely certain."*

That is the standard. Confidence has to be earned per claim, not
inherited from the rest of the diagnosis being sound.

- Mark each claim as observed or inferred, and say how it was observed.
  "`hotspots` returned 0 rows to an anonymous reader" is a fact. "The
  table is empty" is a conclusion that needs the permissions checked
  first.
- "I don't know yet" is a complete and acceptable answer. A wrong
  certainty costs far more than an admitted gap.
- When evidence contradicts the running theory, say so immediately and
  out loud. Do not quietly fold it in.
- A long chain of correct reasoning does not make its weakest premise
  true. The premise is the thing to go back and check.

## Before claiming a fix works

- Say what was verified and how. "Archive succeeded" proves it compiled,
  not that it runs.
- If a claim can't be checked from here (TestFlight state, DB contents,
  device behaviour), say so and ask.
- When a previous explanation turns out to be wrong, correct it plainly
  in the next message rather than quietly moving on.

## When several fixes haven't landed

Stop shipping. Say plainly what has been tried and measured, what the
evidence rules out, and offer to revert to the last state that was
demonstrably better. Continuing to iterate live erodes trust faster than
the bug does.
