-- ReelIntel — ocean-maps public bucket + refresh cron.
--
-- Purpose: stop every angler's Ocean Maps visit from hitting NOAA
-- CoastWatch ERDDAP directly. ERDDAP renders each PNG on demand from
-- gridded NetCDF, so those calls are slow, fail when NOAA is busy, and
-- at scale are how the app gets rate-limited or blocked. The imagery is
-- identical for everyone (one fixed region, one "latest" timestep), so
-- it is rendered once by the refresh-ocean-maps edge function and
-- served to all users as a static CDN file.
--
-- Mirrors the models-published bucket pattern.
--
-- Run once, in the Supabase SQL Editor.
-- Requires: refresh-ocean-maps deployed, CRON_SECRET set.

------------------------------------------------------------------
-- 1) Bucket (public-read)
------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('ocean-maps', 'ocean-maps', true)
  on conflict (id) do update set public = true;

------------------------------------------------------------------
-- 2) Storage RLS
--    Anonymous read comes from the bucket's public flag above.
--    Writes are admin-only; the edge function uses the service role,
--    which bypasses RLS, so these policies only gate the admin UI.
------------------------------------------------------------------
drop policy if exists "ocean-maps admin write" on storage.objects;
create policy "ocean-maps admin write" on storage.objects
  for insert
  with check (
    bucket_id = 'ocean-maps'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  );

drop policy if exists "ocean-maps admin update" on storage.objects;
create policy "ocean-maps admin update" on storage.objects
  for update
  using (
    bucket_id = 'ocean-maps'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  )
  with check (
    bucket_id = 'ocean-maps'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  );

drop policy if exists "ocean-maps admin delete" on storage.objects;
create policy "ocean-maps admin delete" on storage.objects
  for delete
  using (
    bucket_id = 'ocean-maps'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  );

------------------------------------------------------------------
-- 3) Refresh cron — every 6 hours.
--    Chlorophyll is an 8-day rolling composite and MUR SST is daily,
--    so 6h is comfortably ahead of the data actually changing while
--    still recovering quickly from a failed run.
--
--    REPLACE BOTH PLACEHOLDERS BEFORE RUNNING:
--      YOUR_PROJECT_REF  → hfptpsmdfemduhkueyoz
--      YOUR_CRON_SECRET  → the CRON_SECRET value set in edge secrets
------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('refresh-ocean-maps')
  where exists (select 1 from cron.job where jobname = 'refresh-ocean-maps');

select cron.schedule(
  'refresh-ocean-maps',
  '17 */6 * * *',   -- :17 past the hour, every 6h (off the top-of-hour rush)
  $$
  select net.http_post(
    url     := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/refresh-ocean-maps',
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-cron-secret',  'YOUR_CRON_SECRET'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'refresh-ocean-maps';
--   select * from cron.job_run_details order by start_time desc limit 5;
