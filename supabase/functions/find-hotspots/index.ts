/* find-hotspots — read the satellite grids, find the edges, write the spots.
 *
 * The premise: fish stack on edges, not on averages. So this does not care
 * what the sea surface temperature IS. It cares where it CHANGES — and
 * where a temperature break lines up with a colour break, which is the
 * clean-water-meets-green-water line every offshore crew looks for.
 *
 * Runs on a schedule, writes rows. The phone reads those rows and caches
 * them like the forecast: a few hundred bytes per spot, so the answer is
 * aboard before the signal is gone. Nothing here ever runs on a boat.
 *
 * PRIVACY, decided before the community layer exists so it cannot be
 * retrofitted badly: in the app an angler sees only their OWN catches, but
 * hotspots are computed from EVERYONE'S. Those two only coexist if a
 * published hotspot can never be read back as one person's number — and
 * with a sparse log, a cell containing one catch IS that angler's spot.
 * So community catch data may only influence a published spot once a cell
 * holds catches from at least MIN_DISTINCT_ANGLERS different people, and
 * positions are aggregated to the grid, never passed through. The catches
 * table already carries loc_precision (exact | grid_1km | grid_10km) for
 * this.
 *
 * Auth: x-cron-secret.
 * Body: { region?: 'al_gulf', dry_run?: true }
 * Deploy: supabase functions deploy find-hotspots
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ONE copy of the habitat priors and trip modes — the same files the app
// reads. See [[duplicated-knowledge]]: a second copy here would drift.
import { habitatScore } from '../../../src/species-habitat.js';
import { TRIP_MODES } from '../../../src/trip-modes.js';

/* ERDDAP hosts, tried in order. coastwatch.pfeg went fully 503 — index
   page included — while this was being built, which is the difference
   between ERDDAP shedding load and the host being down. One address meant
   one outage emptied the whole map with nothing to fall back to.
   upwell is a separate ERDDAP instance serving the same dataset ids, so a
   failover needs no second set of names. If it is down too we have lost
   nothing: the region records why and comes back in half an hour. */
/* Each entry is [host, attempts]. The primary gets two tries because its
   503s are usually load-shedding that clears; the fallbacks get one each,
   so three hosts still cost no more wall-clock than two did.
   upwell is a separate machine from coastwatch (different address) but the
   same NOAA site, so it does not survive a site-wide failure — which is
   what took the feature down on 2026-10-07. USF is a different
   institution entirely, in the Gulf, and carries jplMURSST41; whether it
   carries the ERD-specific colour, depth and current datasets is unknown,
   and a host that lacks one answers 404, which is handled. */
const ERDDAP_HOSTS: [string, number][] = [
  ['https://coastwatch.pfeg.noaa.gov/erddap/griddap', 2],
  ['https://upwell.pfeg.noaa.gov/erddap/griddap', 1],
  ['https://erddap.marine.usf.edu/erddap/griddap', 1],
];
// MUR is 0.01° (~1 km). Every other cell is ~2 km, which is finer than any
// break worth driving to and keeps the grid at a size an edge function can
// hold in memory.
const SST_DATASET = 'jplMURSST41';
const SST_STRIDE  = 2;
const CHL_DATASET = 'erdMH1chla8day_R2022NRT';
const CHL_STRIDE  = 1;
// A single call now does ONE region (see the region-selection block below),
// and pg_net hangs up on the whole call at 120 s. 25 s per dataset means a
// stalled optional grid drops out instead of eating the budget: everything
// but SST is fetched with .catch(() => null).
const FETCH_TIMEOUT_MS = 20_000;

// What counts as an edge. A break under ~0.4 °F/nm is noise in a 1 km
// satellite product; 1.5 °F/nm is the kind of wall people run 40 miles for.
const SST_GRAD_MIN  = 0.40;
const SST_GRAD_GOOD = 1.50;
const CHL_GRAD_MIN  = 0.12;   // log10(mg/m³) per nautical mile
const CHL_GRAD_GOOD = 0.60;
// Bottom relief, in feet of depth change per nautical mile. The shelf
// break off Alabama falls away at hundreds of feet per mile; flat mud
// reads near zero. This is what separates a break that has something
// under it from one drifting over featureless bottom.
const SLOPE_MIN     = 40;
const SLOPE_GOOD    = 300;
// Geostrophic current speed in knots. Under ~0.2 kt nothing is being
// concentrated; the Loop Current edge runs well over 1.
const CUR_MIN       = 0.20;
const CUR_GOOD      = 1.20;

/* How strict to be. These were 45 / 3 / 12 and produced a map of
   every wobble in the sea surface — which is the same as no map, because
   a dozen mediocre spots tell a captain nothing about which one to run to.
   A spot now has to clear a high bar AND be corroborated by a second
   signal AND stand alone from its neighbours. */
const MIN_SCORE     = 65;     // below this it is not worth a card
const MIN_CELLS     = 5;      // a line, not a few hot pixels
const MAX_SPOTS     = 8;
// Two cards four miles apart describing the same wall is one card and a
// duplicate. Keep the stronger.
const MIN_SEPARATION_NM = 4;
// When the whole region produces nothing above MIN_SCORE, show this many
// of the best anyway rather than an empty map.
const MARGINAL_SPOTS = 3;
// Community catch influence is gated on this — see PRIVACY above. Below it,
// a "hotspot" is one angler's spot with a satellite picture behind it.
const MIN_DISTINCT_ANGLERS = 3;
// How long a hand-pressed run may keep going before it reports back. The
// edge runtime cuts a request off well short of twelve regions, and a run
// killed mid-region writes nothing at all.
const BUDGET_MS = 100_000;
/* No request may be wider than this many points a side. See the stride
   note in the region loop: an uncapped box put 45,000 points in one JSON
   document and timed out on every host. */
