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

## The one credential you need

Everything that needs the database goes through `health-report`, an edge
function that is read-only **by construction** — it holds no write path
at all, so "read-only" is a property of the code rather than a promise
about a token. It answers on the website's own host:

```bash
H="x-api-key: $REELINTEL_HEALTH_KEY"
curl -s -H "$H" https://reelintel.ai/admin/api/health              # everything
curl -s -H "$H" https://reelintel.ai/admin/api/health/monitored
curl -s -H "$H" https://reelintel.ai/admin/api/health/regulations
curl -s -H "$H" https://reelintel.ai/admin/api/health/queue
curl -s -H "$H" https://reelintel.ai/admin/api/health/errors
curl -s -H "$H" https://reelintel.ai/admin/api/health/newsletter
curl -s -H "$H" https://reelintel.ai/admin/api/health/jobs
```

`REELINTEL_HEALTH_KEY` is an environment variable on the agent's
environment, holding the same value as the project's `HEALTH_API_KEY`
secret. If it is not set, every database check goes under NOT DONE with
its endpoint named — do not guess at the numbers.

A direct Postgres connection is not an option and is not worth chasing:
the agent's container resolves no DNS for the database host and speaks
only HTTPS through a proxy. That is a feature. The agent reads what this
function chooses to publish, and cannot write anything at all.

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
```bash
curl -s -H "$H" https://reelintel.ai/admin/api/health/queue | python3 -m json.tool
```
`pipelines` names any region that failed its last run and how old the
newest satellite pass is.
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
```bash
curl -s -H "$H" https://reelintel.ai/admin/api/health/errors | python3 -m json.tool
```
`benign` is in-app-browser noise (Facebook, Instagram) — count it, don't
raise it. Anything else: give the message and the first stack frame.

### 5. The scheduled jobs
```bash
curl -s -H "$H" https://reelintel.ai/admin/api/health/jobs | python3 -m json.tool
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
```bash
curl -s -H "$H" https://reelintel.ai/admin/api/health/regulations | python3 -m json.tool
```
Each waters reports counts of verified / draft / stale / disputed /
unregulated, and the age of its OLDEST reviewed row — a region is only
as current as its worst row.
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
```bash
curl -s -H "$H" https://reelintel.ai/admin/api/health/newsletter | python3 -m json.tool
```
Per waters: status, recipients, what is holding a blocked one, and
whether the PB and ad images are in the HTML.
Report: which waters are draft vs blocked vs sent, what is holding a
blocked one, and whether the PB and ad images are in the HTML.

### 3b. Thursday: the newsletter, start to sent

The draft generates itself at 11:00 UTC and a second pass runs at 11:20
carrying `auto: true`, which drops any unconfirmed change rather than
withholding the whole email. Nothing sends without a human. The weekly
job is to get each waters from draft to sent, or to say why not.

For each jurisdiction with subscribers:

1. **Is there a draft?** If a waters is missing entirely, the generate
   call failed — check `net._http_response` for its reply.
2. **Is it blocked?** `block_reasons` names the rows. A `draft` or
   `disputed` reason needs a human to verify the rule; a `stale` one
   usually clears itself on the re-check. Report which, per waters.
3. **Read the regulation block before it goes out.** Specifically: does
   any season line apply to only one sector? Red snapper closed for
   federal for-hire in October while the private season ran on, and the
   email told every private angler the season had closed. If a line
   names dates without naming who they apply to, stop and ask.
4. **Check the images resolve** (daily check 6) — a 404 is a broken
   image in every inbox.
5. **Report the send**: recipients per waters, and anything in
   `send_error`.

Never approve or send. The owner presses that.

### 3c. Is the whole regulation grid current, or only the bit we sampled?

The five-species spot-check above says nothing about the other 600 rows.
This does:

```sql
-- Verified rows going stale, by waters. The auto-updater's rotation is
-- roughly 90 days wide, so a jurisdiction with a lot over 120 days is
-- one the rotation is not reaching.
select jurisdiction_id,
       count(*) filter (where status = 'verified') as verified,
       count(*) filter (where status = 'verified'
                          and coalesce(verified_at, last_checked_at) < now() - interval '120 days') as over_120d,
       count(*) filter (where status = 'draft')       as drafts,
       count(*) filter (where status = 'unregulated') as no_rule,
       count(*) filter (where status = 'stale')       as failed_lookup
from public.regulations group by jurisdiction_id order by over_120d desc;
```

Report the table as it comes. Two patterns matter: a jurisdiction whose
`over_120d` keeps climbing is starving in the rotation, and one whose
`failed_lookup` is high has an agency page the researcher cannot read —
Louisiana has done this.

**The seasonal watchlist.** A rotation that is evenly spread is still
wrong if it reaches a species the month after its season changed. Check
these by hand in the weeks before they move, whatever the rotation says:

| When | What changes |
| --- | --- |
| Feb – Mar | Gulf gag grouper, triggerfish season dates set |
| Apr – May | Gulf red snapper private season announced (state by state) |
| Jun 1 | Federal for-hire red snapper opens |
| Aug – Sep | Greater amberjack opens; quota closures start landing |
| Oct 14 – 26 | Amberjack and for-hire red snapper close; dates shift yearly |
| Oct 15 | Florida flounder closure starts (reopens Dec 1) |
| Dec 31 | State private red snapper seasons end or roll over |

For each: open the agency page, compare to the app, and report the
difference. These are the dates anglers plan around, and the ones a
90-day rotation is most likely to miss.

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
