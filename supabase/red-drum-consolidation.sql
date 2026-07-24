-- Consolidate the duplicate "Red Drum" (capital) species into canonical
-- red_drum. Leftover from the 2026 species dedup: 4 training images and a
-- duplicate species row still used the display-name id 'Red Drum', which
-- surfaced as a separate, near-empty (=excluded) coverage row even though
-- canonical red_drum already has 500+ verified photos.
--
-- Order matters: re-point every table that references 'Red Drum' BEFORE
-- retiring the species row (there is an FK on species_id).

-- 1. Move the stray training images to the canonical id.
update training_images set species_id = 'red_drum' where species_id = 'Red Drum';

-- 2. Same for the species_photos library, if it holds any.
update species_photos  set species_id = 'red_drum' where species_id = 'Red Drum';

-- 3. Retire the duplicate species row so the phantom "excluded" coverage
--    row disappears. Deactivate (safe against any other FK references)
--    rather than delete.
update species set active = false where id = 'Red Drum';

-- 4. Verify: red_drum should now hold all the photos, 'Red Drum' none.
select species_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) as total
from training_images
where species_id in ('red_drum', 'Red Drum')
group by species_id;
