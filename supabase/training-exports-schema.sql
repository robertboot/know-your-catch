-- ReelIntel — training-exports bucket + table.
--
-- Purpose: the admin Training tab uploads the exported ZIP directly to
-- Supabase Storage instead of triggering a browser download. Colab
-- consumes it via a signed URL. No more Mac-in-the-middle.
--
-- Run once, in the Supabase SQL Editor, on the same project that hosts
-- training_images and model_versions.

------------------------------------------------------------------
-- 1) Bucket (private)
------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('training-exports', 'training-exports', false)
  on conflict (id) do nothing;

------------------------------------------------------------------
-- 2) Table
------------------------------------------------------------------
create table if not exists public.training_exports (
  id              uuid primary key default gen_random_uuid(),
  storage_path    text not null,        -- path within the 'training-exports' bucket
  size_bytes      bigint not null,
  species_count   int not null,
  image_count     int not null,
  split_seed      text,
  exported_by     text,                 -- email of the admin who ran the export
  exported_at     timestamptz not null default now(),
  notes           text
);
create index if not exists training_exports_exported_at_idx
  on public.training_exports (exported_at desc);

------------------------------------------------------------------
-- 3) Row-Level Security — admin only
------------------------------------------------------------------
alter table public.training_exports enable row level security;

-- The single-admin allowlist matches the same email used in
-- send-launch-email/index.ts and the Edge Function auth gate.
drop policy if exists training_exports_admin_all on public.training_exports;
create policy training_exports_admin_all on public.training_exports
  for all
  using (
    coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  )
  with check (
    coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  );

------------------------------------------------------------------
-- 4) Storage RLS — admin-only read+write on the bucket
------------------------------------------------------------------
-- Storage policies live in the storage.objects table. Guard by bucket
-- name so this policy only affects training-exports.
drop policy if exists "training-exports admin all" on storage.objects;
create policy "training-exports admin all" on storage.objects
  for all
  using (
    bucket_id = 'training-exports'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  )
  with check (
    bucket_id = 'training-exports'
    and coalesce((auth.jwt() ->> 'email'), '') = 'robertb1023@me.com'
  );
