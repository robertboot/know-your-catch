-- Federal Gulf seasons, read off NOAA's own closure table on 2026-11-09.
--
-- Source (read today, not from memory):
--   https://www.fisheries.noaa.gov/southeast/rules-regulations/
--     fishing-regulations-and-seasonal-closures-gulf-america
--
-- Why this file exists: the newsletter reads these rows, and three of
-- them still described seasons that ended weeks ago. Greater amberjack
-- in particular said "Sept 1 - Oct 31", which the season parser reads as
-- a close on Oct 31 - nine days back, inside the two-week lookback - so
-- this week's email would have announced a closing date that is not the
-- date it actually closed (Oct 14, on quota).
--
-- Deliberately UPDATE only. Bag and size limits are NOT touched: today's
-- source is the closure table, which carries no limits, and a verified
-- overlay row replaces the bundled row whole - a null bag limit written
-- here would erase a correct one in the app. A species with no fed_gulf
-- row is left missing rather than inserted half-blank; the final query
-- lists those.
--
-- Years are written on BOTH ends of every forward-looking range on
-- purpose. The parser takes the year from the first date only, so
-- "Jan 1 - Feb 28, 2027" resolves the closing edge to Jan 1 of the
-- CURRENT year and the email would never announce it.
--
-- A row a human verified is left alone (verified_by = 'rob').

update public.regulations r
   set season_text = v.season_text,
       notes       = coalesce(v.notes, r.notes),
       status      = 'verified',
       verified_by = 'claude-agency-read',
       verified_at = now(),
       last_checked_at = now(),
       source_note = 'NOAA Fisheries: Fishing Regulations and Seasonal Closures in the Gulf of America, recreational column, read 2026-11-09',
       source_url  = 'https://www.fisheries.noaa.gov/southeast/rules-regulations/fishing-regulations-and-seasonal-closures-gulf-america'
  from (values
    -- Red snapper. For-hire and private are different seasons, which is
    -- what the sector column exists for. If the row for this water is
    -- still a single 'all' row, it gets the combined sentence.
    ('red_snapper', 'for_hire_federal',
     'Closed — the 2026 federally permitted for-hire season closed Oct 26, 2026. Annual closure Jan 1 – May 31.',
     'Federal for-hire component only; captain and crew bag = 0.'),
    ('red_snapper', 'all',
     'For-hire: closed — the 2026 federal season closed Oct 26, 2026. Private anglers: your own state season applies in federal water.',
     'Private recreational red snapper is delegated to the Gulf states under Reef Fish Amendment 50, so a private angler follows the state season out to the federal line.'),
    ('red_snapper', 'private',
     'Your own state season applies in federal water.',
     'Private recreational red snapper is delegated to the Gulf states under Reef Fish Amendment 50.'),

    -- Gag: opened Sept 1, closed Oct 1 on quota.
    ('gag_grouper', 'all',
     'Closed — the 2026 season closed Oct 1, 2026.',
     'Closed annually Jan 1 – Aug 31. The 2026 season opened Sept 1 and closed Oct 1, 2026.'),

    -- Greater amberjack: the season would have run to Oct 31; it closed
    -- early on Oct 14 when the quota was met.
    ('greater_amberjack', 'all',
     'Closed — the 2026 season closed Oct 14, 2026 when the quota was met.',
     'Closed Nov 1 – Jul 31 and Aug 1 – Aug 31, so the season runs Sept 1 – Oct 31; the 2026 season closed early on Oct 14.'),

    -- No recreational seasonal closure in the federal table.
    ('red_grouper', 'all',
     'Year-round, except closed Feb 1, 2027 – Mar 31, 2027 seaward of the ~20-fathom contour.',
     'Within the 4-fish grouper aggregate; max 2 red grouper per person per day.'),
    ('king_mackerel', 'all',
     'Year-round — no federal recreational seasonal closure.',
     'Gulf migratory group. The Southern Zone gillnet closure is commercial only.'),

    -- Other shallow-water grouper. New federal rule on the page today:
    -- from Jan 1, 2027 harvest is prohibited Jan 1 – Jun 30 every year.
    ('black_grouper', 'all',
     'Year-round, except closed Feb 1, 2027 – Mar 31, 2027 seaward of the ~20-fathom contour; closed Jan 1, 2027 – Jun 30, 2027 and every year after.',
     'From Jan 1, 2027 harvest of the other shallow-water groupers (black, yellowmouth, scamp, yellowfin) is prohibited Jan 1 – Jun 30 each year.'),
    ('scamp', 'all',
     'Year-round, except closed Feb 1, 2027 – Mar 31, 2027 seaward of the ~20-fathom contour; closed Jan 1, 2027 – Jun 30, 2027 and every year after.',
     'From Jan 1, 2027 harvest of the other shallow-water groupers (black, yellowmouth, scamp, yellowfin) is prohibited Jan 1 – Jun 30 each year.'),
    ('yellowmouth_grouper', 'all',
     'Year-round, except closed Feb 1, 2027 – Mar 31, 2027 seaward of the ~20-fathom contour; closed Jan 1, 2027 – Jun 30, 2027 and every year after.',
     'From Jan 1, 2027 harvest of the other shallow-water groupers (black, yellowmouth, scamp, yellowfin) is prohibited Jan 1 – Jun 30 each year.'),

    -- Gray triggerfish: two recreational closures a year.
    ('gray_triggerfish', 'all',
     'Open — closed Jan 1, 2027 – Feb 28, 2027 and Jun 1, 2027 – Jul 31, 2027.',
     'Sub-cap of 1 within the 20-fish reef-fish aggregate. An in-season closure can come earlier.'),

    -- Harvest prohibited outright, so there is no season to go stale.
    ('goliath_grouper', 'all', 'Harvest prohibited in federal Gulf waters.', null),
    ('nassau_grouper',  'all', 'Harvest prohibited in federal Gulf waters.', null)
  ) as v(species_id, sector, season_text, notes)
 where r.species_id = v.species_id
   and r.jurisdiction_id = 'fed_gulf'
   and r.sector = v.sector
   and (r.verified_by is null or r.verified_by <> 'rob');

-- What the newsletter will now read for federal Gulf.
select species_id, sector, status, season_text, verified_at::date as verified
  from public.regulations
 where jurisdiction_id = 'fed_gulf'
   and species_id in ('red_snapper','gag_grouper','greater_amberjack','red_grouper',
                      'king_mackerel','black_grouper','scamp','yellowmouth_grouper',
                      'gray_triggerfish','goliath_grouper','nassau_grouper')
 order by species_id, sector;

-- And which of them have no federal row at all. These are not errors to
-- fix by hand: the generator refreshes only rows that exist, so a
-- missing one simply does not print. Paste this result back if you want
-- them filled in properly, with limits read off the source.
select s.species_id
  from (values ('red_snapper'),('gag_grouper'),('greater_amberjack'),('red_grouper'),
               ('king_mackerel'),('black_grouper'),('scamp'),('yellowmouth_grouper'),
               ('gray_triggerfish')) as s(species_id)
 where not exists (
   select 1 from public.regulations r
    where r.species_id = s.species_id and r.jurisdiction_id = 'fed_gulf');
