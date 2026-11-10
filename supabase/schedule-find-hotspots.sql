-- Schedule find-hotspots nightly AND fire it once right now.
--
-- The function was deployed and the tables created, but nothing ever
-- called it — no cron row, so hotspots stayed empty and the Ocean Maps
-- "Suggested spots" layer had nothing to draw.
--
-- No keys to paste: the Authorization and x-cron-secret values are read
-- out of a cron job that already works (same pattern as
-- cron-health-and-newsletter.sql), so they never appear in this file.
--
-- Run AFTER: supabase functions deploy find-hotspots
-- Idempotent: cron.schedule replaces a job of the same name; the
-- immediate fire just queues one extra run.

do $mig$
declare
  src    text;
  bearer text;
  secret text;
  base   text := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/';
  cmd    text;
begin
  select command into src from cron.job
   where command like '%Authorization%' and command like '%x-cron-secret%' limit 1;
  if src is null then
    raise exception 'No existing cron job to copy the keys from — schedule one job by hand first.';
  end if;
  bearer := (regexp_match(src, '''Authorization''\s*,\s*''(Bearer [^'']+)'''))[1];
  secret := (regexp_match(src, '''x-cron-secret''\s*,\s*''([^'']+)'''))[1];
  if bearer is null or secret is null then
    raise exception 'Could not read the keys out of the existing job.';
  end if;

  -- Nightly at 09:40 UTC — after the overnight satellite composites land,
  -- before dawn Central. 60 s timeout per cron-timeout-fix.sql: the run
  -- reads two satellite grids and takes longer than pg_net's 5 s default.
  cmd := format(
    $$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', %L,
          'x-cron-secret', %L),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000)$$,
    base || 'find-hotspots', bearer, secret);

  perform cron.schedule('find-hotspots-nightly', '40 9 * * *', cmd);
  raise notice 'scheduled find-hotspots-nightly at 09:40 UTC';

  -- Fire once immediately so the map has rows today.
  execute cmd;
  raise notice 'fired find-hotspots once — rows should appear within a minute';
end
$mig$;

-- Verify (run ~1 min later):
--   select count(*) from public.hotspots;
--   select status_code, error_msg from net._http_response order by created desc limit 3;
