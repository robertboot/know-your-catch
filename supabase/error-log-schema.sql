-- Client error log — so a crash reports itself.
--
-- Two testers hit a blank screen / crash and neither could produce a
-- device log, which left nothing to debug. This table is the fix: the
-- app posts its own errors, with enough context to reproduce them.
--
-- Anonymous INSERT on purpose — the users who most need this are the
-- ones with no account (a guest hitting a crash is exactly the case we
-- lost). Nobody but the admin can read it back.

create table if not exists public.error_log (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  kind         text not null,                 -- 'react' | 'window' | 'promise'
  message      text not null,
  stack        text,
  screen       text,                          -- route/screen name when known
  is_guest     boolean,                       -- no account = the 5.1.1 path
  has_jurisdiction boolean,
  app_version  text,
  platform     text,                          -- 'ios' | 'android' | 'web'
  user_agent   text,
  user_id      uuid,
  fingerprint  text not null,                 -- kind|message|first stack frame
  resolved_at  timestamptz
);

create index if not exists error_log_recent on public.error_log (occurred_at desc);
create index if not exists error_log_fp     on public.error_log (fingerprint);

alter table public.error_log enable row level security;

-- Anyone running the app may report a crash, and only report one.
drop policy if exists error_log_anon_insert on public.error_log;
create policy error_log_anon_insert on public.error_log
  for insert to anon, authenticated with check (true);

drop policy if exists error_log_admin_read on public.error_log;
create policy error_log_admin_read on public.error_log
  for select using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

drop policy if exists error_log_admin_update on public.error_log;
create policy error_log_admin_update on public.error_log
  for update using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

-- Grouped view for the admin tab: one row per distinct fault, newest
-- first. Counting occurrences matters more than listing them — the same
-- crash hitting 20 people is one bug, not twenty.
create or replace function public.error_log_grouped(since_hours integer default 168)
returns table (
  fingerprint text, kind text, message text, stack text, screen text,
  occurrences bigint, first_seen timestamptz, last_seen timestamptz,
  guests bigint, unresolved bigint
)
language sql security definer stable as $$
  select e.fingerprint,
         min(e.kind)    as kind,
         min(e.message)  as message,
         (array_agg(e.stack  order by e.occurred_at desc))[1] as stack,
         (array_agg(e.screen order by e.occurred_at desc))[1] as screen,
         count(*)                                            as occurrences,
         min(e.occurred_at)                                  as first_seen,
         max(e.occurred_at)                                  as last_seen,
         count(*) filter (where e.is_guest)                  as guests,
         count(*) filter (where e.resolved_at is null)        as unresolved
  from public.error_log e
  where lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
    and e.occurred_at > now() - make_interval(hours => since_hours)
  group by e.fingerprint
  order by max(e.occurred_at) desc;
$$;
grant execute on function public.error_log_grouped(integer) to authenticated;

-- Mark every occurrence of one fault resolved.
create or replace function public.error_log_resolve(fp text)
returns integer language plpgsql security definer as $$
declare n integer;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'robertb1023@me.com' then
    raise exception 'not authorised';
  end if;
  update public.error_log set resolved_at = now()
   where fingerprint = fp and resolved_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.error_log_resolve(text) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------
-- DAILY DIGEST (run AFTER: supabase functions deploy error-digest)
-- ---------------------------------------------------------------
-- Replace YOUR_ANON_KEY and YOUR_CRON_SECRET below, then run this
-- block. Mails only when something actually broke, so silence means
-- silence.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('error-digest-daily');
exception when others then null; end $$;

select cron.schedule(
  'error-digest-daily',
  '20 13 * * *',        -- 13:20 UTC ≈ 8:20am Central
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/error-digest',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer YOUR_ANON_KEY',
      'x-cron-secret',  'YOUR_CRON_SECRET'
    ),
    body    := '{}'::jsonb
  );
  $$
);
