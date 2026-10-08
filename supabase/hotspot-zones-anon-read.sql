-- Let the app read the zones. It currently cannot.
--
-- hotspot_zones says "same policy shape as hotspots" and is not: hotspots
-- grants select to anon AND authenticated, hotspot_zones only to
-- authenticated. The two drifted, and the comment hid it.
--
-- What that does in the app: the Ocean Maps current layer asks for the
-- zone rows, PostgREST returns an empty array rather than an error
-- (invisible rows are not an error), the fetch sees no rows and keeps
-- whatever is in the browser cache. So an angler who is not signed in
-- sees a seven-day-old patch of current off Alabama and nothing else,
-- for ever, while the admin console — signed in — draws the whole Gulf.
--
-- These rows are derived satellite data with nothing personal in them.
-- The catches that feed hotspots are aggregated and gated separately; see
-- the PRIVACY note at the top of find-hotspots.
--
-- Writes stay service-role only.
drop policy if exists hotspot_zones_read on public.hotspot_zones;
create policy hotspot_zones_read on public.hotspot_zones
  for select to anon, authenticated using (true);

notify pgrst, 'reload schema';

-- Confirm: this should return rows WITHOUT being signed in.
--   select region_id, mode_key from public.hotspot_zones order by region_id;