const MAX_GRID_SIDE = 140;

/* Can this runtime reach the outside world at all?
 *
 * Three unrelated hosts — two NOAA, one university — all timing out while
 * a browser gets an instant answer from the same addresses is not three
 * outages. It is the shape of a runtime that cannot get out. But a
 * timeout alone cannot tell those apart, so the function asks.
 *
 * Open-Meteo is the control: the app already depends on it for the
 * forecast, so it is known to work from here. If Open-Meteo answers and
 * every ERDDAP host does not, the problem is reaching ERDDAP. If nothing
 * answers, it is outbound access, and no amount of retrying or failing
 * over will ever help.
 *
 * Tiny requests and a short window — this runs only after a region has
 * already failed, and has to fit in what is left of the budget. */
const PROBE_TIMEOUT_MS = 6_000;

async function probeOutbound(): Promise<string> {
  const one = async (label: string, url: string) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const r = await fetch(url, { signal: ctl.signal });
      return `${label}=${r.status}/${((Date.now() - t0) / 1000).toFixed(1)}s`;
    } catch (e) {
      return `${label}=${(e as Error)?.name === 'AbortError' ? 'timeout' : 'unreachable'}`;
    } finally {
      clearTimeout(t);
    }
  };
  const results = await Promise.all([
    // The control. Not ERDDAP, already proven from this runtime.
    one('open-meteo', 'https://marine-api.open-meteo.com/v1/marine' +
      '?latitude=29&longitude=-88&hourly=sea_surface_temperature&forecast_days=1'),
    // One single point from each host — the smallest thing ERDDAP can serve.
    ...ERDDAP_HOSTS.map(([h]) => one(
      new URL(h).hostname.split('.').slice(0, 2).join('.'),
      `${h}/${SST_DATASET}.json?analysed_sst[(last)][(29.0):1:(29.01)][(-88.0):1:(-87.99)]`)),
  ]);
  return results.join(' ');
}

// Predictive zones (the SiriusXM-style blobs), PER SPECIES — "where is
// the mahi water", not "where is trolling generally good". Coarser than
// the edge grid — a blob is an area statement, ~6 km cells read fine at
// region zoom — and capped so a row stays a few KB for the phone's cache.
// Scored from temperature band + season + depth band (ETOPO bathymetry)
// + edge strength (temperature OR colour). Currents and surface weather
// are deliberately not in here yet: weather decides whether you GO
// (Fishability's job), not where the fish are.
const ZONE_STRIDE    = 3;    // every 3rd SST cell
const ZONE_MIN_SCORE = 20;   // habitat fit below this isn't worth painting
const ZONE_MAX_CELLS = 300;  // per species
const DEPTH_DATASET  = 'etopo180';   // static bathymetry, meters (negative = depth)
// Geostrophic surface currents from altimetry (sea-surface height) —
// the loop current and its eddies, which is the current picture that
// matters offshore. 0.25°, daily, lags a few days; eddies move slowly
// enough that this is still the right map.
const CUR_DATASET = 'nesdisSSH1day';
const MS_TO_KT = 1.94384;
const PELAGIC_SPECIES = TRIP_MODES.find((m) => m.key === 'troll_pelagic')!.species;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });

const NM_PER_DEG_LAT = 60;
const toRad = (d: number) => d * Math.PI / 180;
const nmPerDegLon = (lat: number) => 60 * Math.cos(toRad(lat));

/* Great-circle distance and initial bearing, in nautical miles / degrees. */
function distBearing(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = (bLat - aLat) * NM_PER_DEG_LAT;
  const dLon = (bLon - aLon) * nmPerDegLon((aLat + bLat) / 2);
  const dist = Math.hypot(dLat, dLon);
  let brg = Math.atan2(dLon, dLat) * 180 / Math.PI;
  if (brg < 0) brg += 360;
  return { dist, brg };
}

const compass = (deg: number) =>
  ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW']
    [Math.round(deg / 22.5) % 16];

/* ERDDAP sheds load by answering 503, by its own documented design: when
   the server's memory use is high it refuses requests rather than falling
   over. coastwatch.pfeg is a busy public server, so a 503 is an ordinary
   Tuesday, not an outage — and until this retried, ONE of them on the SST
   grid (the only fetch that is not optional) threw away the whole region.
   Three tries with a short backoff. Only the shed/transient statuses are
   retried: a 400 means our query is wrong and asking again louder will not
   fix it. */
/* The time a run ACTUALLY happened. It has to travel inside the status
   text because last_run_at is not that time: a failed region is stamped
   90 minutes in the past so it comes back round sooner, which makes the
   column a queue position, not a clock. Reading it as "last ran" would
   say "an hour ago" about a run a minute old. */
const stamp = () => new Date().toISOString().slice(11, 16) + 'Z';

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* `path` is everything after /griddap — the host is chosen here, not by
   the caller, so no call site can pin itself to one server. */
