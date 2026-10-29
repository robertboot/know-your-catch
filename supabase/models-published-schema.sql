-- ReelIntel — models-published public bucket.
--
-- Purpose: mobile app fetches the currently-promoted model without
-- being logged in as admin. This bucket is public-read, admin-only
-- write. On promote, the admin app copies the promoted .tflite into
-- this bucket and writes a small manifest JSON alongside it so the
-- mobile app can check the version cheaply before deciding to
-- re-download the model bytes.
--
-- Run once, in the Supabase SQL Editor.

------------------------------------------------------------------
-- 1) Bucket (public-read)
------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('models-published', 'models-published', true)
  on conflict (id) do update set public = true;

------------------------------------------------------------------
-- 2) Storage RLS
--    Anonymous read is granted by the bucket's public flag above.
--    Writes are still admin-only.
------------------------------------------------------------------
drop policy if exists "models-published admin write" on storage.objects;
create policy "models-published admin write" on storage.objects
  for insert
  with check (
    bucket_id = 'models-published'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  );

drop policy if exists "models-published admin update" on storage.objects;
create policy "models-published admin update" on storage.objects
  for update
  using (
    bucket_id = 'models-published'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  )
  with check (
    bucket_id = 'models-published'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  );

drop policy if exists "models-published admin delete" on storage.objects;
create policy "models-published admin delete" on storage.objects
  for delete
  using (
    bucket_id = 'models-published'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  );
