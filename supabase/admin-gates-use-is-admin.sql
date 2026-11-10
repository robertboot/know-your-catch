-- Every admin gate now asks public.is_admin() instead of naming one address.
--
-- add-admin-harper.sql rewrote the RLS policies that tested an ARRAY of
-- addresses, but it could not reach two other kinds of gate:
--
--   * security definer FUNCTIONS, whose check lives in their body
--     (tester_feedback_admin, admin_cron_health, error_log_*)
--   * policies written AFTER that migration, which name a single
--     address and so never matched its array pattern
--     (tester_feedback, error_log, the tester-feedback bucket)
--
-- Result: harper@reelintel.ai could sign in to the console and still be
-- told "not authorised" on Beta Testers, Errors and Scheduled Jobs.
--
-- Idempotent. Safe to run twice.

-- 1) The one list, in case add-admin-harper.sql was never run here.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in
         ('robertb1023@me.com', 'harper@reelintel.ai', 'robert@reelintel.ai');
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2) Patch the gate inside every function that still names an address.
--    Reads the LIVE definition, so the body is preserved exactly
--    whatever state this database is in; only the check changes.
do $mig$
declare
  r    record;
  orig text;
  def  text;
  n    int := 0;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%robertb1023@me.com%'
  loop
    orig := pg_get_functiondef(r.oid);
    def  := regexp_replace(orig,
      'lower\(coalesce\(\(?auth\.jwt\(\) ->> ''email''\)?, ''''\)\)\s*<>\s*''robertb1023@me\.com''',
      'not public.is_admin()', 'g');
    def  := regexp_replace(def,
      'lower\(coalesce\(\(?auth\.jwt\(\) ->> ''email''\)?, ''''\)\)\s*=\s*''robertb1023@me\.com''',
      'public.is_admin()', 'g');
    if def <> orig then
      execute def;
      n := n + 1;
      raise notice 'patched function %', r.proname;
    else
      raise notice 'left alone: % (its gate is already an admin list)', r.proname;
    end if;
  end loop;
  raise notice '% function(s) patched', n;
end $mig$;

-- 3) The policies written after add-admin-harper.sql.
drop policy if exists tester_feedback_admin_read on public.tester_feedback;
create policy tester_feedback_admin_read on public.tester_feedback
  for select using (public.is_admin());

drop policy if exists error_log_admin_read on public.error_log;
create policy error_log_admin_read on public.error_log
  for select using (public.is_admin());

drop policy if exists error_log_admin_update on public.error_log;
create policy error_log_admin_update on public.error_log
  for update using (public.is_admin());

-- Screenshot reads from the private tester-feedback bucket.
drop policy if exists tester_shots_admin_read on storage.objects;
create policy tester_shots_admin_read on storage.objects
  for select
  using (bucket_id = 'tester-feedback' and public.is_admin());

notify pgrst, 'reload schema';
