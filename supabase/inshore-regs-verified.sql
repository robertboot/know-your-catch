-- Inshore regulations, read off the agencies and written in verified.
--
-- Read on 2026-10-31 from the agencies' own text, not from summaries:
--   Alabama      Ala. Admin. Code r. 220-3-.30 (the rule PDF itself)
--   Mississippi  MDMR recreational size and possession limits table
--   Florida      FWC species pages, Gulf and Atlantic state waters
--
-- Louisiana and Texas are NOT in here. wlf.louisiana.gov refuses
-- automated requests (403) and the TPWD table did not render its
-- numbers; guessing them from a neighbouring state is exactly the
-- failure this file exists to end, so those two stay as they are.
--
-- Every statement declines to overwrite a row you verified yourself:
-- `where verified_by is null or verified_by <> 'rob'`. A human who read
-- the page outranks an agent that read the page.
--
-- Species the agency does not list are written as 'unregulated', which
-- is an answer, not a backlog item.

-- Alabama inshore + nearshore, from the administrative code itself.
-- Verified against the rule text, not a summary page.

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('spotted_seatrout', 'al_state', 'all', 'Year-round', 15, 22, 6,
        'Slot 15-22 in total length; one of the six may exceed 22 in.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('red_drum', 'al_state', 'all', 'Year-round', 16, 26, 3,
        'Slot 16-26 in total length. No red drum may be possessed in federal waters by anyone under Alabama jurisdiction.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('sheepshead', 'al_state', 'all', 'Year-round', 12, null, 8,
        'Minimum 12 in fork length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('gulf_flounder', 'al_state', 'all', 'Closed Nov 1 - Nov 30; open the rest of the year', 14, null, 5,
        'Minimum 14 in total length. Harvest is prohibited statewide November 1-30.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('southern_flounder', 'al_state', 'all', 'Closed Nov 1 - Nov 30; open the rest of the year', 14, null, 5,
        'Minimum 14 in total length. Harvest is prohibited statewide November 1-30.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('florida_pompano', 'al_state', 'all', 'Year-round', 12, null, 3,
        'Minimum 12 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('tripletail', 'al_state', 'all', 'Year-round', null, null, 3,
        'Daily limit 3.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('gray_snapper', 'al_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('mangrove_snapper', 'al_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length (gray snapper).', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('lane_snapper', 'al_state', 'all', 'Year-round', 10, null, null,
        'Minimum 10 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('spanish_mackerel', 'al_state', 'all', 'Year-round', null, null, 15,
        'Daily limit 15.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('king_mackerel', 'al_state', 'all', 'Year-round', 24, null, 3,
        'Minimum 24 in fork length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('cobia', 'al_state', 'all', 'Year-round', 36, null, 1,
        'Minimum 36 in fork length; 1 per person, not to exceed 2 per vessel.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'Ala. Admin. Code r. 220-3-.30, Saltwater Fish Creel, Bag, Possession and Size Limits', 'https://admincode.legislature.state.al.us/administrative-code/220-3-.30')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

-- Black drum, sand seatrout, mullet and the rest are absent from the rule:
-- Alabama publishes no species-specific limit for them.
insert into public.regulations
  (species_id, jurisdiction_id, sector, status, drafted_by, drafted_at,
   last_checked_at, notes, source_note, source_url)
select s, 'al_state', 'all', 'unregulated', 'claude-agency-read', now(), now(),
       'Not listed in Ala. Admin. Code 220-3-.30 — no species-specific size or bag limit in Alabama waters. General rules apply.',
       'Ala. Admin. Code r. 220-3-.30 (species absent from the table)',
       'https://admincode.legislature.state.al.us/administrative-code/220-3-.30'
from unnest(array['black_drum','atlantic_croaker','striped_mullet','ladyfish','jack_crevalle']) s
on conflict (species_id, jurisdiction_id, sector) do nothing;
-- Mississippi, from the MDMR limits table.

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('spotted_seatrout', 'ms_state', 'all', 'Year-round', 15, null, 15,
        'Minimum 15 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('red_drum', 'ms_state', 'all', 'Year-round', 18, 30, 3,
        'Slot 18-30 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('gulf_flounder', 'ms_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('southern_flounder', 'ms_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('sheepshead', 'ms_state', 'all', 'Year-round', 14, null, 15,
        'Minimum 14 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('gray_snapper', 'ms_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('mangrove_snapper', 'ms_state', 'all', 'Year-round', 12, null, 10,
        'Minimum 12 in total length (gray snapper).', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('tripletail', 'ms_state', 'all', 'Year-round', 18, null, null,
        'Minimum 18 in total length.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

-- MDMR prints "No Limit" against these: no species-specific rule.
insert into public.regulations
  (species_id, jurisdiction_id, sector, status, drafted_by, drafted_at, last_checked_at,
   notes, source_note, source_url)
select s, 'ms_state', 'all', 'unregulated', 'claude-agency-read', now(), now(),
       'MDMR lists this species as "No Limit" — no species-specific size or possession limit. General rules apply.',
       'MDMR Recreational Size and Possession Limits table', 'https://dmr.ms.gov/recreational-catch-limits/'
from unnest(array['black_drum','florida_pompano','striped_mullet']) s
on conflict (species_id, jurisdiction_id, sector) do nothing;

-- Florida Gulf state waters, from the FWC species pages.

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('sheepshead', 'fl_state', 'all', 'Year-round', 12, null, 8,
        'Minimum 12 in total length. Gulf and Atlantic state waters.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'FWC recreational regulations, species page', 'https://myfwc.com/fishing/saltwater/recreational/sheepshead/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('black_drum', 'fl_state', 'all', 'Year-round', 14, 24, 5,
        'Slot 14-24 in; the five may include one fish over 24 in.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'FWC recreational regulations, species page', 'https://myfwc.com/fishing/saltwater/recreational/black-drum/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('gulf_flounder', 'fl_state', 'all', 'Closed Oct 15 - Nov 30; open the rest of the year', 14, null, 5,
        'Minimum 14 in total length. The closure covers gulf, southern, summer and fringed flounder.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'FWC recreational regulations, species page', 'https://myfwc.com/fishing/saltwater/recreational/flounder/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('southern_flounder', 'fl_state', 'all', 'Closed Oct 15 - Nov 30; open the rest of the year', 14, null, 5,
        'Minimum 14 in total length. The closure covers gulf, southern, summer and fringed flounder.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'FWC recreational regulations, species page', 'https://myfwc.com/fishing/saltwater/recreational/flounder/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

insert into public.regulations
  (species_id, jurisdiction_id, sector, season_text, min_size_in, max_size_in, bag_limit,
   notes, status, drafted_by, drafted_at, verified_by, verified_at, source_note, source_url)
values ('spotted_seatrout', 'fl_state', 'all', 'Year-round', 15, 19, null,
        'Slot 15-19 in total length; one fish over 19 in per vessel, or per person from shore, inside the bag. The bag itself is set by FWC region (2, 3 or 5 per person) — check the region you are fishing.', 'verified', 'claude-agency-read', now(), 'claude-agency-read', now(),
        'FWC recreational regulations, species page', 'https://myfwc.com/fishing/saltwater/recreational/spotted-seatrout/')
on conflict (species_id, jurisdiction_id, sector) do update set
  season_text = excluded.season_text, min_size_in = excluded.min_size_in,
  max_size_in = excluded.max_size_in, bag_limit = excluded.bag_limit,
  notes = excluded.notes, status = 'verified',
  verified_by = excluded.verified_by, verified_at = now(),
  source_note = excluded.source_note, source_url = excluded.source_url
where public.regulations.verified_by is null
   or public.regulations.verified_by <> 'rob';

