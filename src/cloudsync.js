/* Cloud sync (Supabase) — citizen-science backend for the NOAA
   research partnership.

   Dormant when not configured: if SUPABASE_URL or SUPABASE_ANON_KEY
   is empty, all sync calls no-op silently. The local catch log
   remains canonical. When configured AND the user has opted in,
   each saved catch is also published to the central dataset.

   Privacy contract:
   - Opt-in only (state.research.consented + state.research.anglerId)
   - Coordinate precision honours state.research.locPrecision
     ('exact' | 'grid_1km' | 'grid_10km')
   - Photos are a separate opt-in (state.research.sharePhotos),
     defaulted to false. Photo upload not wired yet — schema is
     ready for it under catch_photos.
*/
import { createClient } from '@supabase/supabase-js';

// === CONFIG ============================================================
// Drop your Supabase project URL + anon key here when ready.
// Until both are set, every function in this module is a no-op.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
export const CONSENT_VERSION = 1;

let _client = null;
function client() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return _client;
}

export const isConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// === CONSENT + ANGLER SIGN-UP ==========================================
/**
 * Idempotently register an anonymous angler and store the angler row id.
 * Returns { anglerId } when configured + signed in, null otherwise.
 */
export async function ensureAngler({ jurisdiction, appVersion } = {}) {
  const c = client(); if (!c) return null;
  // Sign in anonymously if not already.
  let { data: { session } } = await c.auth.getSession();
  if (!session) {
    const { data, error } = await c.auth.signInAnonymously();
    if (error) return null;
    session = data.session;
  }
  if (!session) return null;
  const anglerId = session.user.id;
  // Insert-once into anglers; rely on RLS to scope to self.
  await c.from('anglers').upsert({
    id: anglerId,
    consent_version: CONSENT_VERSION,
    jurisdiction: jurisdiction || null,
    app_version: appVersion || null,
  }, { onConflict: 'id' });
  return { anglerId };
}

// === PUBLISH A CATCH ===================================================
/** Best-effort: failures are swallowed; local log is canonical. */
export async function publishCatch(catchEntry, research) {
  const c = client(); if (!c || !research?.consented || !research.anglerId) return { skipped: true };
  const row = {
    angler_id:      research.anglerId,
    species_id:     catchEntry.speciesId,
    caught_at:      catchEntry.dateIso,
    lat: catchEntry.lat ?? null,
    lon: catchEntry.lon ?? null,
    jurisdiction:   catchEntry.jurisdiction || null,
    length_in:      catchEntry.length ?? null,
    weight_lb:      catchEntry.weight ?? null,
    sun_alt_deg:    catchEntry.sunAlt ?? null,
    sun_az_deg:     catchEntry.sunAz ?? null,
    moon_phase:     catchEntry.moonPhase ?? null,
    moon_illum:     catchEntry.moonIllum ?? null,
    moon_name:      catchEntry.moonName ?? null,
    temp_f:         catchEntry.weather?.tempF ?? null,
    wind_mph:       catchEntry.weather?.windMph ?? null,
    wind_dir_deg:   catchEntry.weather?.windDir ?? null,
    cloud_pct:      catchEntry.weather?.cloudPct ?? null,
    precip_mm:      catchEntry.weather?.precipMm ?? null,
    pressure_mb:    catchEntry.weather?.pressureMb ?? null,
    notes:          catchEntry.notes || null,
    client_id:      catchEntry.id,
    app_version:    research.appVersion || null,
  };
  try {
    const { error } = await c.from('catches').upsert(row, { onConflict: 'angler_id,client_id' });
    return { ok: !error, error: error?.message };
  } catch (e) {
    return { ok: false, error: e?.message || 'sync failed' };
  }
}

// (Per policy, anglers cannot delete their contributed research data
// from this client. The app is free in exchange for permanent
// contribution. Admin-side deletion lives in the admin tooling.)
