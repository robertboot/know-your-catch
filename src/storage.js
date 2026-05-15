import { DATA_BUILD_DATE } from './data.js';

/* App state is persisted to localStorage under a single key. */
const STORAGE_KEY = 'kyc_app_state_v1';

export const defaultState = {
  jurisdiction: null,
  units: 'imperial',
  disclaimerAcceptedVersion: null,
  pbs: {},     // speciesId -> { length, weight, primaryMetric, date, location, notes, jurisdiction, gearBait, photo, history }
  notes: {},   // speciesId -> string
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
      syncMeta: parsed.syncMeta || defaultState.syncMeta,
    };
  } catch (e) {
    console.warn('Failed to load app state, using defaults', e);
    return defaultState;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save app state', e);
  }
}

export function clearState() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}
