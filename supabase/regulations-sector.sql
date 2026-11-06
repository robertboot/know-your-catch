-- Who a regulation applies to.
--
-- Red snapper closed in federal waters on October 26 for federally
-- permitted FOR-HIRE boats. Alabama's private and state-charter season
-- is open until the quota is met. The newsletter printed the closure to
-- private anglers, because this table holds one row per species per
-- jurisdiction and had nowhere to say which sector a season belongs to —
-- the two seasons had to share a row, and the newer text won.
--
-- A sector column fixes that at the root: the same species in the same
-- water can carry a private season and a for-hire season side by side,
-- and every reader is told which one they are looking at.
--
-- 'all' is the default and means what the table meant before, so every
-- existing row keeps its meaning and nothing in the app changes until a
-- sector-specific row is entered.

alter table public.regulations
  add column if not exists sector text not null default 'all'
  check (sector in ('all','private','state_charter','for_hire_federal'));

-- The uniqueness rule has to include it, or the second sector cannot be
-- stored at all.
alter table public.regulations
  drop constraint if exists regulations_species_id_jurisdiction_id_key;

create unique index if not exists regulations_species_juris_sector_key
  on public.regulations (species_id, jurisdiction_id, sector);

comment on column public.regulations.sector is
  'Who the rule applies to: all | private | state_charter | for_hire_federal. '
  'Federally permitted for-hire vessels fish a different season from private '
  'anglers in the same water — red snapper is the standing example.';

notify pgrst, 'reload schema';

select species_id, jurisdiction_id, sector, status, season_text
from public.regulations
where species_id = 'red_snapper'
order by jurisdiction_id, sector;
