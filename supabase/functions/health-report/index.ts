/* health-report — read-only JSON for the daily health-check agent.
 *
 * Replaces screen-scraping the admin console. Everything here is a
 * SELECT: the function holds no write path at all, so "read-only" is a
 * property of the code, not a promise about a token's scope.
 *
 * Auth: x-api-key against the HEALTH_API_KEY secret. Deployed
 * --no-verify-jwt so a machine agent needs no Supabase session — the
 * shared secret is the whole gate, which is why the function can only
 * ever read.
 *
 * Called through the admin dashboard's own host, not the Supabase URL —
 * vercel.json rewrites these onto this function so the agent has one
 * origin to know about (reelintel.ai) and the backend can move:
 *
 *   GET https://reelintel.ai/admin/api/health              all three sections
 *   GET https://reelintel.ai/admin/api/health/monitored
 *   GET https://reelintel.ai/admin/api/health/regulations
 *   GET https://reelintel.ai/admin/api/health/queue
 *
 * Deploy:
 *   supabase secrets set HEALTH_API_KEY=<key>
 *   supabase functions deploy health-report --no-verify-jwt
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// A regulation older than this is stale enough to act on. The auto
// updater cycles the whole grid in ~5 days, so 30 is comfortably past
// "the cron is just behind" and into "something is wrong".
const STALE_DAYS = 30;
const OVERDUE_DAYS = 90;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s, headers: { 'Content-Type': 'application/json', ...cors },
  });

const daysSince = (iso: string | null) =>
  iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const KEY = Deno.env.get('HEALTH_API_KEY');
  const URL_ = Deno.env.get('SUPABASE_URL');
  const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!KEY || !URL_ || !SR) return json({ error: 'server_misconfigured' }, 500);

  const presented = req.headers.get('x-api-key') || '';
  // Length check first so a wrong-length guess cannot be timed.
  if (presented.length !== KEY.length || presented !== KEY) {
    return json({ error: 'unauthorized' }, 401);
  }

  const db = createClient(URL_, SR, { auth: { persistSession: false } });
  const section = new URL(req.url).searchParams.get('section');
  const want = (s: string) => !section || section === s;
  const out: Record<string, unknown> = { generated_at: new Date().toISOString() };

  try {
    // ---- 1. Monitored items: species and how fresh their data is ----
    if (want('monitored')) {
      // `is_active` is a soft-hide flag some consolidation migrations set;
      // it is not in the base schema, so ask for it and fall back if this
      // database never got the column. PostgREST 400s on the whole query
      // for one unknown column, which would take the endpoint down.
      const cols = 'id, common_name, category, updated_at';
      let { data: species, error } = await db.from('species')
        .select(`${cols}, is_active`).order('common_name');
      if (error) {
        ({ data: species, error } = await db.from('species')
          .select(cols).order('common_name'));
      }
      if (error) throw error;

      const { data: regs } = await db.from('regulations')
        .select('species_id, status, updated_at, verified_at, last_checked_at');

      const byS = new Map<string, { n: number; newest: string | null; verified: number }>();
      for (const r of regs || []) {
        const e = byS.get(r.species_id) || { n: 0, newest: null, verified: 0 };
        e.n += 1;
        if (r.status === 'verified') e.verified += 1;
        const t = r.verified_at || r.updated_at;
        if (t && (!e.newest || t > e.newest)) e.newest = t;
        byS.set(r.species_id, e);
      }

      out.monitored = (species || [])
        .filter((s: any) => s.is_active !== false && !s.id.startsWith('_'))
        .map((s: any) => {
          const r = byS.get(s.id);
          const last = r?.newest || s.updated_at || null;
          const age = daysSince(last);
          // No regulation row at all is a coverage gap, not staleness —
          // the agent should be able to tell those apart.
          const status = !r || r.n === 0 ? 'no_regulations'
            : r.verified === 0 ? 'pending'
            : age != null && age > OVERDUE_DAYS ? 'overdue'
            : age != null && age > STALE_DAYS ? 'stale'
            : 'active';
          return {
            id: s.id,
            name: s.common_name,
            category: s.category || null,
            last_updated: last,
            days_since_update: age,
            regulation_rows: r?.n ?? 0,
            status,
          };
        });
    }

    // ---- 2. Regulations by region ------------------------------------
    if (want('regulations')) {
      const { data: regs, error } = await db.from('regulations')
        .select('jurisdiction_id, species_id, status, updated_at, verified_at, last_checked_at');
      if (error) throw error;

      const byR = new Map<string, {
        species: number; verified: number; draft: number; stale: number; disputed: number;
        newest_review: string | null; oldest_review: string | null;
      }>();
      for (const r of regs || []) {
        const k = r.jurisdiction_id;
        const e = byR.get(k) || {
          species: 0, verified: 0, draft: 0, stale: 0, disputed: 0,
          newest_review: null, oldest_review: null,
        };
        e.species += 1;
        if (r.status === 'verified') e.verified += 1;
        else if (r.status === 'draft') e.draft += 1;
        else if (r.status === 'stale') e.stale += 1;
        else if (r.status === 'disputed') e.disputed += 1;
        const t = r.verified_at || r.last_checked_at || r.updated_at;
        if (t) {
          if (!e.newest_review || t > e.newest_review) e.newest_review = t;
          if (!e.oldest_review || t < e.oldest_review) e.oldest_review = t;
        }
        byR.set(k, e);
      }

      out.regulations_by_region = [...byR.entries()].map(([region, e]) => {
        // Judge a region by its WORST row, not its newest: one fresh
        // check does not make the region current.
        const age = daysSince(e.oldest_review);
        const status = e.disputed > 0 ? 'disputed'
          : age != null && age > OVERDUE_DAYS ? 'overdue'
          : e.draft > 0 || e.stale > 0 || (age != null && age > STALE_DAYS) ? 'pending_review'
          : 'current';
        return {
          region,
          species_covered: e.species,
          last_reviewed: e.newest_review,
          oldest_review: e.oldest_review,
          days_since_oldest_review: age,
          counts: { verified: e.verified, draft: e.draft, stale: e.stale, disputed: e.disputed },
          status,
        };
      }).sort((a, b) => a.region.localeCompare(b.region));
    }

    // ---- 3. Review / approval queue ----------------------------------
    if (want('queue')) {
      const queue: Array<Record<string, unknown>> = [];

      const { data: sug } = await db.from('species_suggestions')
        .select('id, common_name, status, submitted_at')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true })
        .limit(500);
      for (const s of sug || []) {
        queue.push({
          type: 'species_suggestion',
          id: s.id,
          label: s.common_name,
          entered_queue_at: s.submitted_at,
          days_waiting: daysSince(s.submitted_at),
          status: s.status,
        });
      }

      // Training photos awaiting review are counted, not listed: there
      // are tens of thousands and a daily agent wants the backlog size.
      const { count: pendingPhotos } = await db.from('training_images')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      const { data: oldestPhoto } = await db.from('training_images')
        .select('uploaded_at')
        .eq('status', 'pending')
        .order('uploaded_at', { ascending: true })
        .limit(1);

      out.review_queue = queue;
      out.review_queue_summary = {
        species_suggestions_pending: queue.length,
        training_photos_pending: pendingPhotos ?? null,
        oldest_training_photo_at: oldestPhoto?.[0]?.uploaded_at ?? null,
        oldest_training_photo_days: daysSince(oldestPhoto?.[0]?.uploaded_at ?? null),
      };
    }

    return json(out);
  } catch (e) {
    console.error('health-report failed', e);
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
});
