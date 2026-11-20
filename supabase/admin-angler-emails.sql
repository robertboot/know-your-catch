-- Who logged this catch.
--
-- The anglers table is a consent record: it holds no name and no address.
-- The identity lives in auth.users, which no browser key can read. So the
-- console gets one security-definer lookup, gated on public.is_admin(),
-- that maps a user id to the email it signed up with.
--
-- This exists for one reason: on a map of 71 catches, several of them are
-- testers entering mock data, and a spot built from invented fish is worse
-- than no spot at all. Being able to see whose mark it is makes that
-- separable.
--
-- Admin-only, and deliberately nothing more than id and email — not a
-- general-purpose user table for the front end to grow a dependency on.

create or replace function public.admin_angler_emails()
returns table (user_id uuid, email text)
language plpgsql
security definer
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;
  return query
    select u.id, u.email::text
    from auth.users u;
end $$;

revoke all on function public.admin_angler_emails() from public, anon;
grant execute on function public.admin_angler_emails() to authenticated;

notify pgrst, 'reload schema';
