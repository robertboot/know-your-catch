/* draft-tester-reply — Edge Function.

   Drafts a personal reply to one tester's feedback, so answering 25
   people does not become the reason feedback goes unanswered.

   The draft is deliberately specific: it quotes back what they actually
   reported rather than thanking them generically, because a reply that
   could have been sent to anyone reads worse than no reply at all.

   Auth: admin JWT, same gate as research-species.
   Env:  ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

   Deploy: supabase functions deploy draft-tester-reply
*/
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-4-6';
const ADMIN_EMAIL        = 'robertb1023@me.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...cors } });

const SYSTEM = `You draft replies that Robert, the solo developer of ReelIntel
(a Gulf of Mexico + Florida fishing app), sends to early testers he knows
personally. He recruited ~25 of them by text before marketing the app.

Write the email body only. No subject line, no markdown, no placeholders
like [name] — use the real details you are given.

Rules:
- Open by name. Get to the point in the first line.
- Address their SPECIFIC points, quoting the substance back so it is
  obvious a person read it. Never thank them generically.
- If they reported a crash or bug, say it is being investigated and ask
  the one follow-up question most likely to help reproduce it.
- If they suggested something already planned, say so plainly. Do not
  promise anything else, and never invent a ship date.
- If a field was left blank, ignore it. Do not mention the blank.
- Mention the free t-shirt once, at the end, and ask for size and
  mailing address. Never tie it to leaving a review.
- Sign off as Robert.
- Warm and direct, the way you write to someone you actually know.
  No corporate voice, no exclamation marks, no "we value your feedback".
- 120-220 words.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'missing project env' }, 500);
  if (!KEY) return json({ error: 'server_misconfigured', detail: 'missing ANTHROPIC_API_KEY' }, 500);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'no_auth' }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(authHeader.slice(7));
  if (userErr || !userRes?.user?.email) return json({ error: 'invalid_auth' }, 401);
  if (userRes.user.email.trim().toLowerCase() !== ADMIN_EMAIL) return json({ error: 'forbidden' }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const f = (k: string) => String(b[k] ?? '').trim();
  const answered = [
    ['What they tested',        f('tested')],
    ['What worked',             f('worked')],
    ['What was confusing',      f('confusing')],
    ['What broke',              f('broke')],
    ['Feature they want',       f('wish')],
  ].filter(([, v]) => v);

  if (!answered.length) {
    return json({ error: 'no_content', detail: 'this submission has no written answers' }, 400);
  }

  const hasAccount = b.hasAccount === true;
  const prompt =
    `Tester: ${f('name') || 'a tester'}\n` +
    `Created an account: ${hasAccount ? 'yes' : 'no — they submitted feedback but no matching account exists'}\n` +
    (typeof b.catches === 'number' ? `Catches logged: ${b.catches}\n` : '') +
    `\n${answered.map(([k, v]) => `${k}:\n${v}`).join('\n\n')}\n\n` +
    (hasAccount ? '' : 'Ask, lightly and near the end, which email they signed up with — ' +
      'their feedback address does not match an account.\n') +
    `Draft the reply.`;

  try {
    const r = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 900,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('anthropic failed', r.status, detail);
      return json({ error: `anthropic_${r.status}` }, 502);
    }
    const data = await r.json();
    const text = (data?.content || [])
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text).join('').trim();
    if (!text) return json({ error: 'empty_draft' }, 502);
    return json({ ok: true, draft: text });
  } catch (e) {
    console.error('draft threw', e);
    return json({ error: String(e) }, 502);
  }
});
