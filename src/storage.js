import { DATA_BUILD_DATE } from './data.js';

/* App state is persisted to localStorage under a single key. */
const STORAGE_KEY = 'kyc_app_state_v1';

export const defaultState = {
  jurisdiction: null,
  units: 'imperial',
  anglerName: '', // Used in shared catch/PB report cards. Empty falls back to "Angler".
  anglerEmail: '',
  // Account is captured during onboarding; the email is the future
  // anchor for magic-link auth once Supabase is provisioned. Until then
  // we store it locally only.
  onboardingAccountComplete: false,
  disclaimerAcceptedVersion: null,
  pbs: {},     // speciesId -> { length, weight, primaryMetric, date, location, notes, jurisdiction, gearBait, photo, history }
  notes: {},   // speciesId -> string
  catchLog: [], // [{ id, speciesId, dateIso, lat, lon, length, weight, photo, notes, sunAlt, sunAz, moonPhase, moonIllum, weather }]
  favorites: [], // [speciesId] — the species the angler keeps coming back to.
                 // Pinned to the top of every species/regulation list and seeded
                 // during onboarding right after the jurisdiction picker.
  onboardingFavoritesComplete: false,
  research: {
    // Consent is set by the (forthcoming) account-creation flow, not in
    // the app settings. Until set, cloud sync stays dormant.
    consented:      false,
    anglerId:       null,
    consentedAt:    null,
    consentVersion: 0,
  },
  syncMeta: { lastSyncDate: DATA_BUILD_DATE },
  // Highest consecutive-correct run in the Fish ID quiz, ever. Beat
  // this to set a new best. Session streak is transient.
  quizBestStreak: 0,
  // Custom species suggested by the user via the Log-a-Catch flow.
  // Each entry: { id: 'custom_XXXX', commonName, scientific, altNames[],
  //   notes, submittedAt, status: 'pending'|'approved'|'rejected'|'merged',
  //   approvedSpeciesId?, rejectionReason? }.
  // Immediately usable for logging catches; catches keep the custom_
  // id until sync brings back approved_species_id and the client
  // remaps them.
  // Capped at 25 to keep localStorage sane and stop suggestion spam.
  customSpecies: [],
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw);
    return {
      ...defaultState,
      ...parsed,
      pbs: parsed.pbs || {},
      notes: parsed.notes || {},
      catchLog: Array.isArray(parsed.catchLog) ? parsed.catchLog : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      customSpecies: Array.isArray(parsed.customSpecies) ? parsed.customSpecies : [],
      research: { ...defaultState.research, ...(parsed.research || {}) },
      syncMeta: parsed.syncMeta || defaultState.syncMeta,
    };
  } catch (e) {
    console.warn('Failed to load app state, using defaults', e);
    return defaultState;
  }
}

/* Returns:
   - { ok: true, bytes } on success
   - { ok: false, error, code: 'quota' | 'other' } on failure
   This used to swallow the error silently which is how oversized
   photos were silently dropping new catches on the floor — Safari's
   localStorage quota is ~5MB and a full-res iPhone JPEG encoded as a
   data URL eats that with a single catch's three photos. */
export function saveState(state) {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, json);
    return { ok: true, bytes: json.length };
  } catch (e) {
    const code = (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014))
      ? 'quota' : 'other';
    console.warn('Failed to save app state', e);
    return { ok: false, error: e, code };
  }
}

/* Approximate bytes currently held in localStorage under our key.
   Used by the storage warning + Settings space meter. */
export function storageBytes() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? v.length : 0;
  } catch (e) {
    return 0;
  }
}

export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

/* Walks the full state and re-downscales every photo (catch log +
   PBs, including the legacy `photo` mirror). Idempotent — a photo
   already within the target dimensions is left alone. Used on boot
   to recover state that was saved before downscaling shipped, so
   future writes don't bump the localStorage cap. */
export async function compactStatePhotos(state, maxDim = 1600, quality = 0.82) {
  const compact = async (entry) => {
    // photos-store entries (objects) are skipped — they live on the
    // filesystem (native) or are already thumb+src (web); re-shrinking
    // them in-place would lose the structured shape.
    if (typeof entry !== 'string' || !entry.startsWith('data:')) return entry;
    return downscaleImageDataUrl(entry, maxDim, quality);
  };
  const next = { ...state };
  if (Array.isArray(state.catchLog)) {
    next.catchLog = await Promise.all(state.catchLog.map(async (c) => {
      const out = { ...c };
      if (Array.isArray(c.photos)) out.photos = await Promise.all(c.photos.map(compact));
      if (c.photo) out.photo = await compact(c.photo);
      // Keep the legacy mirror in sync with the first slot.
      if (Array.isArray(out.photos) && out.photos.length > 0) out.photo = out.photos[0];
      return out;
    }));
  }
  if (state.pbs && typeof state.pbs === 'object') {
    const entries = await Promise.all(Object.entries(state.pbs).map(async ([id, pb]) => {
      const out = { ...pb };
      if (Array.isArray(pb.photos)) out.photos = await Promise.all(pb.photos.map(compact));
      if (pb.photo) out.photo = await compact(pb.photo);
      if (Array.isArray(out.photos) && out.photos.length > 0) out.photo = out.photos[0];
      return [id, out];
    }));
    next.pbs = Object.fromEntries(entries);
  }
  return next;
}

/* Downscale an image File or data URL to a max longest-side dimension
   and re-encode as JPEG. Returns a data URL ready to persist.
   Default 1600px / 0.82 quality lands an iPhone photo at ~200-400KB
   instead of 5-7MB, keeping a few catches inside Safari's 5MB cap.
   ALWAYS re-encodes so a previously-saved high-quality JPEG at
   already-modest dimensions still gets compressed. Only keeps the
   re-encoded output if it's smaller than the original. */
export async function downscaleImageDataUrl(input, maxDim = 1600, quality = 0.82) {
  const dataUrl = await (typeof input === 'string'
    ? Promise.resolve(input)
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(input);
      }));
  return await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) { resolve(dataUrl); return; }
      const longest = Math.max(srcW, srcH);
      const ratio = Math.min(1, maxDim / longest); // scale down only
      const w = Math.max(1, Math.round(srcW * ratio));
      const h = Math.max(1, Math.round(srcH * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const out = canvas.toDataURL('image/jpeg', quality);
        // Keep the re-encode only if it actually saved bytes — re-
        // encoding a tiny PNG to JPEG could otherwise inflate it.
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch (e) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* Per-bucket photo stats for the Settings diagnostic. Counts a photo
   regardless of shape; bytes are what's actually in localStorage —
   the full data URL for legacy entries, or just the inline thumbnail
   for photos-store entries (full-res lives on the filesystem and
   doesn't bill against localStorage). */
export function photoStats(state) {
  let count = 0;
  let bytes = 0;
  const tally = (entries) => {
    for (const e of entries) {
      if (!e) continue;
      if (typeof e === 'string') {
        if (!e.startsWith('data:')) continue;
        count++; bytes += e.length;
      } else if (typeof e === 'object') {
        count++;
        if (typeof e.thumb === 'string') bytes += e.thumb.length;
        if (typeof e.src === 'string' && e.src.startsWith('data:')) bytes += e.src.length;
      }
    }
  };
  for (const c of (state.catchLog || [])) {
    if (Array.isArray(c.photos)) tally(c.photos);
    else if (c.photo) tally([c.photo]);
  }
  for (const pb of Object.values(state.pbs || {})) {
    if (Array.isArray(pb.photos)) tally(pb.photos);
    else if (pb.photo) tally([pb.photo]);
  }
  return { count, bytes };
}
