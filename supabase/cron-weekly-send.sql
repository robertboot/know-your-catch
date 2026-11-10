-- Post the editions a human has already approved.
--
-- Six jobs build drafts on Thursday morning and nothing ever carried them
-- the last mile: an approved edition sat in the console until somebody
-- pressed Send by hand. That is not an approval workflow, it is an
-- approval workflow with a missing postman.
--
-- The split is deliberate. APPROVE is the human decision and stays a
-- person's action in the console, recorded against their email. This job
-- only posts what is already signed: it cannot name an edition, cannot
-- touch a draft, a blocked or a discarded one, and cannot re-send one
-- already sent. A shared secret gets the narrow job; the person keeps the
-- wide one.
--
-- Runs every two hours through Thursday and Friday rather than once, so
-- an approval at nine in the morning does not wait until the following
-- week. Each sweep is a no-op when nothing is approved.
--
-- No keys to paste — they are read from a job that already works.

do $mig$
declare
  src    text;
  bearer text;
  secret text;
  cmd    text;
begin
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
    'select net.http_post(timeout_milliseconds := 60000, url := %L,'
    ' headers := jsonb_build_object(''Content-Type'',''application/json'',''Authorization'',%L,''x-cron-secret'',%L),'
    ' body := ''{}''::jsonb);',
    'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-send',
    bearer, secret);

  -- 13:20 UTC = 8:20am Central, two-hourly to 23:20 UTC, Thursday and Friday.
  perform cron.schedule('weekly-report-send-sweep', '20 13-23/2 * * 4,5', cmd);
  raise notice 'scheduled weekly-report-send-sweep';
end $mig$;

select jobname, schedule, active from cron.job
 where jobname like 'weekly-report%' order by jobname;
