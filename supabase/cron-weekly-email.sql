-- Weekly Waters Report — Thursday draft generation.
--
-- This schedules GENERATION only. Nothing is mailed by this job: it builds
-- a draft and stops, and an admin approves it in ReelIntel Admin →
-- Weekly email. That separation is deliberate — see weekly-email-schema.sql.
--
-- Replace PASTE_ANON_KEY and PASTE_CRON_SECRET with the real values (the
-- same two the other cron jobs already use), then run the whole file.

do $$
begin
  perform cron.unschedule('weekly-report-generate-thu');
exception when others then null;
end $$;

-- 11:00 UTC Thursday = 6am Central / 7am Eastern. Early enough that a
-- blocked edition can be fixed and regenerated before anyone would
-- reasonably expect the email.
select cron.schedule(
  'weekly-report-generate-thu',
  '0 11 * * 4',
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer PASTE_ANON_KEY',
                 'x-cron-secret', 'PASTE_CRON_SECRET'
               ),
    -- One call per waters. A jurisdiction with no subscribers returns
    -- immediately without building anything, so listing all six costs
    -- nothing and means a new state lights up the moment someone signs
    -- up for it.
    body    := '{"jurisdiction": "al_state"}'::jsonb
  );
  $$
);

-- The other five, staggered a minute apart so six forecast fetches do not
-- land on Open-Meteo at the same instant.
select cron.schedule('weekly-report-generate-ms', '1 11 * * 4', $$
  select net.http_post(
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "ms_state"}'::jsonb); $$);

select cron.schedule('weekly-report-generate-la', '2 11 * * 4', $$
  select net.http_post(
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "la_state"}'::jsonb); $$);

select cron.schedule('weekly-report-generate-tx', '3 11 * * 4', $$
  select net.http_post(
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "tx_state"}'::jsonb); $$);

select cron.schedule('weekly-report-generate-flg', '4 11 * * 4', $$
  select net.http_post(
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "fl_state"}'::jsonb); $$);

select cron.schedule('weekly-report-generate-fla', '5 11 * * 4', $$
  select net.http_post(
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "fl_atlantic"}'::jsonb); $$);

-- Confirm:
select jobname, schedule, active from cron.job where jobname like 'weekly-report%' order by jobname;
