-- ReelIntel — CRON 401 FIX (run once in the Supabase SQL Editor)
-- =====================================================================
-- WHY the scheduled jobs show "HTTP 401":
--   Every Edge Function sits behind Supabase's API gateway. With JWT
--   verification ON (the default), the gateway rejects any request whose
--   Authorization header is not a valid project JWT — BEFORE the function
--   runs. Our cron jobs POST with only 'x-cron-secret' and no
--   Authorization, so the gateway turns them away with 401 and the
--   function's own x-cron-secret check never even executes.
--
-- THE FIX (this file):
--   Send the project's ANON key as `Authorization: Bearer <anon>`. The
--   anon key IS a valid project JWT, so it clears the gateway; the
--   function then authenticates for real on 'x-cron-secret'. No function
--   redeploys required, and it works whether or not a function was
--   deployed with --no-verify-jwt.
--
--   (Alternative, if you'd rather not embed the anon key: redeploy each
--    headless function with `--no-verify-jwt` and drop the Authorization
--    line below. Both approaches are valid; pick one.)
--
-- BEFORE RUNNING — replace the two placeholders below:
--   PASTE_ANON_KEY   → Supabase dashboard ▸ Project Settings ▸ API ▸
--                      Project API keys ▸ "anon public". Safe to embed
--                      (it's the same key shipped in the app).
--   PASTE_CRON_SECRET→ the value you set with:
--                        supabase secrets set CRON_SECRET=<random string>
--                      Must MATCH exactly, or you'll trade the gateway
--                      401 for a function 401.
--
-- Project ref hfptpsmdfemduhkueyoz is already filled in below.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop each job by name before recreating it. Also removes
-- the failing versions so you don't end up with duplicates.
do $$
declare j text;
begin
  foreach j in array array['regs-auto-update-hourly','scan-regulation-alerts-daily','refresh-ocean-maps']
  loop
    begin perform cron.unschedule(j); exception when others then null; end;
  end loop;
end $$;

-- 1) Regulation auto-updater — hourly, batch of 5 species/jurisdiction pairs.
select cron.schedule(
  'regs-auto-update-hourly',
  '17 * * * *',
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/auto-update-regulations',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer PASTE_ANON_KEY',
                 'x-cron-secret', 'PASTE_CRON_SECRET'
               ),
    body    := '{"batch": 5}'::jsonb
  );
  $$
);

-- 2) Regulation-change alert scan — once daily (reg changes are rare;
--    hourly would just re-diff an unchanged snapshot).
select cron.schedule(
  'scan-regulation-alerts-daily',
  '23 13 * * *',   -- 13:23 UTC daily
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/scan-regulation-alerts',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer PASTE_ANON_KEY',
                 'x-cron-secret', 'PASTE_CRON_SECRET'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- 3) Ocean-maps snapshot refresh — every 6h, staggered off the others.
select cron.schedule(
  'refresh-ocean-maps',
  '42 */6 * * *',
  $$
  select net.http_post(
    url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/refresh-ocean-maps',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer PASTE_ANON_KEY',
                 'x-cron-secret', 'PASTE_CRON_SECRET'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- ---------------------------------------------------------------------
-- AFTER RUNNING:
--   1. Trigger one immediately to test (replace the two placeholders
--      here too), then check the real HTTP result:
--
--      select net.http_post(
--        url     := 'https://hfptpsmdfemduhkueyoz.supabase.co/functions/v1/auto-update-regulations',
--        headers := jsonb_build_object('Content-Type','application/json',
--                     'Authorization','Bearer PASTE_ANON_KEY',
--                     'x-cron-secret','PASTE_CRON_SECRET'),
--        body    := '{"batch": 1}'::jsonb);
--
--      -- wait a few seconds, then:
--      select status_code, error_msg, created
--        from net._http_response order by created desc limit 5;
--      -- expect 200 (was 401).
--
--   2. See every job's health (this is what the admin dashboard reads):
--      select public.admin_cron_health();
--
--   3. If admin_cron_health lists OTHER jobs (e.g. ones created in the
--      dashboard) still 401-ing, they need the SAME Authorization line
--      added. Either re-point them here by name, or delete the dashboard
--      copy and let these three canonical jobs cover it.
-- ---------------------------------------------------------------------
