-- Merge Atlantic Sturgeon into Gulf Sturgeon — one label, "Sturgeon".
--
-- Why: they are subspecies of Acipenser oxyrinchus separated by internal
-- anatomy (spleen and head-length ratios), not by anything a photograph
-- shows. What tells them apart is where the fish was caught. That is why
-- every Gulf Sturgeon photo turned out to be byte-identical to an Atlantic
-- Sturgeon photo, and why the cross-species quarantine — which rejects both
-- copies and picks no label — left Gulf Sturgeon with ZERO verified images
-- while Atlantic Sturgeon kept 221.
--
-- A class at zero is not merely absent: a sturgeon photographed in the Gulf
-- now comes back confidently named as the Atlantic subspecies. Both are
-- federally protected and no-take, so the regulation is the same either way.
--
-- gulf_sturgeon survives as the id because it is the row the app shows;
-- atlantic_sturgeon is already active:false in src/data.js ("Not a Gulf of
-- America species"). The surviving row is renamed to plain "Sturgeon" so it
-- is not wrong on the Florida Atlantic coast.
--
-- Run AFTER supabase/merge-anchovy-classes.sql. Idempotent.

-- 1. Photos move to the surviving label, status intact. A human verified
--    these as a sturgeon and the merged class is sturgeon.
update training_images
   set species_id = 'gulf_sturgeon'
 where species_id = 'atlantic_sturgeon';

-- 2. The duplicates quarantined BETWEEN these two stay rejected.
--    They are NOT two photographs: all 56 pairs carry the same iNaturalist
--    photo id on both sides. Restoring them puts one picture in the class
--    twice, and make_split.py groups by observation rather than by content,
--    so the copies can land in train and val and inflate the retrain's
--    numbers. An earlier version of this file restored them; that was wrong
--    and supabase/drop-sturgeon-duplicate-copies.sql undoes it.

-- 3. Logged catches, so nobody's logbook loses its fish.
update catches
   set species_id = 'gulf_sturgeon'
 where species_id = 'atlantic_sturgeon';

-- 4. The surviving row now describes both subspecies.
update species
   set common_name  = 'Sturgeon',
       scientific   = 'Acipenser oxyrinchus',
       alt_names    = array['Gulf Sturgeon','Atlantic Sturgeon'],
       habitat      = 'Anadromous — coastal rivers, estuaries and nearshore waters. The Gulf subspecies runs from Louisiana to Florida, the Atlantic subspecies up the Atlantic coast; they are told apart by where they are caught, not by sight. Federally protected; no take.',
       lookalikes   = array[]::text[]
 where id = 'gulf_sturgeon';

-- 5. Retire the absorbed row. Deactivate, never delete — its regulation
--    rows and any historical references stay intact and simply stop being
--    shown.
update species set is_active = false where id = 'atlantic_sturgeon';

-- 6. Verify. Expect one row: gulf_sturgeon, ~221 verified plus the
--    recovered duplicates waiting in Review.
select species_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'pending')  as to_review,
       count(*) filter (where status = 'rejected') as rejected
from training_images
where species_id in ('gulf_sturgeon', 'atlantic_sturgeon')
group by species_id;
