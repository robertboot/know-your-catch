-- Weekly email: a second, automatic pass twenty minutes after the first.
--
-- The Thursday 11:00 UTC job generates the draft and, where a printed
-- regulation is unconfirmed, kicks a background re-check and marks the
-- edition BLOCKED. That is correct when an operator is about to look at
-- it. With nobody watching it withholds the entire email — forecast,
-- satellite maps and all — from every subscriber of those waters, and it
-- stays withheld until somebody notices. Four waters sat blocked for
-- days this way.
--
-- This pass runs at :20, by which time the re-check has landed. It sends
-- {"auto": true}, which drops any still-unconfirmed CHANGE from the
-- issue and lets the rest go out; the email already prints a line saying
-- what was left out, and admin still lists the held rows so they can be
-- verified. Nothing is mailed by either pass — an admin still approves.
--
-- Replace PASTE_ANON_KEY and PASTE_CRON_SECRET with the same two values
-- the other cron jobs use, then run the whole file.

do $$
declare j text;
begin
  foreach j in array array['al','ms','la','tx','fl','fla'] loop
    begin
      perform cron.unschedule('weekly-report-auto-' || j);
    exception when others then null;
    end;
  end loop;
end $$;

select cron.schedule('weekly-report-auto-al', '20 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "al_state", "force": true, "auto": true}'::jsonb); $$);

select cron.schedule('weekly-report-auto-ms', '21 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "ms_state", "force": true, "auto": true}'::jsonb); $$);

select cron.schedule('weekly-report-auto-la', '22 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "la_state", "force": true, "auto": true}'::jsonb); $$);

select cron.schedule('weekly-report-auto-tx', '23 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "tx_state", "force": true, "auto": true}'::jsonb); $$);

select cron.schedule('weekly-report-auto-fl', '24 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "fl_state", "force": true, "auto": true}'::jsonb); $$);

select cron.schedule('weekly-report-auto-fla', '25 11 * * 4', $$
  select net.http_post(
    timeout_milliseconds := 60000,
    url := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/weekly-report-generate',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer PASTE_ANON_KEY','x-cron-secret','PASTE_CRON_SECRET'),
    body := '{"jurisdiction": "fl_atlantic", "force": true, "auto": true}'::jsonb); $$);

select jobname, schedule from cron.job where jobname like 'weekly-report-%' order by jobname;
