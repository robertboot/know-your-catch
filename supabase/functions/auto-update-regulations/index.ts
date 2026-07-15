/* auto-update-regulations — scheduled Edge Function.

   The autonomous half of the regulations pipeline. Invoked hourly by
   pg_cron (see supabase/regulations-auto-update-schema.sql), it:

     1. Builds the species × jurisdiction grid from the live species
        table and picks the BATCH least-recently-checked pairs.
     2. Researches each pair with Claude + web search against the
        agency's current published season (concurrency 3, so a batch
        fits inside the edge-function wall-clock).
     3. Publishes automatically when the evidence is strong:
        confidence 'high' + a citable source URL + a season — the row
        lands status='verified', verified_by='auto-updater',
        auto_published=true. Weak results stay drafts for the admin.
        SAFETY RAILS:
          - a draft null NEVER overwrites an existing value — updates
            coalesce field-by-field against the current row
          - 'disputed' rows are never touched (data or status) — the
            admin flagged them for a reason
          - verified rows are never downgraded by a weak draft
          - failed row-less pairs get a stub draft row so they rotate
            to the back of the queue instead of starving it
     4. Logs one summary row in regs_auto_runs (dashboard Health tile).

   Auth: x-cron-secret header must match the CRON_SECRET env var.
   No user JWT — this runs headless.

   REQUIRED SECRETS:
     ANTHROPIC_API_KEY
     CRON_SECRET

   Body (optional): { batch?: number }   // default 5, max 8 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ANTHROPIC_ENDPOINT, ANTHROPIC_MODEL, ANTHROPIC_VERSION,
  JURISDICTIONS, coerceNumeric, jsonResponse, finalTextBlock, salvageJson,
} from '../_shared/regs-shared.ts';

const MAX_TOKENS    = 4000;
const DEFAULT_BATCH = 5;
const MAX_BATCH     = 8;
const CONCURRENCY   = 3;

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
  const rawText = finalTextBlock(json);
  if (!rawText) return { error: 'empty response' };
  const parsed = salvageJson(rawText);
  if (!parsed) return { error: `bad json: ${rawText.slice(0, 150)}` };

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
  // Any rejected numeric downgrades confidence — a value the
  // validator had to throw away means the model's read of the page
  // was off, and auto-publish must not proceed on the remainder.
  let conf = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
    ? parsed.confidence as Draft['confidence'] : 'low';
  if (rejects.length && conf === 'high') conf = 'medium';
  const noteParts  = [typeof parsed.sourceNote === 'string' ? parsed.sourceNote.trim() : '', ...rejects].filter(Boolean);

  return {
    seasonText, minSizeIn, maxSizeIn, bagLimit, boatLimit, notes,
    sourceNote: noteParts.join(' ') || 'No source note returned.',
    sourceUrl,
    confidence: conf,
  };
}

/* Small concurrency pool — run tasks() with at most `limit` in
   flight. Keeps the batch inside the edge wall-clock without
   hammering the Anthropic API. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(lanes);
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
  // Bait-category species are excluded — their agency guidance is
  // cast-net / bait-harvest rules, not the recreational keep/release
  // compliance surface this pipeline exists for. Skipping them saves
  // Anthropic API calls and keeps the pair rotation focused. Kept in
  // sync with the admin RegulationsTab filter in AdminApp.jsx.
  const { data: speciesRows, error: spErr } = await db.from('species')
    .select('id, common_name, scientific, alt_names, category, is_active');
  if (spErr) return jsonResponse({ error: `species query: ${spErr.message}` }, 500);
  const activeSpecies = (speciesRows || [])
    .filter(s => s.is_active !== false)
    .filter(s => s.category !== 'bait');

  const { data: regRows, error: regErr } = await db.from('regulations')
    .select('id, species_id, jurisdiction_id, status, season_text, min_size_in, max_size_in, bag_limit, boat_limit, notes, source_note, source_url, last_checked_at');
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

  // Rows the updater must never modify beyond the check clock:
  // disputed rows (admin flagged conflicting sources) and anything a
  // HUMAN authored or edited (drafted_by is an email, not 'ai') —
  // manual entries are kept verbatim, full stop.
  const isProtected = (row: any) =>
    row && (row.status === 'disputed'
      || (row.drafted_by && row.drafted_by !== 'ai'));

  // A row with no season and no numerics carries nothing an angler
  // can use — junk from the old bulk-verify era even when its status
  // says 'verified'. Such rows are healable, not protected.
  const isEmptyRow = (row: any) =>
    row && row.season_text == null && row.min_size_in == null
      && row.max_size_in == null && row.bag_limit == null && row.boat_limit == null;

  await pool(work, CONCURRENCY, async ({ sp, jur, row }) => {
    const pairKey = `${sp.id} × ${jur.id}`;

    if (isProtected(row)) {
      const { error } = await db.from('regulations')
        .update({ last_checked_at: nowIso }).eq('id', row.id);
      if (error) { failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message }); }
      else       { unchanged += 1; detail.push({ pair: pairKey, outcome: 'skipped-protected' }); }
      return;
    }

    const draft = await researchPair(ANTHROPIC_API_KEY, sp, jur);

    if ('error' in draft) {
      failed += 1;
      detail.push({ pair: pairKey, outcome: 'failed', reason: draft.error });
      if (row) {
        // Bump so a persistent failure doesn't pin this pair at the
        // head of the queue.
        await db.from('regulations').update({ last_checked_at: nowIso }).eq('id', row.id);
      } else {
        // Row-less pair: write a stub draft so it carries a
        // last_checked_at and rotates instead of starving the grid.
        // Visible to the admin as an empty draft with the failure
        // note — honest breadcrumb, not clutter.
        await db.from('regulations').upsert({
          species_id: sp.id,
          jurisdiction_id: jur.id,
          status: 'draft',
          drafted_by: 'ai',
          drafted_at: nowIso,
          source_note: `auto-updater: research failed — ${draft.error}`,
          auto_published: false,
          last_checked_at: nowIso,
        }, { onConflict: 'species_id,jurisdiction_id' });
      }
      return;
    }

    const strong = draft.confidence === 'high'
      && !!draft.sourceUrl
      && !!draft.seasonText
      && (draft.bagLimit != null || draft.minSizeIn != null);

    // The coalesce rail protects VERIFIED rows that actually carry
    // data — a strong re-check that omits max_size must not erase a
    // verified slot limit. It must NOT protect AI drafts: those can
    // carry junk from the pre-web-search era, and coalescing junk
    // forward re-stamps garbage with today's date (real bug, seen as
    // Little Tunny notes riding on a Mahi-Mahi row). Drafts get the
    // researcher's values verbatim, nulls included.
    const protectValues = row && row.status === 'verified' && !isEmptyRow(row);
    const merged = protectValues ? {
      season_text: draft.seasonText ?? row.season_text ?? null,
      min_size_in: draft.minSizeIn  ?? row.min_size_in ?? null,
      max_size_in: draft.maxSizeIn  ?? row.max_size_in ?? null,
      bag_limit:   draft.bagLimit   ?? row.bag_limit   ?? null,
      boat_limit:  draft.boatLimit  ?? row.boat_limit  ?? null,
      notes:       draft.notes      ?? row.notes       ?? null,
    } : {
      season_text: draft.seasonText,
      min_size_in: draft.minSizeIn,
      max_size_in: draft.maxSizeIn,
      bag_limit:   draft.bagLimit,
      boat_limit:  draft.boatLimit,
      notes:       draft.notes,
    };

    const base = {
      species_id: sp.id,
      jurisdiction_id: jur.id,
      source_note: draft.sourceNote,
      source_url:  draft.sourceUrl ?? (protectValues ? row?.source_url ?? null : null),
      drafted_by: 'ai',
      drafted_at: nowIso,
      last_checked_at: nowIso,
    };

    let payload: Record<string, unknown>;
    let outcome: 'published' | 'drafted' | 'unchanged';

    if (strong) {
      payload = {
        ...base, ...merged,
        status: 'verified',
        verified_by: 'auto-updater',
        verified_at: nowIso,
        auto_published: true,
      };
      outcome = 'published';
    } else if (protectValues) {
      // Weak draft + existing verified DATA: keep everything, just
      // note the check happened. (Verified-but-EMPTY rows — old
      // bulk-verify junk — deliberately fall through and get
      // replaced by an honest draft below.)
      const { error } = await db.from('regulations')
        .update({ last_checked_at: nowIso }).eq('id', row.id);
      if (error) { failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message }); }
      else       { unchanged += 1; detail.push({ pair: pairKey, outcome: 'unchanged', confidence: draft.confidence }); }
      return;
    } else {
      // Unproven research → an honest draft carrying exactly what
      // the researcher found (even all-nulls). Old junk values are
      // overwritten, never carried forward. Empty verified rows get
      // demoted to draft here — the app's fallback (bundled/fed)
      // serves anglers better than a data-free 'verified' row.
      payload = {
        ...base,
        ...merged,
        status: 'draft',
        auto_published: false,
      };
      outcome = 'drafted';
    }

    const { error } = await db.from('regulations')
      .upsert(payload, { onConflict: 'species_id,jurisdiction_id' });
    if (error) {
      failed += 1; detail.push({ pair: pairKey, outcome: 'failed', reason: error.message });
    } else if (outcome === 'published') {
      published += 1; detail.push({ pair: pairKey, outcome, season: draft.seasonText || '' });
    } else {
      drafted += 1; detail.push({ pair: pairKey, outcome, confidence: draft.confidence });
    }
  });

  // Best-effort run log — never let a logging failure turn a
  // completed batch into a 500.
  try {
    await db.from('regs_auto_runs').insert({
      checked: work.length, published, drafted, unchanged, failed,
      detail,
    });
  } catch { /* logged results still returned below */ }

  return jsonResponse({ ok: true, checked: work.length, published, drafted, unchanged, failed });
});
