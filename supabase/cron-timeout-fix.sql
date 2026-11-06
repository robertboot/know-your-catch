-- Scheduled jobs: stop pg_net hanging up on them after 5 seconds.
--
-- The dashboard reported "1 of the last 2 scheduled job calls failed —
-- the request never completed". It had not failed. net.http_post defaults
-- to a 5000 ms ceiling, and the ocean-maps refresh spends longer than that
-- downloading satellite imagery, so pg_net abandoned the connection and
-- recorded a row with no status code:
--
--   null | true | Timeout of 5000 ms reached. Total time: 5000.224 ms
--
-- Worse than the false alarm: pg_net closing the socket can cut the edge
-- function off mid-run. 60 s is the ceiling these jobs actually need.
--
-- Idempotent: a job that already carries a timeout is skipped.

-- 1) Let the health RPC see WHY a call has no status code.
do $mig$
declare
  def text := pg_get_functiondef('public.admin_cron_health()'::regprocedure);
begin
  if def not like '%timed_out%' then
    execute replace(def,
      'select status_code, error_msg, created',
      'select status_code, timed_out, error_msg, created');
    raise notice 'admin_cron_health now reports timed_out';
  else
    raise notice 'admin_cron_health already reports timed_out';
  end if;
end $mig$;

-- 2) Give every scheduled HTTP call 60 seconds instead of 5.
do $mig$
declare
  r   record;
  cmd text;
  n   int := 0;
begin
  for r in select jobid, jobname, command from cron.job loop
    if r.command like '%timeout_milliseconds%' then
      raise notice 'already has a timeout: %', r.jobname;
      continue;
    end if;
    -- Every job here calls net.http_post with NAMED arguments, so a named
    -- argument may be added in front. Anything shaped differently is left
    -- alone and reported rather than rewritten blind.
    if r.command ~ 'net\.http_post\(\s*url\s*:=' then
      cmd := regexp_replace(r.command,
        'net\.http_post\(\s*url\s*:=',
        'net.http_post(' || chr(10) || '    timeout_milliseconds := 60000,' || chr(10) || '    url :=');
      perform cron.alter_job(r.jobid, command => cmd);
      n := n + 1;
      raise notice 'timeout raised to 60s: %', r.jobname;
    else
      raise notice 'LEFT ALONE (unexpected shape), check by hand: %', r.jobname;
    end if;
  end loop;
  raise notice '% job(s) updated', n;
end $mig$;

notify pgrst, 'reload schema';

-- Confirm:
--   select jobname, command from cron.job order by jobname;
