-- Let a failing region say why, without a SQL session.
--
-- find-hotspots records the reason a region threw. Until now the only
-- record was the cron response body, which pg_net prunes within hours —
-- so by the time anyone looked, the evidence was gone and the table just
-- read "empty" with no explanation.
--
-- Idempotent.
alter table public.hotspot_regions
  add column if not exists last_error text;

-- Read it back:
--   select id, last_run_at, last_error from public.hotspot_regions
--    order by last_run_at nulls first;
