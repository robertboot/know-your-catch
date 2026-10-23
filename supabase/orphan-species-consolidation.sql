-- Consolidate leftover orphan species_ids into their canonical species.
-- Found via the full training_images audit (every species_id not in the
-- canonical 185-id set from src/data.js). These are display-name / legacy
-- duplicates left behind by earlier bulk imports and the species dedup.
--
-- Only the 3 orphans that have a canonical target are remapped; the two
-- that aren't in the app at all (Rainbow Runner, skipjack tuna — 5 photos
-- total, far below the training floor) are left untouched.
--
-- Status is preserved on purpose: all three canonical targets are below
-- the image floor and won't be in the model regardless, so there's no
-- label-quality risk in keeping the handful of photos as-is.

update training_images set species_id = 'longtail_bass'       where species_id = 'Longtail Bass';
update training_images set species_id = 'blackbelly_rosefish' where species_id = 'Blackbelly Rosefish';
update training_images set species_id = 'spotted_seatrout'    where species_id = 'speckled_seatrout';

-- Same for the species_photos library, if any orphan rows live there
-- (no-op when there are none).
update species_photos set species_id = 'longtail_bass'       where species_id = 'Longtail Bass';
update species_photos set species_id = 'blackbelly_rosefish' where species_id = 'Blackbelly Rosefish';
update species_photos set species_id = 'spotted_seatrout'    where species_id = 'speckled_seatrout';

-- Retire any duplicate species rows so they stop showing as phantom
-- coverage rows (no-op if the rows don't exist).
update species set is_active = false
where id in ('Longtail Bass', 'Blackbelly Rosefish', 'speckled_seatrout');

-- Verify: none of the orphan ids should remain.
select species_id, count(*)
from training_images
where species_id in ('Longtail Bass','Blackbelly Rosefish','speckled_seatrout',
                     'longtail_bass','blackbelly_rosefish','spotted_seatrout')
group by species_id
order by species_id;
