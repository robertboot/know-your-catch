/* scan-regulation-alerts — Edge Function.

   Fires per scheduled cron pass (or an admin test click). For each
   signed-in user with starred species, compares the current bundled
   regulation state (from public.regulation_snapshot) against the
   snapshot in public.regulation_alerts_sent. On a diff, inserts an
   in-app alert into public.regulation_alert_events AND fires an
   email through Resend, then advances the sent-snapshot so the next
   run doesn't re-fire the same alert.

   Auth: JWT-verified admin allowlist (matches send-launch-email).
   Cron uses the same auth via a service_role-signed request.

   Body: { test_only?: boolean }
     - test_only=true → only checks the caller, only emails the
       caller, and does NOT update regulation_alerts_sent (so a
       dry-run doesn't poison the "already notified" cache).
     - default → runs the full pass. */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['robertb1023@me.com'];
const FROM_ADDRESS = 'ReelIntel <hello@reelintel.ai>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_INTERVAL_MS = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function isAdminEmail(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/* Classify a change. Everything in the reg object gets checked;
   season open/close ('open') is the highest-signal so it's split
   from size / bag changes. Multiple simultaneous changes surface as
   'multiple'. */
function classifyChange(prev: any, next: any): {
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
} | null {
  const changes: string[] = [];
  const detail: Record<string, unknown> = {};
  const keys = ['open', 'minSize', 'bagLimit', 'gear', 'notes'];
  for (const k of keys) {
    const p = prev?.[k];
    const n = next?.[k];
    const same = JSON.stringify(p) === JSON.stringify(n);
    if (!same) {
      changes.push(k);
      detail[k] = { prev: p, next: n };
    }
  }
  if (changes.length === 0) return null;
  const kind = changes.length === 1
    ? (changes[0] === 'open' ? (
        typeof next?.open === 'string' && next.open.toLowerCase().includes('closed')
          ? 'season_closed'
          : 'season_opened'
      )
      : changes[0] === 'minSize'  ? 'size_changed'
      : changes[0] === 'bagLimit' ? 'bag_changed'
      : 'other_changed')
    : 'multiple';
  const parts: string[] = [];
  if (changes.includes('open') && next?.open)     parts.push(`Season: ${String(next.open)}`);
  if (changes.includes('minSize') && next?.minSize != null) parts.push(`Min size: ${next.minSize}"`);
  if (changes.includes('bagLimit') && next?.bagLimit != null) parts.push(`Bag: ${next.bagLimit}`);
  const summary = parts.length > 0 ? parts.join(' · ') : `Regulation update (${changes.join(', ')})`;
  return { kind, summary, detail };
}

