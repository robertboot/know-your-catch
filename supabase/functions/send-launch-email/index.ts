/* send-launch-email — Edge Function.

   Fans out one launch email to every user who opted into a given
   feature waitlist. Called from the admin Notifications tab.

   Auth model: the caller's JWT (Authorization: Bearer <token>) is
   verified server-side; only the admin allowlist can call this.
   The `admin_email` field in the body is kept as an extra safety
   assertion but the JWT check is what actually gates access.

   Rate limit: 10 sends/sec (~100ms sleep between calls) to stay well
   under Resend's 100/day tier limits and their per-second ceiling.

   Response shape: { sent, failed, remaining, message? }. */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['robertb1023@me.com'];
const FROM_ADDRESS = 'ReelIntel <hello@reelintel.ai>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_INTERVAL_MS = 100; // 10 sends/sec
const MAX_RECIPIENTS = 2000;  // sanity cap

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const RESEND_KEY    = Deno.env.get('RESEND_API_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'server_misconfigured', detail: 'missing supabase env' }, 500);
  }
  if (!RESEND_KEY) {
    return jsonResponse({ error: 'server_misconfigured', detail: 'missing RESEND_API_KEY' }, 500);
  }

  // Verify caller — the JWT check is the load-bearing gate.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'no_auth' }, 401);
  }
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) {
    return jsonResponse({ error: 'invalid_auth' }, 401);
  }
  const callerEmail = userRes.user.email;
  if (!isAdminEmail(callerEmail)) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  // Parse body.
  let body: {
    feature?: string;
    subject?: string;
    html_body?: string;
    admin_email?: string;
    test_only?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }
  const { feature, subject, html_body, admin_email, test_only } = body;
  if (!feature || !subject || !html_body) {
    return jsonResponse({ error: 'missing_fields', detail: 'feature, subject, html_body required' }, 400);
  }
  // Extra assertion — belt + suspenders.
  if (admin_email && !isAdminEmail(admin_email)) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const sendOne = async (email: string): Promise<'ok' | 'fail'> => {
    try {
      const r = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_KEY}`,
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [email],
          subject,
          html: html_body,
        }),
      });
      if (!r.ok) {
        console.error(`resend failed for ${email}: ${r.status} ${await r.text().catch(() => '')}`);
        return 'fail';
      }
      return 'ok';
    } catch (e) {
      console.error(`resend threw for ${email}:`, e);
      return 'fail';
    }
  };

  // Test path: send only to caller, don't touch the waitlist.
  if (test_only) {
    const outcome = await sendOne(callerEmail);
    return jsonResponse({
      sent: outcome === 'ok' ? 1 : 0,
      failed: outcome === 'fail' ? 1 : 0,
      remaining: 0,
      test: true,
    });
  }

  // Real send: fetch unsent rows, enrich with email, fan out.
  const { data: rows, error: qErr } = await admin
    .from('feature_notifications')
    .select('id, user_id')
    .eq('feature', feature)
    .is('notified_at', null)
    .limit(MAX_RECIPIENTS);
  if (qErr) return jsonResponse({ error: 'query_failed', detail: qErr.message }, 500);
  if (!rows || rows.length === 0) {
    return jsonResponse({ sent: 0, failed: 0, remaining: 0, message: 'no_recipients' });
  }

  // Filter out anyone who has opted out of feature emails. We leave
  // their feature_notifications row in place (so opt-in later is a
  // cheap flip) and just skip them here.
  const { data: optedOutRows, error: prefErr } = await admin
    .from('user_preferences')
    .select('user_id')
    .eq('feature_emails_opted_out', true);
  if (prefErr) return jsonResponse({ error: 'prefs_query_failed', detail: prefErr.message }, 500);
  const optedOut = new Set((optedOutRows || []).map((r) => r.user_id));
  const eligibleRows = rows.filter((r) => !optedOut.has(r.user_id));
  if (eligibleRows.length === 0) {
    return jsonResponse({ sent: 0, failed: 0, remaining: 0, message: 'all_opted_out' });
  }

  // Batch-lookup emails via the admin API. listUsers is paginated —
  // for a small launch list this fits in one page. If we ever
  // outgrow that, add pagination.
  const { data: userList, error: uErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: Math.min(MAX_RECIPIENTS, 1000),
  });
  if (uErr) return jsonResponse({ error: 'user_list_failed', detail: uErr.message }, 500);
  const emailByUserId = new Map<string, string>();
  for (const u of userList.users) {
    if (u.email) emailByUserId.set(u.id, u.email);
  }

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < eligibleRows.length; i++) {
    const row = eligibleRows[i];
    const email = emailByUserId.get(row.user_id);
    if (!email) { failed++; continue; }
    const outcome = await sendOne(email);
    if (outcome === 'ok') {
      sent++;
      // Stamp the row so a retry doesn't double-send.
      const { error: uUpdateErr } = await admin
        .from('feature_notifications')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', row.id);
      if (uUpdateErr) console.error(`could not stamp row ${row.id}:`, uUpdateErr.message);
    } else {
      failed++;
    }
    if (i < eligibleRows.length - 1) {
      await new Promise((r) => setTimeout(r, SEND_INTERVAL_MS));
    }
  }

  return jsonResponse({ sent, failed, remaining: 0 });
});
