---
name: api-cost-control
description: Use when the Anthropic bill is the concern, or before adding/changing anything that calls the Anthropic API on a schedule or per-item loop. Records where the spend actually is and the first-pass vs steady-state cadence rule.
---

# Anthropic API cost

The bill was investigated on 2026-08-06. One call site dominated, and it
was not the one anybody would guess.

## Where the spend is

| Function | Model | Fires |
|---|---|---|
| `auto-update-regulations` | Sonnet 5, 4000 tok, `web_search` | **hourly cron — the bill** |
| `research-regulations` | Sonnet 5, 4000 tok, `web_search` | admin drafts by hand |
| `classify-fish-photo` | Sonnet 5 vision, 400 tok | per photo, admin training sort |
| `identify-fish` | Sonnet 5 vision, 400 tok | only when DeepBlue has no answer |
| `research-species` | Sonnet 4.6, 1500 tok | on demand |

Two things make the top row dominate, and neither is obvious from
reading the code:

1. **Server-side `web_search` results come back as input tokens.** The
   `max_tokens: 4000` cap bounds the *output*. A pair that runs 5
   searches can pull tens of thousands of input tokens. Output is the
   small half of the bill.
2. **It runs whether or not anyone uses the app.** Per-user costs scale
   with adoption and are visible. A cron costs the same at 0 users as at
   10,000, forever, and nothing surfaces it.

## The first-pass rule

A rotating grid job has two distinct phases, and they deserve different
cadences:

- **First pass** — pairs have never been researched. Every run is real
  new coverage. Run it as fast as the function tolerates; total cost is
  fixed at (pairs × per-call), so going faster costs nothing extra.
- **Steady state** — every pair has been checked at least once. Every
  run is now a *re-check*. Left at first-pass speed, the hourly regs job
  re-researches all ~1300 pairs every ~11 days, forever.

**Check which phase you are in before tuning the schedule.** The admin
Home dashboard has a **Regs coverage** tile
(`adminRegsCoverage()` in `regulations-store.js`) that answers it, and
it goes `ok` when coverage *completes* — because that is the moment
action is needed, not the moment nothing is wrong.

Steady-state cadence is a compliance tradeoff, not a pure cost
decision. Season openings and closures move, and a stale reg is a
compliance problem — so the grid should still cycle at least quarterly.
Batch 8 twice daily (~15 pairs/day) cycles ~1300 pairs in ~90 days: an
87% cut from 120/day with nothing older than a quarter.

## Levers, cheapest-effort first

1. **Cadence.** Biggest by far. Nothing else is close.
2. **`max_uses` on `web_search`.** Cut 5 → 3 in both regs functions
   (commit `7e4af4f`). Searches 4 and 5 mostly re-read what the first
   three returned. Applies to every remaining call, costs no accuracy.
3. **Model tier per job.** `classify-fish-photo` picks a coarse bucket,
   not a fine ID — Haiku 4.5 would do. Still unspent.
4. **Gating.** Already done for `identify-fish`: DeepBlue answers
   whenever it has an answer, cloud only when there is none at all.

## Before blaming the app

**Claude Code sessions bill to the same account.** Long build sessions
are plausibly a large share of the total. The Anthropic usage page
splits session traffic from app traffic — say so rather than letting
the app take the blame for a number you have not attributed.

## When adding a new scheduled call site

- What does this cost per day at zero users?
- Is there a first pass that ends, and does anything *notice* when it
  does? A tile beats a comment.
- Does it use `web_search`? Then `max_tokens` is not the cost cap —
  `max_uses` is.

Related: [[regulations-update]] for the updater itself,
[[duplicated-knowledge]] for keeping the coverage tile's grid
definition in step with the edge function's.