async function fetchJson(path: string) {
  let last: unknown = new Error('no erddap host tried');
  /* What EACH host did, not just the last one. The first version threw
     only the final error, so three hosts failing for three different
     reasons reported as one bare "AbortError: The signal has been
     aborted" — which does not say whether a host refused us, does not
     carry the dataset, or never answered at all. Those need different
     fixes, and guessing between them is how a night gets spent. */
  const tried: string[] = [];
  // Two labels, not one: the third host's first label is "erddap", which
  // names nothing. coastwatch.pfeg / upwell.pfeg / erddap.marine read right.
  const shortName = (h: string) => new URL(h).hostname.split('.').slice(0, 2).join('.');
  for (const [host, attemptsPerHost] of ERDDAP_HOSTS) {
    let nextHost = false;
    let why = 'unknown';
    for (let a = 1; a <= attemptsPerHost; a++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(`${host}/${path}`, { signal: ctl.signal });
        if (r.ok) {
          if (tried.length) console.log(`erddap fell through to ${host}: ${tried.join(' ')}`);
          return await r.json();
        }
        why = String(r.status);
        const err = Object.assign(
          new Error(`${host} ${r.status}: ${(await r.text()).slice(0, 120)}`),
          { stop: !RETRY_STATUS.has(r.status) && r.status !== 404 });
        last = err;
        // A 400 means the query is wrong, and it will be just as wrong on
        // the next host — stop rather than walk the whole list to say so.
        if (!RETRY_STATUS.has(r.status)) {
          // 404 means THIS host does not carry the dataset, which says
          // nothing about the next one — walk on. Anything else in the 4xx
          // range is our query being wrong, and it will be just as wrong
          // everywhere, so stop rather than walk the list to say so. The
          // two were treated alike while every host was NOAA with the same
          // catalogue; that stopped being true when USF joined the list.
          if (r.status === 404) { nextHost = true; break; }
          throw err;
        }
      } catch (e) {
        if (e instanceof Error && (e as Error & { stop?: boolean }).stop) {
          tried.push(`${shortName(host)}=${why}`);
          throw Object.assign(new Error(`${String(e)} [${tried.join(' ')}]`), { stop: true });
        }
        // An aborted fetch is our own timeout; anything else is the
        // connection failing. They look identical in a bare error string
        // and mean opposite things — one host is slow, the other is gone.
        why = (e as Error)?.name === 'AbortError' ? `timeout@${FETCH_TIMEOUT_MS / 1000}s` : 'unreachable';
        last = e;
      } finally {
        clearTimeout(t);
      }
      if (nextHost) break;
      if (a < attemptsPerHost) await sleep(2000);
    }
    tried.push(`${shortName(host)}=${why}`);
  }
  throw new Error(`every erddap host failed — ${tried.join(' ')} — last: ${last}`);
}

/* ERDDAP .json comes back as a column table, not a grid. Rebuild the grid
   so neighbours are actually adjacent — gradients are meaningless until
   they are. */
type Grid = { lats: number[]; lons: number[]; v: (number | null)[][]; time: string | null };

function toGrid(doc: any, valueCol: string): Grid {
  const names: string[] = doc.table.columnNames;
  const rows: any[][] = doc.table.rows;
  const iTime = names.indexOf('time');
  const iLat = names.indexOf('latitude');
  const iLon = names.indexOf('longitude');
  const iVal = names.indexOf(valueCol);
  if (iLat < 0 || iLon < 0 || iVal < 0) throw new Error(`unexpected columns: ${names.join(',')}`);

  const latSet = new Set<number>(), lonSet = new Set<number>();
  for (const r of rows) { latSet.add(r[iLat]); lonSet.add(r[iLon]); }
  const lats = [...latSet].sort((a, b) => a - b);
  const lons = [...lonSet].sort((a, b) => a - b);
  const li = new Map(lats.map((v, i) => [v, i]));
  const oi = new Map(lons.map((v, i) => [v, i]));

  const v: (number | null)[][] = lats.map(() => new Array(lons.length).fill(null));
  for (const r of rows) {
    const value = r[iVal];
    v[li.get(r[iLat])!][oi.get(r[iLon])!] = (value == null || Number.isNaN(value)) ? null : value;
  }
  return { lats, lons, v, time: iTime >= 0 && rows.length ? rows[0][iTime] : null };
}

/* Gradient magnitude per nautical mile, by central difference. Returns null
   wherever a neighbour is missing — cloud, or land. Guessing across a gap
   invents an edge at the coastline, which is exactly the kind of beautiful
   wrong answer this feature must not produce. */
function gradient(g: Grid, scale: (x: number) => number) {
  const out: (number | null)[][] = g.lats.map(() => new Array(g.lons.length).fill(null));
  for (let i = 1; i < g.lats.length - 1; i++) {
    const dLatNm = (g.lats[i + 1] - g.lats[i - 1]) * NM_PER_DEG_LAT;
    const dLonNm = (g.lons[1] - g.lons[0]) * 2 * nmPerDegLon(g.lats[i]);
    for (let j = 1; j < g.lons.length - 1; j++) {
      const n = g.v[i + 1][j], s = g.v[i - 1][j], e = g.v[i][j + 1], w = g.v[i][j - 1];
      if (n == null || s == null || e == null || w == null) continue;
      const dy = (scale(n) - scale(s)) / dLatNm;
      const dx = (scale(e) - scale(w)) / dLonNm;
      out[i][j] = Math.hypot(dx, dy);
    }
  }
  return out;
}