function renderEmailHtml(rows: Array<{ speciesName: string; jurisdictionName: string; summary: string }>) {
  const items = rows.map(r => `
    <p style="margin:0 0 10px;padding:8px 10px;border-left:3px solid #b7935a;background:#f5efe1;">
      <strong>${r.speciesName}</strong> — ${r.jurisdictionName}<br>
      <span style="color:#4b5563">${r.summary}</span>
    </p>`).join('');
  return `<div style="font-family:system-ui,Helvetica,Arial,sans-serif;line-height:1.5">
    <p>Regulation change on your starred species:</p>
    ${items}
    <p style="margin-top:14px">Open ReelIntel to review the details and adjust your plans.</p>
    <p style="color:#9aa0a6;font-size:12px;margin-top:14px">
      You're getting this because you starred these species. Manage
      favorites in the app → Regulations.
    </p>
  </div>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL   = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_KEY     = Deno.env.get('RESEND_API_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE || !RESEND_KEY) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) return jsonResponse({ error: 'invalid_auth' }, 401);
  const callerEmail = userRes.user.email;
  const callerId    = userRes.user.id;
  if (!isAdminEmail(callerEmail)) return jsonResponse({ error: 'forbidden' }, 403);

  let body: { test_only?: boolean } = {};
  try { body = await req.json(); } catch {}
  const testOnly = !!body.test_only;

  // Load the current regulation snapshot into a Map keyed by
  // (species_id + '|' + jurisdiction).
  const { data: snapRows, error: snapErr } = await admin
    .from('regulation_snapshot').select('species_id, jurisdiction, state');
  if (snapErr) return jsonResponse({ error: 'snapshot_load_failed', detail: snapErr.message }, 500);
  const snapshot = new Map<string, any>();
  for (const r of (snapRows || [])) {
    snapshot.set(`${r.species_id}|${r.jurisdiction}`, r.state || {});
  }
  if (snapshot.size === 0) {
    return jsonResponse({
      error: 'empty_snapshot',
      detail: 'regulation_snapshot has no rows. Push it from the admin panel first.',
    }, 400);
  }

  // Load user_state for every user, extract favorites + jurisdiction.
  // In test mode, only load the caller's row.
  const usQuery = admin.from('user_state').select('user_id, data').is('deleted_at', null);
  const { data: usRows, error: usErr } = testOnly
    ? await usQuery.eq('user_id', callerId)
    : await usQuery;
  if (usErr) return jsonResponse({ error: 'user_state_load_failed', detail: usErr.message }, 500);

  // Email → user_id map for send. Only fetched when we have work.
  const emailByUserId = new Map<string, string>();
  const { data: userList, error: uErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (uErr) return jsonResponse({ error: 'user_list_failed', detail: uErr.message }, 500);
  for (const u of userList.users) if (u.email) emailByUserId.set(u.id, u.email);

  let alertsInserted = 0;
  let emailsSent     = 0;
  let emailsFailed   = 0;
  let usersChecked   = 0;

  const bumpUser = async (uid: string, favorites: string[], jurisdiction: string) => {
    usersChecked++;
    if (!Array.isArray(favorites) || favorites.length === 0) return;
    if (!jurisdiction) return;

    // Snapshot for this user's last-notified state, keyed by species_id.
    const { data: sentRows, error: sentErr } = await admin
      .from('regulation_alerts_sent')
      .select('species_id, last_state')
      .eq('user_id', uid)
      .eq('jurisdiction', jurisdiction);
    if (sentErr) { console.error('sent load failed', sentErr.message); return; }
    const sentBySpecies = new Map<string, any>();
    for (const r of (sentRows || [])) sentBySpecies.set(r.species_id, r.last_state);

    const emailRows: Array<{ speciesName: string; jurisdictionName: string; summary: string }> = [];
    const nowIso = new Date().toISOString();

    for (const speciesId of favorites) {
      const key = `${speciesId}|${jurisdiction}`;
      const current = snapshot.get(key);
      if (!current) continue; // no regs for this species in this jurisdiction
      const previous = sentBySpecies.get(speciesId);

      // First time we've seen this pair: seed silently. No alert on
      // "first observation" so a fresh signup doesn't get a wall of
      // "regulation change" emails for their entire favorites list.
      if (!previous) {
        if (!testOnly) {
          await admin.from('regulation_alerts_sent').upsert({
            user_id: uid, species_id: speciesId, jurisdiction,
            last_state: current, last_notified_at: nowIso,
          });
        }
        continue;
      }

      const change = classifyChange(previous, current);
      if (!change) continue; // no diff

      // In-app alert row.
      if (!testOnly) {
        const insEvent = await admin.from('regulation_alert_events').insert({
          user_id: uid,
          species_id: speciesId,
          species_name: null, // client renders the name from bundled SPECIES
          jurisdiction,
          jurisdiction_name: null,
          change_kind: change.kind,
          summary: change.summary,
          detail: change.detail,
        });
        if (!insEvent.error) alertsInserted++;
      } else {
        alertsInserted++;
      }
      emailRows.push({
        speciesName: speciesId, // client formats the pretty name; email keeps it terse
        jurisdictionName: jurisdiction,
        summary: change.summary,
      });

      // Advance the sent snapshot so next run doesn't re-fire.
      if (!testOnly) {
        await admin.from('regulation_alerts_sent').upsert({
          user_id: uid, species_id: speciesId, jurisdiction,
          last_state: current, last_notified_at: nowIso,
        });
      }
    }

    if (emailRows.length > 0) {
      const to = emailByUserId.get(uid);
      if (!to) return;
      // test_only: force to caller regardless of which user we're processing.
      const recipient = testOnly ? callerEmail : to;
      try {
        const r = await fetch(RESEND_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_KEY}`,
          },
          body: JSON.stringify({
            from: FROM_ADDRESS, to: [recipient],
            subject: `Regulation update on ${emailRows.length} of your starred species`,
            html: renderEmailHtml(emailRows),
          }),
        });
        if (r.ok) emailsSent++;
        else       emailsFailed++;
      } catch {
        emailsFailed++;
      }
      await new Promise((res) => setTimeout(res, SEND_INTERVAL_MS));
    }
  };

  for (const row of (usRows || [])) {
    const favorites = row?.data?.favorites || [];
    const jurisdiction = row?.data?.jurisdiction || null;
    await bumpUser(row.user_id, favorites, jurisdiction);
  }

  return jsonResponse({
    ok: true,
    test_only: testOnly,
    usersChecked,
    alertsInserted,
    emailsSent, emailsFailed,
  });
});
