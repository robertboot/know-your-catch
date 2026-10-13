-- Give a suggested spot its actual SHAPE.
--
-- The map could only draw a circle because a circle was all the data
-- supported: a spot carried a point, a length and a bearing. A break is
-- not round — it is a ribbon of water that bends, forks and thins, and
-- drawing it as a disc both looks wrong and claims the wrong area. The
-- cells that make up the break are known in find-hotspots and were being
-- thrown away.
--
-- cells is [[lat, lon], ...] for the connected group this spot belongs
-- to, rounded to 3 decimal places (~100 m) and capped in the function.
-- Nullable: older rows have none and the map falls back to the circle.
--
-- Idempotent.
alter table public.hotspots
  add column if not exists cells jsonb;

comment on column public.hotspots.cells is
  'Cells of the connected break this spot belongs to, [[lat,lon],...]. '
  'Drawn as the spot''s outline; null means fall back to a radius circle.';

notify pgrst, 'reload schema';

-- Confirm:
--   select kind, jsonb_array_length(cells) as cells, length_nm
--     from public.hotspots order by score desc limit 5;
