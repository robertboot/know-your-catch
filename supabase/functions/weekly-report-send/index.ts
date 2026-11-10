/* weekly-report-send — mails one APPROVED edition of the Weekly Waters
   Report. It never builds anything and never decides anything: an admin
   approved a specific rendered draft in the console, and this sends that
   exact html to that edition's audience.

   TWO ways in, and the difference matters.

   From the admin UI, with the caller's own session: that admin names an
   edition by id and it goes. The caller's email must be on the admin
   list, because the one action in this system that puts mail in front of
   hundreds of people should be tied to a person.

   From the scheduler, with the cron secret and NO id: it sweeps editions
   a named admin has ALREADY approved and posts them. That is a weaker
   credential, so it gets a narrower job — it cannot name an edition, it
   cannot send a draft, a blocked or a discarded one, and it cannot
   re-send one already sent. The human gate is Approve; this is only the
   postman, and it can only carry what someone already signed.

   Deploy:
     supabase functions deploy weekly-report-send
   Secrets: RESEND_API_KEY (already set for the other mail functions).
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
// The weekly report comes FROM a person, not from a shared inbox.
// hello@ is right for transactional mail nobody replies to; a newsletter
// that lands from a named marketing manager gets opened and, when
// someone hits reply, reaches someone who can answer.
const FROM_ADDRESS = 'Harper Wells, ReelIntel <harper@reelintel.ai>';
const REPLY_TO = 'harper@reelintel.ai';
const ADMINS = ['robertb1023@me.com', 'robert@reelintel.ai', 'harper@reelintel.ai'];
// A draft goes to one person for approval, never back to whoever
// happened to prepare it.
const APPROVER = 'robert@reelintel.ai';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* The scheduler's inner call names its edition in a header rather than
   the body, so the body shape stays exactly what the admin UI sends and
   there is no field a browser could set to impersonate the scheduler. */
