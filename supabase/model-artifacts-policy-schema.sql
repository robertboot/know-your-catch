-- model-artifacts bucket — admin storage policies.
--
-- ROOT CAUSE of the "lingering Import from Colab" bug: this bucket
-- never had storage policies. Colab uploads bundles via signed
-- upload tokens (which bypass policies), and listing worked, but
-- markBundleImported() moves pending/<file> → imported/<file>, and
-- a storage MOVE requires UPDATE on storage.objects for the bucket.
-- With no policy, the move was silently denied — so every imported
-- bundle stayed listed under Pending forever (Big Red 4.0 through
-- 8.0 all hit this).
--
-- Grants the admin email full control of the bucket, and cleans up
-- the already-imported stragglers by moving them out of pending/.

drop policy if exists "model-artifacts admin all" on storage.objects;
create policy "model-artifacts admin all" on storage.objects
  for all
  using (
    bucket_id = 'model-artifacts'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  )
  with check (
    bucket_id = 'model-artifacts'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  );

-- One-time cleanup: everything still sitting in pending/ has already
-- been imported (the imports succeeded — only the move failed), so
-- relocate the stragglers to imported/ now.
update storage.objects
set name = 'imported/' || substring(name from 9)
where bucket_id = 'model-artifacts'
  and name like 'pending/%';
