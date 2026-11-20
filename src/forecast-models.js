// Which weather model answers a forecast call.
//
// Open-Meteo's default ("best_match") does not use NOAA's RRFS for US
// waters: checked 2026-11-05 off Orange Beach (30.0, -87.6), the
// best_match hourly wind differed from ncep_rrfs_north_america in every
// one of the first 79 hours. RRFS is the 3 km hourly model that replaced
// HRRR and NAM, so for North American points the forecast asks for both
// and takes RRFS where it has a value.
//
// RRFS runs about 84 hours out (79 non-null hours came back on the check
// above), and it has no precipitation_probability at all — it is a single
// run, not an ensemble. So every value is merged one by one: RRFS when it
// is not null, best_match otherwise. Days 4-10 and every rain chance come
// from best_match, which is what they came from before.
//
// Shared by the app, the admin panel and the weekly-report edge function
// (Deno imports it straight from src/, like species-habitat.js).

export const RRFS = 'ncep_rrfs_north_america';
export const FALLBACK = 'best_match';

/* RRFS North America's domain. Checked: Gulf, Hawaii, Alaska, Puerto
   Rico, the Bahamas and Trinidad all return values; London, Colombia and
   Brazil do not. Outside the box the call stays plain best_match.
   (Open-Meteo answers a two-model call outside the domain with plain,
   unsuffixed keys anyway, and the merge below passes those through, so
   a box edge drawn a little wide costs nothing.) */
export function inRrfsDomain(lat, lon) {
  return lat >= 5 && lat <= 80 && lon >= -180 && lon <= -50;
}

/** Query-string fragment to append to an api.open-meteo.com/v1/forecast URL. */
export function forecastModelsParam(lat, lon) {
  return inRrfsDomain(Number(lat), Number(lon)) ? `&models=${RRFS},${FALLBACK}` : '';
}

/* Fold `<var>_<model>` keys back into plain `<var>` arrays, so every
   caller keeps reading j.hourly.wind_speed_10m as it always has.

   Hourly: per value, primary when not null, else fallback.

   Daily: per day, primary only when the primary model covers every hour
   of that date. A daily max over the eight hours RRFS reaches on its last
   day is not that day's max, so a partial day takes the fallback whole.

   Adds `hourly_source`: 'rrfs' where an hour's wind came from RRFS, null
   elsewhere, for the forecast screen's source label.

   A response with no suffixed keys (outside the domain, or no models=
   requested) is returned unchanged. */
export function mergeModelHourly(json, primary = RRFS, fallback = FALLBACK) {
  if (!json || typeof json !== 'object') return json;
  const sp = `_${primary}`, sf = `_${fallback}`;

  const fold = (block, pick) => {
    if (!block) return { block, vars: [] };
    const out = {};
    const vars = new Set();
    for (const k of Object.keys(block)) {
      if (k.endsWith(sp)) vars.add(k.slice(0, -sp.length));
      else if (k.endsWith(sf)) vars.add(k.slice(0, -sf.length));
      else out[k] = block[k];
    }
    for (const v of vars) out[v] = pick(v, block[v + sp], block[v + sf]);
    return { block: out, vars: [...vars] };
  };

  const h = fold(json.hourly, (_v, p, f) => {
    if (!p) return f;
    if (!f) return p;
    return p.map((x, i) => (x != null ? x : f[i] ?? null));
  });
  if (!h.vars.length) return json;

  // Which hours RRFS actually answered, judged on wind — the one field
  // every caller asks for and RRFS always fills where it reaches.
  const H = json.hourly;
  const ref = H['wind_speed_10m' + sp] || H[h.vars.map(v => v + sp).find(k => H[k])];
  const times = H.time || [];
  const hourly_source = times.map((_, i) => (ref?.[i] != null ? 'rrfs' : null));

  const fullDays = new Set();
  if (ref) {
    const seen = new Map(); // date -> [hours, covered]
    times.forEach((iso, i) => {
      const d = String(iso).slice(0, 10);
      const s = seen.get(d) || [0, 0];
      s[0]++; if (ref[i] != null) s[1]++;
      seen.set(d, s);
    });
    for (const [d, [n, c]] of seen) if (n > 0 && n === c) fullDays.add(d);
  }

  const dayTimes = json.daily?.time || [];
  const d = fold(json.daily, (_v, p, f) => {
    if (!p) return f;
    if (!f) return p;
    return f.map((x, i) => (fullDays.has(String(dayTimes[i])) && p[i] != null ? p[i] : x));
  });

  return { ...json, hourly: { ...h.block, hourly_source }, ...(json.daily ? { daily: d.block } : {}) };
}
