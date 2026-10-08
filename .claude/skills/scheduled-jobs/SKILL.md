---
name: scheduled-jobs
description: Use when writing or debugging anything that runs on pg_cron — an edge function called through net.http_post, a nightly refresh, a report sweep. Records why a job that looks scheduled can never have written a row, and what a job must record about itself so the next failure is readable without a SQL session.
---

# Jobs that run on a schedule

ReelIntel's scheduled work is pg_cron calling an edge function through
`net.http_post`. That pairing has one failure mode that looks like
nothing at all, and it cost a full night.

## The socket closes and takes the function with it

`net.http_post` has a `timeout_milliseconds` ceiling — 5 s by default,
60 s on ours. When it is reached pg_net does not merely stop waiting:
it closes the connection, **and that cuts off the edge function
mid-run**. This is already written down in
`supabase/cron-timeout-fix.sql`; it was then forgotten and rediscovered
the hard way.

So: **a scheduled call must finish inside its ceiling, every time,
including on a bad day.** Not usually. Every time.

`find-hotspots` looped twelve regions in one call, four satellite grids
each, and both of its writes sat at the END of a region's block. It was
killed before the first one landed. Every night, for the life of the
feature. `hotspots`: 0 rows. `hotspot_zones`: 0 rows. The console said
"No satellite pass read yet — press Regenerate."

### The shape that works

One unit of work per call, oldest first, and let the schedule do the
looping.

- Order by a `last_run_at` column on the thing being processed. Null
  sorts first, so something never processed is always next.
- **Stamp it whether the unit succeeded or failed.** A unit that throws
  every time must still move to the back of the queue, or it starves
  everything behind it.
- Stamp a failure slightly in the past (ours: 90 minutes) so it comes
  back round sooner than a success, without jumping the never-run ones.
- Return what is left (`remaining`) so a caller knows the job is partway
  through rather than finished.
- A button a person presses is not the scheduler. It can run longer —
  but give it an explicit time budget it stops itself at, because the
  edge runtime's own limit kills mid-unit and mid-unit writes nothing.

## A job must say what it did, on the row

`net._http_response` holds the function's reply, and pg_net prunes it
within hours. So by the time anyone looks at an empty table, the reason
it is empty is gone. Reconstructing it means guessing.

Every run writes its outcome to a column on the row it processed —
success as well as failure:

    ok · sst+ chl+ depth+ cur+ · cells=0 spots=0 zones=11
    ERROR · sst+ chl- depth- cur- · no corroborating grid loaded

That one line distinguishes, without a SQL session: the job never ran /
the job ran and the upstream was down / the job ran, the data was fine,
and the scoring found nothing. Those three are indistinguishable in an
empty table and they need completely different fixes.

Then **show it in the console**. The Trip Planning tab's empty state used
to read "No satellite pass read yet — press Regenerate", which is a guess
dressed as an explanation. A healthy board should say nothing; a broken
one should say which region failed and what it said.

## Checking a job without asking the operator to run SQL

Rows readable with the publishable key can be read directly over
PostgREST — region status, row counts, error columns. Use that before
asking for a SQL paste. Being asked to run the same query three times is
how trust gets spent.

    curl -s "$PROJECT/rest/v1/hotspot_regions?select=id,last_run_at,last_error" \
      -H "apikey: $PUBLISHABLE" -H "Authorization: Bearer $PUBLISHABLE"

**That key is anonymous, and an empty answer from it proves nothing.**
PostgREST returns `[]` for rows RLS hides — not an error. `hotspot_zones`
grants select to `authenticated` only, so this read showed nothing while
132 rows sat in the table and the signed-in admin console drew them
across the whole Gulf. A full night of diagnosis was built on "the tables
are empty", and they never were.

Before reporting that a job has written nothing: **read the table's
policy.** `to anon` and `to authenticated` are different answers to the
same query. If the role cannot see the rows, this check cannot tell you
whether the job ran — only `last_run_at` and `last_error` on a table the
role CAN read will. See `[[debug-before-fixing]]`.

## Related

- `[[harness-parity]]` — a scripted patch that silently no-ops is
  indistinguishable from one that worked.
- `[[supabase-migration]]` — writing the SQL that schedules these.
- `[[trip-planning-engine]]` — what find-hotspots actually computes.
