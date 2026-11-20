-- Hogfish, read off FWC's own page on 2026-11-10.
-- Source: https://myfwc.com/fishing/saltwater/recreational/hogfish/
--
-- hogfish was the record holding the Florida Atlantic newsletter, at 36
-- days old. Two different fisheries share the name, which is most of
-- why it kept failing a re-check: Gulf state waters are open all year
-- at 14 inches and five fish, while Atlantic state waters - which FWC
-- defines as everything south of Cape Sable, the Keys included - are
-- 16 inches, one fish, and open only May 1 to Oct 31. That Atlantic
-- season shut nine days ago, which is real news for this week's email.
--
-- The federal rows match their state counterparts; FWC states both on
-- the same page.

update public.regulations r
   set season_text = v.season_text,
       min_size_in = v.min_size_in,
       bag_limit   = v.bag_limit,
       notes       = v.notes,
       status      = 'verified',
       verified_by = 'claude-agency-read',
       verified_at = now(),
       last_checked_at = now(),
       source_note = 'FWC, Hogfish recreational regulations, read 2026-11-10',
       source_url  = 'https://myfwc.com/fishing/saltwater/recreational/hogfish/'
  from (values
    ('fl_atlantic',
     'Closed Nov 1, 2026 – Apr 30, 2027.', 16, 1,
     'Atlantic state waters, which FWC defines as all state and federal waters south of Cape Sable, the Florida Keys included. Open May 1 – Oct 31 each year. 16 in fork length, one per harvester. State Reef Fish Angler designation required from a private vessel. Special rules in Biscayne National Park.'),
    ('fed_satlantic',
     'Closed Nov 1, 2026 – Apr 30, 2027.', 16, 1,
     'Atlantic federal waters, open May 1 – Oct 31 each year. 16 in fork length, one per harvester.'),
    ('fl_state',
     'Year-round.', 14, 5,
     'Gulf state waters. 14 in fork length, five per harvester. State Reef Fish Angler designation required from a private vessel.'),
    ('fed_gulf',
     'Year-round.', 14, 5,
     'Gulf federal waters north of Cape Sable. 14 in fork length, five per harvester.')
  ) as v(jurisdiction_id, season_text, min_size_in, bag_limit, notes)
 where r.species_id = 'hogfish'
   and r.jurisdiction_id = v.jurisdiction_id
   and (r.verified_by is null or r.verified_by <> 'rob');

select jurisdiction_id, status, season_text, min_size_in, bag_limit
  from public.regulations
 where species_id = 'hogfish'
 order by jurisdiction_id;