function isCronEdition(req: Request, secret: string | undefined): string {
  if (!secret || req.headers.get('x-cron-secret') !== secret) return '';
  return req.headers.get('x-cron-edition') || '';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const SR   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const KEY  = Deno.env.get('RESEND_API_KEY');
  if (!URL_ || !SR || !KEY) return json({ error: 'server_misconfigured' }, 500);

  const admin = createClient(URL_, SR, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const id = String(body.id || '');
  const testOnly = body.test === true;

  // The scheduler's path: cron secret, no id, approved editions only.
  const CRON_SECRET = Deno.env.get('CRON_SECRET');
  const isCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;

  if (isCron) {
    if (id || testOnly) {
      // A shared token may not name a target or address a test. Those are
      // a person's decisions.
      return json({ error: 'cron_may_not_target' }, 403);
    }
    const { data: queue, error: qErr } = await admin.from('weekly_emails')
      .select('id, jurisdiction_id, week_start, approved_by, approved_at')
      .eq('status', 'approved')
      .order('week_start', { ascending: true })
      .limit(20);
    if (qErr) return json({ error: qErr.message }, 500);
    if (!queue?.length) return json({ ok: true, sent: 0, reason: 'nothing approved' });

    const results = [];
    for (const ed of queue) {
      // Re-enter this same function per edition so there is ONE send path.
      // A second copy of the delivery loop is a second place for the
      // recipient bookkeeping to drift.
      const r = await fetch(req.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': CRON_SECRET,
          'x-cron-edition': ed.id,
        },
        body: JSON.stringify({}),
      });
      const detail = await r.json().catch(() => ({}));
      results.push({ id: ed.id, jurisdiction: ed.jurisdiction_id,
                     approved_by: ed.approved_by, ok: r.ok, detail });
    }
    return json({ ok: true, swept: queue.length, results });
  }

  // One edition, named by the scheduler's inner call above.
  const cronEdition = isCronEdition(req, CRON_SECRET);
  let callerEmail = '';
  if (cronEdition) {
    callerEmail = 'scheduler';
  } else {
    // Identify the caller from their own bearer token.
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return json({ error: 'unauthorized' }, 401);
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    callerEmail = (who?.user?.email || '').toLowerCase();
    if (whoErr || !callerEmail || !ADMINS.includes(callerEmail)) {
      return json({ error: 'forbidden' }, 403);
    }
  }

  const targetId = cronEdition || id;
  if (!targetId) return json({ error: 'missing_id' }, 400);

  const { data: ed, error: edErr } = await admin.from('weekly_emails')
    .select('*').eq('id', targetId).single();
  if (edErr || !ed) return json({ error: 'not_found' }, 404);

  // The scheduler may only post what a person already signed.
  if (cronEdition && ed.status !== 'approved') {
    return json({ error: 'not_approved', status: ed.status }, 409);
  }

  // A test send goes to the admin who asked for it, and changes nothing
  // about the edition's status. This is how you read the real thing in a
  // real mail client before committing to the audience.
  if (testOnly) {
    // A review copy may be addressed to another admin — Harper prepares
    // the edition and Rob approves it, so "send a test" defaulting to
    // the signed-in user would mail the preparer, not the approver.
    // Restricted to the admin list: this is not a way to mail anyone.
    const asked = String(body.to || '').toLowerCase().trim();
    if (asked && !ADMINS.includes(asked)) {
      return json({ error: 'recipient_not_admin', detail: asked }, 403);
    }
    const to = asked || APPROVER;
    const r = await mail(KEY, to, `[REVIEW] ${ed.subject}`,
      reviewWrapper(ed, callerEmail), reviewText(ed, callerEmail));
    return r.ok ? json({ ok: true, test: true, to })
                : json({ error: 'resend_failed', detail: r.detail }, 502);
  }

  if (ed.status === 'sent')     return json({ error: 'already_sent', sent_at: ed.sent_at }, 409);
  if (ed.status === 'blocked')  return json({ error: 'blocked', reasons: ed.block_reasons }, 409);
  if (ed.status === 'discarded') return json({ error: 'discarded' }, 409);

  // Resolve the audience NOW rather than trusting the count stored at
  // generation time — someone may have signed up, or changed waters,
  // in the days between the draft and the approval.
  const { data: audience, error: audErr } = await admin
    .rpc('weekly_email_audience', { p_jurisdiction: ed.jurisdiction_id });
  if (audErr) return json({ error: 'audience_failed', detail: audErr.message }, 500);
  const list = (audience || []) as Array<{ user_id: string; email: string }>;
  if (list.length === 0) return json({ error: 'no_subscribers' }, 409);

  // Seed the per-recipient log first. A send that dies halfway can then
  // be resumed without mailing anyone twice — the rows already marked
  // sent_at are skipped on the retry.
  await admin.from('weekly_email_recipients').upsert(
    list.map(r => ({ email_id: id, user_id: r.user_id, email: r.email })),
    { onConflict: 'email_id,email' });

  const { data: pending } = await admin.from('weekly_email_recipients')
    .select('id, email').eq('email_id', targetId).is('sent_at', null);

  let sent = 0, failed = 0;
  for (const row of (pending || [])) {
    const r = await mail(KEY, row.email, ed.subject, ed.html, ed.text_body);
    if (r.ok) {
      sent++;
      await admin.from('weekly_email_recipients')
        .update({ sent_at: new Date().toISOString(), error: null }).eq('id', row.id);
    } else {
      failed++;
      await admin.from('weekly_email_recipients').update({ error: r.detail }).eq('id', row.id);
    }
    // Resend's rate limit is per second; a young sending domain should
    // not burst anyway.
    await sleep(600);
  }

  const done = failed === 0;
  await admin.from('weekly_emails').update({
    status: done ? 'sent' : ed.status,
    // Never overwrite the approver with whoever posted it. On the
    // scheduler's path that would replace a person's name with
    // "scheduler" and erase the only record of who signed this edition —
    // which is precisely the record that makes an automated send
    // defensible.
    approved_by: ed.approved_by ?? callerEmail,
    approved_at: ed.approved_at ?? new Date().toISOString(),
    sent_at: done ? new Date().toISOString() : null,
    send_error: failed ? `${failed} of ${sent + failed} failed — press send again to retry just those` : null,
  }).eq('id', targetId);

  return json({ ok: done, sent, failed, total: sent + failed });
});

