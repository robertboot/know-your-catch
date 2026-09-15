-- Regulations overlay + admin verification workflow.
--
-- Bundled REGULATIONS in src/data.js is the offline-first floor.
-- This table sits on top as an overlay where the admin can draft
-- (AI-assisted or manual), then verify with a cited source before
-- the row becomes visible to the mobile app.
--
-- RLS enforces the verified-only rule at the database layer, not
-- just the client — so a draft can never leak to a signed-out user
-- even if the mobile client has a bug.

create table if not exists public.regulations (
  id                uuid primary key default gen_random_uuid(),
  species_id        text not null,
  jurisdiction_id   text not null,
  -- Regulation content. Every field nullable because the AI (or a
  -- partial admin entry) may not know every value. NULL means "we
  -- don't have this datum" — the mobile app renders nothing for
  -- that row rather than a default.
  season_text       text,
  min_size_in       numeric(5,1),
  max_size_in       numeric(5,1),
  bag_limit         integer,
  boat_limit        integer,
  notes             text,
  -- Verification workflow.
  status            text not null default 'draft'
                    check (status in ('draft','verified','stale','disputed')),
  drafted_by        text not null,
  drafted_at        timestamptz not null default now(),
  verified_by       text,
  verified_at       timestamptz,
  source_note       text,
  source_url        text,
  updated_at        timestamptz not null default now(),
  unique (species_id, jurisdiction_id)
);

create index if not exists regulations_species_juris_idx
  on public.regulations (species_id, jurisdiction_id);
create index if not exists regulations_status_idx
  on public.regulations (status);

-- Updated_at auto-touch on any change so subscribers know when to
-- refetch. Idempotent create.
create or replace function public.regulations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists regulations_touch on public.regulations;
create trigger regulations_touch
  before update on public.regulations
  for each row execute function public.regulations_touch_updated_at();

alter table public.regulations enable row level security;

-- Public read: ONLY verified rows. Signed-out mobile users see this.
drop policy if exists regs_public_verified on public.regulations;
create policy regs_public_verified on public.regulations
  for select
  using (status = 'verified');

-- Admin can read + write everything (drafts included).
drop policy if exists regs_admin_all on public.regulations;
create policy regs_admin_all on public.regulations
  for all
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com')
  with check (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

notify pgrst, 'reload schema';
