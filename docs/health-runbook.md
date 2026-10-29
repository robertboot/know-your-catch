# ReelIntel health runbook

For the agent that checks the app, the website and the pipelines, and
writes a report a human reads in two minutes.

## The one rule that matters

**Check what the app actually uses, then report the measurement.**

Three red alarms on this board in October were all false, and each cost
a day:

| The alarm said | What was true | Why it was wrong |
| --- | --- | --- |
| "The published Fish ID model is missing" | 6.26 MB of DeepBlue 12.4, serving fine | it checked `fish_id_model.tflite`, a path publishing never writes |
| "current.tflite returns 1 bytes" | same healthy 6.26 MB file | it asked for one byte and read `content-length`, which is 1 |
| "Red snapper closed" in the newsletter | closed for federal for-hire only; private season open | one row could not say which sector it belonged to |

A false alarm is worse than no alarm: the next real one reads the same,
and the owner learns to scroll past both. So:

- Report the **number you measured**, not a verdict. "6,258,328 bytes,
  TFL3 magic present, manifest says DeepBlue 12.4 / 140 labels" — not
  "model OK".
- If a check fails, **say which URL, query or file** produced the
  failure, verbatim. Someone has to be able to re-run it.
- Never call something BROKEN unless the thing an **angler** touches is
  affected. A stale admin tile is not broken.
- Three things are never done without the owner's say-so, whatever a
  check reports: pressing **Publish** on a model, **deleting** rows in
  bulk, and marking a regulation **verified**. Each has gone wrong here
  before.

---

## Daily

### 1. The Fish ID model the phones download
```bash
curl -sI https://hfptpsmdfemduhkueyoz.supabase.co/storage/v1/object/public/models-published/current.tflite | grep -i content-length
curl -s  https://hfptpsmdfemduhkueyoz.supabase.co/storage/v1/object/public/models-published/current.json
curl -s -r 0-7 https://hfptpsmdfemduhkueyoz.supabase.co/storage/v1/object/public/models-published/current.tflite | xxd | head -1
```
Report: bytes, version name, label count, and whether bytes 4-7 read
`TFL3`. Healthy today: 6,258,328 bytes, DeepBlue 12.4, 140 labels.

Flag only if: the file is missing, under 1 MB, the magic is not `TFL3`,
or the manifest's label count disagrees with the promoted version in
admin. **Never recommend Republish on a file that downloads and parses.**

### 2. Suggested spots and currents
```sql
select id, last_run_at, last_status
from public.hotspot_regions where active order by last_run_at nulls first;

select count(*) as spots_72h from public.hotspots
where observed_at > now() - interval '72 hours';

select region_id, jsonb_array_length(cells) as cells, observed_at
from public.hotspot_zones where mode_key = '_currents' order by region_id;
```
Report: how many of the 12 regions ran in the last 24 h, spots in the
last 72 h, and how many regions carry current cells (12 is right; three
in a row meant nine regions were blank for a week).

### 3. Is NOAA up, or are we down?
```bash
for h in coastwatch.pfeg.noaa.gov upwell.pfeg.noaa.gov erddap.marine.usf.edu; do
  curl -s -o /dev/null -w "$h %{http_code} %{time_total}s\n" --max-time 30 \
    "https://$h/erddap/griddap/jplMURSST41.json?analysed_sst%5B(last)%5D%5B(29.0):1:(29.01)%5D%5B(-88.0):1:(-87.99)%5D"
done
```
503 or 429 is NOAA shedding load — documented behaviour, **not our bug**.
Say so plainly and move on; the next hourly pass picks the region up
first. Only a 4xx other than 404, or a hang on all three hosts for more
than a day, is ours to chase.

### 4. What the app itself reported
```sql
select kind, count(*), max(created_at) as latest
from public.app_errors
where created_at > now() - interval '24 hours'
group by kind order by 2 desc;
```
`benign` is in-app-browser noise (Facebook, Instagram) — count it, don't
raise it. Anything else: give the message and the first stack frame.

### 5. The scheduled jobs
```sql
select status_code, left(content::text, 160) as reply, created
from net._http_response where created > now() - interval '24 hours'
  and status_code <> 200 order by created desc limit 10;

select jobname, status, start_time, return_message
from cron.job_run_details where start_time > now() - interval '24 hours'
  and status <> 'succeeded' order by start_time desc limit 10;
```
A 403 here means a job is sending the wrong cron secret and has never
run — that happened to the drafts drain for a full day while it looked
scheduled.

