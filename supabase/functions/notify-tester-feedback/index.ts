/* notify-tester-feedback — Edge Function.

   Fired by a Supabase Database Webhook on INSERT into tester_feedback.

   Why it exists: the /testers form used to email the founder, but that
   was only the FALLBACK for a failed database insert. Once the table
   existed, submissions saved silently and the email stopped — a real
   response sat unread until someone thought to query the table. This
   restores the alert while keeping the row.

   Deploy:
     supabase functions deploy notify-tester-feedback
   Requires the same RESEND_API_KEY the send-launch-email function uses.
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'ReelIntel <hello@reelintel.ai>';
const TO_ADDRESS = 'robertb1023@me.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...cors },
  });

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const RESEND_KEY = Deno.env.get('RESEND_API_KEY');
  if (!RESEND_KEY) return json({ error: 'missing RESEND_API_KEY' }, 500);

  let row: Record<string, string | null> = {};
  try {
    const payload = await req.json();
    // Supabase webhooks send { type, table, record, old_record }.
    row = payload?.record ?? payload ?? {};
  } catch {
    return json({ error: 'bad payload' }, 400);
  }

  const name = row.name || 'A tester';
  const email = row.email || '(no email)';
  const fields: Array<[string, string | null]> = [
    ['What did you test?', row.tested],
    ['What worked?', row.worked],
    ['What was confusing?', row.confusing],
    ['Did anything break?', row.broke],
    ['Feature they wish existed', row.wish],
  ];

  const blocks = fields
    .filter(([, v]) => (v || '').trim())
    .map(([label, v]) => `
      <p style="margin:16px 0 4px;font:600 12px/1.4 -apple-system,sans-serif;
                color:#64748B;text-transform:uppercase;letter-spacing:.6px">${esc(label)}</p>
      <p style="margin:0;font:15px/1.6 -apple-system,sans-serif;color:#0F172A;
                white-space:pre-wrap">${esc(v || '')}</p>`)
    .join('');

  const html = `
    <div style="max-width:600px;margin:0 auto;padding:24px;background:#fff">
      <p style="margin:0 0 4px;font:800 20px/1.3 -apple-system,sans-serif;color:#0F172A">
        New tester feedback</p>
      <p style="margin:0 0 20px;font:15px/1.5 -apple-system,sans-serif;color:#475569">
        <strong>${esc(name)}</strong> &lt;${esc(email)}&gt;</p>
      ${blocks || '<p style="font:15px -apple-system,sans-serif;color:#94A3B8">(no written answers)</p>'}
      ${row.screenshot_path ? `<p style="margin:18px 0 0;font:13px -apple-system,sans-serif;color:#64748B">
        Screenshot attached — open the Testers tab in the admin to view it.</p>` : ''}
      <p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #E2E8F0;
                font:13px/1.6 -apple-system,sans-serif;color:#64748B">
        Reply straight to this email to reach them, or open the admin
        Testers tab to see whether they created an account.</p>
    </div>`;

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [TO_ADDRESS],
        // So hitting reply in the mail client reaches the tester.
        reply_to: row.email || undefined,
        subject: `ReelIntel tester feedback — ${name}`,
        html,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('resend failed', r.status, detail);
      return json({ ok: false, error: `resend ${r.status}` }, 502);
    }
  } catch (e) {
    console.error('resend threw', e);
    return json({ ok: false, error: String(e) }, 502);
  }

  return json({ ok: true });
});
