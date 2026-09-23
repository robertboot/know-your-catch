/* error-digest — daily email of new client errors.
 *
 * An error table nobody opens is the same as no error table. This runs
 * on pg_cron and only sends when something actually broke, so the mail
 * arriving means something, and silence means silence.
 *
 * Auth: x-cron-secret (same shape as the other scheduled functions).
 * Env:  RESEND_API_KEY, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Deploy: supabase functions deploy error-digest
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'ReelIntel <hello@reelintel.ai>';
const TO   = 'robertb1023@me.com';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_KEY   = Deno.env.get('RESEND_API_KEY');
  const CRON_SECRET  = Deno.env.get('CRON_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE || !RESEND_KEY) return json({ error: 'missing env' }, 500);
  if (CRON_SECRET && req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return json({ error: 'forbidden' }, 403);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db.from('error_log')
    .select('kind,message,screen,is_guest,platform,occurred_at,fingerprint,stack')
    .gte('occurred_at', since)
    .is('resolved_at', null)
    .order('occurred_at', { ascending: false })
    .limit(500);
  if (error) return json({ error: error.message }, 500);

  const rows = data || [];
  // Silence is the signal. Only mail when something broke.
  if (!rows.length) return json({ ok: true, sent: false, reason: 'no new errors' });

  const groups = new Map<string, { n: number; guests: number; r: typeof rows[0] }>();
  for (const r of rows) {
    const g = groups.get(r.fingerprint) || { n: 0, guests: 0, r };
    g.n += 1; if (r.is_guest) g.guests += 1;
    groups.set(r.fingerprint, g);
  }
  const list = [...groups.values()].sort((a, b) => b.n - a.n);

  const html = `
    <div style="max-width:640px;margin:0 auto;padding:22px;font-family:-apple-system,sans-serif">
      <p style="margin:0 0 4px;font-size:19px;font-weight:800;color:#0F172A">
        ${rows.length} error${rows.length === 1 ? '' : 's'} in the last 24h</p>
      <p style="margin:0 0 18px;font-size:14px;color:#475569">
        ${list.length} distinct fault${list.length === 1 ? '' : 's'}.</p>
      ${list.map(g => `
        <div style="border:1px solid #E2E8F0;border-radius:10px;padding:13px;margin-bottom:10px">
          <div style="font-size:11px;font-weight:800;color:#DC2626;text-transform:uppercase;letter-spacing:.5px">
            ${esc(g.r.kind)} · ${g.n}× ${g.guests ? `· ${g.guests} guest` : ''}
          </div>
          <div style="margin-top:5px;font-size:14px;font-weight:600;color:#0F172A;word-break:break-word">
            ${esc(g.r.message || '')}
          </div>
          <div style="margin-top:4px;font-size:12px;color:#64748B">
            ${g.r.screen ? `screen: ${esc(g.r.screen)} · ` : ''}${esc(g.r.platform || '')}
          </div>
        </div>`).join('')}
      <p style="margin:20px 0 0;font-size:13px;color:#64748B">
        Full stacks in the admin Errors tab.</p>
    </div>`;

  const r = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [TO],
      subject: `ReelIntel — ${list.length} error${list.length === 1 ? '' : 's'} in 24h`,
      html,
    }),
  });
  if (!r.ok) return json({ error: `resend ${r.status}` }, 502);
  return json({ ok: true, sent: true, distinct: list.length, total: rows.length });
});
