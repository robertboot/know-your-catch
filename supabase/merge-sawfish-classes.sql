-- Merge Largetooth Sawfish into Smalltooth Sawfish — one label, "Sawfish".
--
-- The review of these photos was judging the same photograph twice.
--
-- All 110 Smalltooth images were byte-identical to a Largetooth image, and
-- every one of those 110 pairs carries THE SAME iNaturalist photo id in both
-- filenames (largetooth_sawfish_110495059.jpg / smalltooth_sawfish_110495059
-- .jpg, and so on for all 110). That is not two photographs of two fish. It
-- is one photograph fetched twice under two species names — the taxon_name
-- mis-resolution that also turned Atlantic Bonito into 999 oarfish.
-- fetch_inat_photos.py resolves by taxon_id now; these photos predate it.
--
-- 110 duplicates is also Smalltooth's ENTIRE class (31 verified + 79
-- rejected = 110). It has no photographs of its own at all.
--
-- So we cannot say which species the surviving pictures show. Naming either
-- one would be a guess on a federally protected animal, and both are no-take
-- anyway, so the regulation does not change. One honest "Sawfish" class
-- beats two confident wrong ones. Split them again when there are genuine,
-- taxon-verified photos of each.
--
-- Order matters: reject BEFORE the move, while species_id still tells the
-- two sets apart. Run AFTER the anchovy and sturgeon merges. Idempotent.

-- 1. Every Smalltooth row is a copy of a Largetooth row. Drop the copies —
--    the originals survive the move in step 2, so no picture is lost.
update training_images
   set status           = 'rejected',
       rejection_reason = 'duplicate',
       reviewed_at      = now()
 where species_id = 'smalltooth_sawfish';

-- 2. The photos move to the surviving label.
update training_images
   set species_id = 'smalltooth_sawfish'
 where species_id = 'largetooth_sawfish';

-- 3. Logged catches, so nobody's logbook loses its fish.
update catches
   set species_id = 'smalltooth_sawfish'
 where species_id = 'largetooth_sawfish';

-- 4. The surviving row now describes the genus.
update species
   set common_name = 'Sawfish',
       scientific  = 'Pristis spp.',
       alt_names   = array['Smalltooth Sawfish','Largetooth Sawfish'],
       habitat     = 'Shallow coastal waters, estuaries and mangroves, mostly South Florida; very rare elsewhere in the Gulf. Smalltooth is the species found in US waters — largetooth is effectively gone from them.',
       lookalikes  = array[]::text[]
 where id = 'smalltooth_sawfish';

update species set is_active = false where id = 'largetooth_sawfish';

-- 5. Verify. Expect one row, smalltooth_sawfish, with ~96 verified.
select species_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'rejected') as rejected,
       count(*) filter (where status = 'pending')  as pending
from training_images
where species_id in ('smalltooth_sawfish', 'largetooth_sawfish')
group by species_id;
