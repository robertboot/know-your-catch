-- Weekly Waters Report — drafts, review, approval, send.
--
-- The cron does NOT send. It GENERATES a draft and stops. Nothing leaves
-- the building until an admin has looked at the rendered email and
-- pressed Approve & send. Regulations are the payload here, and a wrong
-- season in a mass email is the one mistake this product cannot make.
--
-- Run this whole file in the Supabase SQL editor.

create table if not exists public.weekly_emails (
  id               uuid primary key default gen_random_uuid(),
  jurisdiction_id  text not null,                 -- al_state, fl_state, ...
  federal_id       text not null,                 -- fed_gulf | fed_satlantic
  week_start       date not null,                 -- the Thursday this edition covers
  -- draft    : generated, waiting on a human
  -- blocked  : generated but the regulation data could not be trusted
  -- approved : a human said yes; the send function may pick it up
  -- sent     : delivered
  -- discarded: a human said no
  status           text not null default 'draft'
                   check (status in ('draft','blocked','approved','sent','discarded')),
  subject          text not null,
  html             text not null,
  text_body        text not null,
  -- Everything the render was built from, kept so a send can be
  -- explained later without re-deriving it from a moving forecast.
  payload          jsonb not null default '{}'::jsonb,
  -- Why a blocked edition was blocked: the offending regulation rows.
  block_reasons    jsonb not null default '[]'::jsonb,
  recipient_count  integer not null default 0,
  generated_at     timestamptz not null default now(),
  approved_by      text,
  approved_at      timestamptz,
  sent_at          timestamptz,
  send_error       text,
  -- One edition per waters per week. The cron may fire twice, a retry may
  -- land late, an admin may hit generate again — none of that may produce
  -- a second email to the same people.
  unique (jurisdiction_id, week_start)
);

create index if not exists weekly_emails_status_idx
  on public.weekly_emails (status, week_start desc);

alter table public.weekly_emails enable row level security;

-- Admins only. Anglers never read this table; the edge functions use the
-- service role and bypass RLS entirely.
drop policy if exists weekly_emails_admin_all on public.weekly_emails;
create policy weekly_emails_admin_all on public.weekly_emails
  for all
  using (lower(coalesce((auth.jwt() ->> 'email'), ''))
         = any (array['robertb1023@me.com','annelies@reelintel.ai','harper@reelintel.ai']))
  with check (lower(coalesce((auth.jwt() ->> 'email'), ''))
              = any (array['robertb1023@me.com','annelies@reelintel.ai','harper@reelintel.ai']));

-- Per-recipient delivery log. Separate from the edition so a partial
-- send can be resumed without re-mailing the people who already got it.
create table if not exists public.weekly_email_recipients (
  id            uuid primary key default gen_random_uuid(),
  email_id      uuid not null references public.weekly_emails(id) on delete cascade,
  user_id       uuid,
  email         text not null,
  sent_at       timestamptz,
  error         text,
  unique (email_id, email)
);

create index if not exists weekly_email_recipients_email_idx
  on public.weekly_email_recipients (email_id);

alter table public.weekly_email_recipients enable row level security;

drop policy if exists weekly_email_recipients_admin_all on public.weekly_email_recipients;
create policy weekly_email_recipients_admin_all on public.weekly_email_recipients
  for all
  using (lower(coalesce((auth.jwt() ->> 'email'), ''))
         = any (array['robertb1023@me.com','annelies@reelintel.ai','harper@reelintel.ai']))
  with check (lower(coalesce((auth.jwt() ->> 'email'), ''))
              = any (array['robertb1023@me.com','annelies@reelintel.ai','harper@reelintel.ai']));

-- Who would receive an edition. A security-definer function because the
-- admin UI needs the count BEFORE approving, and it cannot read
-- auth.users directly. Column names follow user_state as the sync layer
-- and scan-regulation-alerts already use it: the blob is `data`, and
-- soft-deleted rows carry deleted_at.
create or replace function public.weekly_email_audience(p_jurisdiction text)
returns table (user_id uuid, email text)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, u.email
  from auth.users u
  join public.user_state s on s.user_id = u.id
  where s.data ->> 'jurisdiction' = p_jurisdiction
    and s.deleted_at is null
    and u.email is not null
$$;

revoke all on function public.weekly_email_audience(text) from public;
grant execute on function public.weekly_email_audience(text) to authenticated, service_role;
