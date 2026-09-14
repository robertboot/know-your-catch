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

const JURISDICTIONS: Record<string, { name: string; agency: string; federal: string; lat: number; lon: number }> = {
  al_state:     { name: 'Alabama State Waters',          agency: 'Alabama DCNR', federal: 'fed_gulf',      lat: 30.15, lon: -87.90 },
  ms_state:     { name: 'Mississippi State Waters',      agency: 'MDMR',         federal: 'fed_gulf',      lat: 30.25, lon: -88.90 },
  la_state:     { name: 'Louisiana State Waters',        agency: 'LDWF',         federal: 'fed_gulf',      lat: 29.20, lon: -90.10 },
  tx_state:     { name: 'Texas State Waters',            agency: 'TPWD',         federal: 'fed_gulf',      lat: 28.40, lon: -96.30 },
  fl_state:     { name: 'Florida Gulf State Waters',     agency: 'FWC',          federal: 'fed_gulf',      lat: 27.80, lon: -83.20 },
  fl_atlantic:  { name: 'Florida Atlantic State Waters', agency: 'FWC',          federal: 'fed_satlantic', lat: 27.20, lon: -80.10 },
};
const ADMINS = ['robertb1023@me.com', 'annelies@reelintel.ai'];

const FEDERAL_NAME: Record<string, string> = {
  fed_gulf:      'Federal Gulf',
  fed_satlantic: 'Federal South Atlantic',
};

// A regulation older than this has not been re-checked recently enough to
// mail to a few hundred people. Matches the health API's own threshold.
const STALE_DAYS = 30;
// How far ahead a season change is worth warning about.
const HORIZON_DAYS = 30;
// How many printed regulations a single generate may re-research.
// This is the whole marginal AI cost of the weekly email.
const MAX_REFRESH = 8;

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
    const edge = seasonEdgeWithin(r.season_text, HORIZON_DAYS);
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
  changes.sort((a: any, b: any) => (a.days_away ?? 999) - (b.days_away ?? 999));

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
  if (needsRefresh.length && !body.skip_refresh) {
    try {
      const res = await fetch(`${URL_}/functions/v1/auto-update-regulations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SR}`,
          'x-cron-secret': SECRET,
        },
        body: JSON.stringify({ pairs: needsRefresh }),
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
    } catch { /* a failed refresh is not fatal — the gate still decides */ }
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

  const payload = {
    jurisdiction_id: jid, federal_id: jur.federal, week_start: week,
    jurisdiction_name: jur.name, federal_name: FEDERAL_NAME[jur.federal], agency: jur.agency,
    days, changes, blockers, recipient_count: recipients.length,
    // Not a blocker — the updater's own backlog, surfaced so it is
    // visible in admin rather than invisible until it matters.
    stale_coverage: staleCoverage, total_rows: (regs || []).length,
    refreshed_before_send: refreshed,
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
    refreshed,
  });
});

/* Does this season text have an edge inside the horizon? Season text is
   free-form prose written by the updater, so this reads dates out of it
   rather than pretending there is a structured field. When it cannot
   parse, it says nothing — a missed heads-up is recoverable, an invented
   date is not. */
function seasonEdgeWithin(seasonText: string | null, horizon: number):
    { kind: 'opens' | 'closes'; days: number } | null {
  if (!seasonText) return null;
  const year = new Date().getUTCFullYear();
  const months = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const re = new RegExp(`(closes?|opens?|through|ends?|until)\\s+(?:on\\s+)?(${months})\\w*\\s+(\\d{1,2})`, 'ig');
  let m: RegExpExecArray | null;
  let best: { kind: 'opens' | 'closes'; days: number } | null = null;
  while ((m = re.exec(seasonText)) !== null) {
    const idx = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
      .indexOf(m[2].toLowerCase().slice(0, 3));
    if (idx < 0) continue;
    const when = Date.UTC(year, idx, parseInt(m[3], 10));
    const days = Math.round((when - Date.now()) / 86400000);
    if (days < 0 || days > horizon) continue;
    const kind = /open/i.test(m[1]) ? 'opens' : 'closes';
    if (!best || days < best.days) best = { kind, days };
  }
  return best;
}

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
      date, dayLabel: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
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
   arrives as a column of unstyled text. */
