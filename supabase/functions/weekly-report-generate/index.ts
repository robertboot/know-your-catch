/* weekly-report-generate — builds one edition of the Weekly Waters Report
   and STORES IT AS A DRAFT. It never sends. Sending is weekly-report-send,
   which only runs on an edition an admin has approved in the console.

   That split is the whole design. The payload of this email is fishing
   regulations, and a wrong season mailed to everyone at once is the one
   mistake this product cannot take back. A human looks at the rendered
   email first, every week.

   Deploy:
     supabase functions deploy weekly-report-generate
   Secrets: CRON_SECRET (same one the other cron jobs use).
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Each edition's forecast comes from ONE point, and the email has to say
// which — the app names its source on every screen and a weekly email
// that quietly averages a whole state is worse, not better. The points
// are the same places the app's tide stations sit, so a reader who
// checks both sees the same name.
const JURISDICTIONS: Record<string, {
  name: string; agency: string; federal: string;
  lat: number; lon: number; place: string;
}> = {
  al_state:    { name: 'Alabama State Waters',          agency: 'Alabama DCNR', federal: 'fed_gulf',      lat: 30.250, lon: -88.075, place: 'Dauphin Island, AL' },
  ms_state:    { name: 'Mississippi State Waters',      agency: 'MDMR',         federal: 'fed_gulf',      lat: 30.250, lon: -88.900, place: 'Biloxi, MS' },
  la_state:    { name: 'Louisiana State Waters',        agency: 'LDWF',         federal: 'fed_gulf',      lat: 29.263, lon: -89.957, place: 'Grand Isle, LA' },
  tx_state:    { name: 'Texas State Waters',            agency: 'TPWD',         federal: 'fed_gulf',      lat: 29.310, lon: -94.793, place: 'Galveston, TX' },
  fl_state:    { name: 'Florida Gulf State Waters',     agency: 'FWC',          federal: 'fed_gulf',      lat: 27.760, lon: -82.627, place: 'St. Petersburg, FL' },
  fl_atlantic: { name: 'Florida Atlantic State Waters', agency: 'FWC',          federal: 'fed_satlantic', lat: 27.200, lon: -80.100, place: 'Fort Pierce, FL' },
};

// Who may call this from the admin console. The cron uses the shared
// secret instead; both paths are checked below.
const ADMINS = ['robertb1023@me.com', 'annelies@reelintel.ai', 'harper@reelintel.ai'];

const FEDERAL_NAME: Record<string, string> = {
  fed_gulf:      'Federal Gulf',
  fed_satlantic: 'Federal South Atlantic',
};

// A regulation older than this has not been re-checked recently enough to
// mail to a few hundred people. Matches the health API's own threshold.
const STALE_DAYS = 30;
// How far ahead a season change is worth warning about. The email's own
// copy says 'this month' and 'in the next 30 days' — change both together.
const HORIZON_DAYS = 30;
// How many printed regulations a single generate may re-research.
// This is the whole marginal AI cost of the weekly email.
const MAX_REFRESH = 8;
// How long generate may wait on the regulation researcher before
// giving up on it. The admin console is a browser holding this
// request open; it must come back well inside a tab's patience.
const REFRESH_BUDGET_MS = 25_000;
// How far back a season change is still worth mentioning.
const LOOKBACK_DAYS = 14;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, x-cron-secret, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const esc = (s: string) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const daysBetween = (a: number, b: number) => Math.round((a - b) / 86400000);

/* The Thursday this edition covers. Generated Thursday morning, the
   window runs Thursday through the following Wednesday — seven days
   that include both weekend days, which is when people actually fish. */
