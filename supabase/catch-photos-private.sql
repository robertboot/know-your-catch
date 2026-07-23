-- ============================================================
--  Lock down the catch-photos bucket (audit finding #2)
--  Run once in the Supabase SQL editor.
--
--  Catch photos were served via public, auth-free URLs — anyone with
--  (or guessing) a URL could view them. This makes the bucket PRIVATE
--  and restricts every object to its owner. The app already resolves
--  short-lived SIGNED urls on demand (photos-store.js photoSignedUrl),
--  so display keeps working; only unauthenticated access is closed.
-- ============================================================

-- 1) Flip the bucket to private (public URLs now 403).
update storage.buckets set public = false where id = 'catch-photos';

-- 2) Owner-only object access. Paths are '{uid}/{photoId}.jpg', so the
--    first folder segment is the owner's user id.
drop policy if exists "catch-photos own read"   on storage.objects;
drop policy if exists "catch-photos own insert" on storage.objects;
drop policy if exists "catch-photos own delete" on storage.objects;

create policy "catch-photos own read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catch-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "catch-photos own insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catch-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "catch-photos own delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'catch-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Note: createSignedUrl (used by the app) requires the caller to have
-- SELECT on the object — the "own read" policy above grants exactly that
-- for a user's own folder, and nothing else.
