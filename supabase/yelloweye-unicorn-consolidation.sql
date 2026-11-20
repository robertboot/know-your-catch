-- Consolidate two duplicate species rows found on 2026-08-14 while
-- auditing training-photo contamination.
--
-- 1. "Yelloweye Snapper" (yelloweye_snapper_047a53) carried
--    Rhomboplites aurorubens — Vermilion Snapper's scientific name.
--    Yelloweye Snapper is Lutjanus vivanus, a regional common name for
--    Silk Snapper, which we already carry as silk_snapper AND which
--    already lists "Yelloweye Snapper" in alt_names. So search keeps
--    working after this merge; nothing user-facing is lost.
--
--    This was not a harmless typo. The photo fetcher queries iNat by
--    scientific name, so the Yelloweye folder was filled with Vermilion
--    Snapper photos — 384 byte-identical images shared between the two
--    folders. Left alone it teaches the model that a vermilion snapper
--    is a yelloweye.
--
-- 2. "Unicorn Tile" exists twice (blackline and unicorn_tile_dfccbf),
--    both Caulolatilus cyanops. blackline is canonical: it holds the 3
--    regulation rows and the richer alt_names.
--
-- Both duplicates were verified to have ZERO regulations rows and ZERO
-- training_images rows before this was written, so the re-point steps
-- below are belt-and-braces — they are no-ops today but keep the script
-- correct if rows land before it is run.
--
-- Re-runnable: every statement is conditional or idempotent.

-- 1a. Re-point any stray training photos to the canonical species, and
--     drop them back to pending so they are re-reviewed rather than
--     trusted under a label that was wrong.
update training_images
set species_id  = 'silk_snapper',
    status      = 'pending',
    reviewed_by = null,
    reviewed_at = null
where species_id = 'yelloweye_snapper_047a53';

update training_images
set species_id  = 'blackline',
    status      = 'pending',
    reviewed_by = null,
    reviewed_at = null
where species_id = 'unicorn_tile_dfccbf';

-- 1b. Re-point regulations only where the canonical species does not
--     already hold that jurisdiction — otherwise the unique
--     (species_id, jurisdiction_id) constraint would reject the update.
--     Anything left over is deleted: it is a duplicate of a row the
--     canonical species already has.
update regulations r
set species_id = 'silk_snapper'
where r.species_id = 'yelloweye_snapper_047a53'
  and not exists (
    select 1 from regulations x
    where x.species_id = 'silk_snapper'
      and x.jurisdiction_id = r.jurisdiction_id);

delete from regulations where species_id = 'yelloweye_snapper_047a53';

update regulations r
set species_id = 'blackline'
where r.species_id = 'unicorn_tile_dfccbf'
  and not exists (
    select 1 from regulations x
    where x.species_id = 'blackline'
      and x.jurisdiction_id = r.jurisdiction_id);

delete from regulations where species_id = 'unicorn_tile_dfccbf';

-- 2. Deactivate rather than delete the species rows — other tables may
--    carry historical references (a logged catch keeps its species_id),
--    and is_active = false already removes them from the app, the
--    regulations grid, and the photo fetcher's species list.
update species set is_active = false
where id in ('yelloweye_snapper_047a53', 'unicorn_tile_dfccbf');

-- 3. Verify. Expect: the two duplicates read active = false, and the
--    two canonical rows read active = true with their regulation counts
--    unchanged (silk_snapper 1, blackline 3).
select s.id,
       s.common_name,
       s.scientific,
       s.is_active,
       (select count(*) from regulations r where r.species_id = s.id) as regs
from species s
where s.id in ('yelloweye_snapper_047a53', 'silk_snapper',
               'unicorn_tile_dfccbf', 'blackline')
order by s.common_name, s.id;
