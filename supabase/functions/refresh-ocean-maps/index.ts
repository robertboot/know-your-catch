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
const ERDDAP_BASE = 'https://coastwatch.pfeg.noaa.gov/erddap';
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
  { key: 'chl', dataset: 'erdMH1chla8day_R2022NRT', variable: 'chlorophyll' },
  { key: 'sst', dataset: 'jplMURSST41',             variable: 'analysed_sst' },
];

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
function sstGriddapUrl(dataset: string, variable: string) {
  const [lo, hi] = sstRangeC(new Date().getUTCMonth());
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

async function fetchLayer(url: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return { ok: false, error: `erddap ${r.status}` };
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
      adminOk = ['robertb1023@me.com', 'annelies@reelintel.ai'].includes((data?.user?.email || '').toLowerCase());
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
    const url = layer.key === 'sst'
      ? sstGriddapUrl(layer.dataset, layer.variable)
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
