/* identify-fish — Edge Function (USER-callable).

   The app's online Fish ID. When a signed-in angler's phone has
   network, the photo-confirm flow calls this instead of the small
   on-device model (Big Red): Claude vision gives a much stronger ID,
   AND every call feeds the photo back into the training queue as a
   PENDING row — confident IDs under their species, uncertain ones
   under the misc bucket — so no paid call is wasted and Big Red keeps
   learning from real user photos. Offline, or for signed-out users,
   the app silently falls back to the on-device model.

   Auth: any authenticated Supabase user (JWT verified server-side).
   NOT admin-gated — but rate-limited per user per day to cap cost and
   abuse (see DAILY_CAP). The ingest write uses the service role, so
   it works regardless of the training buckets' admin-only RLS.

   REQUIRED SECRETS (already set project-wide):
       ANTHROPIC_API_KEY
     Standard project envs (auto-injected):
       SUPABASE_URL
       SUPABASE_SERVICE_ROLE_KEY

   Requires the ai_identify_usage table — see
   supabase/ai-identify-usage-schema.sql.

   Body: {
     imageBase64: string,          // required — raw base64, no data: prefix
     mediaType?: string,           // default image/jpeg
     speciesList: [{ id, commonName, scientific? }],
   }

   Response: {
     speciesId: string | null,
     confidence: number,           // 0..1
     alternates: string[],
     note: string,
     source: 'ai',                 // marks this as the cloud ID
   } */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-5';
const ANTHROPIC_VERSION  = '2023-06-01';
const MAX_TOKENS         = 400;

// Per-user soft cap. Exceeding it returns 429 and the app falls back
// to the on-device model — no hard failure for the user.
const DAILY_CAP = 60;
// At/above this confidence a photo is filed under the identified
// species; below it the photo is still KEPT but filed under the misc
// bucket for manual sorting. Every paid call keeps its photo either way.
const INGEST_MIN_CONF = 0.55;
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

