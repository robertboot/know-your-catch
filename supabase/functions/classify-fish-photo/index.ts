/* classify-fish-photo — Edge Function.

   AI photo sorter for the admin Training → Upload "AI sort (misc)"
   mode. Takes one fish photo (downscaled base64) plus the app's
   live species list, has Claude look at the image, and returns the
   best-matching speciesId with an honest confidence — so a folder
   of unsorted photos can be auto-categorized into the training
   queue for one-tap review.

   This exists because Google Lens (which Robert was using to
   hand-verify picks) has no API; Claude vision does the same job
   programmatically with the key that's already in this project's
   secrets.

   Auth model: same as research-species — Authorization: Bearer <jwt>
   verified server-side, admin email allowlist. Never callable from
   an anonymous mobile client.

   REQUIRED SECRETS (already set project-wide for research-species):
       ANTHROPIC_API_KEY
     Standard project envs (auto-injected):
       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY

   Body: {
     imageBase64: string,          // required — raw base64, no data: prefix
     mediaType?: string,           // default image/jpeg
     filename?: string,            // for logging only
     speciesList: [                // full current SPECIES list so the
       { id, commonName,           // model can only ever answer with
         scientific? },            // ids that exist in the app
     ]
   }

   Response: {
     speciesId: string | null,     // null = can't identify / not in list
     confidence: number,           // 0..1
     alternates: string[],         // up to 3 other plausible ids
     note: string,                 // one-liner: what it keyed on / why null
   } */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['robertb1023@me.com'];
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-5';
const ANTHROPIC_VERSION  = '2023-06-01';
const MAX_TOKENS         = 400;

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL      = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'server_misconfigured', detail: 'missing supabase env' }, 500);
  }
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'server_misconfigured', detail: 'missing ANTHROPIC_API_KEY' }, 500);
  }

  // JWT admin gate (same shape as research-species).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) return jsonResponse({ error: 'invalid_auth' }, 401);
  if (!isAdminEmail(userRes.user.email)) return jsonResponse({ error: 'forbidden' }, 403);

  let body: {
    imageBase64?: string;
    mediaType?: string;
    filename?: string;
    speciesList?: SpeciesRef[];
  };
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }

  const imageBase64 = (body.imageBase64 || '').trim();
  const mediaType   = (body.mediaType || 'image/jpeg').trim();
  const speciesList = Array.isArray(body.speciesList) ? body.speciesList : [];
  if (!imageBase64) return jsonResponse({ error: 'missing_fields', detail: 'imageBase64 required' }, 400);
  if (speciesList.length === 0) return jsonResponse({ error: 'missing_fields', detail: 'speciesList required' }, 400);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return jsonResponse({ error: 'bad_media_type', detail: mediaType }, 400);
  }
  // Guard the payload — clients downscale to ~1024px so anything past
  // ~6 MB of base64 means the client skipped the downscale.
  if (imageBase64.length > 6_000_000) {
    return jsonResponse({ error: 'image_too_large', detail: 'downscale before sending' }, 413);
  }

  const validIds = new Set(speciesList.map(s => s.id));
  const listText = speciesList
    .slice(0, 400)
    .map(s => `  ${s.id} — ${s.commonName}${s.scientific ? ` (${s.scientific})` : ''}`)
    .join('\n');

  const systemPrompt = `You are identifying saltwater fish photos for a Gulf-of-Mexico fishing app's training dataset. Each photo will be hand-reviewed afterward, but your label determines which species queue it lands in — a wrong confident label wastes review time, so be honest about uncertainty.

Look at the photo and pick the single best-matching species FROM THE LIST BELOW. Respond with a JSON object only — no prose, no markdown fences:

{
  "speciesId": "<an id from the list, or null>",
  "confidence": <0 to 1 — your honest probability that speciesId is correct>,
  "alternates": ["<up to 3 other plausible ids from the list, best first>"],
  "note": "<one short sentence: the visual cues you keyed on, or why null>"
}

RULES:
1. speciesId MUST be an id from the list, or null. Return null when:
   there is no fish in the photo, several different species share the
   frame with no clear main subject, or the fish is clearly a species
   not in the list (say which in note).
2. Lookalike discipline — this dataset's hard pairs: Red Snapper vs
   Vermilion vs Lane vs Mutton vs Mangrove Snapper; Gag vs Black vs
   Scamp vs Yellowmouth Grouper; the Seriola jacks (Greater/Lesser
   Amberjack, Almaco, Banded Rudderfish); King vs Spanish vs Cero
   Mackerel; the Thunnus tunas. If the distinguishing feature (anal
   fin shape, lateral line spots, gill raker area, tail edge) is not
   visible, lower your confidence accordingly instead of guessing high.
3. confidence is a calibrated probability, not enthusiasm. 0.95 means
   "diagnostic features clearly visible". 0.5 means "coin flip with
   the top alternate".
4. Dead, iced, filleted, or partially-visible fish are common — do
   your best from what's visible.

SPECIES LIST:
${listText}`;

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            { type: 'text', text: 'Identify this fish. JSON only.' },
          ],
        }],
      }),
    });
  } catch (e) {
    return jsonResponse({ error: 'anthropic_network', detail: (e as Error).message }, 502);
  }
  if (!anthropicResp.ok) {
    const bodyText = await anthropicResp.text().catch(() => '');
    return jsonResponse({
      error: 'anthropic_error',
      status: anthropicResp.status,
      detail: bodyText.slice(0, 500),
    }, 502);
  }
  const anthropicJson = await anthropicResp.json().catch(() => null) as any;
  const rawText: string = anthropicJson?.content?.find((b: any) => b?.type === 'text')?.text || '';
  if (!rawText) {
    return jsonResponse({ error: 'empty_response', detail: 'no text block in Anthropic response' }, 502);
  }

  const jsonText = rawText
    .replace(/^```(?:json)?\n/, '')
    .replace(/\n```\s*$/, '')
    .trim();
  let parsed: any;
  try { parsed = JSON.parse(jsonText); }
  catch {
    const m = jsonText.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') {
    return jsonResponse({ error: 'model_bad_json', sample: rawText.slice(0, 300) }, 502);
  }

  // Server-side validation — never let an id outside the list through.
  const rawId = typeof parsed.speciesId === 'string' ? parsed.speciesId.trim() : null;
  const speciesId = rawId && validIds.has(rawId) ? rawId : null;
  const invented = rawId && !validIds.has(rawId);

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));
  if (!speciesId) confidence = 0;

  const alternates = (Array.isArray(parsed.alternates) ? parsed.alternates : [])
    .filter((a: unknown) => typeof a === 'string' && validIds.has(a as string) && a !== speciesId)
    .slice(0, 3);

  let note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 300) : '';
  if (invented) note = `AI answered "${rawId}" which isn't in the species list. ${note}`.trim();

  return jsonResponse({ speciesId, confidence, alternates, note });
});
