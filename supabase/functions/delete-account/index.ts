/* delete-account — Edge Function.

   App Store guideline 5.1.1(v): an app that supports account creation
   must let the user delete their account (and the data tied to it) from
   inside the app. The client can't do this itself — removing an
   auth.users row and another user's storage objects needs the service
   role, which must never reach the browser. This function is that
   privileged step.

   Auth: the caller's Supabase JWT (Authorization: Bearer <token>). We
   verify it with the service role to resolve the user id, so a user can
   only ever delete THEIR OWN account — the id comes from the verified
   token, never from the request body.

   What it purges, for that one user id:
     - storage: every object under `<uid>/` in the private catch-photos
       bucket (their full-res catch photos)
     - rows: catches, pbs, user_state, ai_identify_usage,
       species_suggestions
     - the auth user itself (auth.admin.deleteUser)

   Deploy normally (JWT verification ON is fine — the client always
   sends a real user token):
       supabase functions deploy delete-account

   Standard project envs (auto-injected):
       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY
*/

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PHOTO_BUCKET = 'catch-photos';
// User-scoped tables keyed on user_id. Order doesn't matter — the auth
// user is removed last so a mid-run failure never orphans the login.
const USER_TABLES = ['catches', 'pbs', 'user_state', 'ai_identify_usage', 'species_suggestions'];

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ ok: false, error: 'missing project env' }, 500);

  const authz = req.headers.get('Authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return jsonResponse({ ok: false, error: 'missing bearer token' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // The user id comes ONLY from the verified token.
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (userErr || !uid) return jsonResponse({ ok: false, error: 'invalid or expired session' }, 401);

  const problems: string[] = [];

  // 1) Storage — list the user's folder and remove every object.
  try {
    const { data: files, error: listErr } = await admin.storage.from(PHOTO_BUCKET).list(uid, { limit: 1000 });
    if (listErr) {
      problems.push(`storage list: ${listErr.message}`);
    } else if (files && files.length) {
      const paths = files.map(f => `${uid}/${f.name}`);
      const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove(paths);
      if (rmErr) problems.push(`storage remove: ${rmErr.message}`);
    }
  } catch (e) {
    problems.push(`storage: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) User-scoped rows.
  for (const table of USER_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', uid);
    // A missing table (feature not provisioned in this project) is not a
    // failure worth blocking account deletion over.
    if (error && !/does not exist|not find the table|schema cache/i.test(error.message || '')) {
      problems.push(`${table}: ${error.message}`);
    }
  }

  // 3) The auth user itself — last, so a partial failure above still
  //    leaves a recoverable login rather than an orphaned data set.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return jsonResponse({ ok: false, error: `could not delete account: ${delErr.message}`, problems }, 500);
  }

  return jsonResponse({ ok: true, deleted: uid, problems });
});
