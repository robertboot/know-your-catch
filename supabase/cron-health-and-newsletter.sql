-- Schedule the two things that were never actually scheduled: the weekly
-- newsletter draft, and a daily health check that emails only when
-- something needs doing.
--
-- No keys to paste. The Authorization and x-cron-secret values are read
-- out of a cron job that already works, so they cannot be typed wrong and
-- never appear in this file.
--
-- Run AFTER: supabase functions deploy daily-health-brief
-- Idempotent: cron.schedule replaces a job of the same name.

-- 1) Let the brief see the scheduled jobs.
--    admin_cron_health() gates on public.is_admin(), which needs a signed-in
--    email. An edge function runs as service_role and has none, so it gets
--    its own entry point — locked to service_role, unreachable from a browser.
create or replace function public.cron_health_internal()
returns jsonb
language sql
security definer
set search_path = public, cron, net
as $$
  select jsonb_build_object(
    'jobs', (
      select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb)
      from (select job.jobname, job.schedule, job.active from cron.job job order by job.jobname) j
    ),
    'recent_http', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from (
        select status_code, timed_out, error_msg, created
        from net._http_response order by created desc limit 20
      ) r
    )
  );
$$;
revoke all on function public.cron_health_internal() from public, anon, authenticated;
grant execute on function public.cron_health_internal() to service_role;

-- 2) Schedule everything, borrowing the keys from a job that already runs.
do $mig$
declare
  src    text;
  bearer text;
  secret text;
  base   text := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/';
  waters text[] := array['al_state','ms_state','la_state','tx_state','fl_state','fl_atlantic'];
  w      text;
  i      int := 0;
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

  -- Weekly newsletter DRAFTS, Thursday 11:00 UTC (6am Central), one call per
  -- waters a minute apart so six forecast fetches do not land at once.
  -- This generates only. Nothing reaches a subscriber without approval.
  foreach w in array waters loop
    cmd := format(
      'select net.http_post(timeout_milliseconds := 60000, url := %L,'
      ' headers := jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',%L,''x-cron-secret'',%L),'
      ' body := %L::jsonb);',
      base || 'weekly-report-generate', bearer, secret,
      format('{"jurisdiction": "%s"}', w));
    perform cron.schedule('weekly-report-generate-' || w, format('%s 11 * * 4', i), cmd);
    raise notice 'scheduled weekly-report-generate-% at %:11 UTC Thursday', w, i;
    i := i + 1;
  end loop;

  -- Daily health brief, 12:12 UTC (7:12am Central) — after Thursday's
  -- drafts exist, so the day they are waiting is the day he is told.
  cmd := format(
    'select net.http_post(timeout_milliseconds := 60000, url := %L,'
    ' headers := jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',%L,''x-cron-secret'',%L),'
    ' body := ''{}''::jsonb);',
    base || 'daily-health-brief', bearer, secret);
  perform cron.schedule('daily-health-brief', '12 12 * * *', cmd);
  raise notice 'scheduled daily-health-brief at 12:12 UTC daily';

  -- And send one now, forced, so the format can be seen today.
  perform net.http_post(
    timeout_milliseconds := 60000,
    url     := base || 'daily-health-brief',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', bearer, 'x-cron-secret', secret),
    body    := '{"test": true}'::jsonb);
  raise notice 'test brief requested';
end $mig$;

-- Confirm:
select jobname, schedule, active from cron.job order by jobname;
