-- ReelIntel — admin cron-health RPC.
--
-- Why: both scheduled jobs failed silently for weeks. regs-auto-update
-- had an unreplaced 'YOUR_PROJECT_REF' hostname (every run died at DNS)
-- and reg-alerts authenticated with a service_role key the function
-- couldn't accept. Nothing surfaced either failure — cron.job_run_details
-- reported "succeeded" both times, because net.http_post is ASYNC: the
-- SQL statement succeeds the moment the request is queued. The real
-- outcome lands in net._http_response.
--
-- That asymmetry is the whole point of this RPC: it returns BOTH, so a
-- job that "succeeded" while its HTTP call errored is obvious.
--
-- cron and net live outside the PostgREST-exposed schemas, so the admin
-- console can't read them directly — hence SECURITY DEFINER, gated on
-- the admin email.
--
-- Run once, in the Supabase SQL Editor.

create or replace function public.admin_cron_health()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, net
as $$
declare
  result jsonb;
begin
  -- SECURITY DEFINER runs as the owner, so the caller check is the only
  -- thing standing between any authenticated user and the job table.
  if lower(coalesce((auth.jwt() ->> 'email'), '')) <> 'robertb1023@me.com' then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'jobs', (
      select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb)
      from (
        select
          job.jobname,
          job.schedule,
          job.active,
          d.status     as last_status,
          d.start_time as last_run
        from cron.job job
        left join lateral (
          select status, start_time
          from cron.job_run_details dd
          where dd.jobid = job.jobid
          order by dd.start_time desc
          limit 1
        ) d on true
        order by job.jobname
      ) j
    ),
    -- Unattributed on purpose: net.http_post's request id isn't recorded
    -- in job_run_details, so there's no clean join back to a job. Every
    -- scheduled job here posts over pg_net, so a run of non-200s in this
    -- list means something is broken even without knowing which job.
    'recent_http', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from (
        select status_code, error_msg, created
        from net._http_response
        order by created desc
        limit 20
      ) r
    )
  ) into result;

  return result;
end $$;

revoke all on function public.admin_cron_health() from public, anon;
grant execute on function public.admin_cron_health() to authenticated;
