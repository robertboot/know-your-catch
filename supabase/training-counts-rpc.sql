-- Server-side per-species training-image counts.
--
-- Replaces the client-side "pull every row 1,000 at a time and tally in
-- the browser" approach, which — now that the table has tens of thousands
-- of rows — takes 30+ sequential requests and shows species as 0 until the
-- very last page lands (the "African Pompano shows 0 but has 193" scare).
--
-- One GROUP BY, ~84 rows back, instant. security invoker so it respects
-- the caller's existing RLS on training_images (admins already read it).
create or replace function public.training_counts_by_species()
returns table (
  species_id       text,
  verified         bigint,
  pending          bigint,
  rejected         bigint,
  corrected        bigint,
  total            bigint,
  last_uploaded_at timestamptz
)
language sql
stable
security invoker
as $$
  select species_id,
         count(*) filter (where status = 'verified')  as verified,
         count(*) filter (where status = 'pending')    as pending,
         count(*) filter (where status = 'rejected')   as rejected,
         count(*) filter (where status = 'corrected')  as corrected,
         count(*)                                      as total,
         max(uploaded_at)                              as last_uploaded_at
  from public.training_images
  group by species_id;
$$;
