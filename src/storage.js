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

/* Downscale an image File or data URL to a max longest-side dimension
   and re-encode as JPEG. Returns a data URL ready to persist.
   Default 1600px / 0.82 quality lands an iPhone photo at ~200-400KB
   instead of 5-7MB, keeping a few catches inside Safari's 5MB cap.
   Skips work if the image is already smaller than the target. */
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
      const longest = Math.max(img.width, img.height);
      if (longest <= maxDim) { resolve(dataUrl); return; }
      const ratio = maxDim / longest;
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        // Cross-origin or canvas-tainted; fall back to the original.
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
