/* auto-update-regulations — scheduled Edge Function.

   The autonomous half of the regulations pipeline. Invoked hourly by
   pg_cron (see supabase/regulations-auto-update-schema.sql), it:

     1. Builds the species × jurisdiction grid from the live species
        table and picks the BATCH least-recently-checked pairs.
     2. Researches each pair with Claude + web search against the
        agency's current published season.
     3. Publishes automatically when the evidence is strong:
        confidence 'high' + a citable source URL + a season — the row
        lands status='verified', verified_by='auto-updater',
        auto_published=true. Weak results stay drafts for the admin.
        Existing verified data is NEVER downgraded by a null-heavy
        draft — worst case the pair just gets its last_checked_at
        bumped and rotates to the back of the queue.
     4. Logs one summary row in regs_auto_runs (dashboard Health tile).

   Auth: x-cron-secret header must match the CRON_SECRET env var.
   No user JWT — this runs headless.

   REQUIRED SECRETS:
     ANTHROPIC_API_KEY
     CRON_SECRET

   Body (optional): { batch?: number }   // default 6, max 12 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-5';
const ANTHROPIC_VERSION  = '2023-06-01';
const MAX_TOKENS         = 4000;
const DEFAULT_BATCH      = 6;
const MAX_BATCH          = 12;

// Static jurisdiction descriptors — mirrors src/data.js. These change
// ~never; species come from the live table.
const JURISDICTIONS = [
  { id: 'al_state', name: 'Alabama State Waters',     agency: 'ADCNR',        regsUrl: 'https://www.outdooralabama.com/fishing/saltwater-fishing' },
  { id: 'fl_state', name: 'Florida State Waters',     agency: 'FWC',          regsUrl: 'https://myfwc.com/fishing/saltwater/recreational/' },
  { id: 'ms_state', name: 'Mississippi State Waters', agency: 'MDMR',         regsUrl: 'https://dmr.ms.gov/marine-fisheries/' },
  { id: 'la_state', name: 'Louisiana State Waters',   agency: 'LDWF',         regsUrl: 'https://www.wlf.louisiana.gov/page/recreational-fishing-regulations' },
  { id: 'tx_state', name: 'Texas State Waters',       agency: 'TPWD',         regsUrl: 'https://tpwd.texas.gov/regulations/outdoor-annual/fishing/saltwater-fishing/' },
  { id: 'fed_gulf', name: 'Federal Gulf Waters',      agency: 'NOAA / GMFMC', regsUrl: 'https://www.fisheries.noaa.gov/southeast/recreational-fishing/recreational-fishing-gulf-mexico' },
];

const RANGES: Record<string, [number, number]> = {
  minSizeIn: [0, 120],
  maxSizeIn: [0, 200],
  bagLimit:  [0, 1000],
  boatLimit: [0, 5000],
};

function coerceNumeric(raw: unknown, key: keyof typeof RANGES, rejects: string[]): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = RANGES[key];
  if (n < lo || n > hi) {
    rejects.push(`${key}=${raw} rejected (allowed ${lo}-${hi})`);
    return null;
  }
  return n;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

interface Draft {
  seasonText: string | null;
  minSizeIn:  number | null;
  maxSizeIn:  number | null;
  bagLimit:   number | null;
  boatLimit:  number | null;
  notes:      string | null;
  sourceNote: string;
  sourceUrl:  string | null;
  confidence: 'high' | 'medium' | 'low';
}

async function researchPair(
  apiKey: string,
  species: { id: string; common_name: string; scientific?: string | null; alt_names?: string[] | null },
  jur: typeof JURISDICTIONS[number],
): Promise<Draft | { error: string }> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are the automated regulations researcher for a US saltwater fishing app. Today is ${todayStr}. You have a web search tool — ALWAYS use it to check the agency's currently published season before answering. Your output updates a live database that anglers rely on to stay legal.

Return JSON ONLY in your final message:

{
  "seasonText":  "<current season with dates + year, 'Year-round', or null>",
  "minSizeIn":   <inches or null>,
  "maxSizeIn":   <inches for slot limits, or null>,
  "bagLimit":    <per angler per day, or null>,
  "boatLimit":   <per vessel, or null>,
  "notes":       "<short explanation or null>",
  "sourceNote":  "<REQUIRED: what page you found, retrieved ${todayStr}>",
  "sourceUrl":   "<the exact agency URL your season came from, or null>",
  "confidence":  "<high | medium | low>"
}

CONFIDENCE CONTRACT — this gates automatic publishing:
- "high" ONLY when you found the CURRENT season on an official agency
  page (the .gov / state agency site, not a blog or forum) via web
  search AND the numeric limits corroborate. High-confidence output is
  published to anglers WITHOUT human review — be strict.
- "medium" when search found partial or slightly stale info.
- "low" when search failed or sources conflict.

RULES:
1. Search the agency page first. Include the year in seasonText
   ("June 1 - October 26, 2026"). Write dates as "Mon D, YYYY".
2. Never guess numerics. null over wrong — a wrong bag limit is a
   legal failure for a real person.
3. Federal vs state waters differ; research exactly the jurisdiction
   given. Gulf red snapper state seasons are delegated per-state.
4. HMS species (tunas, billfish, most sharks): NOAA HMS rules apply
   in all jurisdictions; note it in sourceNote.
5. sourceUrl must be the real page you drew the season from — it
   becomes the citation shown to anglers.

Final message: the JSON object only.`;

  const altSuffix = Array.isArray(species.alt_names) && species.alt_names.length
    ? ` (also known as: ${species.alt_names.join(', ')})` : '';
  const userMessage = [
    `Species: ${species.common_name}${species.scientific ? ` (${species.scientific})` : ''}${altSuffix}`,
    `Jurisdiction: ${jur.name} — agency ${jur.agency}`,
    `Agency page to check first: ${jur.regsUrl}`,
  ].join('\n');

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      }),
    });
  } catch (e) {
    return { error: `network: ${(e as Error).message}` };
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { error: `anthropic ${resp.status}: ${t.slice(0, 200)}` };
  }
  const json = await resp.json().catch(() => null) as any;
  const textBlocks = Array.isArray(json?.content)
    ? json.content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    : [];
  const rawText: string = textBlocks.length ? textBlocks[textBlocks.length - 1].text : '';
  if (!rawText) return { error: 'empty response' };

  const stripped = rawText.replace(/^```(?:json)?\n/, '').replace(/\n```\s*$/, '').trim();
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(stripped); }
  catch {
    const m = stripped.match(/\{[\s\S]*\}/);
    try { parsed = JSON.parse(m ? m[0] : ''); }
    catch { return { error: `bad json: ${rawText.slice(0, 150)}` }; }
  }

  const rejects: string[] = [];
  const minSizeIn = coerceNumeric(parsed.minSizeIn, 'minSizeIn', rejects);
  let   maxSizeIn = coerceNumeric(parsed.maxSizeIn, 'maxSizeIn', rejects);
  const bagLimit  = coerceNumeric(parsed.bagLimit,  'bagLimit',  rejects);
  const boatLimit = coerceNumeric(parsed.boatLimit, 'boatLimit', rejects);
  if (minSizeIn != null && maxSizeIn != null && maxSizeIn < minSizeIn) {
    rejects.push(`maxSizeIn ${maxSizeIn} < minSizeIn ${minSizeIn} — dropped`);
    maxSizeIn = null;
  }
  const seasonText = typeof parsed.seasonText === 'string' && parsed.seasonText.trim() ? parsed.seasonText.trim() : null;
  const notes      = typeof parsed.notes      === 'string' && parsed.notes.trim()      ? parsed.notes.trim()      : null;
  const rawUrl     = typeof parsed.sourceUrl  === 'string' ? parsed.sourceUrl.trim() : '';
  const sourceUrl  = /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
  const conf       = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
    ? parsed.confidence : 'low';
  const noteParts  = [typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '', ...rejects].filter(Boolean);

  return {
    seasonText, minSizeIn, maxSizeIn, bagLimit, boatLimit, notes,
    sourceNote: noteParts.join(' ') || 'No source note returned.',
    sourceUrl,
    confidence: conf,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL      = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  const CRON_SECRET       = Deno.env.get('CRON_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: 'server_misconfigured' }, 500);
  if (!ANTHROPIC_API_KEY)             return jsonResponse({ error: 'missing ANTHROPIC_API_KEY' }, 500);
  if (!CRON_SECRET)                   return jsonResponse({ error: 'missing CRON_SECRET' }, 500);

  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  let batch = DEFAULT_BATCH;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.batch)) batch = Math.max(1, Math.min(MAX_BATCH, Math.floor(body.batch)));
  } catch { /* empty body is fine */ }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Build the pair grid: live species × static jurisdictions, joined
  // against existing regulation rows for rotation ordering.
  const { data: speciesRows, error: spErr } = await db.from('species')
    .select('id, common_name, scientific, alt_names, is_active');
  if (spErr) return jsonResponse({ error: `species query: ${spErr.message}` }, 500);
  const activeSpecies = (speciesRows || []).filter(s => s.is_active !== false);

  const { data: regRows, error: regErr } = await db.from('regulations')
    .select('id, species_id, jurisdiction_id, status, season_text, min_size_in, max_size_in, bag_limit, boat_limit, last_checked_at');
  if (regErr) return jsonResponse({ error: `regulations query: ${regErr.message}` }, 500);
  const regByPair = new Map<string, NonNullable<typeof regRows>[number]>();
  for (const r of regRows || []) regByPair.set(`${r.species_id}|${r.jurisdiction_id}`, r);

  const pairs: { sp: typeof activeSpecies[number]; jur: typeof JURISDICTIONS[number]; row: any }[] = [];
  for (const sp of activeSpecies) {
    for (const jur of JURISDICTIONS) {
      pairs.push({ sp, jur, row: regByPair.get(`${sp.id}|${jur.id}`) || null });
    }
  }
  // Least-recently-checked first; never-checked (null) leads.
  pairs.sort((a, b) => {
    const ta = a.row?.last_checked_at ? Date.parse(a.row.last_checked_at) : 0;
    const tb = b.row?.last_checked_at ? Date.parse(b.row.last_checked_at) : 0;
    return ta - tb;
  });
  const work = pairs.slice(0, batch);

  const nowIso = new Date().toISOString();
  let published = 0, drafted = 0, unchanged = 0, failed = 0;
  const detail: Record<string, string>[] = [];

  for (const { sp, jur, row } of work) {
    const draft = await researchPair(ANTHROPIC_API_KEY, sp, jur);
    const pairKey = `${sp.id} × ${jur.id}`;

    if ('error' in draft) {
      failed += 1;
      detail.push({ pair: pairKey, outcome: 'failed', reason: draft.error });
      // Bump last_checked_at on an existing row so a persistent
      // failure doesn't pin this pair at the head of the queue.
      if (row) await db.from('regulations').update({ last_checked_at: nowIso }).eq('id', row.id);
      continue;
    }

    const strong = draft.confidence === 'high'
      && !!draft.sourceUrl
      && !!draft.seasonText
      && (draft.bagLimit != null || draft.minSizeIn != null);

    const hasAnyData = !!draft.seasonText || draft.minSizeIn != null || draft.bagLimit != null;

    if (strong) {
      // Auto-publish. Upsert on the (species,jurisdiction) unique key.
      const { error } = await db.from('regulations').upsert({
        ...(row ? { id: row.id } : {}),
        species_id: sp.id,
        jurisdiction_id: jur.id,
        season_text: draft.seasonText,
        min_size_in: draft.minSizeIn,
        max_size_in: draft.maxSizeIn,
        bag_limit:   draft.bagLimit,
        boat_limit:  draft.boatLimit,
        notes:       draft.notes,
        source_note: draft.sourceNote,
        source_url:  draft.sourceUrl,
        status: 'verified',
        drafted_by: 'ai',
        drafted_at: nowIso,
        verified_by: 'auto-updater',
        verified_at: nowIso,
        auto_published: true,
        last_checked_at: nowIso,
      }, { onConflict: 'species_id,jurisdiction_id' });
      if (error) { failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message }); }
      else       { published += 1; detail.push({ pair: pairKey, outcome: 'published', season: draft.seasonText || '' }); }
      continue;
    }

    if (row && row.status === 'verified') {
      // NEVER downgrade verified data with a weak draft — just note
      // the check happened and move on. The admin's verified values
      // (or a prior auto-publish) stay live.
      const { error } = await db.from('regulations')
        .update({ last_checked_at: nowIso })
        .eq('id', row.id);
      if (error) { failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message }); }
      else       { unchanged += 1; detail.push({ pair: pairKey, outcome: 'unchanged', confidence: draft.confidence }); }
      continue;
    }

    // Non-verified (or missing) row + weak draft → store as draft so
    // the admin sees it in the Regulations tab, and the pair rotates.
    const { error } = await db.from('regulations').upsert({
      ...(row ? { id: row.id } : {}),
      species_id: sp.id,
      jurisdiction_id: jur.id,
      ...(hasAnyData ? {
        season_text: draft.seasonText,
        min_size_in: draft.minSizeIn,
        max_size_in: draft.maxSizeIn,
        bag_limit:   draft.bagLimit,
        boat_limit:  draft.boatLimit,
        notes:       draft.notes,
      } : {}),
      source_note: draft.sourceNote,
      source_url:  draft.sourceUrl,
      status: row?.status === 'stale' ? 'stale' : 'draft',
      drafted_by: 'ai',
      drafted_at: nowIso,
      auto_published: false,
      last_checked_at: nowIso,
    }, { onConflict: 'species_id,jurisdiction_id' });
    if (error) { failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message }); }
    else       { drafted += 1; detail.push({ pair: pairKey, outcome: 'drafted', confidence: draft.confidence }); }
  }

  await db.from('regs_auto_runs').insert({
    checked: work.length, published, drafted, unchanged, failed,
    detail,
  });

  return jsonResponse({ ok: true, checked: work.length, published, drafted, unchanged, failed });
});
