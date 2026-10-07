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
 *   GET https://reelintel.ai/admin/api/health/errors
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

    // ---- 4. Unresolved app errors ------------------------------------
    // Read-only by construction, which is the point: the morning triage
    // routine needs to SEE the error log, and handing an automated job a
    // service-role key to read one table would let it write every other
    // one. 'benign' is excluded here as it is in the daily brief —
    // stale-chunk imports the page already recovered from, and Android
    // WebView bridge errors from in-app browsers.
    if (want('errors')) {
      const { data: errs, error } = await db.from('error_log')
        .select('fingerprint, kind, message, stack, screen, platform, app_version, is_guest, occurred_at')
        .is('resolved_at', null)
        .neq('kind', 'benign')
        .gte('occurred_at', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('occurred_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      // Grouped by fingerprint: the same crash hitting twenty people is
      // one fault to fix, not twenty to read.
      const byFp = new Map<string, any>();
      for (const e of errs || []) {
        const g = byFp.get(e.fingerprint);
        if (g) { g.occurrences += 1; if (e.occurred_at > g.last_seen) g.last_seen = e.occurred_at; continue; }
        byFp.set(e.fingerprint, {
          fingerprint: e.fingerprint,
          kind: e.kind,
          message: e.message,
          stack: e.stack,
          screen: e.screen,
          platform: e.platform,
          app_version: e.app_version,
          is_guest: e.is_guest,
          first_seen: e.occurred_at,
          last_seen: e.occurred_at,
          occurrences: 1,
        });
      }
      out.errors = [...byFp.values()].sort((a, b) => b.occurrences - a.occurrences);
      out.errors_summary = {
        distinct_faults: byFp.size,
        total_occurrences: (errs || []).length,
        window_days: 7,
      };
    }

    /* PIPELINES — is the data actually arriving?
     *
     * Every other section here asks whether a job ERRORED. None asked
     * whether it produced anything, and the difference is the whole
     * point: find-hotspots failed on every region every ten minutes for
     * thirteen hours while returning HTTP 200 with the failures listed
     * in its body, and the dashboard said "nothing needs attention".
     * A call that completes and writes nothing is the failure mode that
     * matters, because it is the one nobody notices.
     *
     * So this section asks the only question an angler would: is what
     * the app is about to show me actually from today?
     */
    if (want('pipelines')) {
      const issues: Record<string, unknown>[] = [];

      // 1. Regions that recorded a failure on their last run. The
      //    function writes its own outcome there, success or failure.
      const { data: regions } = await db.from('hotspot_regions')
        .select('id, label, active, last_run_at, last_error').eq('active', true);
      const failing = (regions || []).filter(r => r.last_error?.startsWith('ERROR'));
      const neverRun = (regions || []).filter(r => !r.last_run_at);
      if (failing.length) {
        issues.push({
          what: 'Suggested spots are not being computed',
          detail: `${failing.length} of ${(regions || []).length} regions failed their last run. ` +
                  `${failing[0].id}: ${String(failing[0].last_error).slice(0, 220)}`,
          do: 'Read the reason above. If every ERDDAP host timed out, NOAA is unreachable and ' +
              'there is nothing to fix here — it clears on its own. Anything else needs a look.',
          severity: failing.length === (regions || []).length ? 'broken' : 'degraded',
        });
      }
      if (neverRun.length) {
        issues.push({
          what: 'Some waters have never been read',
          detail: neverRun.map(r => r.id).join(', '),
          do: 'Press Regenerate on Trip Planning, or wait — the job takes one region every ten minutes.',
          severity: 'degraded',
        });
      }

      // 2. How old is the data the app is drawing? Perishable: a
      //    week-old break has moved, and drawing it is worse than
      //    drawing nothing.
      const { data: zone } = await db.from('hotspot_zones')
        .select('observed_at').order('observed_at', { ascending: false }).limit(1);
      const zoneAge = daysSince(zone?.[0]?.observed_at ?? null);
      if (zone?.[0] && zoneAge != null && zoneAge >= 2) {
        issues.push({
          what: `Species maps and currents are ${zoneAge} days old`,
          detail: `Newest satellite pass is ${String(zone[0].observed_at).slice(0, 10)}. ` +
                  'The app draws these without saying how old they are.',
          do: zoneAge >= 5
            ? 'Nothing has landed in days — check the region errors above before trusting the map.'
            : 'Watch it. If it keeps climbing, the nightly job is not completing.',
          severity: zoneAge >= 5 ? 'broken' : 'degraded',
        });
      }
      if (!zone?.length) {
        issues.push({
          what: 'No species maps or currents at all',
          detail: 'hotspot_zones is empty.',
          do: 'Deploy find-hotspots and press Regenerate on Trip Planning.',
          severity: 'broken',
        });
      }

      // 3. The satellite pictures the Ocean Maps layers draw. Written by
      //    refresh-ocean-maps into a public bucket; a stale PNG looks
      //    exactly like a fresh one, which is why this has to be checked
      //    rather than looked at.
      try {
        const r = await fetch(`${URL_}/storage/v1/object/public/ocean-maps/sst-latest.json`);
        if (r.ok) {
          const meta = await r.json();
          const imgAge = daysSince(meta?.captured_at ?? null);
          if (imgAge != null && imgAge >= 1) {
            issues.push({
              what: `Chlorophyll and sea-temp layers are ${imgAge} day${imgAge === 1 ? '' : 's'} old`,
              detail: `Last written ${String(meta.captured_at).slice(0, 16).replace('T', ' ')}Z. ` +
                      'A stale picture looks identical to a fresh one on the map.',
              do: 'refresh-ocean-maps is not completing. Check its errors; it reads the same ' +
                  'NOAA servers as the spots, so the two usually fail together.',
              severity: imgAge >= 3 ? 'broken' : 'degraded',
            });
          }
        }
      } catch { /* a probe that cannot run is not itself a finding */ }

      out.pipelines = issues;
      out.pipelines_summary = {
        broken: issues.filter(i => i.severity === 'broken').length,
        degraded: issues.filter(i => i.severity === 'degraded').length,
      };
    }

    return json(out);
  } catch (e) {
    console.error('health-report failed', e);
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
});
