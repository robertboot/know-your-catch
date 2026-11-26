/* refresh-ocean-maps — snapshot the ocean satellite layers.

   Every angler opening Ocean Maps used to hit NOAA CoastWatch ERDDAP
   directly. ERDDAP renders each PNG on demand out of gridded NetCDF
   (jplMURSST41 is a 1 km global field), so those requests are slow,
   fail when NOAA is busy, and — at any real user count — are exactly
   how an app gets rate-limited or IP-blocked by NOAA.

   The imagery is identical for every user: one fixed region, one
   "latest" timestep. So render it ONCE here and let everyone read a
   static file off the CDN.

   Writes to the public `ocean-maps` bucket:
     chl-latest.png    chlorophyll, current 8-day composite
     sst-latest.png    sea surface temp, current daily MUR field
     chlh0..2-latest.png  chlorophyll, three newest 750 m passes (NOAA-21 VIIRS)
     chld-latest.png   a copy of chlh0, the name older app builds draw
     manifest.json     { capturedAt, layers: { chl: {...}, sst: {...} } }

   The manifest is what the client checks — it carries per-layer ok/
   bytes so a half-failed refresh is visible rather than silently
   serving a stale or missing image.

   PARTIAL FAILURE IS NOT FATAL: if one layer fetches and the other
   doesn't, the good one is still published and the manifest records
   the failure. Overwriting a working snapshot with nothing would be
   worse than leaving yesterday's image up.

   Auth: x-cron-secret header must match CRON_SECRET (same convention
   as auto-update-regulations), so pg_cron can call it headless.
   Admins can also trigger it from the Ocean panel with a user JWT.

   Body (optional): { width?: number, height?: number } */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'ocean-maps';
/* Same failover as find-hotspots, and for the same reason: coastwatch.pfeg
   went fully 503 and took the satellite layers down with it, with no second
   address to try. upwell.pfeg is a separate ERDDAP instance serving the same
   dataset ids. URLs are built with a {H} token where the host goes and the
   fetchers substitute each host in turn, so a builder cannot pin itself to
   one server. */
const ERDDAP_HOSTS = [
  'https://coastwatch.pfeg.noaa.gov/erddap',
  'https://upwell.pfeg.noaa.gov/erddap',
  // A different institution, so it survives a NOAA-wide failure. It carries
  // jplMURSST41 (the sea-temperature layer); the colour layer is an ERD
  // dataset it probably does not have, and a host without a dataset answers
  // 404, which just moves the walk along.
  'https://erddap.marine.usf.edu/erddap',
];
const ERDDAP_BASE = '{H}';
const ERDDAP_WMS = `${ERDDAP_BASE}/wms`;

// Must match REGION_BOUNDS in src/screens_ocean.jsx — [S,W] [N,E].
const REGION = { south: 22.0, west: -98.5, north: 31.5, east: -77.5 };

// Rendered once, so we can afford retina. The old per-user request was
// 600x272 and got upscaled on tablets.
const DEFAULT_W = 1800;
const DEFAULT_H = 816;

// ERDDAP can sit on a slow render for a long time; cap it so one bad
// layer can't run the whole function into its wall-clock limit.
const FETCH_TIMEOUT_MS = 90_000;

const LAYERS = [
  { key: 'chl',  dataset: 'erdMH1chla8day_R2022NRT', variable: 'chlorophyll' },
  { key: 'sst',  dataset: 'jplMURSST41',             variable: 'analysed_sst' },
];

/* Sharp chlorophyll: NOAA-21 VIIRS at 750 m, the three newest passes.

   The layer this replaces was NOAA-20 VIIRS at 4 km - one pixel is about
   two nautical miles, so a 150 nm view of it is visibly squares, and Rob
   asked whether the picture could be more accurate. It could: the same
   server publishes the US sector at 750 m (0.0075 deg), five times finer
   each way. Measured 2026-11-26 over this box: the 4 km layer covered
   14.8% of it and its newest day was ten days old; one 750 m pass
   covered 21.4%, three or four stacked about 36%, newest four days old.

   Three passes, not one, because a single day is mostly cloud. The app
   stacks them oldest-first over the 8-day composite, so the newest clear
   look wins each pixel.

   Only coastwatch.noaa.gov carries it, so it is fetched from there
   directly rather than through the host walk. That server answers 502
   to roughly one request in three and then succeeds on the next, so
   every fetch here retries. griddap .transparentPng with the same log
   0.03-30 mg/m3 scale the legend prints. The dataset has an altitude
   axis with a single 0.0 value, and a time axis of real pass times -
   which is why the passes are asked for by the time the axis reports
   rather than as "(last-1)", which this server quietly reads as (last). */
