-- Autonomous regulations updater — schema + schedule.
--
-- Adds check-tracking columns to regulations, a run-log table the
-- dashboard reads, and an hourly pg_cron job that invokes the
-- auto-update-regulations edge function with a shared secret.
--
-- BEFORE RUNNING: replace the two placeholders in the cron block
-- at the bottom (project ref hfptpsmdfemduhkueyoz is already filled in):
--   YOUR_ANON_KEY    — dashboard ▸ Project Settings ▸ API ▸ anon public.
--                      Clears the gateway's JWT check so the scheduled
--                      POST isn't rejected with 401 before the function
--                      runs. Safe to embed (same key shipped in the app).
--   YOUR_CRON_SECRET — the same value you set with:
--     supabase secrets set CRON_SECRET=<random string>
--
-- NOTE: to fix jobs that are ALREADY failing with 401, run
-- supabase/cron-fix.sql — it reschedules all three cron jobs at once.

-- 1) Check-tracking columns.
alter table public.regulations
  add column if not exists last_checked_at timestamptz,
  add column if not exists auto_published  boolean not null default false;

-- Rotation index: the updater always grabs the least-recently-checked
-- pairs first, so the whole grid cycles continuously.
create index if not exists regulations_last_checked
  on public.regulations (last_checked_at asc nulls first);

-- 2) Run log — one row per updater invocation. The admin dashboard's
--    Health strip reads the latest row.
create table if not exists public.regs_auto_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  checked     integer not null default 0,
  published   integer not null default 0,   -- auto-verified this run
  drafted     integer not null default 0,   -- low-confidence, left as draft
  unchanged   integer not null default 0,   -- existing data kept
  failed      integer not null default 0,
  detail      jsonb                          -- per-pair outcomes for debugging
);

alter table public.regs_auto_runs enable row level security;

-- Admin can read the log (dashboard). The edge function writes with
-- the service role, which bypasses RLS — no write policy needed.
drop policy if exists regs_auto_runs_admin_read on public.regs_auto_runs;
create policy regs_auto_runs_admin_read on public.regs_auto_runs
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

-- 3) Steady-state schedule (twice daily). pg_cron + pg_net ship with
--    Supabase; the job POSTs to the edge function with the shared
--    secret. First pass completed 2026-08 — every pair has been
--    researched once, so runs are now re-checks. Batch of 8 pairs,
--    twice daily (~16 pairs/day) cycles the grid roughly quarterly.
--    See .claude/skills/api-cost-control for the cadence rule; hourly
--    at this batch size was ~$12/day in Anthropic web-search tokens.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Drop any previous schedule with the same name (idempotent re-run).
do $$
begin
  perform cron.unschedule('regs-auto-update-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'regs-auto-update-hourly',
  '17 6,18 * * *',   -- 06:17 and 18:17 UTC, off the top-of-hour rush
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/auto-update-regulations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- The anon key is a valid project JWT: it clears the gateway's
      -- verify_jwt check so the request reaches the function, which then
      -- authenticates for real on x-cron-secret. Without it the gateway
      -- 401s before the function runs. (Alternative: deploy the function
      -- --no-verify-jwt and drop this line.)
      'Authorization', 'Bearer YOUR_ANON_KEY',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body    := '{"batch": 8}'::jsonb
  );
  $$
);

notify pgrst, 'reload schema';
