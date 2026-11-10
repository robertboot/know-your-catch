-- Florida snook, read off FWC's own page on 2026-11-10.
--
-- Source: https://myfwc.com/fishing/saltwater/recreational/snook/
-- and the swordspine snook profile, whose "Recreational Regulations"
-- link points at that same page - which is the answer to the question
-- this file exists to settle: swordspine snook is not unregulated and
-- it is not a species FWC treats separately. It is a snook, and the
-- snook rule covers it.
--
-- Why it mattered: swordspine_snook was the single unverified record
-- holding the Florida Gulf newsletter, at 32 days old, and the
-- researcher kept being asked and never came back with an answer.
--
-- FWC manages snook by region. These are the GULF regions (Panhandle,
-- Big Bend, Tampa Bay, Sarasota Bay) and the ATLANTIC regions
-- (Northeast, Indian River Lagoon, Southeast). Charlotte Harbor and
-- Southwest run a longer summer closure, which the notes carry.
--
-- Years are on both ends of every range on purpose; the season parser
-- takes the year from the first date only.

update public.regulations r
   set season_text = v.season_text,
       min_size_in = v.min_size_in,
       max_size_in = v.max_size_in,
       bag_limit   = v.bag_limit,
       notes       = v.notes,
       status      = 'verified',
       verified_by = 'claude-agency-read',
       verified_at = now(),
       last_checked_at = now(),
       source_note = 'FWC, Snook Management Regions and Regulations, read 2026-11-10',
       source_url  = 'https://myfwc.com/fishing/saltwater/recreational/snook/'
  from (values
    ('common_snook', 'fl_state',
     'Open now. Closed Dec 1, 2026 – Feb 28, 2027 and May 1, 2027 – Aug 31, 2027.',
     28, 33, 1,
     'Snook permit and recreational licence required; hook and line only; must stay whole until ashore; no commercial sale. Charlotte Harbor and Southwest regions close May 1 – Sept 30 instead.'),
    ('swordspine_snook', 'fl_state',
     'Open now. Closed Dec 1, 2026 – Feb 28, 2027 and May 1, 2027 – Aug 31, 2027.',
     28, 33, 1,
     'Managed under the same FWC snook rule as common snook. Swordspine snook reaches about 15 inches, so it never meets the 28-inch slot - in practice it is catch and release. FWC also calls it rare on the west coast.'),
    ('common_snook', 'fl_atlantic',
     'Open now. Closed Dec 15, 2026 – Jan 31, 2027 and Jun 1, 2027 – Aug 31, 2027.',
     28, 32, 1,
     'Snook permit and recreational licence required; hook and line only; must stay whole until ashore; no commercial sale. Special rules apply in Biscayne National Park.'),
    ('swordspine_snook', 'fl_atlantic',
     'Open now. Closed Dec 15, 2026 – Jan 31, 2027 and Jun 1, 2027 – Aug 31, 2027.',
     28, 32, 1,
     'Managed under the same FWC snook rule as common snook. Swordspine snook reaches about 15 inches, so it never meets the 28-inch slot - in practice it is catch and release.')
  ) as v(species_id, jurisdiction_id, season_text, min_size_in, max_size_in, bag_limit, notes)
 where r.species_id = v.species_id
   and r.jurisdiction_id = v.jurisdiction_id
   and (r.verified_by is null or r.verified_by <> 'rob');

select species_id, jurisdiction_id, status, season_text, min_size_in, max_size_in, bag_limit
  from public.regulations
 where species_id in ('common_snook','swordspine_snook')
   and jurisdiction_id in ('fl_state','fl_atlantic')
 order by jurisdiction_id, species_id;
