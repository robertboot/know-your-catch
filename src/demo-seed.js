/* Demo seed for the App Store review account.

   Catches live on-device (cloud sync is off), so a reviewer signing in
   on a fresh device would see an empty logbook. When the App Review
   account signs in and has no catches, we inject a small, realistic Gulf
   logbook + a couple of personal bests so the reviewer sees the app
   populated. Only fires for DEMO_EMAIL, once (guarded in App.jsx). */

export const DEMO_EMAIL = 'appreview@reelintel.ai';

export function buildDemoSeed() {
  const now = Date.now();
  const DAY = 86400000;
  const at = (d) => new Date(now - d * DAY).toISOString();
  const mk = (o) => ({
    status: 'complete',
    lat: 30.28, lon: -87.57,
    photos: [], photo: null,
    sunAlt: null, sunAz: null,
    moonPhase: null, moonIllum: null, moonName: null,
    weather: null,
    jurisdiction: 'al_state',
    outcome: null,
    ...o,
  });

  const catchLog = [
    mk({ id: 'c_demo_1', speciesId: 'red_snapper',      dateIso: at(2),  length: 20, weight: 5.2,  outcome: 'kept',     notes: 'Off Orange Beach on live cigar minnows.', lat: 30.05, lon: -87.65 }),
    mk({ id: 'c_demo_2', speciesId: 'spotted_seatrout', dateIso: at(5),  length: 18, weight: 2.1,  outcome: 'released', notes: 'Grass flats at first light.',           lat: 30.31, lon: -87.60 }),
    mk({ id: 'c_demo_3', speciesId: 'red_drum',         dateIso: at(9),  length: 27, weight: 7.6,  outcome: 'released', notes: 'Over the slot — released. Cut mullet in the pass.' }),
    mk({ id: 'c_demo_4', speciesId: 'king_mackerel',    dateIso: at(13), length: 34, weight: 12.4, outcome: 'kept',     notes: 'Slow-trolled ribbonfish ~8 miles out.',     lat: 29.95, lon: -87.55 }),
    mk({ id: 'c_demo_5', speciesId: 'gag_grouper',      dateIso: at(20), length: 25, weight: 8.3,  outcome: 'kept',     notes: 'Bottom fishing a nearshore wreck.',         lat: 30.00, lon: -87.70 }),
  ];

  const pbs = {
    red_snapper:   { length: 20, weight: 5.2,  primaryMetric: 'weight', date: at(2).slice(0, 10),  location: 'Orange Beach, AL', notes: '', jurisdiction: 'al_state', gearBait: 'Live cigar minnow',        photo: null, history: [] },
    king_mackerel: { length: 34, weight: 12.4, primaryMetric: 'weight', date: at(13).slice(0, 10), location: 'Nearshore, AL',    notes: '', jurisdiction: 'al_state', gearBait: 'Slow-trolled ribbonfish', photo: null, history: [] },
  };

  return { catchLog, pbs };
}
