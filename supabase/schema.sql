-- Know Your Catch — research dataset schema (v1)
--
-- Run this once in a fresh Supabase project (SQL editor) to set up
-- the citizen-science backend. Designed for partnership with NOAA
-- Fisheries: anonymous angler IDs, opt-in consent, coordinate
-- resolution control, photos as a separate opt-in.
--
-- This is the RESEARCH dataset, not the production / commercial app
-- data. Every record originates from an explicit user opt-in.

------------------------------------------------------------------
-- 1) Anglers (anonymous research IDs)
------------------------------------------------------------------
create table if not exists public.anglers (
  id              uuid primary key default gen_random_uuid(),
  consented_at    timestamptz not null default now(),
  -- The consent text the user accepted; bump version when wording changes.
  consent_version smallint not null,
  -- Optional rough region (state/jurisdiction) declared at consent.
  jurisdiction    text,
  app_version     text,
  created_at      timestamptz not null default now()
);
create index if not exists anglers_consent_idx on public.anglers(consented_at);

------------------------------------------------------------------
-- 2) Catches (the research records)
------------------------------------------------------------------
create table if not exists public.catches (
  id              uuid primary key default gen_random_uuid(),
  angler_id       uuid not null references public.anglers(id) on delete cascade,

  -- Identity
  species_id      text not null,        -- matches the app's species ids
  caught_at       timestamptz not null, -- catch event time (not insert time)

  -- Where, at the resolution the angler consented to share
  lat             double precision,
  lon             double precision,
  loc_precision   text not null default 'exact'  -- 'exact' | 'grid_1km' | 'grid_10km'
                  check (loc_precision in ('exact', 'grid_1km', 'grid_10km')),
  jurisdiction    text,

  -- Measurements
  length_in       numeric(5,1),
  weight_lb       numeric(6,2),

  -- Captured environmental conditions
  sun_alt_deg     real,
  sun_az_deg     real,
  moon_phase      real,    -- 0..1
  moon_illum      real,    -- 0..1
  moon_name       text,
  temp_f          real,
  wind_mph        real,
  wind_dir_deg    real,
  cloud_pct       real,
  precip_mm       real,
  pressure_mb     real,

  notes           text,

  -- Bookkeeping
  client_id       text,    -- original client-side id (for idempotent re-sync)
  app_version     text,
  inserted_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One server-side row per client_id per angler.
  unique (angler_id, client_id)
);
create index if not exists catches_caught_at_idx on public.catches(caught_at);
create index if not exists catches_species_idx   on public.catches(species_id);
create index if not exists catches_jur_idx       on public.catches(jurisdiction);
-- Spatial queries: most consumers will filter by bounding box.
create index if not exists catches_loc_idx       on public.catches(lat, lon);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists catches_touch on public.catches;
create trigger catches_touch before update on public.catches
for each row execute function public.touch_updated_at();

------------------------------------------------------------------
-- 3) Photo uploads (separate opt-in, stored in Supabase Storage)
------------------------------------------------------------------
create table if not exists public.catch_photos (
  id              uuid primary key default gen_random_uuid(),
  catch_id        uuid not null references public.catches(id) on delete cascade,
  storage_path    text not null,         -- path within the 'catch-photos' bucket
  uploaded_at     timestamptz not null default now()
);

------------------------------------------------------------------
-- 4) Row-Level Security
--    Anglers can only see/write their own rows. Service role
--    (admin dashboard) sees all. NOAA partner access is granted via
--    a dedicated "researcher" role with read-only access.
------------------------------------------------------------------
alter table public.anglers      enable row level security;
alter table public.catches      enable row level security;
alter table public.catch_photos enable row level security;

-- Anglers row: own-row read / insert / update only — **no delete**.
-- Contributions are permanent per app policy (the app is free in
-- exchange for permanent dataset contribution). Admins (service role)
-- bypass RLS and can remove rows for moderation if ever needed.
drop policy if exists anglers_self_read   on public.anglers;
drop policy if exists anglers_self_insert on public.anglers;
drop policy if exists anglers_self_update on public.anglers;
create policy anglers_self_read   on public.anglers for select using (id = auth.uid());
create policy anglers_self_insert on public.anglers for insert with check (id = auth.uid());
create policy anglers_self_update on public.anglers for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists catches_own_read   on public.catches;
drop policy if exists catches_own_insert on public.catches;
drop policy if exists catches_own_update on public.catches;
create policy catches_own_read   on public.catches for select using (angler_id = auth.uid());
create policy catches_own_insert on public.catches for insert with check (angler_id = auth.uid());
create policy catches_own_update on public.catches for update using (angler_id = auth.uid()) with check (angler_id = auth.uid());

drop policy if exists photos_own_read   on public.catch_photos;
drop policy if exists photos_own_insert on public.catch_photos;
create policy photos_own_read   on public.catch_photos for select using (
  catch_id in (select id from public.catches where angler_id = auth.uid()));
create policy photos_own_insert on public.catch_photos for insert with check (
  catch_id in (select id from public.catches where angler_id = auth.uid()));

-- Researcher role — read-only across all consented data.
-- After running this schema, in Supabase Auth, create a role named
-- 'researcher' and grant it via the dashboard or:
--   create role researcher noinherit;
-- Then the policy below grants SELECT.
drop policy if exists catches_researcher on public.catches;
create policy catches_researcher on public.catches
  for select to authenticated using (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'researcher'
  );

------------------------------------------------------------------
-- 5) Aggregated views for partners (no per-angler joins)
------------------------------------------------------------------
create or replace view public.species_effort_by_month as
  select
    species_id,
    date_trunc('month', caught_at) as month,
    count(*) as catches,
    avg(length_in) as avg_length_in,
    avg(weight_lb) as avg_weight_lb,
    avg(moon_illum) as avg_moon_illum
  from public.catches
  group by species_id, date_trunc('month', caught_at);
