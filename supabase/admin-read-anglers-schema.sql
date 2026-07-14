-- Admin dashboard read access for the research-dataset tables
-- (anglers, catches, catch_photos). Mirrors the pattern used by
-- regulations / species / species_suggestions: a single
-- allowlisted email gets SELECT bypass on the RLS-locked tables.
--
-- Run once against the production Supabase project. The dashboard's
-- "Users" panel is gated behind this — without it the HEAD counts
-- come back as 0 for the admin because the tables are RLS-owned
-- per-row and the admin's uuid never matches other anglers'.
--
-- SAFETY: read-only. No insert / update / delete policy is added.
-- Moderation still happens through the service role via edge
-- functions, not the anon key logged into the admin site.

drop policy if exists anglers_admin_read on public.anglers;
create policy anglers_admin_read on public.anglers
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

drop policy if exists catches_admin_read on public.catches;
create policy catches_admin_read on public.catches
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

drop policy if exists photos_admin_read on public.catch_photos;
create policy photos_admin_read on public.catch_photos
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

notify pgrst, 'reload schema';
