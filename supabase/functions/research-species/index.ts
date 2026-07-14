/* research-species — Edge Function.

   AI-powered pre-fill for the admin Quick Add species flow.
   Reduces species entry from ~10 min (bouncing between FishBase +
   iNaturalist for habitat, key IDs, and lookalikes) to ~30 sec of
   review + edit.

   Auth model: same as send-launch-email — Authorization: Bearer <jwt>
   verified server-side, admin email allowlist. Never callable from
   an anonymous mobile client.

   REQUIRED SECRETS (set once in the Supabase dashboard →
     Edge Functions → research-species → Secrets):
       ANTHROPIC_API_KEY   — Anthropic Messages API key
     Standard project envs (auto-injected):
       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY

   Body: {
     commonName: string,           // required — user's typed name
     scientificName?: string,      // optional — narrows the model's guess
     existingSpeciesIds: [         // full current SPECIES list so the
       { id: string, commonName },  // model can pick lookalikes that
     ]                              // ACTUALLY exist in the app.
   }

   Response: {
     scientific?: string,
     category?: string,           // matches CATEGORIES key
     altNames: string[],
     habitat: string,
     keyIds: string[],
     lookalikes: string[],        // always a subset of existingSpeciesIds
     sourceNote?: string,         // one-line model self-assessment
   } */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ADMIN_EMAILS = ['robertb1023@me.com'];
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION  = '2023-06-01';
const MAX_TOKENS         = 1500;

// Kept in sync with data.js CATEGORIES. If a new category is added
// there, add it here so the model can pick it up. Uncommon to change.
const CATEGORIES = [
  'snapper', 'grouper', 'tilefish', 'jacks', 'mackerel',
  'tuna', 'billfish', 'trigger', 'sharks', 'cobia',
  'wahoo', 'cod', 'sturgeon', 'flatfish', 'bait', 'reef',
];

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

interface SpeciesRef { id: string; commonName: string }