const CW_ERDDAP = 'https://coastwatch.noaa.gov/erddap';
const CHL_HI = { dataset: 'noaacwN21VIIRSchlaNSWUSDaily', variable: 'chlor_a', passes: 3 };
const HI_TRIES = 3;

function chlHiUrl(timeIso: string) {
  const subset = `${CHL_HI.variable}[(${timeIso})][(0.0)][(${REGION.south}):(${REGION.north})][(${REGION.west}):(${REGION.east})]`;
  return `${CW_ERDDAP}/griddap/${CHL_HI.dataset}.transparentPng?${subset}&.colorBar=Rainbow||Log|0.03|30|`;
}

/** The newest pass times, newest first. Empty if the axis cannot be read. */
async function chlHiTimes(): Promise<string[]> {
  const url = `${CW_ERDDAP}/griddap/${CHL_HI.dataset}.json?time[last-${CHL_HI.passes - 1}:1:last]`;
  for (let i = 0; i < HI_TRIES; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (r.ok) {
        const rows = (await r.json())?.table?.rows as string[][] | undefined;
        const times = (rows || []).map((x) => x[0]).filter(Boolean).reverse();
        if (times.length) return times;
      }
    } catch { /* retried below */ } finally { clearTimeout(timer); }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return [];
}

async function fetchHi(url: string) {
  let last: { ok: true; bytes: Uint8Array } | { ok: false; error: string } = { ok: false, error: 'not tried' };
  for (let i = 0; i < HI_TRIES; i++) {
    last = await fetchLayerFrom(url, CW_ERDDAP);
    if (last.ok) return last;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return last;
}

/* SST colour range in °C, by month. Must stay in sync with sstRangeC()
   in src/screens_ocean.jsx, which draws the legend.

   ERDDAP's default range saturated: the Gulf runs 29-32 °C through late
   summer against a palette topping out near 31.7 °C, so the whole basin
   rendered solid red and the temperature BREAKS the layer exists to show
   were invisible. */
function sstRangeC(month: number): [number, number] {
  if (month >= 5 && month <= 8)  return [27, 32];  // Jun-Sep
  if (month >= 3 && month <= 4)  return [22, 29];  // Apr-May
  if (month >= 9 && month <= 10) return [22, 29];  // Oct-Nov
  return [14, 24];                                 // Dec-Mar
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

/* SST goes through griddap .transparentPng, not WMS.

   This ERDDAP's WMS refuses any style override — it answers
   "STYLE=boxfill/rainbow is invalid (must be \"\")" — and without a
   style it also ignores colorBarMinimum/Maximum, so the palette is
   whatever the dataset defaults to. In late summer that put the entire
   29-32 °C Gulf at the top of the scale: sampled pixels came back
   255,0,0 through 139,0,0, pure red with no green or blue channel.

   griddap's .transparentPng renders just the data (no axes or legend,
   so it drops straight onto the map) and DOES honour .colorBar, which
   is the only way to fix the range. */
/* The colour range, measured rather than assumed.
 *
 * A fixed month table cannot win. Set it wide and every break disappears
 * into one smear; set it narrow and the first unusual week saturates the
 * whole Gulf solid red — which is exactly what happened in October, with
 * water at 29-30 °C against a table topping out at 29.
 *
 * So read a coarse sample of the actual field first and colour between its
 * 2nd and 98th percentiles. The tails are clipped because a single
 * cloud-edge pixel at 15 °C would otherwise stretch the scale and flatten
 * everything real. The span is floored at 3 °C so a genuinely uniform sea
 * does not get amplified into dramatic-looking noise.
 */
async function measuredSstRangeC(dataset: string, variable: string): Promise<[number, number]> {
  const fallback = sstRangeC(new Date().getUTCMonth());
  try {
    // Stride 40 on a 0.01° grid is ~45 km: far too coarse to map, ample
    // to characterise a distribution.
    const subset = `${variable}[(last)][(${REGION.south}):40:(${REGION.north})][(${REGION.west}):40:(${REGION.east})]`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let r: Response | null = null;
    try {
      for (const host of ERDDAP_HOSTS) {
        try {
          const got = await fetch(`${host}/griddap/${dataset}.json?${subset}`, { signal: ctl.signal });
          if (got.ok) { r = got; break; }
        } catch { /* try the next host */ }
      }
    } finally {
      clearTimeout(timer);
    }
    if (!r) return fallback;
    const doc = await r.json();
    const names: string[] = doc.table.columnNames;
    const iVal = names.indexOf(variable);
    const vals: number[] = [];
    for (const row of doc.table.rows) {
      const v = row[iVal];
      if (v != null && Number.isFinite(v)) vals.push(v);
    }
    if (vals.length < 50) return fallback;
    vals.sort((a, b) => a - b);
    const at = (q: number) => vals[Math.min(vals.length - 1, Math.floor(q * vals.length))];
    let lo = at(0.02), hi = at(0.98);
    if (hi - lo < 3) {
      const mid = (hi + lo) / 2;
      lo = mid - 1.5; hi = mid + 1.5;
    }
    return [Math.round(lo * 10) / 10, Math.round(hi * 10) / 10];
  } catch {
    return fallback;
  }
}

function sstGriddapUrl(dataset: string, variable: string, lo: number, hi: number) {
  const subset = `${variable}[(last)][(${REGION.south}):(${REGION.north})][(${REGION.west}):(${REGION.east})]`;
  // .colorBar = palette|continuous|scale|min|max|nSections
  return `${ERDDAP_BASE}/griddap/${dataset}.transparentPng?${subset}&.colorBar=Rainbow|||${lo}|${hi}|`;
}

function wmsUrl(key: string, dataset: string, variable: string, width: number, height: number) {
  const params = new URLSearchParams({
    service: 'WMS', version: '1.3.0', request: 'GetMap',
    crs: 'EPSG:4326',
    bbox: `${REGION.south},${REGION.west},${REGION.north},${REGION.east}`,
    width: String(width), height: String(height),
    layers: `${dataset}:${variable}`, styles: '',
    format: 'image/png', transparent: 'true',
  });
  return `${ERDDAP_WMS}/${dataset}/request?${params.toString()}`;
}

async function fetchLayer(template: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  let last = { ok: false as const, error: 'no erddap host tried' };
  for (const host of ERDDAP_HOSTS) {
    const got = await fetchLayerFrom(template.replace('{H}', host), host);
    if (got.ok) return got;
    last = got;
  }
  return last;
}

async function fetchLayerFrom(url: string, host: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { ok: false, error: `${host} ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    const buf = new Uint8Array(await r.arrayBuffer());
    // ERDDAP reports errors as an XML/text body with a 200, so a
    // non-image content-type or a suspiciously tiny payload means the
    // render failed even though the HTTP call "succeeded".
    if (!/image\/png/i.test(ct)) {
      const head = new TextDecoder().decode(buf.slice(0, 900));
      return { ok: false, error: `non-image response (${ct}): ${head}` };
    }
    if (buf.byteLength < 1000) return { ok: false, error: `suspiciously small png (${buf.byteLength}B)` };
    return { ok: true, bytes: buf };
  } catch (e) {
    const msg = (e as Error).name === 'AbortError'
      ? `timeout after ${FETCH_TIMEOUT_MS}ms`
      : (e as Error).message;
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
      },
    });
  }
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const CRON_SECRET  = Deno.env.get('CRON_SECRET');
  if (!SUPABASE_URL || !SERVICE_ROLE) return jsonResponse({ error: 'server_misconfigured' }, 500);
  if (!CRON_SECRET)                   return jsonResponse({ error: 'missing CRON_SECRET' }, 500);

  // Cron calls carry the shared secret. An admin triggering a manual
  // refresh from the Ocean panel carries a normal user JWT instead.
  const cronOk = req.headers.get('x-cron-secret') === CRON_SECRET;
  let adminOk = false;
  if (!cronOk) {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const db = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data } = await db.auth.getUser(jwt);
      adminOk = ['robertb1023@me.com', 'annelies@reelintel.ai', 'harper@reelintel.ai'].includes((data?.user?.email || '').toLowerCase());
    }
  }
  if (!cronOk && !adminOk) return jsonResponse({ error: 'forbidden' }, 403);

  let width = DEFAULT_W, height = DEFAULT_H;
  try {
    const body = await req.json();
    if (Number.isFinite(body?.width))  width  = Math.max(256, Math.min(4096, Math.floor(body.width)));
    if (Number.isFinite(body?.height)) height = Math.max(256, Math.min(4096, Math.floor(body.height)));
  } catch { /* empty body is fine */ }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const capturedAt = new Date().toISOString();
  const results: Record<string, unknown> = {};
  let published = 0;

  for (const layer of LAYERS) {
    let sstRange: [number, number] | null = null;
    if (layer.key === 'sst') sstRange = await measuredSstRangeC(layer.dataset, layer.variable);
    const url = layer.key === 'sst'
      ? sstGriddapUrl(layer.dataset, layer.variable, sstRange![0], sstRange![1])
      : wmsUrl(layer.key, layer.dataset, layer.variable, width, height);
    const got = await fetchLayer(url);
    if (!got.ok) {
      // Leave whatever is already in the bucket alone — a stale image
      // beats a missing one.
      results[layer.key] = { ok: false, error: got.error, dataset: layer.dataset };
      continue;
    }
    const path = `${layer.key}-latest.png`;
    const { error } = await db.storage.from(BUCKET).upload(path, got.bytes, {
      contentType: 'image/png',
      upsert: true,
      // Clients get a fresh image within the refresh window without
      // re-downloading on every open.
      cacheControl: '3600',
    });
    if (!error && sstRange) {
      // The legend must read the range the image was actually drawn with.
      // Recomputing it anywhere else is how a scale ends up labelled with
      // numbers the colours do not match.
      await db.storage.from(BUCKET).upload(
        `${layer.key}-latest.json`,
        new Blob([JSON.stringify({ lo: sstRange[0], hi: sstRange[1], unit: 'C', captured_at: capturedAt })]),
        { contentType: 'application/json', upsert: true, cacheControl: '3600' },
      ).catch(() => {});
    }
    if (error) {
      results[layer.key] = { ok: false, error: `upload: ${error.message}`, dataset: layer.dataset };
      continue;
    }
    published += 1;
    results[layer.key] = {
      ok: true, path, bytes: got.bytes.byteLength,
      dataset: layer.dataset, width, height,
    };
  }

  /* The 750 m passes, fetched together: one takes ~16 s to render, and
     three in a row plus retries would crowd the function's wall clock.
     chlh0 is the newest. A pass that fails leaves the file already in the
     bucket alone - an older sharp image beats a hole.

     The newest pass is ALSO written as chld-latest.png. Every app already
     installed draws that name over the composite, so they get the sharp
     picture today, without waiting for an update. */
  const hiTimes = await chlHiTimes();
  if (!hiTimes.length) results.chlh = { ok: false, error: 'could not read pass times', dataset: CHL_HI.dataset };
  await Promise.all(hiTimes.map(async (t, i) => {
    const key = `chlh${i}`;
    const got = await fetchHi(chlHiUrl(t));
    if (!got.ok) { results[key] = { ok: false, error: got.error, dataset: CHL_HI.dataset, time: t }; return; }
    const names = i === 0 ? [`${key}-latest.png`, 'chld-latest.png'] : [`${key}-latest.png`];
    for (const path of names) {
      const { error } = await db.storage.from(BUCKET).upload(path, got.bytes, {
        contentType: 'image/png', upsert: true, cacheControl: '3600',
      });
      if (error) { results[key] = { ok: false, error: `upload ${path}: ${error.message}`, dataset: CHL_HI.dataset, time: t }; return; }
    }
    published += 1;
    results[key] = { ok: true, path: names[0], bytes: got.bytes.byteLength, dataset: CHL_HI.dataset, time: t };
    // The admin Ocean panel reads the daily layer's status under its old key.
    if (i === 0) results.chld = { ...(results[key] as object), path: 'chld-latest.png' };
  }));

  const manifest = {
    capturedAt,
    region: REGION,
    layers: results,
  };
  const { error: manErr } = await db.storage.from(BUCKET).upload(
    'manifest.json',
    new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    { contentType: 'application/json', upsert: true, cacheControl: '300' },
  );
  if (manErr) return jsonResponse({ ok: false, error: `manifest upload: ${manErr.message}`, results }, 500);

  return jsonResponse({ ok: published > 0, published, capturedAt, results });
});
