-- Tier-1 + Tier-2 species research fields.
-- Matches the ALTER TABLE already applied to the production project.
-- Kept in the repo so fresh clones + future environments get a
-- reproducible source of truth; idempotent, safe to re-run.
--
-- Companion:
--   src/species-store.js  KNOWN_SPECIES_COLUMNS   (must include every
--                         column this migration adds)
--   supabase/functions/research-species/index.ts KNOWN_RESEARCH_FIELDS
--                         (camelCase JS keys the edge function returns)

alter table public.species
  add column if not exists typical_length_in text,
  add column if not exists typical_weight_lb text,
  add column if not exists world_record_lb   text,
  add column if not exists range_text        text,
  add column if not exists edibility         text,
  add column if not exists seasonality       text;

-- Soft whitelist on edibility so a rogue free-text value can't leak
-- through the admin form or the AI research edge function.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'species_edibility_check'
  ) then
    alter table public.species
      add constraint species_edibility_check
      check (edibility is null or edibility in ('excellent','good','fair','poor'));
  end if;
end $$;

-- Reload PostgREST's schema cache so the new columns are queryable
-- without waiting for its lazy refresh. Without this, a fresh clone
-- that runs this file will see "column not found in schema cache"
-- for a few minutes until PostgREST notices the DDL.
notify pgrst, 'reload schema';
