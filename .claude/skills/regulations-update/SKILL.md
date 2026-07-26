---
name: regulations-update
description: Update fishing-regulation feed data, or work on the source monitor / autonomous updater. Use when changing regulations feeds, seasons/bag limits, the change-detection monitor, or the auto-update cron/edge function.
---

# Regulations pipeline

Two halves, deliberately split so **publication stays human-gated**:

1. **Detection (automatic)** — `regulations/monitor.mjs` fetches each watched
   official page (`regulations/.sources.json`), normalizes HTML → text, hashes
   it, and flags changes into `MONITOR_REPORT.md`. It **never edits feed data**;
   a change opens a PR for a human to re-verify. This is the "constantly
   searches" half.
2. **Autonomous updater (optional)** — an `auto-update-regulations` edge function
   invoked hourly by `pg_cron` (`supabase/regulations-auto-update-schema.sql`).
   It grabs the least-recently-checked pairs (rotation index
   `regulations_last_checked`) and logs each run to `regs_auto_runs`, which the
   admin dashboard Health strip reads.

## Editing feed data
- Feeds live in `regulations/feed` against `regulations/schema.json`.
- The app reads via `src/regulations-store.js`; home alerts via
  `src/regulation-alerts-store.js` (drives the "Regulation Alerts" card — first
  closed featured species + "+N more", or "All clear").
- **Always run `npm run validate-feeds`** (`regulations/validate.mjs`) before
  shipping — it enforces the schema. Then use the **ship-change** skill.

## Season/status logic
`seasonState(reg.open)` in `src/helpers.js` returns `open|closed|unknown`; the
UI uses federal fallback when a state feed is missing (no "CONFIRM SOURCE" pill).
Don't hardcode closures in the UI — drive them from feed data.

## Standing up the cron (owed manual steps)
Run `regulations-auto-update-schema.sql` after replacing `YOUR_PROJECT_REF` and
`YOUR_CRON_SECRET`; set `supabase secrets set CRON_SECRET=<random>`; deploy the
`auto-update-regulations` edge function. The agent cannot run these.
