-- Tester feedback — backs the form at /testers.
--
-- The page works WITHOUT this table: submissions fall back to opening a
-- pre-filled email. Running this turns on database capture, the optional
-- screenshot upload, and the live "N / 25 spots claimed" counter (which
-- counts rows here, so it maintains itself).
--
-- Anyone with the link can INSERT (they are not signed in — the whole
-- point is that testers are recruited by text). Nobody can read the
-- responses except the admin.

create table if not exists public.tester_feedback (
  id              uuid primary key default gen_random_uuid(),
  submitted_at    timestamptz not null default now(),
  name            text not null,
  email           text not null,
  tested          text,
  worked          text,
  confusing       text,
  broke           text,
  wish            text,
  screenshot_path text
);

alter table public.tester_feedback enable row level security;

-- Anonymous testers may submit, and only submit.
drop policy if exists tester_feedback_anon_insert on public.tester_feedback;
create policy tester_feedback_anon_insert on public.tester_feedback
  for insert to anon, authenticated
  with check (true);

-- Only the admin reads them.
drop policy if exists tester_feedback_admin_read on public.tester_feedback;
create policy tester_feedback_admin_read on public.tester_feedback
  for select
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

-- The spots-claimed counter uses a HEAD count, which needs select. Anon
-- must be able to COUNT without reading contents; Postgres has no
-- count-only grant, so expose the number through a function instead.
create or replace function public.tester_feedback_count()
returns integer language sql security definer stable as $$
  select count(*)::int from public.tester_feedback;
$$;
grant execute on function public.tester_feedback_count() to anon, authenticated;

-- Optional: screenshot uploads. Private bucket — only the admin reads.
insert into storage.buckets (id, name, public)
values ('tester-feedback', 'tester-feedback', false)
on conflict (id) do nothing;

drop policy if exists tester_shots_anon_insert on storage.objects;
create policy tester_shots_anon_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'tester-feedback');

drop policy if exists tester_shots_admin_read on storage.objects;
create policy tester_shots_admin_read on storage.objects
  for select
  using (
    bucket_id = 'tester-feedback'
    and lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com'
  );

notify pgrst, 'reload schema';