interface SpeciesRef { id: string; commonName: string; scientific?: string }

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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

  // Auth: any signed-in user (not admin-gated).
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ error: 'no_auth' }, 401);
  const jwt = authHeader.slice(7);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userRes?.user?.id) return jsonResponse({ error: 'invalid_auth' }, 401);
  const userId = userRes.user.id;
  const userEmail = userRes.user.email || null;

  let body: {
    imageBase64?: string;
    mediaType?: string;
    speciesList?: SpeciesRef[];
  };
  try { body = await req.json(); } catch {
    return jsonResponse({ error: 'bad_json' }, 400);
  }

  const imageBase64 = (body.imageBase64 || '').trim();
  const mediaType   = (body.mediaType || 'image/jpeg').trim().toLowerCase();
  const speciesList = Array.isArray(body.speciesList) ? body.speciesList : [];
  if (!imageBase64) return jsonResponse({ error: 'missing_fields', detail: 'imageBase64 required' }, 400);
  if (speciesList.length === 0) return jsonResponse({ error: 'missing_fields', detail: 'speciesList required' }, 400);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) {
    return jsonResponse({ error: 'bad_media_type', detail: mediaType }, 400);
  }
  if (imageBase64.length > 6_000_000) {
    return jsonResponse({ error: 'image_too_large' }, 413);
  }

  // --- Rate limit: per user, per UTC day. Soft — a 429 just makes the
  //     app fall back to the on-device model. ---
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const { data: usageRow } = await admin
    .from('ai_identify_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();
  const usedToday = usageRow?.count || 0;
  if (usedToday >= DAILY_CAP) {
    return jsonResponse({ error: 'rate_limited', detail: `daily cap ${DAILY_CAP} reached` }, 429);
  }

  const validIds = new Set(speciesList.map(s => s.id));
  const listText = speciesList
    .slice(0, 400)
    .map(s => `  ${s.id} — ${s.commonName}${s.scientific ? ` (${s.scientific})` : ''}`)
    .join('\n');

  const systemPrompt = `You are identifying a saltwater fish photo for a Gulf-of-Mexico fishing app. An angler just photographed their catch and wants to know what it is so they can check size and bag regulations — a wrong confident answer can put them out of compliance, so be honest about uncertainty.

Pick the single best-matching species FROM THE LIST BELOW. Respond with a JSON object only — no prose, no markdown fences:

{
  "speciesId": "<an id from the list, or null>",
  "confidence": <0 to 1 — your honest probability that speciesId is correct>,
  "alternates": ["<up to 4 other plausible ids from the list, best first>"],
  "note": "<one short sentence: the visual cues you keyed on; OR when speciesId is null, name the fish you believe it is>"
}

RULES:
1. speciesId MUST be an id from the list, or null. Return null when there is no fish, several species share the frame with no clear subject, or the fish is clearly not in the list. When you return null BECAUSE the fish isn't in the list, still identify it in the note by its common name if you can (e.g. "Looks like a lookdown — not in the provided list."). A confident real-species name there is useful even though we have no rules for it.
2. Lookalike discipline — hard pairs to separate carefully: Red vs Vermilion vs Lane vs Mutton vs Mangrove Snapper; Gag vs Black vs Scamp vs Yellowmouth Grouper; the Seriola jacks (Greater/Lesser Amberjack, Almaco, Banded Rudderfish); King vs Spanish vs Cero Mackerel; the Thunnus tunas. If the distinguishing feature isn't visible, lower confidence instead of guessing high.
3. confidence is a calibrated probability, not enthusiasm. Provide alternates so the angler can correct you.
4. Dead, iced, or partially-visible fish are normal — do your best from what's visible.

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
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
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
    return jsonResponse({ error: 'anthropic_error', status: anthropicResp.status, detail: bodyText.slice(0, 300) }, 502);
  }
  const anthropicJson = await anthropicResp.json().catch(() => null) as any;
  const rawText: string = anthropicJson?.content?.find((b: any) => b?.type === 'text')?.text || '';
  if (!rawText) return jsonResponse({ error: 'empty_response' }, 502);

  const jsonText = rawText.replace(/^```(?:json)?\n/, '').replace(/\n```\s*$/, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(jsonText); }
  catch {
    const m = jsonText.match(/\{[\s\S]*\}/);
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object') {
    return jsonResponse({ error: 'model_bad_json', sample: rawText.slice(0, 200) }, 502);
  }

  const rawId = typeof parsed.speciesId === 'string' ? parsed.speciesId.trim() : null;
  const speciesId = rawId && validIds.has(rawId) ? rawId : null;
  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));
  if (!speciesId) confidence = 0;
  const alternates = (Array.isArray(parsed.alternates) ? parsed.alternates : [])
    .filter((a: unknown) => typeof a === 'string' && validIds.has(a as string) && a !== speciesId)
    .slice(0, 4);
  const note = typeof parsed.note === 'string' ? parsed.note.trim().slice(0, 300) : '';

  // Background work — runs AFTER the response is sent so the angler's
  // ID isn't delayed by the counter bump or the training upload.
  // EdgeRuntime.waitUntil keeps the isolate alive until it resolves.
  const background = (async () => {
    // Bump the per-day usage counter.
    try {
      await admin.from('ai_identify_usage').upsert(
        { user_id: userId, day: today, count: usedToday + 1, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,day' },
      );
    } catch { /* soft cap — a missed bump just allows one extra call */ }

    // Feed Big Red: EVERY paid Claude ID keeps its photo. Since the
    // angler is paying for each call, nothing is thrown away.
    //   - confident, in-list species → filed under that species.
    //   - uncertain / not-in-list     → filed under the misc bucket
    //     (_unassigned) so it lands in Review for you to sort with the
    //     AI-sort / swipe tools. It never counts toward a species'
    //     verified training data until you categorize it.
    // All land as PENDING; Review is the quality gate before any
    // retrain. Content-hashed path → the same photo is one row.
    try {
      const confident = !!(speciesId && confidence >= INGEST_MIN_CONF);
      const targetSpecies = confident ? speciesId! : '_unassigned';

      // Make sure the FK target row exists (misc bucket may not have a
      // species row yet on a fresh DB). Best-effort upsert; the real
      // taxonomy row for a confident species already exists.
      if (!confident) {
        await admin.from('species').upsert(
          { id: '_unassigned', common_name: '— Misc / needs species', category: '_admin' },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      }

      const bytes = base64ToBytes(imageBase64);
      const hash = await sha256Hex(imageBase64);
      const ext = mediaType === 'image/png' ? 'png'
        : mediaType === 'image/webp' ? 'webp' : 'jpg';
      const storagePath = `${targetSpecies}/appid_${hash.slice(0, 32)}.${ext}`;
      const up = await admin.storage.from(TRAINING_BUCKET)
        .upload(storagePath, bytes, { contentType: mediaType, upsert: false });
      // 'already exists' → this photo is already queued; stop here.
      if (up.error && !/exist/i.test(up.error.message || '')) return;
      await admin.from('training_images').insert({
        id: crypto.randomUUID(),
        species_id: targetSpecies,
        storage_path: storagePath,
        source: 'app_identify',
        // Keep Claude's best guess even when we filed it under misc, so
        // Review shows what the model thought.
        original_species_id: confident ? null : (speciesId || null),
        status: 'pending',
        uploaded_by: userEmail,
      });
    } catch { /* best-effort ingest */ }
  })();
  // @ts-ignore — EdgeRuntime is a Supabase runtime global.
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(background);

  return jsonResponse({ speciesId, confidence, alternates, note, source: 'ai' });
});