interface ResearchResult {
  scientific?: string;
  category?: string;
  altNames: string[];
  habitat: string;
  keyIds: string[];
  lookalikes: string[];
  sourceNote?: string;
}

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

  // JWT admin gate (same shape as send-launch-email).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) return jsonResponse({ error: 'invalid_auth' }, 401);
  if (!isAdminEmail(userRes.user.email)) return jsonResponse({ error: 'forbidden' }, 403);

  let body: {
    commonName?: string;
    scientificName?: string;
    existingSpeciesIds?: SpeciesRef[];
  };
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }
  const commonName = (body.commonName || '').trim();
  const scientificHint = (body.scientificName || '').trim();
  const existingList = Array.isArray(body.existingSpeciesIds) ? body.existingSpeciesIds : [];
  if (!commonName) return jsonResponse({ error: 'missing_fields', detail: 'commonName required' }, 400);

  const existingIds = new Set(existingList.map(s => s.id));
  const existingListSample = existingList
    .slice(0, 400)
    .map(s => `  ${s.id} — ${s.commonName}`).join('\n');

  const systemPrompt = `You are pre-filling a species record for a fishing app that focuses on Gulf-of-America saltwater species (with some broader coverage).

You will receive a fish species name and produce a JSON object matching this exact schema — NO wrapping prose, NO markdown fences, JSON only:

{
  "scientific": "<Genus species>",
  "category": "<one of: ${CATEGORIES.join(', ')}>",
  "altNames": ["regional or common alt name", "..."],
  "habitat": "<one-paragraph habitat description>",
  "keyIds": ["<visual ID cue>", "<visual ID cue>", "<visual ID cue>"],
  "lookalikes": ["<species_id from the provided list>", "..."],
  "sourceNote": "<one sentence: how confident you are and what your source basis was>"
}

RULES:

1. keyIds must be 3–5 short, visual, angler-relevant identifying features
   — the kind of thing you can check in a hand-held photo of the fish on
   the deck. Examples: "Deep red iris", "Sharp pointed anal fin",
   "Yellow tail edge". DO NOT include scientific characters like tooth
   counts, vertebral counts, or gill raker counts unless they'd be
   visible in a standard angler photo.

2. lookalikes MUST be species_ids drawn from this exact list of species
   already in the app. If a lookalike species doesn't have an id in the
   list, do NOT include it and instead mention it in sourceNote:

${existingListSample}
   ${existingList.length > 400 ? `\n   (list truncated at 400 of ${existingList.length} entries)` : ''}

3. category must be one of the enum values above. If uncertain, pick the
   closest match. If genuinely no fit, use "reef" as a fallback.

4. If confidence is low on any field, return SPARSE fields — empty arrays,
   empty strings — rather than fabricating. It is better to leave a field
   blank than to invent a plausible-sounding wrong answer.

5. altNames: 3-8 common regional or vernacular names. Skip if uncertain.

6. habitat: 2-4 sentences on depth range, structure preference (reefs,
   wrecks, sand, mangroves, etc.), and any relevant migration or
   seasonal notes. Angler-focused; skip zoology jargon.

7. sourceNote: one sentence assessing your confidence. Example:
   "Common Gulf snapper; well-documented at FishBase and NOAA — high
   confidence on habitat and lookalikes." Or if low: "Uncertain
   identification; the common name may refer to multiple species."

Return the JSON object only.`;

  const userMessage = scientificHint
    ? `Common name: ${commonName}\nScientific name (user-provided): ${scientificHint}`
    : `Common name: ${commonName}`;

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
        messages: [{ role: 'user', content: userMessage }],
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
  const contentBlock = anthropicJson?.content?.[0];
  const rawText: string = contentBlock?.text || '';
  if (!rawText) {
    return jsonResponse({ error: 'empty_response', detail: 'no content block in Anthropic response' }, 502);
  }

  // Model was asked for JSON only; be defensive about markdown fences.
  const jsonText = rawText
    .replace(/^```(?:json)?\n/, '')
    .replace(/\n```\s*$/, '')
    .trim();
  let parsed: Partial<ResearchResult>;
  try { parsed = JSON.parse(jsonText); }
  catch {
    return jsonResponse({
      error: 'model_bad_json',
      detail: 'model returned non-JSON',
      sample: rawText.slice(0, 300),
    }, 502);
  }

  // Filter lookalikes to those actually in the app. Track dropped
  // ones so we can note them for the admin.
  const rawLookalikes = Array.isArray(parsed.lookalikes) ? parsed.lookalikes : [];
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const la of rawLookalikes) {
    if (typeof la !== 'string') continue;
    if (existingIds.has(la)) kept.push(la);
    else dropped.push(la);
  }

  // Filter category to the allowed enum.
  const categoryRaw = (parsed.category || '').trim();
  const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : '';

  const result: ResearchResult = {
    scientific: (parsed.scientific || '').trim() || undefined,
    category:   category || undefined,
    altNames:   Array.isArray(parsed.altNames)
                  ? parsed.altNames.map((n: unknown) => String(n || '').trim()).filter(Boolean).slice(0, 12)
                  : [],
    habitat:    (parsed.habitat || '').trim(),
    keyIds:     Array.isArray(parsed.keyIds)
                  ? parsed.keyIds.map((k: unknown) => String(k || '').trim()).filter(Boolean).slice(0, 5)
                  : [],
    lookalikes: kept.slice(0, 6),
    sourceNote: (parsed.sourceNote || '').trim() || undefined,
  };
  if (dropped.length > 0) {
    const droppedList = dropped.slice(0, 6).join(', ');
    const note = `Also considered: ${droppedList}, but not currently in the app's species list.`;
    result.sourceNote = result.sourceNote
      ? `${result.sourceNote} ${note}`
      : note;
  }

  return jsonResponse(result);
});