function weekStart(now = new Date()): string {
  const d = new Date(now);
  const back = (d.getUTCDay() - 4 + 7) % 7;   // 4 = Thursday
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/* ---- fishability, kept in step with src/forecast-extras.js ----------
   These are the same curves the app scores with. If they drift, the
   email says B+ for an hour the app calls C, and the one claim this
   email makes — that it comes from the app in your pocket — breaks. */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const FISH_STOPS: Array<[number, string]> = [
  [30, '#8f2417'], [55, '#c0392b'], [66, '#e07b2f'], [76, '#d9b038'],
  [84, '#9bb03a'], [92, '#4fa64a'], [98, '#63e08a'],
];
function fishColor(v: number | null): string {
  if (v == null) return '#7d8ca0';
  if (v <= FISH_STOPS[0][0]) return FISH_STOPS[0][1];
  const last = FISH_STOPS[FISH_STOPS.length - 1];
  if (v >= last[0]) return last[1];
  for (let i = 0; i < FISH_STOPS.length - 1; i++) {
    const [v0, c0] = FISH_STOPS[i], [v1, c1] = FISH_STOPS[i + 1];
    if (v >= v0 && v <= v1) {
      const t = (v - v0) / (v1 - v0);
      const h = (c: string) => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
      const a = h(c0), b = h(c1);
      return '#' + a.map((n, j) => Math.round(n + (b[j] - n) * t).toString(16).padStart(2, '0')).join('');
    }
  }
  return '#7d8ca0';
}
function grade(s: number | null): string {
  if (s == null) return '—';
  const v = Math.max(0, Math.min(100, s));
  if (v >= 97) return 'A+'; if (v >= 93) return 'A';  if (v >= 90) return 'A-';
  if (v >= 87) return 'B+'; if (v >= 83) return 'B';  if (v >= 80) return 'B-';
  if (v >= 77) return 'C+'; if (v >= 73) return 'C';  if (v >= 70) return 'C-';
  if (v >= 67) return 'D+'; if (v >= 63) return 'D';  if (v >= 60) return 'D-';
  return 'F';
}
function weatherCap(code: number | null | undefined): { cap: number; reason: string } | null {
  if (code == null) return null;
  if ([95, 96, 99].includes(code))         return { cap: 35, reason: 'Thunderstorms' };
  if ([82, 65, 67].includes(code))         return { cap: 62, reason: 'Heavy rain' };
  if ([81, 63, 55, 57].includes(code))     return { cap: 74, reason: 'Rain' };
  return null;
}
function scoreHour(h: { wind?: number|null; gust?: number|null; waveFt?: number|null; periodS?: number|null; weatherCode?: number|null }): number {
  const terms: Array<[number, number]> = [];
  if (h.wind != null) {
    const eff = h.gust != null ? h.wind * 0.65 + h.gust * 0.35 : h.wind;
    terms.push([Math.round(clamp01((28 - eff) / 22) * 100), 0.42]);
  }
  if (h.waveFt != null) {
    let effH = h.waveFt;
    if (h.periodS != null && h.periodS > 0) {
      const steep = h.waveFt / (5.12 * h.periodS * h.periodS);
      effH = h.waveFt * Math.max(0.8, Math.min(1.8, Math.pow(steep / 0.018, 0.4)));
    }
    terms.push([Math.round(clamp01((6 - effH) / 5) * 100), 0.36]);
  }
  if (h.periodS != null) {
    const p = (h.waveFt ?? 0) <= 2.5
      ? Math.round(60 + clamp01((h.periodS - 1) / 5) * 35)
      : Math.round(clamp01((h.periodS - 3) / 5) * 100);
    terms.push([Math.max(0, Math.min(100, p)), 0.22]);
  }
  let s = terms.length
    ? terms.reduce((a, [v, w]) => a + v * w, 0) / terms.reduce((a, [, w]) => a + w, 0)
    : 50;
  const cap = weatherCap(h.weatherCode);
  if (cap) s = Math.min(s, cap.cap);
  return Math.round(Math.max(0, Math.min(100, s)));
}

Deno.serve(async (req: Request) => {
  // Everything below runs inside one catch. An unhandled throw returns a
  // platform 500 that carries no CORS headers, so a browser sees a bare
  // network failure and the operator learns nothing — which is exactly
  // how this went undiagnosed for several rounds.
  try {
    return await handle(req);
  } catch (e) {
    console.error('weekly-report-generate threw', e);
    return json({ error: 'unhandled', detail: String(e?.stack || e).slice(0, 1500) }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SECRET = Deno.env.get('CRON_SECRET');
  const URL_   = Deno.env.get('SUPABASE_URL');
  const SR     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SECRET || !URL_ || !SR) return json({ error: 'server_misconfigured' }, 500);
  // Two callers, two credentials. The cron holds the shared secret. The
  // admin console holds a person's session — and must NOT hold the
  // secret, which would put it in the web bundle for anyone to read.
  const db0 = createClient(URL_, SR, { auth: { persistSession: false } });
  const presented = req.headers.get('x-cron-secret') || '';
  let authed = presented.length === SECRET.length && presented === SECRET;
  if (!authed) {
    const hdr = req.headers.get('Authorization') || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (token) {
      const { data: who } = await db0.auth.getUser(token);
      const email = (who?.user?.email || '').toLowerCase();
      authed = ADMINS.includes(email);
    }
  }
  if (!authed) return json({ error: 'unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* generate with defaults */ }
  const jid = String(body.jurisdiction || 'al_state');
  const force = body.force === true;
  const jur = JURISDICTIONS[jid];
  if (!jur) return json({ error: 'unknown_jurisdiction', jurisdiction: jid }, 400);

  const db = db0;
  const week = weekStart();

  // Already built this week? Regenerating a SENT edition is never right —
  // the mail is out, and a new draft under the same key would suggest it
  // is not. force only re-opens a draft or a blocked one.
  const { data: existing } = await db.from('weekly_emails')
    .select('id, status').eq('jurisdiction_id', jid).eq('week_start', week).maybeSingle();
  if (existing && (existing.status === 'sent' || existing.status === 'approved')) {
    return json({ skipped: 'already_' + existing.status, id: existing.id, week_start: week });
  }
  if (existing && !force) {
    return json({ skipped: 'draft_exists', id: existing.id, status: existing.status, week_start: week });
  }

  // ---- audience ------------------------------------------------------
  // Build nothing for an edition nobody receives. Five of six editions
  // have no subscribers; rendering them weekly to throw them away burns
  // a forecast fetch and an AI call for no one.
  const { data: audience, error: audErr } = await db.rpc('weekly_email_audience', { p_jurisdiction: jid });
  if (audErr) return json({ error: 'audience_failed', detail: audErr.message }, 500);
  const recipients = (audience || []) as Array<{ user_id: string; email: string }>;
  if (recipients.length === 0) {
    return json({ skipped: 'no_subscribers', jurisdiction: jid, week_start: week });
  }

  // ---- regulations + the freshness gate -------------------------------
  const { data: regsInitial, error: regErr } = await db.from('regulations')
    .select('species_id, jurisdiction_id, status, season_text, min_size_in, max_size_in, bag_limit, boat_limit, notes, updated_at, verified_at, last_checked_at')
    .in('jurisdiction_id', [jid, jur.federal]);
  if (regErr) return json({ error: 'regulations_failed', detail: regErr.message }, 500);
  // Reassignable: the pre-send refresh below re-reads these rows, and the
  // gate must judge them as they are after that, not before.
  let regs = regsInitial;

  const now = Date.now();

  // ---- species names ---------------------------------------------------
  const ids = [...new Set((regs || []).map(r => r.species_id))];
  const { data: sp } = await db.from('species').select('id, common_name').in('id', ids);
  const nameOf = new Map((sp || []).map(s => [s.id, s.common_name as string]));

  // ---- what changed ----------------------------------------------------
  // Openings and closings only. Nothing else earns a line.
  //
  // This used to also report any row the updater had TOUCHED in the last
  // week, as a stand-in for "a limit moved". It was a bad stand-in: the
  // updater touches rows on its own rotation, so the section filled with
  // species that have no season at all — jack crevalle, tarpon — whose
  // only news was that a robot had looked at them. A reader learns
  // nothing from that, and every one of those rows still had to clear the
  // freshness gate, so noise could block a real send.
  //
  // Detecting a genuine bag- or size-limit change needs a history of what
  // the limit WAS, which this schema does not keep. Rather than guess at
  // it, the section reports the one kind of change the data can actually
  // prove: a season edge inside the horizon.
  const changes = (regs || []).map(r => {
    const edge = notableEdge(r.season_text, HORIZON_DAYS, LOOKBACK_DAYS, new Date(now));
    if (!edge) return null;
    // A species with no season text, no bag limit and no size limit is not
    // regulated in any way this email can report on. It has no place here
    // even if a date string happens to parse out of a note.
    const regulated = !!r.season_text || r.bag_limit != null
      || r.min_size_in != null || r.max_size_in != null;
    if (!regulated) return null;
    return {
      species_id: r.species_id,
      species: nameOf.get(r.species_id) || r.species_id,
      jurisdiction_id: r.jurisdiction_id,
      is_federal: r.jurisdiction_id !== jid,
      jurisdiction_label: r.jurisdiction_id === jid ? jur.name : FEDERAL_NAME[jur.federal],
      season_text: r.season_text,
      bag_limit: r.bag_limit,
      min_size_in: r.min_size_in,
      notes: r.notes,
      kind: edge.kind,
      days_away: edge.days,
    };
  }).filter(Boolean) as Array<Record<string, unknown>>;

  // Soonest first — a season closing in three days outranks one closing
  // in three weeks, and the reader's attention is finite.
  // Soonest first, and anything still ahead before anything already past.
  changes.sort((a: any, b: any) => {
    const ax = a.days_away < 0 ? 1 : 0, bx = b.days_away < 0 ? 1 : 0;
    return ax - bx || Math.abs(a.days_away) - Math.abs(b.days_away);
  });

  // ---- refresh what we are about to print, before judging it ---------
  // The rows this email names may sit anywhere in the updater's ~90-day
  // rotation, so waiting for the cron to reach them is not a plan. Ask
  // the updater for exactly these pairs first. Bounded on purpose: at
  // most MAX_REFRESH pairs, once a week, which is the entire AI cost this
  // feature adds. Anything still unverified after this blocks the send,
  // which is the correct outcome — it is better to mail nothing than to
  // announce a season change from data nobody has confirmed.
  const printedPairs = changes.map((c: any) => ({
    species_id: c.species_id as string, jurisdiction_id: c.jurisdiction_id as string,
  }));
  const needsRefresh = printedPairs.filter(pp => {
    const r = (regs || []).find(x => x.species_id === pp.species_id && x.jurisdiction_id === pp.jurisdiction_id);
    if (!r) return false;
    if (r.status === 'draft' || r.status === 'disputed') return true;
    const checked = r.verified_at || r.last_checked_at || r.updated_at;
    const age = checked ? daysBetween(now, Date.parse(checked)) : null;
    return age == null || age > STALE_DAYS;
  }).slice(0, MAX_REFRESH);

  let refreshed = 0;
  let refreshTimedOut = false;
  if (needsRefresh.length && !body.skip_refresh) {
    try {
      // Bounded. The researcher makes one AI call per pair with
      // concurrency 3, which can run for minutes — and the admin console
      // is a browser waiting on this response. Unbounded, the tab gives
      // up first and the operator sees "Load failed" with no idea that
      // anything is still running. Whatever has not come back inside the
      // budget simply is not refreshed, and the gate below then blocks
      // the edition, which is the correct outcome rather than a silent
      // one.
      const res = await fetch(`${URL_}/functions/v1/auto-update-regulations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SR}`,
          'x-cron-secret': SECRET,
        },
        body: JSON.stringify({ pairs: needsRefresh }),
        signal: AbortSignal.timeout(REFRESH_BUDGET_MS),
      });
      if (res.ok) {
        refreshed = needsRefresh.length;
        // Re-read: the gate below must judge the rows as they are NOW,
        // not as they were before the refresh ran.
        const { data: fresh } = await db.from('regulations')
          .select('species_id, jurisdiction_id, status, season_text, min_size_in, max_size_in, bag_limit, boat_limit, notes, updated_at, verified_at, last_checked_at')
          .in('jurisdiction_id', [jid, jur.federal]);
        if (fresh) regs = fresh;
      }
    } catch (e) {
      // Timed out or errored. Not fatal: the gate still decides, and a
      // row that could not be re-checked will block the send.
      refreshTimedOut = String(e).includes('Timeout') || String(e).includes('abort');
    }
  }

  // ---- the freshness gate, scoped to what the email actually prints ----
  // Vetting every row for these waters blocks every edition forever: the
  // auto-updater cycles the whole grid in about 90 days by design, so a
  // 30-day rule over ~215 rows can never come back clean. What matters is
  // the handful of regulations this email puts in front of people — if we
  // are going to print it, it has to be fresh.
  const printed = new Set(changes.map(c => `${c.species_id}|${c.jurisdiction_id}`));
  const blockers: Array<Record<string, unknown>> = [];
  let staleCoverage = 0;
  for (const r of regs || []) {
    const checked = r.verified_at || r.last_checked_at || r.updated_at;
    const age = checked ? daysBetween(now, Date.parse(checked)) : null;
    const old = age == null || age > STALE_DAYS;
    const unsure = r.status === 'draft' || r.status === 'disputed';
    if (old || unsure) staleCoverage++;
    if (!printed.has(`${r.species_id}|${r.jurisdiction_id}`)) continue;
    if (unsure) {
      blockers.push({ species_id: r.species_id, jurisdiction_id: r.jurisdiction_id, reason: r.status });
    } else if (old) {
      blockers.push({ species_id: r.species_id, jurisdiction_id: r.jurisdiction_id, reason: 'stale', days: age });
    }
  }

  // ---- forecast --------------------------------------------------------
  const days = await weekForecast(jur.lat, jur.lon);

  // One sentence over the week's real numbers. Written from the data
  // rather than by a model: it is a statement of fact about wind and
  // seas, it costs nothing, and it cannot invent a day that is not there.
  const goodDays = days.filter(d => d.score >= 80);
  const badDays  = days.filter(d => d.score < 63);
  const bestDay  = days.reduce((a, b) => (b.score > (a?.score ?? -1) ? b : a), days[0]);
  let summary = '';
  if (bestDay) {
    const names = goodDays.slice(0, 2).map(d => d.dayLabel.split(',')[0]);
    summary = names.length >= 2
      ? `${names[0]} and ${names[1]} are the standout weather windows`
      : `${bestDay.dayLabel.split(',')[0]} is the standout weather window`;
    if (badDays.length >= 2) {
      const firstBad = badDays[0].dayLabel.split(',')[0];
      summary += `; it turns choppier from ${firstBad}.`;
    } else {
      summary += `, with ${bestDay.windKt != null ? bestDay.windDir + ' ' + bestDay.windKt + ' kt' : 'light wind'}`
        + `${bestDay.waveFt != null ? ' and ' + bestDay.waveFt + ' ft seas' : ''}.`;
    }
  }

  // Human date range for the masthead — "Week of 2026-09-10" is a
  // database value, not something anyone says.
  const ws = new Date(week + 'T12:00:00Z');
  const we = new Date(ws.getTime() + 6 * 86400000);
  const MONTHS_LONG = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const md = (d: Date) => `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const dateRange = ws.getUTCMonth() === we.getUTCMonth()
    ? `${md(ws)}\u2013${we.getUTCDate()}, ${we.getUTCFullYear()}`
    : `${md(ws)} \u2013 ${md(we)}, ${we.getUTCFullYear()}`;

  const payload = {
    jurisdiction_id: jid, federal_id: jur.federal, week_start: week,
    jurisdiction_name: jur.name, federal_name: FEDERAL_NAME[jur.federal], agency: jur.agency,
    place: jur.place, lat: jur.lat, lon: jur.lon,
    fetched_at: new Date().toISOString(),
    days, changes, blockers, recipient_count: recipients.length,
    summary, date_range: dateRange,
    // Not a blocker — the updater's own backlog, surfaced so it is
    // visible in admin rather than invisible until it matters.
    stale_coverage: staleCoverage, total_rows: (regs || []).length,
    refreshed_before_send: refreshed, refresh_timed_out: refreshTimedOut,
    satellite: {
      chl: `${URL_}/storage/v1/object/public/ocean-maps/chl-latest.png`,
      sst: `${URL_}/storage/v1/object/public/ocean-maps/sst-latest.png`,
    },
  };

  const best = days.reduce((a, b) => (b.score > (a?.score ?? -1) ? b : a), days[0]);
  const subject = blockers.length
    ? `[BLOCKED] ${jur.name} — week of ${week}`
    : `${jur.name}: ${best ? grade(best.score) + ' on ' + best.dayLabel : 'your week ahead'}`;

  const html = renderHtml(payload, best);
  const text = renderText(payload, best);

  const row = {
    jurisdiction_id: jid, federal_id: jur.federal, week_start: week,
    status: blockers.length ? 'blocked' : 'draft',
    subject, html, text_body: text, payload,
    block_reasons: blockers, recipient_count: recipients.length,
    generated_at: new Date().toISOString(),
    approved_by: null, approved_at: null, sent_at: null, send_error: null,
  };
  const { data: saved, error: saveErr } = await db.from('weekly_emails')
    .upsert(row, { onConflict: 'jurisdiction_id,week_start' })
    .select('id, status').single();
  if (saveErr) return json({ error: 'save_failed', detail: saveErr.message }, 500);

  return json({
    ok: true, id: saved.id, status: saved.status, week_start: week,
    recipients: recipients.length, changes: changes.length, blocked: blockers.length,
    refreshed, refresh_timed_out: refreshTimedOut,
  });
}

/* Season text is free-form prose written by the auto-updater from an
   agency page, and it is the only place an opening or closing lives.
   Real examples from the live table:

     "September 1 - October 1, 2026 (Alabama state waters open concurrently…)"
     "Open August 1 – December 31, 2026 (or until the federal quota is met); closed annually in January/February"
     "March 1 - May 31, 2026 and August 1 - December 31, 2026 (subject to early closure…)"
     "September 1 - October 14, 2026 (currently closed as of Aug 3, 2026; reopens Sept 1, 2026)"

   Two things this has to get right, and an earlier version got both
   wrong — it looked for a keyword immediately before a date, so it saw
   the open date and never the close, and it read the parentheses.

   1. A season is a RANGE. The closing date sits after a dash with no
      keyword in front of it. Parse the range, not the keyword.
   2. Parentheses are commentary and are full of dates that are not the
      season — a restatement of the end date, or a narration of what the
      status was last month. They are dropped before anything is read. */
const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*';
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const monthIndex = (w: string) => MONTHS.indexOf(w.toLowerCase().slice(0, 3));

type Edge = { kind: 'opens' | 'closes'; at: number };

function seasonEdges(seasonText: string | null, now: Date): Edge[] {
  if (!seasonText) return [];
  const body = String(seasonText).replace(/\([^)]*\)/g, ' ');
  const range = new RegExp(
    `(${MONTH_RE})\\s+(\\d{1,2})(?:\\s*,\\s*(\\d{4}))?` +
    `\\s*(?:-|–|—|to|through|thru)\\s*` +
    `(?:(${MONTH_RE})\\s+)?(\\d{1,2})(?:\\s*,\\s*(\\d{4}))?`, 'ig');
  const yearNow = now.getUTCFullYear();
  const out: Edge[] = [];
  let m: RegExpExecArray | null;
  while ((m = range.exec(body)) !== null) {
    const m1 = monthIndex(m[1]);
    const d1 = parseInt(m[2], 10);
    const y1 = m[3] ? parseInt(m[3], 10) : yearNow;
    const m2 = m[4] ? monthIndex(m[4]) : m1;
    const d2 = parseInt(m[5], 10);
    const y2 = m[6] ? parseInt(m[6], 10) : (m2 < m1 ? y1 + 1 : y1);
    if (m1 < 0 || m2 < 0) continue;
    // Open season or closure? Judge from this clause only — "Open Aug 1 –
    // Dec 31; closed annually in January" must not read the later word.
    const clause = body.slice(0, m.index).split(/[;.]/).pop()!.toLowerCase();
    const isClosure = /clos/.test(clause) && !/open/.test(clause);
    const start = Date.UTC(y1, m1, d1), end = Date.UTC(y2, m2, d2);
    if (isClosure) out.push({ kind: 'closes', at: start }, { kind: 'opens', at: end });
    else           out.push({ kind: 'opens', at: start }, { kind: 'closes', at: end });
  }
  return out;
}

/* The edge worth printing. A date still ahead always beats one already
   past: an angler needs to know the gag season shuts in seventeen days
   more than that it opened a fortnight ago. Recent edges are kept as a
   fallback so a season that just opened is still news to someone who has
   not been out since. */
function notableEdge(seasonText: string | null, horizonDays: number, lookbackDays: number, now: Date):
    { kind: 'opens' | 'closes'; days: number } | null {
  let future: { kind: 'opens' | 'closes'; days: number } | null = null;
  let past:   { kind: 'opens' | 'closes'; days: number } | null = null;
  for (const e of seasonEdges(seasonText, now)) {
    const days = Math.round((e.at - now.getTime()) / 86400000);
    if (days >= 0 && days <= horizonDays) {
      if (!future || days < future.days) future = { kind: e.kind, days };
    } else if (days < 0 && days >= -lookbackDays) {
      if (!past || days > past.days) past = { kind: e.kind, days };
    }
  }
  return future ?? past;
}

const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtDayLabel = (d: Date) =>
  `${WD[d.getUTCDay()]}, ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;

type Day = { date: string; dayLabel: string; score: number; grade: string; color: string;
             windKt: number | null; windDir: string; waveFt: number | null; periodS: number | null };

async function weekForecast(lat: number, lon: number): Promise<Day[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code`
    + `&forecast_days=8&wind_speed_unit=kn&timezone=auto`;
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + `&hourly=wave_height,wave_period&forecast_days=8&timezone=auto`;
  const [r, mr] = await Promise.all([fetch(url), fetch(marineUrl).catch(() => null)]);
  if (!r.ok) return [];
  const j = await r.json();
  let mh: Record<string, number[]> | null = null;
  try { const mj = mr && mr.ok ? await mr.json() : null; mh = mj?.hourly ?? null; } catch { /* marine is optional */ }

  const H = j.hourly || {};
  const byDay = new Map<string, { s: number[]; wind: number[]; dir: number[]; wave: number[]; per: number[] }>();
  (H.time || []).forEach((iso: string, i: number) => {
    const hour = Number(iso.slice(11, 13));
    if (hour < 5 || hour > 19) return;            // daylight hours only
    const date = iso.slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, { s: [], wind: [], dir: [], wave: [], per: [] });
    const b = byDay.get(date)!;
    const waveFt = mh?.wave_height?.[i] != null ? mh.wave_height[i] * 3.28084 : null;
    const periodS = mh?.wave_period?.[i] ?? null;
    b.s.push(scoreHour({
      wind: H.wind_speed_10m?.[i], gust: H.wind_gusts_10m?.[i],
      waveFt, periodS, weatherCode: H.weather_code?.[i],
    }));
    if (H.wind_speed_10m?.[i] != null) b.wind.push(H.wind_speed_10m[i]);
    if (H.wind_direction_10m?.[i] != null) b.dir.push(H.wind_direction_10m[i]);
    if (waveFt != null) b.wave.push(waveFt);
    if (periodS != null) b.per.push(periodS);
  });
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const dirName = (d: number | null) => d == null ? ''
    : ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(d / 22.5) % 16];

  return [...byDay.entries()].slice(0, 7).map(([date, b]) => {
    // A day is judged by its mean and pulled down by its worst hour —
    // the same 0.6/0.4 reduction the 10-day grid uses, so a blown-out
    // afternoon cannot average away into a good-looking day.
    const mean = avg(b.s) ?? 50;
    const worst = b.s.length ? Math.min(...b.s) : mean;
    const score = Math.round(mean * 0.6 + worst * 0.4);
    const d = new Date(date + 'T12:00:00Z');
    return {
      date, dayLabel: fmtDayLabel(d),
      score, grade: grade(score), color: fishColor(score),
      windKt: avg(b.wind) != null ? Math.round(avg(b.wind)!) : null,
      windDir: dirName(avg(b.dir)),
      waveFt: avg(b.wave) != null ? Number(avg(b.wave)!.toFixed(1)) : null,
      periodS: avg(b.per) != null ? Number(avg(b.per)!.toFixed(1)) : null,
    };
  });
}

/* Email HTML, not app HTML. Tables and inline styles only — Outlook has
   no flex, Gmail strips <style>, and a design that relies on either
   arrives as a column of unstyled text.

   Images are absolute URLs on reelintel.ai, not attachments and not
   inline SVG: an email client will not render an <svg>, and a data: URI
   is stripped by Gmail. Anything that must be seen has to be a PNG or
   JPEG the client can fetch. That is also why every section still reads
   correctly with images turned off — a third of recipients will never
   load them. */
const SITE = 'https://www.reelintel.ai';

/* The PB ask is a pre-written email rather than a form. There is no
   submission page yet, so a button pointing at one was a dead end —
   and a mail client is where the photo already lives. The body
   carries the consent as a line the angler KEEPS or DELETES, which
   is a choice they make rather than one made for them by having
   pressed a button, and it says plainly that the shirt does not
   depend on it. */
const PB_MAILTO = "mailto:harper@reelintel.ai?subject=My%20personal%20best&body=Hi%20Harper%2C%0A%0AHere%27s%20my%20personal%20best%20%E2%80%94%20photo%20attached.%0A%0ASpecies%3A%0ALength%20/%20weight%3A%0AGeneral%20area%20%28no%20exact%20numbers%20needed%29%3A%0ADate%20caught%3A%0A%0AShirt%20size%3A%0AMailing%20address%3A%0A%0A%0A---%20Permission%20---%0AKeep%20the%20line%20below%20if%20you%27re%20happy%20for%20us%20to%20run%20this%20catch%20in%20the%0Aweekly%20newsletter.%20Delete%20it%20if%20you%27d%20rather%20we%20didn%27t%20%E2%80%94%20either%20way%20the%0Ashirt%20is%20yours.%0A%0AI%20give%20ReelIntel%20permission%20to%20feature%20this%20catch%2C%20my%20first%20name%20and%20this%0Aphoto%20in%20the%20ReelIntel%20weekly%20email.%20My%20exact%20location%20will%20not%20be%20shared.%0A%0AThanks%2C%0A";

const fmtCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}\u00B0${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}\u00B0${lon >= 0 ? 'E' : 'W'}`;

const fmtWhen = (iso: string) => {
  // Formatted by hand in UTC rather than with a named time zone: the edge
  // runtime does not reliably carry zone data, and an unsupported zone
  // throws rather than falling back.
  try {
    const d = new Date(iso);
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `${M} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
  } catch { return iso; }
};

function renderHtml(p: any, best: Day | undefined): string {
  // The approved palette, not the app's: #081321 outer, #061F33 content,
  // #0C2D43 cards, #18C5DF accent.
  const OUT = '#081321', BG = '#061F33', CARD = '#0C2D43',
        EDGE = 'rgba(24,197,223,0.18)', INK = '#FFFFFF', SOFT = '#B8C8D8',
        CYAN = '#18C5DF', GOOD = '#54C96B', BAD = '#D65245', GOLD = '#FFC343';
  const F = 'Arial, Helvetica, sans-serif';
  const wrap = (inner: string) => `<tr><td style="padding:0 32px;">${inner}</td></tr>`;
  const sec = (s: string) =>
    `<div style="font-family:${F};font-size:14px;font-weight:bold;letter-spacing:2px;color:${CYAN};text-transform:uppercase;padding-bottom:12px;">${esc(s)}</div>`;

  const dayRows = (p.days as Day[]).map(d => {
    const good = d.score >= 80;
    return `
    <tr>
      <td style="padding:8px 10px 8px 0;font-family:${F};font-size:14px;color:${good ? INK : SOFT};font-weight:${good ? 'bold' : 'normal'};white-space:nowrap;">${esc(d.dayLabel)}</td>
      <td style="padding:8px 10px 8px 0;" width="58">
        <div style="background:${d.color};color:#06212f;font-family:${F};font-size:14px;font-weight:bold;text-align:center;border-radius:6px;padding:5px 0;">${esc(d.grade)}</div>
      </td>
      <td style="padding:8px 10px 8px 0;font-family:${F};font-size:14px;color:${SOFT};white-space:nowrap;">${d.windKt != null ? esc(d.windDir + ' ' + d.windKt + ' kt') : '—'}</td>
      <td style="padding:8px 0;font-family:${F};font-size:14px;color:${SOFT};white-space:nowrap;">${d.waveFt != null ? esc(d.waveFt + ' ft') : '—'}${d.periodS != null ? esc(' / ' + d.periodS + ' sec') : ''}</td>
    </tr>`;
  }).join('');

  const changeCards = (p.changes as any[]).length ? (p.changes as any[]).map(c => {
    const closing = c.kind === 'closes';
    const tone = closing ? BAD : GOOD;
    const d = Number(c.days_away);
    const head = d < 0
      ? `${closing ? 'CLOSED' : 'OPENED'} ${Math.abs(d) === 1 ? 'YESTERDAY' : Math.abs(d) + ' DAYS AGO'}`
      : `${closing ? 'CLOSES' : 'OPENS'} ${d === 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : 'IN ' + d + ' DAYS'}`;
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${EDGE};border-radius:12px;margin-bottom:12px;">
      <tr><td style="padding:9px 15px;border-bottom:1px solid ${EDGE};font-family:${F};font-size:12px;font-weight:bold;letter-spacing:1.2px;color:${tone};">
        ${esc(String(c.jurisdiction_label).toUpperCase())} &middot; ${esc(head)}
      </td></tr>
      <tr><td style="padding:14px 15px;font-family:${F};">
        <div style="font-size:18px;font-weight:bold;color:${INK};">${esc(c.species)}</div>
        <div style="font-size:14px;color:${SOFT};line-height:1.55;padding-top:5px;">${esc(c.season_text || '')}</div>
      </td></tr>
    </table>`;
  }).join('') : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${EDGE};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${F};">
        <div style="font-size:17px;font-weight:bold;color:${INK};">No upcoming season changes identified</div>
        <div style="font-size:14px;color:${SOFT};line-height:1.55;padding-top:6px;">Nothing opens or closes in ${esc(p.jurisdiction_name)} or ${esc(p.federal_name)} in the next 30 days, as of ${esc(p.date_range || p.week_start)}.</div>
      </td></tr>
    </table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(p.jurisdiction_name)}</title></head>
<body style="margin:0;padding:0;background:${OUT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${OUT};">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;background:${BG};">

  <!-- masthead: logo, title and tagline are in the artwork; the alt text
       carries them for anyone with images off -->
  <tr><td style="padding:0;">
    <img src="${SITE}/brand/newsletter-masthead.jpg" width="640" alt="ReelIntel — Your Offshore Outlook. Built for Offshore."
         style="display:block;width:100%;max-width:640px;height:auto;border:0;">
  </td></tr>
  <tr><td style="padding:16px 32px 22px;background:${OUT};font-family:${F};">
    <div style="font-size:16px;font-weight:bold;color:${INK};">${esc(p.jurisdiction_name)} &amp; ${esc(p.federal_name)}</div>
    <div style="font-size:14px;color:${SOFT};padding-top:3px;">${esc(p.date_range || p.week_start)}</div>
    <div style="font-size:13px;color:${SOFT};padding-top:6px;">Forecast for <b style="color:${INK};">${esc(p.place)}</b> &middot; ${esc(fmtCoord(p.lat, p.lon))}</div>
  </td></tr>

  <!-- A named human opens the email and is the person to reply to. The
       copy is fixed rather than generated: a greeting that changes every
       week reads as machinery, and this one is the only part of the email
       that is not a measurement. -->
  ${wrap(`<div style="padding:26px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${EDGE};border-radius:12px;">
      <tr><td style="padding:18px 20px;font-family:${F};">
        <div style="font-size:15px;color:${INK};line-height:1.6;">
          Morning &mdash; here&rsquo;s your week on the water, pulled fresh this morning
          from ${esc(p.place)}.
        </div>
        <div style="font-size:14px;color:${SOFT};line-height:1.6;padding-top:8px;">
          Questions about anything in here, or a season date that looks wrong to you?
          Just hit reply &mdash; it comes straight to me.
        </div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
          <tr>
            <td width="48" valign="middle" style="padding-right:12px;">
              <img src="${SITE}/brand/newsletter-harper.jpg" width="48" height="48" alt=""
                   style="display:block;width:48px;height:48px;border-radius:24px;border:0;">
            </td>
            <td valign="middle" style="font-family:${F};">
              <div style="font-size:14px;color:${INK};font-weight:bold;">Harper Wells</div>
              <div style="font-size:13px;color:${SOFT};">Marketing Manager, ReelIntel</div>
            </td>
          </tr>
        </table>
      </td></tr>
    </table></div>`)}

  ${wrap(`<div style="padding:26px 0 0;">${sec("This Week's Outlook")}
    <div style="font-family:${F};font-size:19px;line-height:1.45;color:${INK};font-weight:bold;">${esc(p.summary || '')}</div></div>`)}

  ${best ? wrap(`<div style="padding:20px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${GOOD};border-radius:12px;">
      <tr><td style="padding:20px;font-family:${F};">
        <div style="font-size:13px;font-weight:bold;letter-spacing:1.4px;color:${GOOD};text-transform:uppercase;">Best Weather Window</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr>
          <td width="66" valign="middle">
            <div style="width:66px;height:66px;background:${GOOD};border-radius:12px;text-align:center;">
              <div style="font-family:${F};font-size:26px;font-weight:bold;color:#06212f;padding-top:16px;line-height:1;">${esc(best.grade)}</div>
              <div style="font-family:${F};font-size:9px;font-weight:bold;letter-spacing:0.8px;color:#06212f;padding-top:3px;">CALMEST</div>
            </div>
          </td>
          <td style="padding-left:16px;" valign="middle">
            <div style="font-family:${F};font-size:22px;font-weight:bold;color:${INK};">${esc(best.dayLabel)}</div>
            <div style="font-family:${F};font-size:14px;color:${SOFT};padding-top:5px;">${best.windKt != null ? esc('Wind ' + best.windDir + ' ' + best.windKt + ' kt') : ''}${best.waveFt != null ? esc(' · Seas ' + best.waveFt + ' ft') : ''}${best.periodS != null ? esc(' · Period ' + best.periodS + ' sec') : ''}</div>
          </td>
        </tr></table>
      </td></tr>
    </table></div>`) : ''}

  ${wrap(`<div style="padding:30px 0 0;">${sec('The Week Ahead')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-family:${F};font-size:12px;font-weight:bold;letter-spacing:1.3px;color:${SOFT};text-transform:uppercase;padding-bottom:6px;">Day</td>
        <td style="font-family:${F};font-size:12px;font-weight:bold;letter-spacing:1.3px;color:${SOFT};text-transform:uppercase;padding-bottom:6px;">Grade</td>
        <td style="font-family:${F};font-size:12px;font-weight:bold;letter-spacing:1.3px;color:${SOFT};text-transform:uppercase;padding-bottom:6px;">Wind</td>
        <td style="font-family:${F};font-size:12px;font-weight:bold;letter-spacing:1.3px;color:${SOFT};text-transform:uppercase;padding-bottom:6px;">Seas / Period</td>
      </tr>${dayRows}
    </table>
    <div style="font-family:${F};font-size:13px;color:${SOFT};line-height:1.55;padding-top:14px;">
      Open-Meteo marine and weather models for ${esc(p.place)}, pulled ${esc(fmtWhen(p.fetched_at))}.
      Conditions vary across a state &mdash; check your own spot before you run.
      <br><br>
      Grades rate <b style="color:${INK};">boat comfort only</b> &mdash; wind and gusts, sea height judged against
      wave period, with thunderstorms capping the grade. They say nothing about whether fish are biting, and
      they are not a safety clearance.
    </div></div>`)}

  ${wrap(`<div style="padding:30px 0 0;">${sec('Satellite Watch')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" valign="top" style="padding-right:7px;">
        <img src="${esc(p.satellite.chl)}" width="278" alt="Chlorophyll, northern Gulf" style="display:block;width:100%;height:auto;border-radius:12px;border:1px solid ${EDGE};">
        <div style="font-family:${F};font-size:15px;font-weight:bold;color:${INK};padding-top:8px;">Chlorophyll</div>
        <div style="font-family:${F};font-size:12px;color:${SOFT};padding-top:2px;">NOAA CoastWatch, 8-day composite</div>
      </td>
      <td width="50%" valign="top" style="padding-left:7px;">
        <img src="${esc(p.satellite.sst)}" width="278" alt="Sea surface temperature, northern Gulf" style="display:block;width:100%;height:auto;border-radius:12px;border:1px solid ${EDGE};">
        <div style="font-family:${F};font-size:15px;font-weight:bold;color:${INK};padding-top:8px;">Sea Surface Temperature</div>
        <div style="font-family:${F};font-size:12px;color:${SOFT};padding-top:2px;">NASA MUR, daily field</div>
      </td>
    </tr></table></div>`)}

  ${wrap(`<div style="padding:32px 0 0;">${sec('Season & Regulation Watch')}${changeCards}
    <div style="font-family:${F};font-size:13px;color:${SOFT};line-height:1.55;padding-top:12px;">
      Season dates only &mdash; bag, size and gear rules can change without a season change.
      Verified against ${esc(p.agency)} and NOAA Fisheries before this went out.
    </div></div>`)}

  ${wrap(`<div style="padding:34px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${GOLD};border-radius:12px;">
      <tr><td style="padding:22px;font-family:${F};">
        <!-- Artwork left of the copy in every client. A two-cell table
             rather than flex: Outlook has no flex, and a stacked version
             on mobile is what was asked NOT to happen. The left column is
             fixed so the lettering never squeezes to nothing. -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="150" valign="middle" style="padding-right:16px;">
              <img src="${SITE}/brand/reelintel-new-pb.png" width="150" alt="New PB!"
                   style="display:block;width:150px;height:auto;border:0;">
            </td>
            <td valign="middle" style="font-family:${F};">
              <div style="font-size:22px;font-weight:bold;color:${INK};line-height:1.2;">A New Personal Best? Let&rsquo;s See It.</div>
              <div style="font-size:14px;color:${SOFT};line-height:1.6;padding-top:8px;">Send Harper your personal-best catch and get a ReelIntel shirt. The email opens ready to fill in &mdash; you decide whether we feature it.</div>
              <a href="${PB_MAILTO}" style="display:inline-block;background:${GOLD};color:#06212f;font-size:15px;font-weight:bold;text-decoration:none;padding:13px 24px;border-radius:10px;margin-top:14px;">Email Harper your PB</a>
            </td>
          </tr>
        </table>
        <img src="${SITE}/brand/newsletter-shirt.jpg" width="560" alt="ReelIntel shirt, front and back"
             style="display:block;width:100%;max-width:560px;height:auto;border-radius:10px;border:0;margin:18px auto 0;">
        <div style="font-size:12px;color:${SOFT};padding-top:10px;text-align:center;">One per angler while supplies last.</div>
      </td></tr>
    </table></div>`)}

  ${wrap(`<div style="padding:30px 0 0;font-family:${F};">
    <div style="font-size:15px;color:${INK};line-height:1.6;">
      Tight lines this week. If something in here helped you pick a day &mdash; or if it got it wrong &mdash;
      I&rsquo;d genuinely like to hear about it.
    </div>
    <!-- Built as markup rather than dropped in as the white signature
         card: that card carries its own white ground and would sit on the
         navy as a bright rectangle. This keeps her name and address as
         live text, which is what a reader with images blocked needs, and
         the photo degrades to nothing rather than to a broken white box. -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr>
        <td width="72" valign="top" style="padding-right:14px;">
          <img src="${SITE}/brand/newsletter-harper.jpg" width="72" height="72" alt=""
               style="display:block;width:72px;height:72px;border-radius:36px;border:0;">
        </td>
        <td valign="middle" style="font-family:${F};">
          <div style="font-size:16px;font-weight:bold;color:${INK};">Harper Wells</div>
          <div style="font-size:13px;color:${SOFT};padding-top:2px;">Marketing Manager &middot; ReelIntel, LLC</div>
          <div style="font-size:13px;padding-top:6px;">
            <a href="mailto:harper@reelintel.ai" style="color:${CYAN};text-decoration:none;">harper@reelintel.ai</a>
            <span style="color:#4A6478;"> &middot; </span>
            <a href="${SITE}" style="color:${CYAN};text-decoration:none;">reelintel.ai</a>
          </div>
        </td>
      </tr>
    </table>
  </div>`)}

  ${wrap(`<div style="padding:32px 0 34px;border-top:1px solid ${EDGE};margin-top:32px;font-family:${F};">
    <div style="font-size:13px;color:${SOFT};line-height:1.65;">You&rsquo;re receiving this because you selected <b style="color:${INK};">${esc(p.jurisdiction_name)}</b> in the ReelIntel app.</div>
    <div style="font-size:13px;line-height:1.65;padding-top:8px;">
      <a href="mailto:harper@reelintel.ai?subject=Change%20my%20waters" style="color:${CYAN};text-decoration:none;">Change your waters</a>
      <span style="color:#4A6478;"> &middot; </span>
      <a href="mailto:harper@reelintel.ai?subject=Unsubscribe&body=Please%20stop%20sending%20me%20the%20weekly%20report." style="color:${CYAN};text-decoration:none;">Unsubscribe</a>
    </div>
    <div style="font-size:12px;color:#7C90A2;line-height:1.6;padding-top:12px;">
      Regulations change. Confirm current rules with ${esc(p.agency)} and NOAA Fisheries before you fish.
    </div>
  </div>`)}

</table></td></tr></table></body></html>`;
}

function renderText(p: any, best: Day | undefined): string {
  const lines: string[] = [];
  lines.push(`${p.jurisdiction_name} & ${p.federal_name} — ${p.date_range || p.week_start}`, '');
  lines.push('Morning — here\u2019s your week on the water, pulled fresh this morning.',
    'Questions, or a season date that looks wrong? Just hit reply — it comes straight to me.',
    'Harper Wells, Marketing Manager, ReelIntel — harper@reelintel.ai', '');
  if (p.summary) lines.push(p.summary, '');
  lines.push(`Forecast for ${p.place} — Open-Meteo, pulled ${p.fetched_at}`, '');
  if (best) lines.push(`BEST DAY: ${best.dayLabel} — ${best.grade}`,
    `  ${best.windKt != null ? best.windDir + ' ' + best.windKt + ' kt' : ''}${best.waveFt != null ? ' · ' + best.waveFt + ' ft' : ''}`, '');
  lines.push('THE WEEK AHEAD');
  for (const d of p.days as Day[]) {
    lines.push(`  ${d.dayLabel.padEnd(14)} ${d.grade.padEnd(3)} ${d.windKt != null ? d.windDir + ' ' + d.windKt + ' kt' : '—'}  ${d.waveFt != null ? d.waveFt + ' ft' : '—'}`);
  }
  lines.push('', 'CHANGES THIS MONTH');
  if ((p.changes as any[]).length === 0) {
    lines.push(`  Nothing opens or closes in ${p.jurisdiction_name} or ${p.federal_name} in the next 30 days.`);
  } else {
    for (const c of p.changes as any[]) {
      const dd = Number(c.days_away);
      lines.push(`  [${c.jurisdiction_label}] ${c.species} — ${c.kind.replace(/s$/, dd < 0 ? 'ed' : 's')} ${dd < 0 ? Math.abs(dd) + ' days ago' : 'in ' + dd + ' days'}`);
      if (c.season_text) lines.push(`      ${c.season_text}`);
    }
  }
  lines.push('', 'Tight lines this week. — Harper Wells, harper@reelintel.ai', '');
  lines.push('', 'Send Harper your personal best — every angler who submits one gets a ReelIntel shirt.',
    'Email harper@reelintel.ai with the species, size, where and when, plus your shirt size and address.',
    'Say whether we may feature the catch; the shirt is yours either way.', '',
    `Regulations change without notice. Confirm with ${p.agency} or NOAA before you fish.`,
    '',
    `To stop receiving this, reply with "unsubscribe" or email harper@reelintel.ai.`);
  return lines.join('\n');
}
