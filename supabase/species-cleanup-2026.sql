-- ============================================================
--  Species DB cleanup — one row per fish, new categories only
--  Run once in the Supabase SQL editor.
-- ============================================================

-- 1) Remove the hand-added DUPLICATE rows (capitalized / spaced ids).
--    These duplicate a lowercase row that already exists and is the
--    one referenced everywhere else. Safe to delete: nothing FK's them.
delete from species where id in (
  'Ballyhoo', 'Cigar minnow', 'Glass minnow', 'Gulf Madhaden',
  'Pinfish', 'Pogies', 'Squid', 'Speckled Hind',
  'Yellowedge Grouper', 'Yellowfin Grouper', 'Pigfish',
  'Red Drum', 'Sheepshead'
);

-- 2) Promote the two genuinely-new deep-reef species to offshore.
update species set category='offshore'
  where scientific in ('Anthias woodsi', 'Helicolenus dactylopterus');

-- 3) Remap every remaining lowercase row to the NEW taxonomy.
--    (These ids are FK-referenced by training_images / species_photos,
--     so we UPDATE the category — never delete the row.)
update species set category='baitfish' where id in (
  'atlantic_menhaden', 'butterfish'
);
update species set category='coastal' where id in (
  'bluefish', 'black_sea_bass', 'scup', 'atlantic_sturgeon'
);
update species set category='drums_trouts' where id in (
  'speckled_seatrout'
);
update species set category='groupers' where id in (
  'black_grouper', 'coney', 'gag_grouper', 'goliath_grouper', 'graysby',
  'misty_grouper', 'nassau_grouper', 'red_grouper', 'scamp', 'snowy_grouper',
  'speckled_hind', 'warsaw_grouper', 'yellowedge_grouper', 'yellowfin_grouper',
  'yellowmouth_grouper'
);
update species set category='inshore' where id in (
  'summer_flounder', 'winter_flounder'
);
update species set category='offshore' where id in (
  'wreckfish', 'hogfish', 'mahi', 'opah', 'short_bigeye',
  'tripletail', 'gray_triggerfish'
);
update species set category='sharks_rays' where id in (
  'atlantic_sharpnose_shark', 'blacknose_shark', 'blacktip_shark',
  'bonnethead_shark', 'great_white_shark', 'oceanic_whitetip_shark',
  'sandbar_shark', 'scalloped_hammerhead', 'shortfin_mako_shark',
  'smalltooth_sawfish', 'winter_skate'
);
update species set category='snappers' where id in (
  'black_snapper', 'blackfin_snapper', 'cubera_snapper', 'dog_snapper',
  'lane_snapper', 'mahogany_snapper', 'mangrove_snapper', 'mutton_snapper',
  'queen_snapper', 'red_snapper', 'schoolmaster_snapper', 'silk_snapper',
  'vermilion_snapper', 'yellowtail_snapper'
);

-- 4) Hide any retired category rows so old categories disappear
--    from the app's category picker (bundled data.js is the floor;
--    this just stops the overlay from re-introducing dead ones).
update categories set is_active=false
  where id not in (
    'sharks_rays','baitfish','groupers','snappers','inshore','coastal',
    'offshore','tilefish','drums_trouts','jacks','mackerels_barracuda',
    'tuna','billfish','_admin'
  );

-- 5) Sanity check — should return ZERO rows (any row here is still
--    on an old/unknown category and needs a manual home).
select id, common_name, category from species
  where category not in (
    'sharks_rays','baitfish','groupers','snappers','inshore','coastal',
    'offshore','tilefish','drums_trouts','jacks','mackerels_barracuda',
    'tuna','billfish','_admin'
  );