/* Nearest-neighbour sample of one grid at another grid's point. The two
   satellite products are on different resolutions (1 km vs 4 km) and there
   is no sense interpolating a chlorophyll pixel onto a finer grid than it
   was measured at. */
function sampleAt(g: Grid, vals: (number | null)[][], lat: number, lon: number) {
  if (!g.lats.length || !g.lons.length) return null;
  let bi = 0, bj = 0, bd = Infinity;
  for (let i = 0; i < g.lats.length; i++) {
    const d = Math.abs(g.lats[i] - lat);
    if (d < bd) { bd = d; bi = i; }
  }
  bd = Infinity;
  for (let j = 0; j < g.lons.length; j++) {
    const d = Math.abs(g.lons[j] - lon);
    if (d < bd) { bd = d; bj = j; }
  }
  return vals[bi]?.[bj] ?? null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const cToF = (c: number) => c * 9 / 5 + 32;

type Cell = {
  i: number; j: number; lat: number; lon: number;
  sg: number; cg: number | null;
  slope: number | null; depthFt: number | null; curKt: number | null;
  score: number;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
      },
    });
  }
  const URL_ = Deno.env.get('SUPABASE_URL');
  const SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const CRON_SECRET = Deno.env.get('CRON_SECRET');
  if (!URL_ || !SR) return json({ error: 'missing env' }, 500);
  // Two ways in: the scheduler's shared secret, or a signed-in admin
  // pressing Recompute in the console. Without the second, the only way to
  // see a new run would be to wait for tomorrow's cron, which is no way to
  // judge whether the thresholds are right.
  const presentedSecret = req.headers.get('x-cron-secret');
  if (!CRON_SECRET || presentedSecret !== CRON_SECRET) {
    const auth = req.headers.get('Authorization') || '';
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
    if (adminErr || isAdmin !== true) return json({ error: 'forbidden' }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const db = createClient(URL_, SR, { auth: { persistSession: false } });

  // ONE REGION PER CALL, stalest first.
  //
  // This used to loop every active region in a single invocation. With 12
  // regions and four satellite grids each, the call ran well past the 60 s
  // pg_net ceiling the scheduler calls it with — and as cron-timeout-fix.sql
  // already recorded, pg_net closing the socket cuts the edge function off
  // mid-run. Both writes sit at the END of a region's block, so the run was
  // killed before the first one landed: hotspots and hotspot_zones stayed
  // empty, every night, and Suggested Spots had nothing to draw.
  //
  // So a call takes the region whose last run is oldest and returns. The
  // scheduler fires every ten minutes, so all twelve refresh inside two
  // hours and no single call can outlive its socket. last_run_at is stamped
  // on success AND on failure, so one broken region cannot starve the rest.
  let q = db.from('hotspot_regions').select('*').eq('active', true);
  if (body.region) q = q.eq('id', body.region);
  const { data: all, error: regErr } = await q;
  if (regErr) return json({ error: regErr.message }, 500);
  if (!all?.length) return json({ error: 'no active regions' }, 404);

  const stalestFirst = [...all].sort((a, b) =>
    (a.last_run_at ? Date.parse(a.last_run_at) : 0) -
    (b.last_run_at ? Date.parse(b.last_run_at) : 0));
  /* body.all is the Regenerate button: a person is watching, nothing hangs
     up at 60 s, and pressing it twelve times to fill a map is not a
     workflow. So it keeps going until the budget is spent rather than
     doing the lot — the edge runtime stops a request well before twelve
     regions of satellite grids are through, and a run killed mid-region
     writes nothing, which is the bug this whole file was fixed for.
     Whatever is left is reported, and the ten-minute cron picks it up. */
  const regions = body.region ? stalestFirst : body.all ? stalestFirst : stalestFirst.slice(0, 1);
  const deadline = Date.now() + (body.all ? BUDGET_MS : Infinity);
  let done = 0;

  const out: Record<string, unknown>[] = [];

  for (const reg of regions) {
    if (done && Date.now() > deadline) break;
    done++;
    let failure: string | null = null;
    let loaded = 'no grids';
    let status = 'ok';
    try {
      /* Cap how many points a region may ask for.
         The stride was a fixed number of grid cells, so a region's request
         grew with its box: fl_keys is 3.5 deg by 5.1 deg, which at MUR's
         0.01 deg and stride 2 is about 45,000 points in one JSON document.
         That is slow to assemble and slow to send even from a healthy
         server, and it was timing out — every host, every run, which reads
         as "the provider is down" when it is really "we asked for too
         much". Big regions now take a coarser stride instead of a longer
         wait. A 0.05 deg cell is still 3 nm, finer than any break worth
         driving to, and the gradient is per nautical mile either way. */
      const strideFor = (base: number, degPerCell: number) => {
        const side = (span: number) => Math.ceil(span / degPerCell / MAX_GRID_SIDE);
        return Math.max(base, side(reg.north - reg.south), side(reg.east - reg.west));
      };
      const box = (base: number, degPerCell = 0.01) => {
        const stride = strideFor(base, degPerCell);
        return `[(last)][(${reg.south}):${stride}:(${reg.north})][(${reg.west}):${stride}:(${reg.east})]`;
      };
      // Bathymetry has no time dimension; stride 4 (~4 km) is plenty for
      // "is this 300 ft or 3000 ft" — the only question the priors ask.
      const depthStride = strideFor(4, 1 / 60);
      const depthBox = `[(${reg.south}):${depthStride}:(${reg.north})][(${reg.west}):${depthStride}:(${reg.east})]`;
      const curBox = `[(last)][(${reg.south}):1:(${reg.north})][(${reg.west}):1:(${reg.east})]`;
      const [sstDoc, chlDoc, depthDoc, curDoc] = await Promise.all([
        fetchJson(`${SST_DATASET}.json?analysed_sst${box(SST_STRIDE)}`),
        fetchJson(`${CHL_DATASET}.json?chlorophyll${box(CHL_STRIDE, 0.0417)}`).catch(() => null),
        fetchJson(`${DEPTH_DATASET}.json?altitude${depthBox}`).catch(() => null),
        fetchJson(`${CUR_DATASET}.json?ugos${curBox},vgos${curBox}`).catch(() => null),
      ]);

      const sst = toGrid(sstDoc, 'analysed_sst');
      const chl = chlDoc ? toGrid(chlDoc, 'chlorophyll') : null;
      const bathy = depthDoc ? toGrid(depthDoc, 'altitude') : null;
      loaded = `sst${sstDoc ? '+' : '-'} chl${chlDoc ? '+' : '-'} ` +
               `depth${depthDoc ? '+' : '-'} cur${curDoc ? '+' : '-'}`;

      // A temperature break has to be corroborated by colour, bottom relief
      // or current before it may be drawn — see CORROBORATION below. All
      // three of those grids are fetched with .catch(() => null), so when a
      // shedding ERDDAP drops all three, every cell fails corroboration and
      // the region publishes nothing. That is the right call on the data and
      // the wrong thing to do silently: it looks identical to calm water.
      // Say so, and come back in half an hour.
      if (!chlDoc && !depthDoc && !curDoc) {
        throw new Error('no corroborating grid loaded (chl, depth and current all failed) — ' +
                        'temperature alone cannot publish a spot');
      }

      // SST arrives in °C. Work in °F throughout: it is what the card says,
      // and converting once here means no unit lives in two places.
      const sstGrad = gradient(sst, cToF);
      // Chlorophyll spans three orders of magnitude, so a plain difference
      // is dominated by the green inshore water. log10 makes the edge
      // between 0.1 and 0.3 as visible as the one between 1 and 3.
      const chlGrad = chl ? gradient(chl, (x) => Math.log10(Math.max(x, 0.001))) : null;
      // Bottom slope, in FEET per nautical mile. ETOPO altitude is metres
      // and negative below sea level, so the sign is flipped first — a
      // gradient taken on negative numbers is still a gradient, but every
      // threshold downstream would read backwards.
      const slopeGrad = bathy ? gradient(bathy, (m) => -m * 3.28084) : null;
      // Current speed from the altimetry u/v pair. Speed, not direction:
      // what concentrates bait is the shear between fast and slow water,
      // and a knot is a knot whichever way it runs.
      const curU = curDoc ? toGrid(curDoc, 'ugos') : null;
      const curV = curDoc ? toGrid(curDoc, 'vgos') : null;

      // ---- score every cell -----------------------------------------
      const cells: Cell[] = [];
      for (let i = 1; i < sst.lats.length - 1; i++) {
        for (let j = 1; j < sst.lons.length - 1; j++) {
          const sg = sstGrad[i][j];
          if (sg == null || sg < SST_GRAD_MIN) continue;
          const lat = sst.lats[i], lon = sst.lons[j];
          const cg = chl && chlGrad ? sampleAt(chl, chlGrad, lat, lon) : null;
          const slope = bathy && slopeGrad ? sampleAt(bathy, slopeGrad, lat, lon) : null;
          const altM = bathy ? sampleAt(bathy, bathy.v, lat, lon) : null;
          const depthFt = altM == null || altM >= 0 ? null : -altM * 3.28084;
          const u = curU ? sampleAt(curU, curU.v, lat, lon) : null;
          const v = curV ? sampleAt(curV, curV.v, lat, lon) : null;
          const curKt = (u == null || v == null) ? null : Math.hypot(u, v) * MS_TO_KT;

          const sPart = clamp01((sg - SST_GRAD_MIN) / (SST_GRAD_GOOD - SST_GRAD_MIN));
          const cPart = cg == null ? 0
            : clamp01((cg - CHL_GRAD_MIN) / (CHL_GRAD_GOOD - CHL_GRAD_MIN));
          const bPart = slope == null ? 0
            : clamp01((slope - SLOPE_MIN) / (SLOPE_GOOD - SLOPE_MIN));
          const uPart = curKt == null ? 0
            : clamp01((curKt - CUR_MIN) / (CUR_GOOD - CUR_MIN));

          // A temperature break alone is worth something. A temperature
          // break ON a colour change is worth far more than the sum — that
          // is the clean-water line, and it is the whole reason to look at
          // two satellites instead of one. Bottom relief and current get
          // the same treatment: a wall standing on the shelf edge, with
          // water moving across it, is the thing worth forty miles.
          const score = Math.round(100 * clamp01(
            0.40 * sPart + 0.20 * cPart + 0.16 * bPart + 0.08 * uPart
            + 0.30 * sPart * cPart
            + 0.16 * sPart * bPart,
          ));

          // CORROBORATION. A temperature wobble over flat bottom in dead
          // water is noise dressed as a spot, however steep it looks —
          // satellites see cloud edges and sensor seams too. Something
          // else has to agree before it may be drawn.
          const corroborated =
            (cg != null && cg >= CHL_GRAD_MIN) ||
            (slope != null && slope >= SLOPE_MIN * 2) ||
            (curKt != null && curKt >= CUR_MIN * 2);
          if (!corroborated) continue;

          cells.push({ i, j, lat, lon, sg, cg, slope, depthFt, curKt, score });
        }
      }

      // ---- group adjacent cells into one edge -------------------------
      // A break is a LINE, not a pixel. Without this the same wall would
      // produce forty cards two kilometres apart.
      const key = (i: number, j: number) => `${i},${j}`;
      const byKey = new Map(cells.map(c => [key(c.i, c.j), c]));
      const seen = new Set<string>();
      const groups: Cell[][] = [];
      for (const c of cells) {
        const k0 = key(c.i, c.j);
        if (seen.has(k0)) continue;
        const stack = [c]; seen.add(k0);
        const group: Cell[] = [];
        while (stack.length) {
          const cur = stack.pop()!;
          group.push(cur);
          for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
              if (!di && !dj) continue;
              const k = key(cur.i + di, cur.j + dj);
              const nb = byKey.get(k);
              if (nb && !seen.has(k)) { seen.add(k); stack.push(nb); }
            }
          }
        }
        groups.push(group);
      }

      // ---- turn each group into spots ---------------------------------
      /* A group is a whole BREAK, and a break is not a place — the shelf-edge
         front runs the width of the region. Taking one peak per group meant
         a hundred-mile wall produced a single pin at its hottest pixel, so
         MAX_SPOTS and the four-mile spacing rule could never bind: twelve
         regions, twelve pins, most of them nowhere near anybody's port.
         Each group now offers up its strongest cells that stand at least
         MIN_SEPARATION_NM apart, and the spacing pass below still has the
         last word. A long front becomes several places to start looking,
         which is what it is. */
      const peaksOf = (group: Cell[]) => {
        const picked: Cell[] = [];
        for (const c of [...group].sort((a, b) => b.score - a.score)) {
          if (picked.length >= MAX_SPOTS) break;
          if (picked.every(o => distBearing(o.lat, o.lon, c.lat, c.lon).dist >= MIN_SEPARATION_NM)) {
            picked.push(c);
          }
        }
        return picked;
      };

      const observed = sst.time || new Date().toISOString();
      // A few hot pixels are not a wall. Filtered here rather than after the
      // spots are built, because one group no longer means one spot.
      let spots = groups.filter(g => g.length >= MIN_CELLS).flatMap(group =>
        peaksOf(group).map(peak => buildSpot(group, peak)));

      function buildSpot(group: Cell[], peak: Cell) {
        // The peak is the spot. A centroid of a curving break lands in the
        // middle of nowhere, which is a good way to send someone 30 miles
        // to flat water. The span is the whole break's, not this peak's:
        // "running 40 nm NE" describes the wall, and that is the part worth
        // knowing when deciding where along it to start.
        const lats = group.map(c => c.lat), lons = group.map(c => c.lon);
        const spanLatNm = (Math.max(...lats) - Math.min(...lats)) * NM_PER_DEG_LAT;
        const spanLonNm = (Math.max(...lons) - Math.min(...lons)) * nmPerDegLon(peak.lat);
        const lengthNm = Math.hypot(spanLatNm, spanLonNm);
        let bearing = Math.atan2(spanLonNm, spanLatNm) * 180 / Math.PI;
        if (bearing < 0) bearing += 180;

        const sstF = (() => {
          const v = sst.v[peak.i][peak.j];
          return v == null ? null : cToF(v);
        })();
        const { dist, brg } = distBearing(reg.port_lat, reg.port_lon, peak.lat, peak.lon);
        /* The drop across the break — what a captain actually pictures, and
           a number the card states out loud, so it has to be the water's
           and not an extrapolation. This used to be the peak gradient times
           four miles, which on a front with 3.6 °F in it claimed 7.6: the
           gradient is a local maximum, and assuming it holds for four miles
           invents temperature that is not there. Measured instead, as the
           real spread of the surface temperature around the peak. The window
           is +/-2 cells, about two and a half miles at this stride. */
        const dropF = (() => {
          let lo = Infinity, hi = -Infinity;
          for (let di = -2; di <= 2; di++) {
            for (let dj = -2; dj <= 2; dj++) {
              const v = sst.v[peak.i + di]?.[peak.j + dj];
              if (v == null) continue;
              const f = cToF(v);
              if (f < lo) lo = f;
              if (f > hi) hi = f;
            }
          }
          return hi > lo ? hi - lo : peak.sg;
        })();
        const chlV = chl ? sampleAt(chl, chl.v, peak.lat, peak.lon) : null;

        // The card has to say WHY, in the order a captain would ask: what
        // the break is, what it is standing on, and what the water is doing
        // across it.
        const depthPhrase = peak.depthFt == null ? ''
          : peak.depthFt >= 600
            ? `, over ${Math.round(peak.depthFt / 6 / 100) * 100} fathoms`
            : `, in ${Math.round(peak.depthFt / 10) * 10} ft`;
        const slopePhrase = peak.slope != null && peak.slope >= SLOPE_GOOD * 0.5
          ? ' on the drop-off' : '';
        const curPhrase = peak.curKt != null && peak.curKt >= CUR_MIN * 2
          ? `, ${peak.curKt.toFixed(1)} kt of current across it` : '';

        const why =
          `${sstF != null ? `${sstF.toFixed(1)}°F ` : ''}temperature break` +
          `${dropF >= 1 ? `, about ${dropF.toFixed(1)}° across it` : ''}` +
          `${lengthNm >= 2 ? `, running ${lengthNm.toFixed(0)} nm ${compass(bearing)}` : ''}` +
          `${peak.cg != null && peak.cg >= CHL_GRAD_MIN ? ', on a colour change' : ''}` +
          `${depthPhrase}${slopePhrase}${curPhrase}` +
          `. ${dist.toFixed(0)} nm ${compass(brg)} of ${reg.port_name}.`;

        return {
          region_id: reg.id,
          observed_at: observed,
          kind: (peak.cg != null && peak.cg >= CHL_GRAD_MIN ? 'convergence' : 'temp_break') as const,
          lat: peak.lat, lon: peak.lon,
          score: peak.score,
          sst_f: sstF, sst_drop_f: dropF, sst_grad_f_nm: peak.sg,
          chl_mg_m3: chlV, chl_grad: peak.cg,
          depth_ft: peak.depthFt, slope_ft_nm: peak.slope, current_kt: peak.curKt,
          length_nm: lengthNm, bearing_deg: bearing,
          dist_nm: dist, from_port_deg: brg,
          why,
        };
      }

      // A few hot pixels are noise, not a wall — but keep the rejected
      // ones to hand, because a week with nothing strong still has a
      // strongest.
      const allScored = spots;
      spots = spots
        .filter(s => s.score >= MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SPOTS * 4);

      /* Nothing cleared the bar? Show the best of a flat week anyway, said
         plainly.
         An empty map is not an honest answer — it reads as "broken" or
         "no data", when the truth is "the sea is flat and here is the most
         there is". So the strongest few are kept, scored as they really
         are, with a why that opens by admitting it. The bar is NOT
         lowered: these carry their real score, so a 44 shows as a 44 and
         sorts below anything genuine the moment real water turns up. */
      let kept = spots;
      let marginal = false;
      if (!kept.length) {
        marginal = true;
        kept = allScored
          .sort((a, b) => b.score - a.score)
          .slice(0, MARGINAL_SPOTS)
          .map(sp => ({ ...sp, why: `Nothing strong this pass \u2014 this is the best of it. ${sp.why}` }));
      }

      // Thin out near-duplicates: two cards four miles apart describing the
      // same wall is one card and a distraction. The list is already sorted
      // by score, so the first one kept in any neighbourhood is the
      // strongest one.
      const spaced: typeof kept = [];
      for (const sp of kept) {
        const tooClose = spaced.some(
          o => distBearing(o.lat, o.lon, sp.lat, sp.lon).dist < MIN_SEPARATION_NM);
        if (!tooClose) spaced.push(sp);
        if (spaced.length >= MAX_SPOTS) break;
      }

      // ---- predictive zones, one per PELAGIC SPECIES ------------------
      // Every ~6 km cell scored for each trolled species: temperature
      // band + season + depth band + edge strength, all from the priors
      // in species-habitat.js. The Sirius-style species map — each
      // species gets its own row of cells, each drawn in its own colour.
      const month = new Date(observed).getUTCMonth() + 1;
      const zoneRows = PELAGIC_SPECIES.map((sp) => {
        const zcells: [number, number, number][] = [];
        for (let i = 1; i < sst.lats.length - 1; i += ZONE_STRIDE) {
          for (let j = 1; j < sst.lons.length - 1; j += ZONE_STRIDE) {
            const v = sst.v[i][j];
            if (v == null) continue;
            const lat = sst.lats[i], lon = sst.lons[j];
            const sstF = cToF(v);
            // Edge strength: temperature OR colour break, whichever is
            // stronger — pelagics work both kinds of line.
            const sg = clamp01((sstGrad[i][j] ?? 0) / SST_GRAD_GOOD);
            const cgRaw = chl && chlGrad ? sampleAt(chl, chlGrad, lat, lon) : null;
            const cg = cgRaw == null ? 0 : clamp01(cgRaw / CHL_GRAD_GOOD);
            const edgeStrength = Math.max(sg, cg);
            // ETOPO altitude: negative metres = depth. Land (>= 0) scores 0
            // through the depth gate inside habitatScore.
            const alt = bathy ? sampleAt(bathy, bathy.v, lat, lon) : null;
            const depthFt = alt == null ? null : (alt < 0 ? -alt * 3.28084 : 1);
            const s = habitatScore(sp, { sstF, depthFt, edgeStrength, month });
            if (s == null) continue;
            const score = Math.round(100 * s);
            if (score >= ZONE_MIN_SCORE) {
              zcells.push([Number(lat.toFixed(3)), Number(lon.toFixed(3)), score]);
            }
          }
        }
        zcells.sort((a, b) => b[2] - a[2]);
        return {
          region_id: reg.id,
          mode_key: sp,                 // one row per species now
          observed_at: observed,
          step_deg: Number(((sst.lats[1] - sst.lats[0]) * ZONE_STRIDE).toFixed(4)),
          cells: zcells.slice(0, ZONE_MAX_CELLS),
        };
      });

      if (body.dry_run) {
        out.push({ region: reg.id, observed, grid: `${sst.lats.length}x${sst.lons.length}`,
                   candidates: cells.length, groups: groups.length, marginal, spots: spaced,
                   zones: zoneRows.map(z => ({ mode: z.mode_key, cells: (z.cells as unknown[]).length })) });
        continue;
      }

      const { error: upErr } = await db.from('hotspots')
        .upsert(spaced, { onConflict: 'region_id,observed_at,lat,lon' });
      if (upErr) throw upErr;

      // ---- current vectors, one row keyed '_currents' ------------------
      // cells here are [lat, lon, speed_kt, dir_deg] — dir is the compass
      // direction the water flows TOWARD, which is how a captain says it.
      // Underscore key can never collide with a species id.
      if (curDoc) {
        try {
          const cur = toGrid(curDoc, 'ugos');
          const curV = toGrid(curDoc, 'vgos');
          const vec: [number, number, number, number][] = [];
          for (let i = 0; i < cur.lats.length; i++) {
            for (let j = 0; j < cur.lons.length; j++) {
              const u = cur.v[i][j], v = curV.v[i][j];
              if (u == null || v == null) continue;
              const kt = Math.hypot(u, v) * MS_TO_KT;
              // 0.1 kt was the right floor for ARROWS — a glyph on still
              // water says nothing. It is the wrong floor for a flow
              // animation: particles die where there is no cell, so that
              // threshold punched the entire quiet half of the Gulf out of
              // the picture and left the Loop Current floating alone in
              // blank water. Slow water is still water moving, and the
              // speed bands already say it is slow.
              if (kt < 0.03) continue;
              let dir = Math.atan2(u, v) * 180 / Math.PI;
              if (dir < 0) dir += 360;
              vec.push([Number(cur.lats[i].toFixed(3)), Number(cur.lons[j].toFixed(3)),
                        Number(kt.toFixed(2)), Math.round(dir)]);
            }
          }
          zoneRows.push({
            region_id: reg.id,
            mode_key: '_currents',
            observed_at: cur.time || observed,
            step_deg: 0.25,
            cells: vec as unknown as [number, number, number][],
          });
        } catch { /* currents are optional — zones still publish without them */ }
      }

      // Zones replace wholesale — perishable, no history worth keeping.
      // Delete-then-insert also clears rows keyed by retired mode/species
      // ids (the first cut keyed rows by trip mode, not species).
      await db.from('hotspot_zones').delete().eq('region_id', reg.id);
      const { error: zErr } = await db.from('hotspot_zones').insert(zoneRows);
      if (zErr) throw zErr;

      // Keep a fortnight. These are perishable — a week-old break has
      // moved, and showing it is worse than showing nothing.
      await db.from('hotspots').delete()
        .eq('region_id', reg.id)
        .lt('observed_at', new Date(Date.now() - 14 * 86400000).toISOString());

      status = `ok · ${stamp()} · ${loaded} · cells=${cells.length} spots=${spaced.length}` +
               `${marginal ? ' (marginal)' : ''} zones=${zoneRows.length}`;
      out.push({ region: reg.id, observed, grid: `${sst.lats.length}x${sst.lons.length}`,
                 candidates: cells.length, groups: groups.length, written: spots.length,
                 zones: zoneRows.map(z => ({ mode: z.mode_key, cells: (z.cells as unknown[]).length })) });
    } catch (e) {
      failure = `ERROR · ${stamp()} · ${loaded} · ${String(e)}`.slice(0, 460);
      // Every host silent is the one failure a retry cannot explain. Ask
      // whether this runtime can reach anything at all, and record the
      // answer beside the failure so nobody has to guess at it twice.
      if (String(e).includes('every erddap host failed')) {
        failure += ` · probe: ${await probeOutbound()}`;
      }
      out.push({ region: reg.id, error: failure });
    }
    // Stamped whatever happened. A region that throws every time still has
    // to move to the back of the queue, or it blocks the other eleven.
    // A FAILED region is stamped 90 minutes in the past, so it comes back
    // round in about half an hour instead of two hours — long enough for a
    // shed 503 to clear, short enough not to leave a hole in the map.
    // last_error is kept so a failing region can be read straight off the
    // table, instead of being reconstructed from a cron response that
    // pg_net prunes within hours.
    if (!body.dry_run) {
      await db.from('hotspot_regions').update({
        last_run_at: new Date(Date.now() - (failure ? 90 * 60000 : 0)).toISOString(),
        // Named last_error, but it carries the outcome EITHER way: a run
        // that published nothing and a run that was never attempted look
        // the same in the tables, and telling them apart used to need a
        // cron response body that pg_net had already pruned.
        last_error: (failure || status).slice(0, 900),
      }).eq('id', reg.id);
    }
  }

  return json({ ok: true, remaining: Math.max(0, all.length - done), regions: out });
});
