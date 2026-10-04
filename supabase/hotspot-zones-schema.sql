-- Predictive zones — the SiriusXM-style blobs, per trip mode.
--
-- Where hotspots are POINTS (the steepest edges, each worth a card),
-- zones are AREAS: every ~6 km cell of the region scored by how well the
-- water suits the selected trip mode's species right now — habitat fit
-- (species-habitat.js priors: temperature band, season) amplified by edge
-- strength. The phone reads one row per region+mode and paints the cells;
-- nothing is computed on the boat.
--
-- One row per (region, mode), replaced on every run — zones are
-- perishable, there is no history to keep.

create table if not exists public.hotspot_zones (
  region_id   text not null references public.hotspot_regions(id) on delete cascade,
  mode_key    text not null,                 -- TRIP_MODES key ('troll_pelagic', ...)
  observed_at timestamptz not null,          -- satellite pass the cells were scored from
  computed_at timestamptz not null default now(),
  step_deg    real not null,                 -- cell spacing, for drawing cell-sized blobs
  cells       jsonb not null,                -- [[lat, lon, score 0-100], ...] best-first
  primary key (region_id, mode_key)
);

alter table public.hotspot_zones enable row level security;

-- Same policy shape as hotspots: signed-in read, service-role write only —
-- every row is derived data.
drop policy if exists hotspot_zones_read on public.hotspot_zones;
create policy hotspot_zones_read on public.hotspot_zones
  for select to authenticated using (true);
