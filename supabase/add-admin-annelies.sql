-- Add annelies@reelintel.ai as a second admin.
--
-- The admin email is hardcoded into 37 RLS policies across 14 schema
-- files. Editing those files changes nothing in the live database —
-- the policies are already applied — so this rewrites them in place.
--
-- The rewrite is surgical: it swaps the string literal for an ANY(array)
-- test, turning
--     lower(...) = 'robertb1023@me.com'
-- into
--     lower(...) = any (array['robertb1023@me.com','annelies@reelintel.ai'])
-- and leaves the rest of each expression untouched. That matters because
-- several policies are compound (bucket_id = X AND email = admin) and
-- replacing the whole condition would drop the other half.
--
-- Idempotent: a policy already carrying both addresses no longer matches
-- the search and is skipped.

-- 1) Single source of truth for anything written from here on.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in
         ('robertb1023@me.com', 'annelies@reelintel.ai');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) Rewrite every existing policy that names the old admin.
do $$
declare
  r        record;
  lit      text := '''robertb1023@me.com''::text';
  -- Two shapes exist in this database and they need opposite edits:
  --   plain equality  =  'robert...'          -> becomes = any(array[both])
  --   already ANY()   = any (array['robert']) -> just add to that array
  -- Substituting blindly nests ARRAY[any(array[...])], which is invalid.
  as_any    text := 'any (array[''robertb1023@me.com''::text, ''annelies@reelintel.ai''::text])';
  in_array  text := '''robertb1023@me.com''::text, ''annelies@reelintel.ai''::text';
  new_qual text;
  new_chk  text;
  stmt     text;
  n        integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '')       like '%robertb1023@me.com%'
        or coalesce(with_check, '') like '%robertb1023@me.com%')
      and coalesce(qual, '') || coalesce(with_check, '') not like '%annelies@reelintel.ai%'
  loop
    new_qual := coalesce(r.qual, '');
    new_chk  := coalesce(r.with_check, '');

    if new_qual ~* 'any\s*\(\s*array\[' then
      new_qual := replace(new_qual, lit, in_array);
    else
      new_qual := replace(new_qual, lit, as_any);
    end if;

    if new_chk ~* 'any\s*\(\s*array\[' then
      new_chk := replace(new_chk, lit, in_array);
    else
      new_chk := replace(new_chk, lit, as_any);
    end if;

    execute format('drop policy if exists %I on %I.%I;',
                   r.policyname, r.schemaname, r.tablename);

    stmt := format('create policy %I on %I.%I for %s to %s',
                   r.policyname, r.schemaname, r.tablename,
                   lower(r.cmd), array_to_string(r.roles, ', '));
    if r.qual is not null and new_qual <> '' then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if r.with_check is not null and new_chk <> '' then
      stmt := stmt || format(' with check (%s)', new_chk);
    end if;
    execute stmt;

    n := n + 1;
    raise notice 'rewrote %.% policy %', r.schemaname, r.tablename, r.policyname;
  end loop;
  raise notice 'policies updated: %', n;
end $$;

-- 3) Verify: expect 0 rows still naming only the old admin.
select schemaname, tablename, policyname
from pg_policies
where schemaname in ('public', 'storage')
  and (coalesce(qual, '') like '%robertb1023@me.com%'
    or coalesce(with_check, '') like '%robertb1023@me.com%')
  and coalesce(qual, '') || coalesce(with_check, '') not like '%annelies@reelintel.ai%';

notify pgrst, 'reload schema';
