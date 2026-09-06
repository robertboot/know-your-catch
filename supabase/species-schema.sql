-- Species editor schema (Phase 1 of the admin console)
--
-- Mirrors the SPECIES shape in src/data.js so bundled seed rows and
-- editable overrides share the same field set. species_photos is a
-- separate table so Phase 3 (photo attachments) can iterate without
-- touching the species row.
--
-- Read access: anonymous read is enabled so any client (including the
-- iOS TestFlight bundle) can pull the overlay on boot. Write access:
-- gated to the admin allowlist via the auth JWT email claim, which
-- matches the frontend gate in src/admin/AdminApp.jsx.

------------------------------------------------------------------
-- 1) Species overlay
------------------------------------------------------------------
create table if not exists public.species (
  id            text primary key,
  common_name   text not null,
  alt_names     text[] not null default '{}',
  scientific    text not null default '',
  category      text not null default '',
  key_ids       text[] not null default '{}',
  lookalikes    text[] not null default '{}',
  habitat       text not null default '',
  typical_size  text not null default '',
  reef_fish     boolean not null default false,
  hms           boolean not null default false,
  updated_at    timestamptz not null default now(),
  updated_by    text
);

create or replace function public.species_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(
    (auth.jwt() ->> 'email'),
    new.updated_by
  );
  return new;
end;
$$;

drop trigger if exists species_touch on public.species;
create trigger species_touch before insert or update on public.species
for each row execute function public.species_touch_updated_at();

------------------------------------------------------------------
-- 2) Species photos (Phase 3 will populate)
------------------------------------------------------------------
create table if not exists public.species_photos (
  id           uuid primary key default gen_random_uuid(),
  species_id   text not null references public.species(id) on delete cascade,
  url          text not null,
  credit       text,
  license      text,
  source       text,
  is_primary   boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists species_photos_species_idx
  on public.species_photos(species_id);

------------------------------------------------------------------
-- 3) Row-Level Security
------------------------------------------------------------------
alter table public.species        enable row level security;
alter table public.species_photos enable row level security;

-- Anyone (including anon key) can read the overlay. This is
-- intentional — the app fetches overrides on boot with the anon key.
drop policy if exists species_read       on public.species;
drop policy if exists species_photos_read on public.species_photos;
create policy species_read        on public.species        for select using (true);
create policy species_photos_read on public.species_photos for select using (true);

-- Writes: only the admin email(s) can insert/update/delete. Add more
-- emails to the ARRAY[...] literal when the admin team grows.
drop policy if exists species_admin_write        on public.species;
drop policy if exists species_photos_admin_write on public.species_photos;
create policy species_admin_write on public.species
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') = any (array['robertb1023@me.com']))
  with check (lower(auth.jwt() ->> 'email') = any (array['robertb1023@me.com']));
create policy species_photos_admin_write on public.species_photos
  for all to authenticated
  using (lower(auth.jwt() ->> 'email') = any (array['robertb1023@me.com']))
  with check (lower(auth.jwt() ->> 'email') = any (array['robertb1023@me.com']));
