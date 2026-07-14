-- Species research fields — new columns populated by AI Research +
-- the admin edit form. Everything is nullable; missing values fall
-- through to the bundled seed (species-store.rowToSpecies).
--
-- Run once in the SQL Editor. Idempotent — safe to re-run.

alter table public.species
  add column if not exists typical_length_in text,
  add column if not exists typical_weight_lb text,
  add column if not exists world_record_lb   text,
  add column if not exists geo_range         text,       -- geographic range; `range` is a Postgres reserved word
  add column if not exists edibility         text,
  add column if not exists seasonality       text;

-- Optional soft constraint on edibility so a stray free-text value
-- from a future edit form doesn't leak through. If the constraint
-- ever needs to expand, drop + re-add here.
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
