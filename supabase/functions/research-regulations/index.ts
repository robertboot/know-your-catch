/* research-regulations — Edge Function.

   AI-drafted regulations for the admin verification workflow. Same
   admin JWT + email allowlist as the other admin functions. Returns
   a JSON draft object with strict server-side validation: numeric
   fields outside plausible ranges are coerced to null and surfaced
   in sourceNote. Any field the AI can't confidently fill returns
   null — never a guess. The result is ALWAYS a draft; verification
   is a separate, human-only step.

   Auth: Bearer JWT, admin allowlist.

   REQUIRED SECRETS (set once in Supabase dashboard):
     ANTHROPIC_API_KEY

   Body: {
     speciesId:      string,        // e.g. 'red_snapper'
     speciesName:    string,        // 'Red Snapper' (client provides common name)
     scientificName: string?,       // 'Lutjanus campechanus'
     altNames:       string[]?,     // ['Sow Snapper', 'Genuine Red']
     jurisdictionId: string,        // 'fed_gulf'
     jurisdictionName: string,      // 'Federal Gulf Waters'
     jurisdictionAgency: string,    // 'NOAA / GMFMC'
     jurisdictionRegsUrl: string?,  // agency landing page
   }

   Response: {
     seasonText?:  string | null,
     minSizeIn?:   number | null,
     maxSizeIn?:   number | null,
     bagLimit?:    number | null,
     boatLimit?:   number | null,
     notes?:       string | null,
     sourceNote:   string,    // required — how the AI arrived at the values
   } */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ANTHROPIC_ENDPOINT, ANTHROPIC_MODEL, ANTHROPIC_VERSION,
  coerceNumeric, jsonResponse as sharedJsonResponse,
  finalTextBlock, salvageJson,
} from '../_shared/regs-shared.ts';

const ADMIN_EMAILS = ['robertb1023@me.com'];
// Web search interleaves reasoning + search-result digestion into the
// output stream before the final JSON, so this needs headroom well
// beyond the ~200-token answer itself.
const MAX_TOKENS = 4000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Browser-invoked function → every response carries CORS headers.
function jsonResponse(body: unknown, status = 200) {
  return sharedJsonResponse(body, status, corsHeaders);
}

function isAdminEmail(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

interface ResearchBody {
  speciesId?: string;
  speciesName?: string;
  scientificName?: string;
  altNames?: string[];
  jurisdictionId?: string;
  jurisdictionName?: string;
  jurisdictionAgency?: string;
  jurisdictionRegsUrl?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL      = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: 'server_misconfigured', detail: 'missing supabase env' }, 500);
  if (!ANTHROPIC_API_KEY)             return jsonResponse({ error: 'server_misconfigured', detail: 'missing ANTHROPIC_API_KEY' }, 500);

  // Admin JWT gate.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.email) return jsonResponse({ error: 'invalid_auth' }, 401);
  if (!isAdminEmail(userRes.user.email)) return jsonResponse({ error: 'forbidden' }, 403);

  let body: ResearchBody;
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }
  const speciesId   = (body.speciesId   || '').trim();
  const speciesName = (body.speciesName || '').trim();
  const jurisdictionId   = (body.jurisdictionId   || '').trim();
  const jurisdictionName = (body.jurisdictionName || '').trim();
  const jurisdictionAgency  = (body.jurisdictionAgency  || '').trim();
  const jurisdictionRegsUrl = (body.jurisdictionRegsUrl || '').trim();
  if (!speciesId || !speciesName || !jurisdictionId || !jurisdictionName) {
    return jsonResponse({ error: 'missing_fields' }, 400);
  }

  const altSuffix = Array.isArray(body.altNames) && body.altNames.length
    ? ` (also known as: ${body.altNames.join(', ')})`
    : '';
  const scientific = (body.scientificName || '').trim();

  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are drafting a recreational-fishing regulation record for a US saltwater fishing app. Compliance-critical output. A wrong bag limit or size is a real-world safety and legal failure — but so is a MISSING season for a heavily-fished species whose season is publicly documented: the app then can't tell an angler whether they can keep the fish at all.

Today's date is ${todayStr}. You have a web search tool — USE IT. Search the agency's current-season page for this species + jurisdiction before answering. Seasons change every year; your training data is stale by definition.

After researching, return a JSON object matching this exact schema — JSON ONLY in your final response, no wrapping prose, no markdown fences:

{
  "seasonText":  "<'Year-round' | 'Jun 1 - Aug 31' | free-text season description, or null>",
  "minSizeIn":   <number of inches, or null>,
  "maxSizeIn":   <number of inches for slot limits, or null>,
  "bagLimit":    <integer per angler per day, or null>,
  "boatLimit":   <integer per vessel, or null>,
  "notes":       "<short freeform explanation, or null>",
  "sourceNote":  "<REQUIRED: which agency page / publication you found and how confident you are>"
}

HARD RULES:

