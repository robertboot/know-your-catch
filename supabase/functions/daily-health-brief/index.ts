/* daily-health-brief — one email a day, only when something needs doing.
 *
 * The admin dashboard answers "what needs doing today", but only if
 * somebody opens it. This asks the same questions on a schedule and
 * mails the answer — and mails NOTHING when the answer is "nothing",
 * so an email arriving always means an email worth opening.
 *
 * What makes it send (anything here, and only these):
 *   • a scheduled job call that failed, or a job switched off
 *   • app errors in the last 24h that nobody has resolved
 *   • a newsletter edition waiting on approval, or blocked
 *   • species suggestions waiting on approval
 *
 * Standing backlogs — training photos, regulations due a re-check — ride
 * along as context when the mail is already going out. They never
 * trigger one on their own: a number that is always there would make
 * this a daily email, and a daily email is an ignored email.
 *
 * Cost: a handful of SELECTs and, on a bad day, one Resend send. No
 * model calls, no paid APIs.
 *
 * Auth: x-cron-secret, same as the other scheduled functions.
 * Body:  {}              normal run
 *        {"test": true}  send even when everything is fine, so the
 *                        format can be checked without breaking something
 * Env:  RESEND_API_KEY, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy daily-health-brief
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
// Harper sends the automated mail, same as the newsletter — one voice,
// one address to allow-list, one address to trust.
const FROM  = 'Harper Wells, ReelIntel <harper@reelintel.ai>';
const TO    = 'robert@reelintel.ai';
const ADMIN = 'https://reelintel.ai/#/admin';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const esc = (t: string) =>
  String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Item = {
  sev: 'broken' | 'todo' | 'context';
  what: string;     // the finding, in a sentence
  action: string;   // what Robert does about it
  link?: string;    // where he does it
};

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_KEY   = Deno.env.get('RESEND_API_KEY');
  const CRON_SECRET  = Deno.env.get('CRON_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE || !RESEND_KEY) return json({ error: 'missing env' }, 500);
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'forbidden' }, 403);
  }

  let test = false;
  try { test = !!(await req.json())?.test; } catch { /* empty body is the normal case */ }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const items: Item[] = [];
  const notes: string[] = [];          // checks that could not run — said out loud, never swallowed
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // ---- 1. Scheduled jobs ------------------------------------------
  // cron.job is not reachable over PostgREST; cron_health_internal() is a
  // security-definer view of it granted to service_role alone.
  try {
    const { data, error } = await db.rpc('cron_health_internal');
    if (error) throw error;
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const http = Array.isArray(data?.recent_http) ? data.recent_http : [];

    const off = jobs.filter((j: any) => !j.active);
    if (off.length) {
      items.push({
        sev: 'broken',
        what: `${off.length} scheduled job${off.length === 1 ? ' is' : 's are'} switched off: ${off.map((j: any) => j.jobname).join(', ')}`,
        action: 'Nothing behind these is running. Tell Claude which job and it will be re-enabled.',
      });
    }
    // A timed-out call is not a failed one — pg_net stopped waiting, the
    // function still ran. Only genuine failures belong in this email.
    const failed = http.filter((r: any) =>
      !(r.status_code == null && r.timed_out) && (r.status_code == null || r.status_code >= 400));
    if (failed.length) {
      items.push({
        sev: 'broken',
        what: `${failed.length} of the last ${http.length} scheduled job calls failed (${esc(failed[0].error_msg || `HTTP ${failed[0].status_code}`)})`,
        action: 'Send this line to Claude — a failing call usually means a key or a secret has moved.',
      });
    }
  } catch (e) {
    notes.push(`Scheduled jobs could not be checked: ${String(e)}`);
  }

  // ---- 2. App errors ----------------------------------------------
  try {
    // 'benign' is recorded but never alarms: stale-chunk imports that the
    // page already auto-recovered from, and Android WebView bridge errors
    // from in-app browsers. A brief that opens with "1 thing broken" over
    // a deploy that healed itself teaches you to ignore the brief.
    const { data, error } = await db.from('error_log')
      .select('fingerprint, message, screen')
      .gte('occurred_at', since24h)
      .is('resolved_at', null)
      .neq('kind', 'benign')
      .limit(500);
    if (error) throw error;
    const rows = data || [];
    if (rows.length) {
      const distinct = new Set(rows.map((r: any) => r.fingerprint)).size;
      items.push({
        sev: 'broken',
        what: `${rows.length} app error${rows.length === 1 ? '' : 's'} in the last 24h (${distinct} distinct fault${distinct === 1 ? '' : 's'}). Most recent: ${esc(rows[0].message || 'no message')}`,
        action: 'Open Errors, read the top fault, and mark it resolved once it is fixed.',
        link: `${ADMIN}/errors`,
      });
    }
  } catch (e) {
    notes.push(`Errors could not be checked: ${String(e)}`);
  }

  // ---- 3. Newsletter waiting on you -------------------------------
  try {
    const { data, error } = await db.from('weekly_emails')
      .select('jurisdiction_id, week_start, status')
      .in('status', ['draft', 'blocked'])
      .order('week_start', { ascending: false })
      .limit(50);
    if (error) throw error;
    const drafts  = (data || []).filter((r: any) => r.status === 'draft');
    const blocked = (data || []).filter((r: any) => r.status === 'blocked');
    if (drafts.length) {
      items.push({
        sev: 'todo',
        what: `${drafts.length} newsletter edition${drafts.length === 1 ? '' : 's'} waiting on your approval`,
        action: 'Read it, then Approve or Discard. Nothing is sent to subscribers until you approve.',
        link: `${ADMIN}/weekly`,
      });
    }
    if (blocked.length) {
      items.push({
        sev: 'todo',
        what: `${blocked.length} newsletter edition${blocked.length === 1 ? '' : 's'} blocked on regulation data`,
        action: 'Open the edition to see which regulation rows it does not trust, fix those, then regenerate.',
        link: `${ADMIN}/weekly`,
      });
    }
  } catch (e) {
    notes.push(`Newsletter could not be checked: ${String(e)}`);
  }

  // ---- 4. Species suggestions --------------------------------------
  try {
    const { count, error } = await db.from('species_suggestions')
      .select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (error) throw error;
    if (count) {
      items.push({
        sev: 'todo',
        what: `${count} species suggestion${count === 1 ? '' : 's'} submitted from the app`,
        action: 'Approve the real ones, reject the rest.',
        link: `${ADMIN}/species`,
      });
    }
  } catch (e) {
    notes.push(`Species suggestions could not be checked: ${String(e)}`);
  }

  // ---- 5. Context: never sends an email by itself -------------------
  try {
    const { count } = await db.from('training_images')
      .select('id', { count: 'exact', head: true }).eq('status', 'pending');
    if (count) {
      items.push({
        sev: 'context',
        what: `${count.toLocaleString('en-US')} training photos are waiting on review`,
        action: 'Only you can do this one. No rush unless you are about to retrain.',
        link: `${ADMIN}/training/review`,
      });
    }
  } catch { /* context only — not worth a note */ }

  try {
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const { count } = await db.from('regulations')
      .select('species_id', { count: 'exact', head: true }).lt('updated_at', cutoff);
    if (count) {
      items.push({
        sev: 'context',
        what: `${count.toLocaleString('en-US')} regulation rows have not been re-checked in 90 days`,
        action: 'The hourly auto-updater works through these. Only act if the number stops falling week to week.',
        link: `${ADMIN}/regulations`,
      });
    }
  } catch { /* context only */ }

  // ---- Decide whether to send --------------------------------------
  // Silence is the signal: context lines never trigger a send, and a
  // check that failed to run always does — not knowing is not healthy.
  const actionable = items.filter(i => i.sev !== 'context');
  if (!actionable.length && !notes.length && !test) {
    return json({ ok: true, sent: false, reason: 'nothing needs doing', checks: items.length });
  }

  const broken = items.filter(i => i.sev === 'broken');
  const todo   = items.filter(i => i.sev === 'todo');
  const ctx    = items.filter(i => i.sev === 'context');

  const row = (i: Item, color: string) => `
    <tr><td style="padding:0 0 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="border-left:3px solid ${color};background:#F8FAFC;border-radius:0 6px 6px 0">
        <tr><td style="padding:12px 14px">
          <p style="margin:0 0 5px;font-size:15px;font-weight:700;color:#0F172A;line-height:1.35">${i.what}</p>
          <p style="margin:0;font-size:13.5px;color:#475569;line-height:1.45">${esc(i.action)}</p>
          ${i.link ? `<p style="margin:8px 0 0"><a href="${i.link}" style="font-size:13px;font-weight:700;color:#0E7490;text-decoration:none">Open in admin &rarr;</a></p>` : ''}
        </td></tr>
      </table>
    </td></tr>`;

  const group = (title: string, color: string, list: Item[]) => !list.length ? '' : `
    <tr><td style="padding:0 0 8px">
      <p style="margin:0;font-size:11.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${color}">${title}</p>
    </td></tr>
    ${list.map(i => row(i, color)).join('')}`;

  const headline = broken.length
    ? `${broken.length} thing${broken.length === 1 ? '' : 's'} broken`
    : todo.length
      ? `${todo.length} thing${todo.length === 1 ? '' : 's'} need you`
      : 'Everything is healthy';

  const html = `
  <div style="background:#EEF2F6;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:620px;margin:0 auto;background:#FFFFFF;border-radius:10px">
      <tr><td style="padding:24px 22px 8px">
        <p style="margin:0 0 2px;font-size:11.5px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:#64748B">ReelIntel &middot; daily check</p>
        <p style="margin:0;font-size:21px;font-weight:800;color:#0F172A">${headline}</p>
        ${test ? '<p style="margin:8px 0 0;font-size:13px;color:#B45309;font-weight:700">This is a test send. Context below is real.</p>' : ''}
      </td></tr>
      <tr><td style="padding:16px 22px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${group('Broken', '#B91C1C', broken)}
          ${group('Needs you', '#B45309', todo)}
          ${group('For information only', '#64748B', ctx)}
          ${notes.length ? `
          <tr><td style="padding:4px 0 16px">
            <p style="margin:0 0 5px;font-size:11.5px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#B91C1C">Could not be checked</p>
            ${notes.map(n => `<p style="margin:0 0 4px;font-size:13px;color:#475569">${esc(n)}</p>`).join('')}
          </td></tr>` : ''}
        </table>
      </td></tr>
      <tr><td style="padding:4px 22px 24px;border-top:1px solid #E2E8F0">
        <p style="margin:14px 0 0;font-size:12.5px;color:#64748B;line-height:1.5">
          You only get this email when something needs doing. A quiet morning means everything passed.
        </p>
      </td></tr>
    </table>
  </div>`;

  const subject = broken.length
    ? `ReelIntel: ${broken.length} thing${broken.length === 1 ? '' : 's'} broken`
    : todo.length
      ? `ReelIntel: ${todo.length} thing${todo.length === 1 ? '' : 's'} need you`
      : 'ReelIntel: all healthy (test send)';

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, reply_to: 'harper@reelintel.ai', to: [TO], subject, html }),
  });
  if (!res.ok) return json({ error: 'resend_failed', detail: await res.text() }, 502);

  return json({ ok: true, sent: true, broken: broken.length, todo: todo.length, context: ctx.length });
});
