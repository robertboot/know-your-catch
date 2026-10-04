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

const ERDDAP = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap';
// MUR is 0.01° (~1 km). Every other cell is ~2 km, which is finer than any
// break worth driving to and keeps the grid at a size an edge function can
// hold in memory.
const SST_DATASET = 'jplMURSST41';
const SST_STRIDE  = 2;
const CHL_DATASET = 'erdMH1chla8day_R2022NRT';
const CHL_STRIDE  = 1;
const FETCH_TIMEOUT_MS = 90_000;

// What counts as an edge. A break under ~0.4 °F/nm is noise in a 1 km
// satellite product; 1.5 °F/nm is the kind of wall people run 40 miles for.
const SST_GRAD_MIN  = 0.40;
const SST_GRAD_GOOD = 1.50;
const CHL_GRAD_MIN  = 0.12;   // log10(mg/m³) per nautical mile
const CHL_GRAD_GOOD = 0.60;
const MIN_SCORE     = 45;     // below this it is not worth a card
const MAX_SPOTS     = 12;     // a captain reads three. Twelve is generous.
// Community catch influence is gated on this — see PRIVACY above. Below it,
// a "hotspot" is one angler's spot with a satellite picture behind it.
const MIN_DISTINCT_ANGLERS = 3;

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

async function fetchJson(url: string) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`erddap ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
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

type Cell = { i: number; j: number; lat: number; lon: number; sg: number; cg: number | null; score: number };

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
  let q = db.from('hotspot_regions').select('*').eq('active', true);
  if (body.region) q = q.eq('id', body.region);
  const { data: regions, error: regErr } = await q;
  if (regErr) return json({ error: regErr.message }, 500);
  if (!regions?.length) return json({ error: 'no active regions' }, 404);

  const out: Record<string, unknown>[] = [];

  for (const reg of regions) {
    try {
      const box = (stride: number) =>
        `[(last)][(${reg.south}):${stride}:(${reg.north})][(${reg.west}):${stride}:(${reg.east})]`;
      const [sstDoc, chlDoc] = await Promise.all([
        fetchJson(`${ERDDAP}/${SST_DATASET}.json?analysed_sst${box(SST_STRIDE)}`),
        fetchJson(`${ERDDAP}/${CHL_DATASET}.json?chlorophyll${box(CHL_STRIDE)}`).catch(() => null),
      ]);

      const sst = toGrid(sstDoc, 'analysed_sst');
      const chl = chlDoc ? toGrid(chlDoc, 'chlorophyll') : null;

      // SST arrives in °C. Work in °F throughout: it is what the card says,
      // and converting once here means no unit lives in two places.
      const sstGrad = gradient(sst, cToF);
      // Chlorophyll spans three orders of magnitude, so a plain difference
      // is dominated by the green inshore water. log10 makes the edge
      // between 0.1 and 0.3 as visible as the one between 1 and 3.
      const chlGrad = chl ? gradient(chl, (x) => Math.log10(Math.max(x, 0.001))) : null;

      // ---- score every cell -----------------------------------------
      const cells: Cell[] = [];
      for (let i = 1; i < sst.lats.length - 1; i++) {
        for (let j = 1; j < sst.lons.length - 1; j++) {
          const sg = sstGrad[i][j];
          if (sg == null || sg < SST_GRAD_MIN) continue;
          const lat = sst.lats[i], lon = sst.lons[j];
          const cg = chl && chlGrad ? sampleAt(chl, chlGrad, lat, lon) : null;

          const sPart = clamp01((sg - SST_GRAD_MIN) / (SST_GRAD_GOOD - SST_GRAD_MIN));
          const cPart = cg == null ? 0
            : clamp01((cg - CHL_GRAD_MIN) / (CHL_GRAD_GOOD - CHL_GRAD_MIN));
          // A temperature break alone is worth something. A temperature
          // break ON a colour change is worth far more than the sum — that
          // is the clean-water line, and it is the whole reason to look at
          // two satellites instead of one.
          const score = Math.round(100 * clamp01(0.55 * sPart + 0.25 * cPart + 0.45 * sPart * cPart));
          cells.push({ i, j, lat, lon, sg, cg, score });
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

      // ---- turn each group into one spot ------------------------------
      const observed = sst.time || new Date().toISOString();
      const spots = groups.map(group => {
        // The peak is the spot. A centroid of a curving break lands in the
        // middle of nowhere, which is a good way to send someone 30 miles
        // to flat water.
        const peak = group.reduce((a, b) => (b.score > a.score ? b : a));
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
        // The drop across the break, which is what a captain actually
        // pictures: gradient times the width the break runs over.
        const dropF = peak.sg * Math.max(1, Math.min(lengthNm, 4));
        const chlV = chl ? sampleAt(chl, chl.v, peak.lat, peak.lon) : null;

        const why =
          `${sstF != null ? `${sstF.toFixed(1)}°F ` : ''}temperature break` +
          `${dropF >= 1 ? `, about ${dropF.toFixed(1)}° across it` : ''}` +
          `${lengthNm >= 2 ? `, running ${lengthNm.toFixed(0)} nm ${compass(bearing)}` : ''}` +
          `${peak.cg != null && peak.cg >= CHL_GRAD_MIN ? ', on a colour change' : ''}` +
          `. ${dist.toFixed(0)} nm ${compass(brg)} of ${reg.port_name}.`;

        return {
          region_id: reg.id,
          observed_at: observed,
          kind: (peak.cg != null && peak.cg >= CHL_GRAD_MIN ? 'convergence' : 'temp_break') as const,
          lat: peak.lat, lon: peak.lon,
          score: peak.score,
          sst_f: sstF, sst_drop_f: dropF, sst_grad_f_nm: peak.sg,
          chl_mg_m3: chlV, chl_grad: peak.cg,
          length_nm: lengthNm, bearing_deg: bearing,
          dist_nm: dist, from_port_deg: brg,
          why,
        };
      })
        // A single hot pixel is noise, not a wall.
        .filter((s, idx) => s.score >= MIN_SCORE && groups[idx].length >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SPOTS);

      if (body.dry_run) {
        out.push({ region: reg.id, observed, grid: `${sst.lats.length}x${sst.lons.length}`,
                   candidates: cells.length, groups: groups.length, spots });
        continue;
      }

      const { error: upErr } = await db.from('hotspots')
        .upsert(spots, { onConflict: 'region_id,observed_at,lat,lon' });
      if (upErr) throw upErr;

      // Keep a fortnight. These are perishable — a week-old break has
      // moved, and showing it is worse than showing nothing.
      await db.from('hotspots').delete()
        .eq('region_id', reg.id)
        .lt('observed_at', new Date(Date.now() - 14 * 86400000).toISOString());

      out.push({ region: reg.id, observed, grid: `${sst.lats.length}x${sst.lons.length}`,
                 candidates: cells.length, groups: groups.length, written: spots.length });
    } catch (e) {
      out.push({ region: reg.id, error: String(e) });
    }
  }

  return json({ ok: true, regions: out });
});
