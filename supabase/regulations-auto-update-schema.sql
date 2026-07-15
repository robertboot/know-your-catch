-- Autonomous regulations updater — schema + schedule.
--
-- Adds check-tracking columns to regulations, a run-log table the
-- dashboard reads, and an hourly pg_cron job that invokes the
-- auto-update-regulations edge function with a shared secret.
--
-- BEFORE RUNNING: replace the two placeholders in the cron block
-- at the bottom:
--   YOUR_PROJECT_REF — from your Supabase project URL
--   YOUR_CRON_SECRET — the same value you set with:
--     supabase secrets set CRON_SECRET=<random string>

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

-- 3) Hourly schedule. pg_cron + pg_net ship with Supabase; the job
--    POSTs to the edge function with the shared secret. Batch of 5
--    pairs per run (concurrency 3 inside the function keeps it well
--    under the edge wall-clock) ≈ 120 pairs/day → the full ~570-pair
--    grid (95 species × 6 jurisdictions) refreshes about every 5 days.
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
  '17 * * * *',   -- hh:17 every hour, off the top-of-hour rush
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/auto-update-regulations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'YOUR_CRON_SECRET'
    ),
    body    := '{"batch": 5}'::jsonb
  );
  $$
);

notify pgrst, 'reload schema';
