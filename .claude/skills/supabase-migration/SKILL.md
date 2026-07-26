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
