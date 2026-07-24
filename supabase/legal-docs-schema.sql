-- Legal docs — admin-editable, publicly readable.
-- Backs reelintel.ai/privacy (and future /terms). The static
-- privacy.html page fetches the current row from here on load and
-- falls back to its bundled copy if the fetch fails, so the page
-- always renders even when Supabase is unreachable.

create table if not exists public.legal_docs (
  slug         text primary key,           -- 'privacy', 'terms', 'support'
  title        text not null,
  body_html    text not null,              -- HTML fragment injected into
                                           -- the page's <article> container.
  updated_at   timestamptz not null default now(),
  updated_by   text
);

create or replace function public.legal_docs_touch_updated_at()
  returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists legal_docs_touch on public.legal_docs;
create trigger legal_docs_touch
  before update on public.legal_docs
  for each row execute function public.legal_docs_touch_updated_at();

alter table public.legal_docs enable row level security;

-- Anyone (anon browser hitting /privacy) can read.
drop policy if exists legal_docs_public_read on public.legal_docs;
create policy legal_docs_public_read on public.legal_docs
  for select using (true);

-- Only the admin allowlisted email writes.
drop policy if exists legal_docs_admin_write on public.legal_docs;
create policy legal_docs_admin_write on public.legal_docs
  for all
  using (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com')
  with check (lower(coalesce((auth.jwt() ->> 'email'), '')) = 'robertb1023@me.com');

notify pgrst, 'reload schema';
