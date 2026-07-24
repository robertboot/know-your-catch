/* mint-model-upload-url — Edge Function.

   Fixes the "finished model never uploaded" failure. A Supabase signed
   upload URL is only valid ~2 hours and CANNOT be extended. The admin
   used to mint one when copying the Colab cell, but as the dataset grew
   a training run started taking longer than 2 hours — so by the time
   Colab tried to PUT the finished bundle the URL had expired, the upload
   silently 403'd, and the model was lost with the runtime. This function
   lets Colab mint a FRESH upload URL at the moment it's ready to upload,
   seconds before the PUT, so training duration no longer matters.

   Two actions, ONE static server secret that never reaches the browser:

     { action: "issue" }   — called by the ADMIN from the browser with
                             their Supabase JWT. Verifies the caller is
                             the admin, then returns a 7-day HMAC-signed
                             TICKET (not the secret). Baked into the
                             pasted Colab snippet.

     { action: "redeem",   — called by COLAB at the end of training with
       ticket }              the ticket. Verifies the ticket's signature
                             + expiry, then mints and returns a fresh
                             signed upload URL for model-artifacts/pending.

   Deploy WITHOUT JWT verification (Colab has no JWT); the "issue" branch
   verifies the admin JWT itself:
       supabase functions deploy mint-model-upload-url --no-verify-jwt

   REQUIRED SECRET (set once):
       MODEL_UPLOAD_SECRET   — any long random string; signs tickets.
   Standard project envs (auto-injected):
       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY
*/

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAIL     = 'robertb1023@me.com';
const MODEL_BUCKET    = 'model-artifacts';
const TICKET_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days

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

/* ---- base64url + HMAC helpers (Web Crypto) ---- */
function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Constant-time-ish string compare to avoid signature timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ticket = "<expB64url>.<hmacHex(secret, expB64url)>" where expB64url
   encodes the millisecond expiry timestamp. Self-contained: no storage,
   no DB — verification only needs the secret. */
async function issueTicket(secret: string): Promise<string> {
  const exp = String(Date.now() + TICKET_TTL_MS);
  const payload = b64urlEncodeStr(exp);
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

async function verifyTicket(secret: string, ticket: string): Promise<{ ok: boolean; reason?: string }> {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payload, sig] = parts;
  const expected = await hmacHex(secret, payload);
  if (!safeEqual(sig, expected)) return { ok: false, reason: 'bad-signature' };
  let expMs = 0;
  try {
    let b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '='; // restore stripped base64url padding
    expMs = parseInt(atob(b64), 10);
  } catch { /* fall through — treated as invalid below */ }
  if (!Number.isFinite(expMs) || expMs <= 0) return { ok: false, reason: 'bad-payload' };
  if (Date.now() > expMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SECRET       = Deno.env.get('MODEL_UPLOAD_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: 'missing project env' }, 500);
  if (!SECRET) return jsonResponse({ error: 'missing MODEL_UPLOAD_SECRET' }, 500);

  let body: { action?: string; ticket?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid JSON body' }, 400); }
  const action = body.action;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ---- issue: admin-only, returns a signed ticket ----
  if (action === 'issue') {
    const authz = req.headers.get('Authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) return jsonResponse({ error: 'missing bearer token' }, 401);
    const { data, error } = await admin.auth.getUser(token);
    const email = (data?.user?.email || '').trim().toLowerCase();
    if (error || email !== ADMIN_EMAIL) return jsonResponse({ error: 'forbidden' }, 403);
    const ticket = await issueTicket(SECRET);
    return jsonResponse({ ok: true, ticket, expiresInDays: 7 });
  }

  // ---- redeem: ticket-gated, mints a fresh upload URL ----
  if (action === 'redeem') {
    const v = await verifyTicket(SECRET, body.ticket || '');
    if (!v.ok) return jsonResponse({ error: `invalid ticket: ${v.reason}` }, 403);
    const today = new Date().toISOString().slice(0, 10);
    const path = `pending/${today}/${crypto.randomUUID()}.zip`;
    const { data, error } = await admin.storage.from(MODEL_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      return jsonResponse({ error: error?.message || 'could not mint upload URL' }, 500);
    }
    return jsonResponse({ ok: true, signedUrl: data.signedUrl, token: data.token, path });
  }

  return jsonResponse({ error: 'unknown action (expected "issue" or "redeem")' }, 400);
});
