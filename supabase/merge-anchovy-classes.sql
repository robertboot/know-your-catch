-- Merge Bay Anchovy and Striped Anchovy into Glass Minnow.
--
-- Why: the three are the same handful of Anchoa species, told apart in the
-- hand by a stripe width, and not at all in a 224-pixel photo. The app's own
-- data already listed each of the three as the other two's lookalikes.
--
-- The cross-species duplicate quarantine did its job and left them with 72,
-- 108 and 40 verified images. All three stayed above the 30-image floor, so
-- the model kept three under-trained classes that look identical. An
-- under-trained class does not learn a tight shape; it learns a loose one
-- that fires on things it should not — a vermilion snapper, for instance.
--
-- One class of ~220 clean images beats three guesses of 72, 108 and 40.
--
-- The 883 duplicate images quarantined WITHIN this trio stay rejected. Once
-- merged they are no longer contradictory, but they are still the same photo
-- twice, and the split groups by observation rather than by content hash —
-- restoring them would put identical pixels in train and val and inflate
-- every accuracy number the retrain reports.
--
-- Idempotent. Safe to run twice.

-- 1. Re-point the photos. Status is preserved on purpose: a human already
--    verified these as that anchovy, and the merged class IS that anchovy.
--    Nothing here needs re-reviewing.
update training_images
   set species_id = 'glass_minnow'
 where species_id in ('bay_anchovy', 'striped_anchovy');

-- 2. Logged catches, so nobody's logbook loses its fish.
update catches
   set species_id = 'glass_minnow'
 where species_id in ('bay_anchovy', 'striped_anchovy');

-- 3. The surviving row now describes all three.
update species
   set common_name  = 'Glass Minnow',
       scientific   = 'Anchoa spp.',
       alt_names    = array['Anchovy','Bay Anchovy','Striped Anchovy','Silverside','Glass minnows'],
       key_ids      = array[
         'Tiny glassy, near-transparent body, 1-6 in',
         'Bright silver stripe along the midline',
         'Large eye, with the mouth reaching back past it',
         'Backbone visible through the skin'],
       lookalikes   = array['scaled_sardine','gulf_menhaden'],
       habitat      = 'Estuaries, bays, passes and the surf zone; dense translucent schools Gulf-wide.',
       typical_size = '1.5-6 in'
 where id = 'glass_minnow';

-- 4. Retire the other two. Deactivate rather than delete — other rows may
--    still reference them, and nothing is gained by breaking those.
update species set is_active = false
 where id in ('bay_anchovy', 'striped_anchovy');

-- 5. Verify. Expect one row, glass_minnow, with ~220 verified.
select species_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'pending')  as pending,
       count(*) filter (where status = 'rejected') as rejected,
       count(*)                                    as total
from training_images
where species_id in ('glass_minnow', 'bay_anchovy', 'striped_anchovy')
group by species_id;