### 6. The website and the browser app
```bash
for u in https://reelintel.ai https://reelintel.ai/app https://reelintel.ai/privacy \
         https://reelintel.ai/delete-account \
         https://www.reelintel.ai/brand/newsletter-desktop-ad.jpg \
         https://www.reelintel.ai/brand/pb-spotlight.jpg; do
  curl -s -o /dev/null -w "%{http_code} $u\n" --max-time 30 -L "$u"
done
```
The two brand images matter the week a newsletter goes out: a 404 there
is a broken image in everyone's inbox.

### 7. The regulations pipeline
```sql
select status, count(*) from public.regulations group by status order by 2 desc;

select count(*) as drafts_over_7d from public.regulations
where status = 'draft' and drafted_at < now() - interval '7 days';
```
Report the shape, not just the total. `unregulated` growing and `draft`
falling is the pipeline working: most species have no species-specific
rule and that is now a recorded answer. `draft` climbing again means the
researcher has stopped returning `notRegulated` — worth a look at one
run's `detail`.

---

## Weekly

### 1. Spot-check five regulations against the agencies
Pick five pairs an angler would actually look up (red snapper, red drum,
speckled trout, gag grouper, cobia — rotate the jurisdictions). For each:
open the agency page, compare season, size and bag to what the app shows,
and report agreement or the exact difference.

Rules: a value without an agency citation is not a finding. Never mark a
row verified — hand the owner the comparison and let him decide.

### 2. Sector coverage
```sql
select species_id, jurisdiction_id, sector, season_text
from public.regulations where sector <> 'all' order by species_id;
```
Red snapper should carry both a private and a for-hire row for Alabama.
Any species whose agency runs separate seasons and has only one row is a
newsletter mistake waiting to happen.

### 3. The newsletter
```sql
select jurisdiction_id, status, recipient_count, generated_at, sent_at,
       block_reasons, (html like '%pb-spotlight%') as has_pb
from public.weekly_emails
where week_start = (select max(week_start) from public.weekly_emails)
order by jurisdiction_id;
```
Report: which waters are draft vs blocked vs sent, what is holding a
blocked one, and whether the PB and ad images are in the HTML.

### 4. The stores
TestFlight: latest build number and processing state. Play Console:
internal testing track — is a release live, and what version code.
Report crash-free rate if either console shows one.

### 5. Money
Anthropic usage for the week against the expected shape: the regulations
researcher is the only per-item spend, at roughly one web-search call per
pair. A jump means the rotation is churning — say how many pairs were
researched and what came back.

### 6. The things a laptop failure would lose
Confirm, by asking the owner rather than by reading anything:
the Android upload keystore and its password are backed up off the Mac,
and the Supabase service-role key is not in the repo.
```bash
git -C . grep -nE "(sb_secret|service_role|-----BEGIN)" -- . ':!*.md' | head
```
Any hit is an emergency; report it first, above everything else.

### 7. The build
```bash
npm run sync && bash scripts/ship.sh --check
```
Every check in that script exists because something shipped broken once.
Report the first failing line verbatim.

---

## The report

Keep it to one screen. This shape:

```
REELINTEL HEALTH — <date> <time CT>

VERDICT: <everything working | N things need a decision | N broken>

BROKEN (an angler is affected)
  • <what> — measured: <number/URL/query output>
    first seen: <date> · suggested fix: <one line> · owner decision needed: <yes/no>

NEEDS A DECISION (nothing is down; someone must choose)
  • <what> — <the choice, and what each option costs>

MEASURED, ALL FINE
  model: 6,258,328 bytes · DeepBlue 12.4 · 140 labels
  spots: 12/12 regions ran in 24 h · 47 spots in 72 h · currents in 12/12
  regs: 644 verified · 61 draft · 180 unregulated · 12 stale
  errors: 3 benign, 0 real · jobs: 0 failures · site: 6/6 200s
  <one line per daily check, with the number>

CHANGED SINCE YESTERDAY
  • <only real movement — "drafts 282 → 61" — not noise>

NOT DONE
  • <any check that could not run, and why>
```

Rules for the report itself:

- "MEASURED, ALL FINE" carries numbers. A report with no numbers cannot
  be audited and will not be trusted.
- If a check could not run, it goes under NOT DONE. Never report a check
  as passing because it did not fail.
- Repeat an item's **first seen** date every day it persists. Three days
  of "BROKEN" on the same line is the signal that a human has to stop
  scrolling.
- One line per item. The detail belongs in the attached raw output, not
  in the summary.
