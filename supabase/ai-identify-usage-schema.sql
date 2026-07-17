-- ReelIntel — per-user daily usage counter for the app's online
-- Fish ID (identify-fish edge function).
--
-- Purpose: cap how many Claude-vision identifies a single angler can
-- run per day, so the app's online ID stays cheap and abuse-resistant.
-- Only the identify-fish function (service role) reads/writes this
-- table; no client ever touches it directly.
--
-- Run once, in the Supabase SQL Editor.

create table if not exists public.ai_identify_usage (
  user_id    uuid        not null,
  day        date        not null,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- RLS on, with NO client policies. The edge function uses the service
-- role (which bypasses RLS), so locking every client out is exactly
-- what we want — this counter is never readable or writable from a
-- phone or the admin.
alter table public.ai_identify_usage enable row level security;

-- Housekeeping: an index to prune old days if you ever want to.
create index if not exists ai_identify_usage_day_idx
  on public.ai_identify_usage (day);
