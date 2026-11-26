-- Admin dashboard read access for the cloudsync tables
-- (catches, pbs, user_state). Mirrors the pattern used by
-- regulations / species / species_suggestions: a single allowlisted
-- email gets SELECT bypass on the RLS-locked tables.
--
-- Run once against the production Supabase project. The dashboard's
-- "Users" panel is gated behind this — without it the HEAD counts
-- come back as 0 for the admin because the tables are own-row
-- RLS-locked (each user only sees their own catches / pbs / state).
--
-- SAFETY: read-only. No insert / update / delete policy is added.
-- Everything else — moderation, user-state edits — stays gated on
-- the row-owner's session, exactly as before.

drop policy if exists catches_admin_read on public.catches;
create policy catches_admin_read on public.catches
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

drop policy if exists pbs_admin_read on public.pbs;
create policy pbs_admin_read on public.pbs
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

drop policy if exists user_state_admin_read on public.user_state;
create policy user_state_admin_read on public.user_state
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

notify pgrst, 'reload schema';
