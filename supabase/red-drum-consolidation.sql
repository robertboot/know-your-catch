-- Consolidate the duplicate "Red Drum" (capital) species into canonical
-- red_drum. Leftover from the 2026 species dedup: 4 training images and a
-- duplicate species row still used the display-name id 'Red Drum', which
-- surfaced as a separate, near-empty (=excluded) coverage row even though
-- canonical red_drum already has 560+ verified photos.

-- 1. Re-point the 4 stray photos to canonical red_drum AND drop them back
--    to UNVERIFIED (pending) so they get re-reviewed rather than trusted
--    as-is. Clears the review stamps, exactly as the app's "restore to
--    pending" action does.
update training_images
set species_id       = 'red_drum',
    status           = 'pending',
    reviewed_by      = null,
    reviewed_at      = null,
    rejection_reason = null
where species_id = 'Red Drum';

-- 2. Retire the now-empty duplicate species row so the phantom "excluded"
--    coverage row disappears. Deactivate (safe against any other FK
--    references) rather than delete.
update species set is_active = false where id = 'Red Drum';

-- 3. Verify: 'Red Drum' should be gone; red_drum keeps its verified count
--    and gains 4 pending.
select species_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'pending')  as pending,
       count(*) as total
from training_images
where species_id in ('red_drum', 'Red Drum')
group by species_id;
