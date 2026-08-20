-- Testers admin view + submission alerts.
--
-- Run AFTER supabase/tester-feedback-schema.sql.
--
-- Gives the admin Testers tab one call that answers the question the
-- table alone cannot: did the person who sent feedback actually create
-- an account, and have they used the app? That means reading
-- auth.users, which the anon key can never do — hence security definer
-- with an explicit admin check inside.

create or replace function public.tester_feedback_admin()
returns table (
  id                  uuid,
  submitted_at        timestamptz,
  name                text,
  email               text,
  tested              text,
  worked              text,
  confusing           text,
  broke               text,
  wish                text,
  screenshot_path     text,
  user_id             uuid,
  account_created_at  timestamptz,
  email_confirmed_at  timestamptz,
  last_sign_in_at     timestamptz,
  catches             integer,
  pbs                 integer
)
language plpgsql
security definer
stable
as $$
-- OUT params share names with tester_feedback columns (id, name,
-- email...). Every reference below is table-qualified so there is no
-- conflict, but pin the resolution anyway — an ambiguity error here
-- would only surface at run time, in the SQL editor.
#variable_conflict use_column
declare
  r  record;
  nc integer;
  np integer;
begin
  -- security definer bypasses RLS, so the gate lives here.
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'robertb1023@me.com' then
    raise exception 'not authorised';
  end if;

  for r in
    select f.*,
           u.id                 as uid,
           u.created_at         as acct_created,
           u.email_confirmed_at as confirmed,
           u.last_sign_in_at    as last_seen
    from public.tester_feedback f
    -- Trim + lower: testers type their email by hand, and a stray
    -- capital or trailing space must not read as "never signed up".
    left join auth.users u
      on lower(trim(u.email)) = lower(trim(f.email))
    order by f.submitted_at desc
  loop
    nc := null;
    np := null;
    if r.uid is not null then
      -- Usage counts are a bonus, not the point. Wrapped so a renamed
      -- column or missing table degrades to "unknown" instead of
      -- taking the whole Testers tab down with it.
      begin
        execute 'select count(*)::int from public.catches where user_id = $1'
          into nc using r.uid;
      exception when others then nc := null;
      end;
      begin
        execute 'select count(*)::int from public.pbs where user_id = $1'
          into np using r.uid;
      exception when others then np := null;
      end;
    end if;

    id                 := r.id;
    submitted_at       := r.submitted_at;
    name               := r.name;
    email              := r.email;
    tested             := r.tested;
    worked             := r.worked;
    confusing          := r.confusing;
    broke              := r.broke;
    wish               := r.wish;
    screenshot_path    := r.screenshot_path;
    user_id            := r.uid;
    account_created_at := r.acct_created;
    email_confirmed_at := r.confirmed;
    last_sign_in_at    := r.last_seen;
    catches            := nc;
    pbs                := np;
    return next;
  end loop;
end $$;

revoke execute on function public.tester_feedback_admin() from anon;
grant  execute on function public.tester_feedback_admin() to authenticated;

-- Signed URL for a submitted screenshot (private bucket).
create or replace function public.tester_feedback_is_admin()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'robertb1023@me.com';
$$;
grant execute on function public.tester_feedback_is_admin() to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------
-- SUBMISSION ALERTS
-- ---------------------------------------------------------------
-- Once the table existed, submissions stopped emailing (the email was
-- only ever the fallback for a failed insert), so a response could sit
-- unread. This webhook restores the alert without giving up the row.
--
-- Dashboard ▸ Database ▸ Webhooks ▸ Create:
--   Table       public.tester_feedback
--   Events      Insert
--   Type        Supabase Edge Function
--   Function    notify-tester-feedback
--   Header      Authorization: Bearer <ANON_KEY>
