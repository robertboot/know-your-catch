-- Species Suggestions
-- User-submitted custom species from the Log-a-Catch flow. Rides the
-- same admin overlay pipeline as species-store.js: on approval the
-- admin promotes the suggestion into the real `species` table via
-- upsertSpecies() and the mobile app picks it up on next refresh.

create table if not exists public.species_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id),
  -- The custom_XXXX id the client used locally before approval. Catches
  -- logged against this id are remapped on the client after the sync
  -- brings back approved_species_id.
  client_species_id   text,
  common_name         text not null,
  scientific_name     text,
  alt_names           text,
  notes               text,
  -- Optional signed-photo pointer into catch-photos so admin can eyeball
  -- the species before approving. Best-effort — many submissions ship
  -- without a photo (e.g., "add before I catch it").
  photo_storage_path  text,
  status              text not null default 'pending'
                      check (status in ('pending','approved','rejected','merged')),
  approved_species_id text,
  rejection_reason    text,
  submitted_at        timestamptz not null default now(),
  reviewed_by         text,
  reviewed_at         timestamptz,
  -- One row per (user, client_species_id) so retries are idempotent
  -- and the client can look up its own suggestion by client_species_id.
  unique (user_id, client_species_id)
);

alter table public.species_suggestions enable row level security;

-- User can insert their own suggestions and read their own.
drop policy if exists suggestions_own_ins on public.species_suggestions;
create policy suggestions_own_ins on public.species_suggestions
  for insert
  with check (user_id = auth.uid());

drop policy if exists suggestions_own_sel on public.species_suggestions;
create policy suggestions_own_sel on public.species_suggestions
  for select
  using (user_id = auth.uid());

-- Owner admin can read + update + delete everything.
drop policy if exists suggestions_admin_all on public.species_suggestions;
create policy suggestions_admin_all on public.species_suggestions
  for all
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com')
  with check (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

-- Index for the admin dashboard's "pending first" ordering.
create index if not exists species_suggestions_status_submitted
  on public.species_suggestions (status, submitted_at desc);
