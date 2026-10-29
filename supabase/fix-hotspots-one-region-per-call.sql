-- Suggested Spots has always been empty. This is why.
--
-- find-hotspots looped all twelve active regions in ONE invocation, reading
-- four satellite grids each. The scheduler calls it through pg_net with a
-- 60 s ceiling, and cron-timeout-fix.sql already recorded what pg_net does
-- at that ceiling: it closes the socket, which cuts the edge function off
-- mid-run. Both of the function's writes sit at the END of a region's block,
-- so the run died before the first one landed. Every night. hotspots: 0
-- rows. hotspot_zones: 0 rows. Nothing for the map to draw.
--
-- The function now does ONE region per call, oldest run first. This file
-- gives it the column to order by and fires it every ten minutes, so all
-- twelve refresh inside two hours and no call can outlive its socket.
--
-- Run AFTER: supabase functions deploy find-hotspots
-- Idempotent: safe to run twice.

-- 1) The column the function orders by. Null sorts first, so a region that
--    has never run is always next in line.
alter table public.hotspot_regions
  add column if not exists last_run_at timestamptz;

-- 2) Reschedule: every ten minutes, 120 s ceiling.
do $mig$
declare
  src    text;
  bearer text;
  secret text;
  cmd    text;
begin
  -- Keys are read out of a job that already works, so they never appear
  -- in this file.
  select command into src from cron.job
   where command like '%Authorization%' and command like '%x-cron-secret%' limit 1;
  if src is null then
    raise exception 'No existing cron job to copy the keys from.';
  end if;
  bearer := (regexp_match(src, '''Authorization''\s*,\s*''(Bearer [^'']+)'''))[1];
  secret := (regexp_match(src, '''x-cron-secret''\s*,\s*''([^'']+)'''))[1];
  if bearer is null or secret is null then
    raise exception 'Could not read the keys out of the existing job.';
  end if;

  cmd := format(
    $$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', %L,
          'x-cron-secret', %L),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000)$$,
    'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/find-hotspots',
    bearer, secret);

  perform cron.schedule('find-hotspots-nightly', '*/10 * * * *', cmd);
  raise notice 'find-hotspots now runs every 10 minutes, one region per call';

  -- Fire once now so the first region lands without waiting.
  execute cmd;
end
$mig$;

-- Verify. Run this again every few minutes — the count should climb as
-- regions come in, and last_run_at should fill from the top.
--   select count(*) as spots from public.hotspots;
--   select region_id, count(*) from public.hotspot_zones group by 1 order by 1;
--   select id, last_run_at from public.hotspot_regions order by last_run_at nulls first;
