-- ============================================================
--  Species DB cleanup v2 — dedupe + new categories only
--  Built from the live duplicate audit. Run once, top to bottom,
--  in the Supabase SQL editor.
--
--  KEY RULE: several capitalized/duplicate rows are FK-referenced by
--  training_images / species_photos (e.g. "Little Tunny" has 301
--  training images). We MUST re-point that data onto the canonical
--  lowercase row BEFORE deleting the duplicate, or the delete fails
--  (and would orphan training data if it didn't).
-- ============================================================

-- ------------------------------------------------------------
-- PART A — Merge duplicates that have a real lowercase twin row.
--          Re-point training_images + species_photos, then delete.
-- ------------------------------------------------------------
update training_images set species_id='ballyhoo'           where species_id='Ballyhoo';
update species_photos  set species_id='ballyhoo'           where species_id='Ballyhoo';

update training_images set species_id='little_tunny'       where species_id='Little Tunny';
update species_photos  set species_id='little_tunny'       where species_id='Little Tunny';

update training_images set species_id='speckled_hind'      where species_id='Speckled Hind';
update species_photos  set species_id='speckled_hind'      where species_id='Speckled Hind';

update training_images set species_id='yellowedge_grouper' where species_id='Yellowedge Grouper';
update species_photos  set species_id='yellowedge_grouper' where species_id='Yellowedge Grouper';

update training_images set species_id='yellowfin_grouper'  where species_id='Yellowfin Grouper';
update species_photos  set species_id='yellowfin_grouper'  where species_id='Yellowfin Grouper';

delete from species where id in (
  'Ballyhoo', 'Little Tunny', 'Speckled Hind',
  'Yellowedge Grouper', 'Yellowfin Grouper'
);

-- ------------------------------------------------------------
-- PART B — Delete redundant rows with ZERO references. Each of
--          these is already covered by the bundled data.js floor,
--          so removing the overlay row loses nothing.
--          (Squid has no floor and isn't a Gulf fish — it's a stray
--           'bait' entry with 0 refs; remove per "gulf species only".)
-- ------------------------------------------------------------
delete from species where id in (
  'Cigar minnow',   -- floor: cigar_minnow
  'Glass minnow',   -- floor: bay_anchovy (Anchoa mitchilli)
  'Pigfish',        -- floor: pigfish
  'Pinfish',        -- floor: pinfish
  'Gulf Madhaden',  -- floor: gulf_menhaden
  'Pogies',         -- floor: gulf_menhaden (same fish, Brevoortia patronus)
  'Sheepshead',     -- floor: sheepshead (inshore)
  'Squid'           -- stray, no floor, 0 refs
);

-- ------------------------------------------------------------
-- PART C — Rows we MUST keep (they carry training images and have
--          no lowercase twin in the DB). Just correct their category
--          to the new taxonomy. Runtime already merges them with the
--          bundled species by scientific name, so they show once.
-- ------------------------------------------------------------
update species set category='offshore'     where id='Blackbelly Rosefish';
update species set category='offshore'     where id='Longtail Bass';
update species set category='drums_trouts' where id='Red Drum';
update species set category='jacks'        where id='Rainbow Runner';
update species set category='tuna'         where id='skipjack tuna';

-- ------------------------------------------------------------
-- PART D — Make sure the canonical twin rows also sit on new
--          categories (they may still be on an old one).
-- ------------------------------------------------------------
update species set category='baitfish' where id='ballyhoo';
update species set category='tuna'     where id='little_tunny';
update species set category='groupers' where id in (
  'speckled_hind', 'yellowedge_grouper', 'yellowfin_grouper'
);

-- ------------------------------------------------------------
-- PART E — Remap every remaining lowercase overlay row to the new
--          taxonomy (harmless no-op for any id not present).
-- ------------------------------------------------------------
update species set category='baitfish' where id in ('atlantic_menhaden','butterfish','cigar_minnow','bay_anchovy','gulf_menhaden','pigfish','pinfish');
update species set category='coastal'  where id in ('bluefish','black_sea_bass','scup','atlantic_sturgeon');
update species set category='drums_trouts' where id in ('speckled_seatrout','red_drum');
update species set category='groupers' where id in ('black_grouper','coney','gag_grouper','goliath_grouper','graysby','misty_grouper','nassau_grouper','red_grouper','scamp','snowy_grouper','warsaw_grouper','yellowmouth_grouper');
update species set category='inshore'  where id in ('summer_flounder','winter_flounder');
update species set category='offshore' where id in ('wreckfish','hogfish','mahi','opah','short_bigeye','tripletail','gray_triggerfish');
update species set category='sharks_rays' where id in ('atlantic_sharpnose_shark','blacknose_shark','blacktip_shark','bonnethead_shark','great_white_shark','oceanic_whitetip_shark','sandbar_shark','scalloped_hammerhead','shortfin_mako_shark','smalltooth_sawfish','winter_skate');
update species set category='snappers' where id in ('black_snapper','blackfin_snapper','cubera_snapper','dog_snapper','lane_snapper','mahogany_snapper','mangrove_snapper','mutton_snapper','queen_snapper','red_snapper','schoolmaster_snapper','silk_snapper','vermilion_snapper','yellowtail_snapper');

-- ------------------------------------------------------------
-- PART F — Hide retired categories (only if your categories table
--          has an is_active column; if it errors, skip this block).
-- ------------------------------------------------------------
update categories set is_active=false
  where id not in (
    'sharks_rays','baitfish','groupers','snappers','inshore','coastal',
    'offshore','tilefish','drums_trouts','jacks','mackerels_barracuda',
    'tuna','billfish','_admin'
  );

-- ------------------------------------------------------------
-- PART G — Sanity check. Should return ZERO rows. Anything listed
--          is still on an old/unknown category — paste it back.
-- ------------------------------------------------------------
select id, common_name, category from species
  where category not in (
    'sharks_rays','baitfish','groupers','snappers','inshore','coastal',
    'offshore','tilefish','drums_trouts','jacks','mackerels_barracuda',
    'tuna','billfish','_admin'
  );