/* The review copy carries an approval block the real send never has.
   Approving used to mean replying in a separate chat, which left no
   record tying a yes to a specific edition — and the edition is what
   matters, since regenerating replaces its contents entirely.

   These are mailto links rather than one-click web buttons on purpose:
   a URL that sends a newsletter to hundreds of people the moment it is
   fetched will eventually be fetched by a link scanner. A reply is a
   deliberate act by a person. */
function reviewWrapper(ed: any, preparedBy: string): string {
  const count = ed.recipient_count ?? 0;
  const week = ed.week_start;
  const subj = (s: string) =>
    encodeURIComponent(`${s}: ${ed.jurisdiction_id} ${week}`);
  const approveBody = encodeURIComponent(
    `Approved. Send the ${ed.jurisdiction_id} edition for the week of ${week} to all ${count} subscribers.\n\n` +
    `Edition id: ${ed.id}\n`);
  const changeBody = encodeURIComponent(
    `Changes needed before this goes out.\n\n` +
    `What to change:\n  - \n\nEdition id: ${ed.id}\n`);

  const banner = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFC343;">
<tr><td align="center" style="padding:0;">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:640px;">
    <tr><td style="padding:18px 32px;font-family:Arial,Helvetica,sans-serif;color:#06212f;">
      <div style="font-size:13px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">Review copy &mdash; not sent to anglers</div>
      <div style="font-size:15px;line-height:1.55;padding-top:6px;">
        <b>${ed.jurisdiction_id}</b> &middot; week of ${week} &middot; goes to <b>${count}</b> subscriber${count === 1 ? '' : 's'} when approved.
        Prepared by ${preparedBy}.
      </div>
      <div style="padding-top:14px;">
        <a href="mailto:${preparedBy}?subject=${subj('APPROVED')}&amp;body=${approveBody}"
           style="display:inline-block;background:#06212f;color:#FFC343;font-size:15px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:9px;margin-right:8px;">Approve &amp; send</a>
        <a href="mailto:${preparedBy}?subject=${subj('CHANGES')}&amp;body=${changeBody}"
           style="display:inline-block;background:transparent;color:#06212f;border:2px solid #06212f;font-size:15px;font-weight:bold;text-decoration:none;padding:10px 20px;border-radius:9px;">Request changes</a>
      </div>
      <div style="font-size:12px;line-height:1.5;padding-top:12px;opacity:0.8;">
        Either button opens a reply. Approving does not send anything by itself &mdash;
        ${preparedBy} presses send in the console once your reply arrives.
      </div>
    </td></tr>
  </table>
</td></tr></table>`;

  // Injected after <body> so it sits above the masthead without touching
  // the edition's own markup, which is what actually gets sent.
  return String(ed.html).replace(/(<body[^>]*>)/i, `$1${banner}`);
}

function reviewText(ed: any, preparedBy: string): string {
  return [
    'REVIEW COPY — not sent to anglers.',
    `${ed.jurisdiction_id} · week of ${ed.week_start} · ${ed.recipient_count ?? 0} subscribers when approved.`,
    `Prepared by ${preparedBy}. Reply APPROVED to send, or reply with changes.`,
    `Edition id: ${ed.id}`,
    '', '----------------------------------------', '',
    ed.text_body,
  ].join('\n');
}

async function mail(key: string, to: string, subject: string, html: string, text: string) {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_ADDRESS, reply_to: REPLY_TO, to: [to], subject, html, text,
        // Bulk mail without a List-Unsubscribe header is a spam signal at
        // Gmail and Apple regardless of how well the domain authenticates,
        // and since February 2024 it is a stated requirement for anyone
        // sending in volume. The mailto is the one-click target; the
        // header is what the client reads to draw its own unsubscribe
        // button above the message.
        headers: {
          'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=Unsubscribe>`,
          'List-Id': `ReelIntel Weekly Waters Report <weekly.reelintel.ai>`,
          'Precedence': 'bulk',
        },
      }),
    });
    if (!res.ok) return { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 300)}` };
    return { ok: true, detail: '' };
  } catch (e) {
    return { ok: false, detail: String(e).slice(0, 300) };
  }
}
