---
name: supabase-migration
description: Author a Supabase SQL migration (schema, RLS, RPC, bucket) and hand it to the user to run. Use when a change needs a DB table, policy, storage bucket, or data consolidation.
---

# Supabase migration

DB changes are delivered as **idempotent SQL files in `supabase/`** that the
USER runs in the Supabase SQL editor — the agent cannot run them (no DB creds
in the sandbox).

## Steps
1. Write a new file `supabase/<kebab-name>.sql`. Make it **re-runnable**:
   `create table if not exists`, `drop policy if exists … create policy`,
   `insert … on conflict do nothing`, etc.
2. Match existing conventions (see `supabase/schema.sql`, `regulations-schema.sql`,
   `training-exports-schema.sql`): explicit RLS, `auth.uid()` checks, admin
   allow-list where relevant.
3. Data cleanups (species/regulation consolidation) go in their own file
   (`orphan-species-consolidation.sql`, `red-drum-consolidation.sql` are examples)
   and should be safe to run once.
4. After committing, **tell the user exactly which file(s) to run** and in what
   order — this is an owed manual step, not something the push completes.

## Validation
- Feeds: `npm run validate-feeds` (`regulations/validate.mjs`).
- Photos: `npm run validate-photos` (`photos/validate.mjs`).
Run the relevant validator before shipping data changes.

## Handing SQL to the user

The user pastes whole messages into the SQL editor. Twice in one
session a **prose line was copied in with the SQL** and Postgres
rejected it:

```
ERROR: 42601: syntax error at or near "And"
LINE 20: And per-jurisdiction, to confirm the two new regions ...
```

Both times the SQL was fine. So:

- **One statement per message**, and nothing between fences. Explanation
  goes above the fence or in a later message — never between two
  queries.
- If two results are needed, **merge them into one statement**
  (`group by rollup (...)`, a `union all`, a CTE) rather than sending
  two blocks.
- **Never ask for a column containing a secret.** `cron.job.command`
  holds `CRON_SECRET`; select `jobid, jobname, schedule, active` and
  leave `command` out, so it cannot land in chat.
- Quote reserved words used as aliases — `count(*) as "rows"`.

## Gotchas that fail silently

- **PostgREST caps unbounded selects at 1000 rows.** A grid already past
  1300 will read as 1000 with no error and no warning — an
  under-report, not a failure. Use explicit `.range(0, 9999)` on any
  select that could exceed it.
- **`cron.job` is owned by `supabase_admin`** in newer projects.
  `update cron.job ...` gives `42501: permission denied for table job`
  from the SQL editor. `cron.schedule()` with the same jobname
  overwrites, but needs the full command re-supplied — including the
  secret, which the user must paste themselves.
- **pg_net is async** — see [[regulations-update]] and the cron health
  RPC. `cron.job_run_details` says "succeeded" the moment a request is
  queued; the truth is in `net._http_response`.