1. SEARCH FIRST for the season. For major managed species (snappers,
   groupers, amberjack, triggerfish, red drum, flounder…) the current
   season is published on the agency site — find it and return it with
   the year included (e.g. "Opens May 22, 2026" or
   "Jun 1 - Aug 31, 2026"). Return null for seasonText ONLY when the
   search genuinely cannot resolve a current season — and then say in
   sourceNote what you searched and why it didn't resolve.

2. For numeric fields (sizes, limits): if the search + your knowledge
   do NOT establish the current value with high confidence, return
   null. Do NOT guess numbers. A missing number is honest; a wrong
   number is a compliance failure.

3. sourceNote is REQUIRED. Cite the specific page or publication you
   found ("MDMR Tails n' Scales red snapper page, retrieved today",
   "FWC saltwater recreational regs — Snapper"), with a URL when you
   have one, and state your confidence. If web search failed and
   you're on training data alone, say so and prefix with "STALE:".

4. Federal vs state waters have DIFFERENT limits. Do not mix them.
   The jurisdiction is exactly what the caller specified. Gulf red
   snapper state seasons are delegated — each state sets its own
   private-recreational season; search that state's agency, not NOAA.

5. If the species is HMS (Highly Migratory — tunas, billfish,
   swordfish, most sharks), federal NOAA HMS rules apply everywhere
   and state jurisdictions do NOT override. In that case return
   the NOAA HMS limits and note it in sourceNote.

6. Slot limits (both minSizeIn and maxSizeIn set) are common for
   drum, snook, redfish, etc. Set both when they apply.

7. Season formats: use "Year-round" for open all year; "Jun 1 - Aug 31, 2026"
   for date ranges (include the year); free text for complex seasons
   ("Open May 22 - Jul 6, 2026, then Fri-Sun through Labor Day").
   Write dates as "Mon D" — the app parses them for live open/closed
   status.

8. bagLimit is PER ANGLER PER DAY. boatLimit is PER VESSEL. Do NOT
   confuse them. If only one is specified in the source, set the
   other to null.

Your FINAL message must be the JSON object only.`;

  const userMessage = [
    `Species: ${speciesName}${scientific ? ` (${scientific})` : ''}${altSuffix}`,
    `Species id: ${speciesId}`,
    `Jurisdiction: ${jurisdictionName} — id ${jurisdictionId}`,
    jurisdictionAgency  ? `Agency: ${jurisdictionAgency}` : null,
    jurisdictionRegsUrl ? `Agency source (verify against this): ${jurisdictionRegsUrl}` : null,
  ].filter(Boolean).join('\n');

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
        // Server-side web search — the whole point: current-year
        // seasons live on agency pages, not in training data. The
        // API runs searches server-side and the model cites what it
        // found. max_uses caps runaway search loops per draft.
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      }),
    });
  } catch (e) {
    return jsonResponse({ error: 'anthropic_network', detail: (e as Error).message }, 502);
  }
  if (!anthropicResp.ok) {
    const t = await anthropicResp.text().catch(() => '');
    return jsonResponse({ error: 'anthropic_error', status: anthropicResp.status, detail: t.slice(0, 500) }, 502);
  }
  const anthropicJson = await anthropicResp.json().catch(() => null) as any;
  const rawText = finalTextBlock(anthropicJson);
  if (!rawText) return jsonResponse({ error: 'empty_response' }, 502);

  const parsed = salvageJson(rawText);
  if (!parsed) return jsonResponse({ error: 'model_bad_json', sample: rawText.slice(0, 300) }, 502);

  // Validate numerics against plausibility bounds.
  const rejects: string[] = [];
  const minSizeIn = coerceNumeric(parsed.minSizeIn, 'minSizeIn', rejects);
  const maxSizeIn = coerceNumeric(parsed.maxSizeIn, 'maxSizeIn', rejects);
  const bagLimit  = coerceNumeric(parsed.bagLimit,  'bagLimit',  rejects);
  const boatLimit = coerceNumeric(parsed.boatLimit, 'boatLimit', rejects);

  // Additional sanity: if both sizes set, max >= min.
  let sizeFlip = false;
  if (minSizeIn != null && maxSizeIn != null && maxSizeIn < minSizeIn) {
    rejects.push(`AI returned maxSizeIn=${maxSizeIn} < minSizeIn=${minSizeIn} — dropped max as implausible.`);
    sizeFlip = true;
  }

  const seasonText = typeof parsed.seasonText === 'string' && parsed.seasonText.trim() ? parsed.seasonText.trim() : null;
  const notes      = typeof parsed.notes      === 'string' && parsed.notes.trim()      ? parsed.notes.trim()      : null;
  const modelSourceNote = typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '';

  const sourceNoteParts = [modelSourceNote, ...rejects].filter(Boolean);
  const sourceNote = sourceNoteParts.length
    ? sourceNoteParts.join(' ')
    : 'Model returned no source note.';

  return jsonResponse({
    seasonText,
    minSizeIn,
    maxSizeIn: sizeFlip ? null : maxSizeIn,
    bagLimit,
    boatLimit,
    notes,
    sourceNote,
  });
});
