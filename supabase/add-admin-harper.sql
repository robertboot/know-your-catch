-- Add harper@reelintel.ai as a third admin.
--
-- The live policies were last rewritten by add-admin-harper's predecessor,
-- so every admin policy in this database now tests
--     lower(...) = any (array['robertb1023@me.com'::text, 'annelies@reelintel.ai'::text])
-- There is exactly one shape to match, which makes this simpler than the
-- annelies migration: append to the array, never convert anything.
--
-- Idempotent: a policy already naming harper no longer matches and is
-- skipped, so running this twice is harmless.

-- 1) The helper other code should prefer over its own literal.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in
         ('robertb1023@me.com', 'annelies@reelintel.ai', 'harper@reelintel.ai');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) Append harper to every policy array that already names the other two.
do $$
declare
  r        record;
  old_arr  text := '''robertb1023@me.com''::text, ''annelies@reelintel.ai''::text';
  new_arr  text := '''robertb1023@me.com''::text, ''annelies@reelintel.ai''::text, ''harper@reelintel.ai''::text';
  new_qual text;
  new_chk  text;
  stmt     text;
  n        integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') like '%annelies@reelintel.ai%'
        or coalesce(with_check, '') like '%annelies@reelintel.ai%')
      and coalesce(qual, '') not like '%harper@reelintel.ai%'
      and coalesce(with_check, '') not like '%harper@reelintel.ai%'
  loop
    new_qual := replace(coalesce(r.qual, ''), old_arr, new_arr);
    new_chk  := replace(coalesce(r.with_check, ''), old_arr, new_arr);

    -- Nothing changed means the policy names annelies in some other shape
    -- this migration does not understand. Leave it alone and report it
    -- rather than rewriting an expression blind.
    if new_qual = coalesce(r.qual, '') and new_chk = coalesce(r.with_check, '') then
      raise notice 'SKIPPED (unfamiliar shape): %.% / %', r.schemaname, r.tablename, r.policyname;
      continue;
    end if;

    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null       then stmt := stmt || format(' using (%s)', new_qual); end if;
    if r.with_check is not null then stmt := stmt || format(' with check (%s)', new_chk); end if;

    execute stmt;
    n := n + 1;
  end loop;
  raise notice 'rewrote % policies', n;
end $$;

-- 3) Verify: every admin policy should now name all three.
select schemaname, tablename, policyname,
       (coalesce(qual,'') || coalesce(with_check,'')) like '%harper@reelintel.ai%' as has_harper
from pg_policies
where schemaname in ('public','storage')
  and (coalesce(qual,'') like '%robertb1023@me.com%'
    or coalesce(with_check,'') like '%robertb1023@me.com%')
order by has_harper, schemaname, tablename, policyname;