function renderHtml(p: any, best: Day | undefined): string {
  const NAVY = '#031B33', CARD = '#0B2740', EDGE = '#0f5e85', INK = '#ffffff',
        SOFT = '#CBD5E1', MUTE = '#94A3B8', BRASS = '#19D4F2';
  const wrap = (inner: string) => `<tr><td style="padding:0 28px;">${inner}</td></tr>`;
  const label = (s: string) =>
    `<div style="font-size:11px;font-weight:bold;letter-spacing:1.6px;color:${MUTE};text-transform:uppercase;padding-bottom:10px;">${esc(s)}</div>`;

  const dayRows = (p.days as Day[]).map(d => `
    <tr>
      <td style="padding:8px 10px;background:${CARD};border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${SOFT};white-space:nowrap;">${esc(d.dayLabel)}</td>
      <td style="padding:8px 6px;"><div style="background:${d.color};color:#06212f;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;text-align:center;border-radius:6px;padding:5px 0;width:44px;">${esc(d.grade)}</div></td>
      <td style="padding:8px 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${SOFT};white-space:nowrap;">${d.windKt != null ? esc(d.windDir + ' ' + d.windKt + ' kt') : '—'}</td>
      <td style="padding:8px 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${SOFT};white-space:nowrap;">${d.waveFt != null ? esc(d.waveFt + ' ft') : '—'}${d.periodS != null ? esc(' · ' + d.periodS + ' s') : ''}</td>
    </tr>`).join('');

  const changeCards = (p.changes as any[]).length ? (p.changes as any[]).map(c => {
    // Only two kinds reach here now. A closing is the urgent one — it
    // takes something away — so it gets the alarm colour.
    const closing = c.kind === 'closes';
    const tone = closing ? '#FF4D4D' : '#32D17B';
    const soon = c.days_away === 0 ? 'TODAY' : c.days_away === 1 ? 'TOMORROW' : `IN ${c.days_away} DAYS`;
    const head = `${closing ? 'CLOSES' : 'OPENS'} ${soon}`;
    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${EDGE};border-radius:12px;margin-bottom:10px;">
      <tr><td style="padding:8px 14px;border-bottom:1px solid ${EDGE};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.3px;color:${tone};">
        ${esc(String(c.jurisdiction_label).toUpperCase())} &middot; ${esc(head)}
      </td></tr>
      <tr><td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:16px;font-weight:bold;color:${INK};">${esc(c.species)}</div>
        <div style="font-size:13px;color:${SOFT};line-height:1.5;padding-top:4px;">
          ${esc(c.season_text || '')}${c.bag_limit != null ? esc(' · bag ' + c.bag_limit) : ''}${c.min_size_in != null ? esc(' · min ' + c.min_size_in + ' in') : ''}
        </div>
      </td></tr>
    </table>`;
  }).join('') : `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${EDGE};border-radius:12px;">
      <tr><td style="padding:18px;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:15px;font-weight:bold;color:${INK};">No changes this week</div>
        <div style="font-size:13px;color:${SOFT};line-height:1.5;padding-top:4px;">Nothing opened, closed or changed limits in ${esc(p.jurisdiction_name)} or ${esc(p.federal_name)}.</div>
      </td></tr>
    </table>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(p.jurisdiction_name)}</title></head>
<body style="margin:0;padding:0;background:#06111F;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#06111F;">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:${NAVY};">

  <tr><td style="padding:26px 28px 20px;background:#06111F;border-bottom:1px solid ${EDGE};font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:19px;font-weight:bold;color:${INK};letter-spacing:1px;">REEL<span style="color:${BRASS};">INTEL</span></div>
    <div style="font-size:16px;font-weight:bold;color:${INK};padding-top:12px;">${esc(p.jurisdiction_name)} &amp; ${esc(p.federal_name)}</div>
    <div style="font-size:12px;color:${MUTE};padding-top:3px;">Week of ${esc(p.week_start)}</div>
  </td></tr>

  ${best ? wrap(`<div style="padding:24px 0 0;font-family:Arial,Helvetica,sans-serif;">
    ${label('Best day')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${best.color};border-radius:14px;">
      <tr>
        <td width="74" style="padding:16px 0 16px 16px;">
          <div style="background:${best.color};color:#06212f;font-size:22px;font-weight:bold;text-align:center;border-radius:14px;padding:16px 0;">${esc(best.grade)}</div>
        </td>
        <td style="padding:16px;font-family:Arial,Helvetica,sans-serif;">
          <div style="font-size:19px;font-weight:bold;color:${INK};">${esc(best.dayLabel)}</div>
          <div style="font-size:13px;color:${SOFT};padding-top:4px;">${best.windKt != null ? esc(best.windDir + ' ' + best.windKt + ' kt') : ''}${best.waveFt != null ? esc(' · ' + best.waveFt + ' ft') : ''}${best.periodS != null ? esc(' at ' + best.periodS + ' s') : ''}</div>
        </td>
      </tr>
    </table></div>`) : ''}

  ${wrap(`<div style="padding:28px 0 0;">${label('The week ahead')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 4px;">${dayRows}</table></div>`)}

  ${wrap(`<div style="padding:28px 0 0;">${label('Satellite this week')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="padding-right:6px;"><img src="${esc(p.satellite.chl)}" width="278" alt="Chlorophyll" style="display:block;width:100%;border-radius:12px;border:1px solid ${EDGE};"><div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTE};padding-top:6px;">Chlorophyll</div></td>
      <td width="50%" style="padding-left:6px;"><img src="${esc(p.satellite.sst)}" width="278" alt="Sea temp" style="display:block;width:100%;border-radius:12px;border:1px solid ${EDGE};"><div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTE};padding-top:6px;">Sea temp</div></td>
    </tr></table></div>`)}

  ${wrap(`<div style="padding:30px 0 0;">${label('What changed in your waters')}${changeCards}
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTE};line-height:1.55;padding-top:12px;">Verified against ${esc(p.agency)} and NOAA before this went out.</div></div>`)}

  ${wrap(`<div style="padding:30px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid #FFC857;border-radius:14px;">
      <tr><td style="padding:22px;font-family:Arial,Helvetica,sans-serif;text-align:center;">
        <div style="font-size:18px;font-weight:bold;color:${INK};">Send us your personal best</div>
        <div style="font-size:13.5px;color:${SOFT};line-height:1.6;padding:8px 0 16px;">Every angler who submits one gets a ReelIntel shirt. Whether it runs in this email is up to you &mdash; there is a box to tick when you send it.</div>
        <a href="https://www.reelintel.ai/" style="display:inline-block;background:${BRASS};color:#06212f;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 28px;border-radius:12px;">Submit your PB</a>
      </td></tr>
    </table></div>`)}

  ${wrap(`<div style="padding:30px 0 30px;border-top:1px solid ${EDGE};margin-top:30px;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-size:12px;color:${MUTE};line-height:1.65;">You get this because you fish ${esc(p.jurisdiction_name)}.</div>
    <div style="font-size:11.5px;color:#64748B;line-height:1.6;padding-top:10px;">Regulations change without notice. Confirm with ${esc(p.agency)} or NOAA before you fish.</div>
  </div>`)}

</table></td></tr></table></body></html>`;
}

function renderText(p: any, best: Day | undefined): string {
  const lines: string[] = [];
  lines.push(`${p.jurisdiction_name} & ${p.federal_name} — week of ${p.week_start}`, '');
  if (best) lines.push(`BEST DAY: ${best.dayLabel} — ${best.grade}`,
    `  ${best.windKt != null ? best.windDir + ' ' + best.windKt + ' kt' : ''}${best.waveFt != null ? ' · ' + best.waveFt + ' ft' : ''}`, '');
  lines.push('THE WEEK AHEAD');
  for (const d of p.days as Day[]) {
    lines.push(`  ${d.dayLabel.padEnd(14)} ${d.grade.padEnd(3)} ${d.windKt != null ? d.windDir + ' ' + d.windKt + ' kt' : '—'}  ${d.waveFt != null ? d.waveFt + ' ft' : '—'}`);
  }
  lines.push('', 'WHAT CHANGED IN YOUR WATERS');
  if ((p.changes as any[]).length === 0) {
    lines.push(`  No changes in ${p.jurisdiction_name} or ${p.federal_name} this week.`);
  } else {
    for (const c of p.changes as any[]) {
      lines.push(`  [${c.jurisdiction_label}] ${c.species} — ${c.kind} in ${c.days_away} day${c.days_away === 1 ? '' : 's'}`);
      if (c.season_text) lines.push(`      ${c.season_text}`);
    }
  }
  lines.push('', 'Send us your personal best — every angler who submits one gets a ReelIntel shirt.',
    'https://www.reelintel.ai/', '',
    `Regulations change without notice. Confirm with ${p.agency} or NOAA before you fish.`);
  return lines.join('\n');
}
