-- Job failures, readable through the Data API.
--
-- cron.job_run_details and net._http_response live outside the `public`
-- schema, so PostgREST cannot see them and the health agent could not
-- ask the one question that mattered twice this month: did the job
-- actually run? The drafts-drain job sat "scheduled" for a day while
-- every call came back 403, and a weekly generate ran past the pg_net
-- timeout with nobody the wiser.
--
-- SECURITY DEFINER with a fixed search_path, SELECT only, and it never
-- returns a header or a body fragment that could carry a secret — only
-- the status code, the job name and a clipped reply.

create or replace function public.health_job_failures(hours int default 24)
returns table (
  source      text,
  name        text,
  status      text,
  at          timestamptz,
  detail      text
)
language sql
security definer
set search_path = public, cron, net
as $$
  select 'cron'::text,
         jobname::text,
         status::text,
         start_time,
         left(coalesce(return_message, ''), 200)
    from cron.job_run_details
   where start_time > now() - make_interval(hours => hours)
     and status is distinct from 'succeeded'

  union all

  -- net._http_response keeps no url (the request queue row that had it
  -- is gone once the call completes), so a failed call is named by its
  -- request id; a timeout shows as 'timeout' rather than a blank status.
  select 'http'::text,
         ('request ' || r.id)::text,
         coalesce(r.status_code::text, case when r.timed_out then 'timeout' else 'error' end),
         r.created,
         left(coalesce(r.error_msg, r.content::text, ''), 200)
    from net._http_response r
   where r.created > now() - make_interval(hours => hours)
     and (r.status_code is null or r.status_code <> 200)

   order by 4 desc
   limit 50;
$$;

revoke all on function public.health_job_failures(int) from public, anon, authenticated;
grant execute on function public.health_job_failures(int) to service_role;

notify pgrst, 'reload schema';

select * from public.health_job_failures(24);
