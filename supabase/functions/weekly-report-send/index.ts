/* weekly-report-send — mails one APPROVED edition of the Weekly Waters
   Report. It never builds anything and never decides anything: an admin
   approved a specific rendered draft in the console, and this sends that
   exact html to that edition's audience.

   Called from the admin UI with the caller's own session, not a cron
   secret. The caller's email must be an admin — the one action in this
   system that puts mail in front of hundreds of people should be tied to
   a person, not to a shared token that any job could hold.

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
const ADMINS = ['robertb1023@me.com', 'annelies@reelintel.ai', 'harper@reelintel.ai'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const URL_ = Deno.env.get('SUPABASE_URL');
  const SR   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const KEY  = Deno.env.get('RESEND_API_KEY');
  if (!URL_ || !SR || !KEY) return json({ error: 'server_misconfigured' }, 500);

  // Identify the caller from their own bearer token.
  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(URL_, SR, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const callerEmail = (who?.user?.email || '').toLowerCase();
  if (whoErr || !callerEmail || !ADMINS.includes(callerEmail)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_payload' }, 400); }
  const id = String(body.id || '');
  const testOnly = body.test === true;
  if (!id) return json({ error: 'missing_id' }, 400);

  const { data: ed, error: edErr } = await admin.from('weekly_emails')
    .select('*').eq('id', id).single();
  if (edErr || !ed) return json({ error: 'not_found' }, 404);

  // A test send goes to the admin who asked for it, and changes nothing
  // about the edition's status. This is how you read the real thing in a
  // real mail client before committing to the audience.
  if (testOnly) {
    const r = await mail(KEY, callerEmail, `[TEST] ${ed.subject}`, ed.html, ed.text_body);
    return r.ok ? json({ ok: true, test: true, to: callerEmail })
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
    .select('id, email').eq('email_id', id).is('sent_at', null);

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
    approved_by: callerEmail,
    approved_at: ed.approved_at ?? new Date().toISOString(),
    sent_at: done ? new Date().toISOString() : null,
    send_error: failed ? `${failed} of ${sent + failed} failed — press send again to retry just those` : null,
  }).eq('id', id);

  return json({ ok: done, sent, failed, total: sent + failed });
});

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
