-- Hotspots — where to go, not just what to catch.
--
-- Fish stack on EDGES, not on averages. A 74°F patch of water says
-- nothing; a place where 74° meets 71° in three miles says everything.
-- find-hotspots reads the NOAA satellite grids once a night, measures
-- where the temperature and colour gradients are steepest, and writes the
-- handful of resulting lines here.
--
-- The phone never computes any of this. It reads rows — a few hundred
-- bytes each — and caches them like the forecast, so the answer is aboard
-- before the signal is gone. That is the whole point: the intelligence is
-- distilled on the server and the boat carries the conclusion.

create table if not exists public.hotspot_regions (
  id          text primary key,              -- 'al_gulf', 'fl_panhandle', ...
  label       text not null,
  -- Bounding box the satellite grids are read over.
  south       double precision not null,
  west        double precision not null,
  north       double precision not null,
  east        double precision not null,
  -- The inlet distances and bearings are measured from, so "31 nm at 190°"
  -- means something to a person leaving the dock.
  port_name   text not null,
  port_lat    double precision not null,
  port_lon    double precision not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.hotspots (
  id            uuid primary key default gen_random_uuid(),
  region_id     text not null references public.hotspot_regions(id) on delete cascade,
  -- The satellite pass these were derived from, not the time we ran.
  observed_at   timestamptz not null,
  computed_at   timestamptz not null default now(),

  kind          text not null                  -- what kind of edge this is
                check (kind in ('temp_break', 'color_edge', 'convergence')),
  lat           double precision not null,
  lon           double precision not null,

  score         real not null,                 -- 0-100, comparable within a run
  -- The measurements behind the score, kept so the card can explain itself
  -- and so a bad call can be argued with later.
  sst_f         real,                          -- temperature at the edge
  sst_drop_f    real,                          -- across the break
  sst_grad_f_nm real,                          -- °F per nautical mile
  chl_mg_m3     real,
  chl_grad      real,
  length_nm     real,                          -- how far the edge runs
  bearing_deg   real,                          -- orientation of the edge itself
  -- From the region's port.
  dist_nm       real,
  from_port_deg real,
  why           text not null,                 -- the sentence shown on the card

  unique (region_id, observed_at, lat, lon)
);

create index if not exists hotspots_region_idx
  on public.hotspots (region_id, observed_at desc, score desc);

alter table public.hotspot_regions enable row level security;
alter table public.hotspots        enable row level security;

-- Anyone signed in may read: this is the product. Only the service role
-- writes, because every row is derived data and a hand-edited hotspot
-- would be indistinguishable from a measured one.
drop policy if exists hotspot_regions_read on public.hotspot_regions;
create policy hotspot_regions_read on public.hotspot_regions
  for select to anon, authenticated using (active);

drop policy if exists hotspots_read on public.hotspots;
create policy hotspots_read on public.hotspots
  for select to anon, authenticated using (true);

-- Seed: the Alabama / western Florida panhandle offshore grounds.
insert into public.hotspot_regions (id, label, south, west, north, east,
                                    port_name, port_lat, port_lon)
values ('al_gulf', 'Alabama & Western Panhandle',
        28.20, -88.80, 30.30, -86.60,
        'Perdido Pass', 30.2730, -87.5560)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
