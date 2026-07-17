/* inat-identify — Edge Function (admin-only).

   A free second opinion for the admin Review tab. Given a pending
   training photo, this downloads it from storage (service role) and
   forwards it to iNaturalist's computer-vision endpoint
   (POST /v1/computervision/score_image), then maps iNat's taxon
   suggestions back to the app's species by scientific name. When
   iNat and the app's own model (Big Red) agree, the reviewer's
   one-tap confirm is that much safer.

   Why a proxy instead of calling iNat from the browser: iNat's API
   doesn't send permissive CORS headers, and the image lives in an
   admin-only storage bucket — so the call has to happen server-side.

   Auth (this function): admin JWT, same as classify-fish-photo.
   Auth (to iNat): a short-lived iNaturalist API token the admin
   pastes in — get one (signed in) at
   https://www.inaturalist.org/users/api_token — it expires ~24h, so
   the admin refreshes it every day or two.

   NOTE: iNat's score_image response shape is lightly documented; this
   reads scores defensively (combined_score → vision_score → score)
   and normalizes to 0..1. If iNat changes field names, adjust the
   MAP block below.

   Body: {
     storagePath: string,          // path in the training-photos bucket
     inatToken: string,            // the admin's iNat API token
     speciesList: [{ id, commonName, scientific }],
   }
   Response: {
     results: [{ speciesId, commonName, score, taxonName }],  // best first
   }  — or { error, detail } (401 inat_auth means the token expired). */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['robertb1023@me.com'];
const INAT_ENDPOINT = 'https://api.inaturalist.org/v1/computervision/score_image';
const TRAINING_BUCKET = 'training-photos';

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

interface SpeciesRef { id: string; commonName: string; scientific?: string }

// Normalize a scientific name for matching: lowercase, collapse
// whitespace, drop authorship/subspecies noise past the binomial.
function normSci(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function binomial(name: string): string {
  return normSci(name).split(' ').slice(0, 2).join(' ');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'server_misconfigured', detail: 'missing supabase env' }, 500);
  }

  // Admin gate.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) return jsonResponse({ error: 'invalid_auth' }, 401);
  if (!isAdminEmail(userRes.user.email)) return jsonResponse({ error: 'forbidden' }, 403);

  let body: { storagePath?: string; inatToken?: string; speciesList?: SpeciesRef[] };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'bad_json' }, 400); }
  const storagePath = (body.storagePath || '').trim();
  const inatToken   = (body.inatToken || '').trim();
  const speciesList = Array.isArray(body.speciesList) ? body.speciesList : [];
  if (!storagePath) return jsonResponse({ error: 'missing_fields', detail: 'storagePath required' }, 400);
  if (!inatToken)   return jsonResponse({ error: 'missing_token', detail: 'iNat API token required' }, 400);
  if (speciesList.length === 0) return jsonResponse({ error: 'missing_fields', detail: 'speciesList required' }, 400);

  // Download the photo from storage (service role bypasses RLS).
  const dl = await admin.storage.from(TRAINING_BUCKET).download(storagePath);
  if (dl.error || !dl.data) {
    return jsonResponse({ error: 'download_failed', detail: dl.error?.message || 'no data' }, 404);
  }
  const blob = dl.data;

  // Forward to iNat as multipart/form-data. Field name is `image`.
  const form = new FormData();
  const ext = storagePath.split('.').pop()?.toLowerCase() || 'jpg';
  form.append('image', blob, `photo.${ext}`);

  let inatResp: Response;
  try {
    inatResp = await fetch(INAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${inatToken}` },
      body: form,
    });
  } catch (e) {
    return jsonResponse({ error: 'inat_network', detail: (e as Error).message }, 502);
  }
  if (inatResp.status === 401 || inatResp.status === 403) {
    return jsonResponse({ error: 'inat_auth', detail: 'iNat token expired or invalid — get a fresh one.' }, 401);
  }
  if (!inatResp.ok) {
    const t = await inatResp.text().catch(() => '');
    return jsonResponse({ error: 'inat_error', status: inatResp.status, detail: t.slice(0, 300) }, 502);
  }
  const inatJson = await inatResp.json().catch(() => null) as any;
  const rawResults: any[] = Array.isArray(inatJson?.results) ? inatJson.results : [];

  // Build a scientific-name → species lookup (binomial + full).
  const byBinomial = new Map<string, SpeciesRef>();
  const byFull = new Map<string, SpeciesRef>();
  for (const s of speciesList) {
    if (!s.scientific) continue;
    byFull.set(normSci(s.scientific), s);
    byBinomial.set(binomial(s.scientific), s);
  }

  // MAP: iNat taxon → our species, keep those that match, best score
  // first. Scores come as 0..100 (combined_score) — normalize to 0..1.
  const seen = new Set<string>();
  const results: { speciesId: string; commonName: string; score: number; taxonName: string }[] = [];
  for (const r of rawResults) {
    const taxon = r?.taxon || {};
    const sciName: string = taxon?.name || '';
    if (!sciName) continue;
    const match = byFull.get(normSci(sciName)) || byBinomial.get(binomial(sciName));
    if (!match || seen.has(match.id)) continue;
    let score = Number(r?.combined_score ?? r?.vision_score ?? r?.score ?? 0);
    if (!Number.isFinite(score)) score = 0;
    if (score > 1) score = score / 100; // 0..100 → 0..1
    score = Math.max(0, Math.min(1, score));
    seen.add(match.id);
    results.push({ speciesId: match.id, commonName: match.commonName, score, taxonName: sciName });
    if (results.length >= 5) break;
  }

  return jsonResponse({ results });
});
