/* Where each fish lives, as numbers a model can use.
 *
 * The catch log is the right long-term source for this and cannot carry it
 * yet: 71 logged positions across 28 species is about two and a half per
 * species, where a presence-only habitat model wants thirty or more before
 * it says anything you could not have guessed. So these are published
 * preferences — the kind of ranges that appear in NOAA species profiles
 * and state fishery guides — used as a PRIOR. As the log fills, the same
 * scorer can lean on measured preference instead, species by species, and
 * these become the fallback for whatever is still thin.
 *
 * Every number here is a claim about a fish and Robert can overrule any of
 * them; that is the point of having them in one readable file rather than
 * buried in a scoring function.
 *
 * sstF:    [cold edge, ideal low, ideal high, warm edge] in °F. Outside the
 *          outer pair the fish is not there; between the inner pair it is
 *          most likely. Linear in between — a soft edge, because a hard
 *          cutoff at a tenth of a degree is a lie about biology.
 * depthFt: [shallow edge, ideal low, ideal high, deep edge], same shape.
 * edge:    0-1. How much this fish relates to a temperature or colour
 *          break rather than to a place on the bottom.
 * structure: 0-1. How much it relates to a platform, wreck or hard bottom.
 * months:  1-12 it is realistically catchable in the northern Gulf.
 */

export const SPECIES_HABITAT = {
  // ---- pelagics: the break IS the structure -------------------------
  yellowfin_tuna:  { sstF: [70, 76, 84, 88], depthFt: [300, 600, 6000, 12000], edge: 0.95, structure: 0.25, months: [3,4,5,6,7,8,9,10,11] },
  blackfin_tuna:   { sstF: [70, 75, 84, 88], depthFt: [120, 300, 3000, 9000], edge: 0.85, structure: 0.45, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  bigeye_tuna:     { sstF: [64, 70, 80, 85], depthFt: [600, 1200, 6000, 12000], edge: 0.90, structure: 0.15, months: [4,5,6,7,8,9,10] },
  bluefin_tuna:    { sstF: [58, 64, 75, 81], depthFt: [300, 600, 6000, 12000], edge: 0.90, structure: 0.10, months: [1,2,3,4,5,12] },
  mahi:            { sstF: [72, 76, 86, 90], depthFt: [100, 250, 3000, 9000], edge: 0.95, structure: 0.35, months: [3,4,5,6,7,8,9,10] },
  wahoo:           { sstF: [70, 75, 86, 89], depthFt: [150, 300, 3000, 9000], edge: 0.90, structure: 0.45, months: [1,2,3,4,5,6,9,10,11,12] },
  blue_marlin:     { sstF: [74, 78, 86, 89], depthFt: [600, 1200, 6000, 12000], edge: 0.95, structure: 0.10, months: [5,6,7,8,9,10] },
  white_marlin:    { sstF: [70, 74, 84, 88], depthFt: [300, 600, 3000, 9000], edge: 0.95, structure: 0.10, months: [5,6,7,8,9,10] },
  sailfish:        { sstF: [72, 76, 86, 89], depthFt: [100, 200, 2000, 6000], edge: 0.90, structure: 0.20, months: [4,5,6,7,8,9,10] },
  little_tunny:    { sstF: [68, 72, 84, 88], depthFt: [20, 50, 400, 1500], edge: 0.70, structure: 0.35, months: [1,2,3,4,5,6,7,8,9,10,11,12] },

  // ---- reef: the bottom matters far more than the water colour ------
  red_snapper:     { sstF: [62, 68, 84, 88], depthFt: [60, 90, 300, 400], edge: 0.10, structure: 0.95, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  vermilion_snapper:{ sstF: [62, 68, 84, 88], depthFt: [80, 120, 350, 500], edge: 0.10, structure: 0.85, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  mangrove_snapper:{ sstF: [66, 72, 86, 90], depthFt: [10, 40, 250, 400], edge: 0.10, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  lane_snapper:    { sstF: [66, 72, 86, 90], depthFt: [20, 50, 250, 400], edge: 0.10, structure: 0.80, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  mutton_snapper:  { sstF: [70, 74, 86, 90], depthFt: [20, 50, 300, 450], edge: 0.10, structure: 0.85, months: [3,4,5,6,7,8,9,10] },
  gag_grouper:     { sstF: [58, 64, 82, 86], depthFt: [40, 80, 300, 450], edge: 0.10, structure: 0.95, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  red_grouper:     { sstF: [60, 66, 84, 88], depthFt: [60, 100, 350, 500], edge: 0.10, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  black_grouper:   { sstF: [64, 70, 84, 88], depthFt: [60, 100, 400, 600], edge: 0.10, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  scamp:           { sstF: [58, 64, 82, 86], depthFt: [100, 150, 450, 600], edge: 0.10, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  gray_triggerfish:{ sstF: [62, 68, 84, 88], depthFt: [40, 80, 300, 450], edge: 0.10, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  greater_amberjack:{ sstF: [62, 68, 84, 88], depthFt: [60, 120, 400, 700], edge: 0.25, structure: 0.95, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  almaco_jack:     { sstF: [64, 70, 84, 88], depthFt: [100, 150, 500, 900], edge: 0.25, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  banded_rudderfish:{ sstF: [62, 68, 84, 88], depthFt: [30, 60, 300, 500], edge: 0.25, structure: 0.85, months: [1,2,3,4,5,6,7,8,9,10,11,12] },

  // ---- deep drop: contour and relief, not colour --------------------
  swordfish:       { sstF: [64, 70, 84, 88], depthFt: [900, 1200, 2400, 4000], edge: 0.45, structure: 0.30, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  golden_tilefish: { sstF: [48, 50, 58, 62], depthFt: [500, 650, 1100, 1500], edge: 0.05, structure: 0.60, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  blueline_tilefish:{ sstF: [50, 52, 60, 66], depthFt: [300, 400, 800, 1000], edge: 0.05, structure: 0.60, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  snowy_grouper:   { sstF: [48, 52, 62, 68], depthFt: [400, 600, 1200, 1600], edge: 0.05, structure: 0.85, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  yellowedge_grouper:{ sstF: [48, 52, 62, 68], depthFt: [400, 600, 1200, 1500], edge: 0.05, structure: 0.80, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  warsaw_grouper:  { sstF: [48, 52, 64, 70], depthFt: [300, 500, 1200, 1700], edge: 0.05, structure: 0.85, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  queen_snapper:   { sstF: [48, 52, 62, 68], depthFt: [400, 600, 1400, 1800], edge: 0.05, structure: 0.70, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  wreckfish:       { sstF: [44, 46, 56, 62], depthFt: [1200, 1500, 2400, 3000], edge: 0.05, structure: 0.90, months: [1,2,3,4,5,6,7,8,9,10,11,12] },
  blackbelly_rosefish:{ sstF: [44, 46, 56, 62], depthFt: [600, 900, 1800, 2400], edge: 0.05, structure: 0.60, months: [1,2,3,4,5,6,7,8,9,10,11,12] },

  // ---- coastal trolling: bait and temperature, close in -------------
  king_mackerel:   { sstF: [68, 72, 84, 88], depthFt: [20, 40, 250, 400], edge: 0.55, structure: 0.55, months: [3,4,5,6,7,8,9,10,11] },
  spanish_mackerel:{ sstF: [68, 72, 84, 88], depthFt: [5, 15, 80, 150], edge: 0.45, structure: 0.35, months: [3,4,5,6,7,8,9,10,11] },
  cero_mackerel:   { sstF: [70, 74, 86, 90], depthFt: [10, 20, 120, 200], edge: 0.45, structure: 0.45, months: [4,5,6,7,8,9,10] },
  cobia:           { sstF: [68, 72, 84, 88], depthFt: [10, 25, 200, 400], edge: 0.45, structure: 0.70, months: [3,4,5,6,9,10,11] },
  bonito:          { sstF: [62, 66, 80, 85], depthFt: [20, 50, 300, 600], edge: 0.60, structure: 0.30, months: [1,2,3,4,10,11,12] },
};

/* Trapezoid fit: 0 outside the outer pair, 1 between the inner pair,
   linear across the shoulders. A hard cutoff at a tenth of a degree would
   be a lie about biology; a bell curve would claim a precision these
   published ranges do not have. */
export function fit(value, [outLo, inLo, inHi, outHi]) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value <= outLo || value >= outHi) return 0;
  if (value >= inLo && value <= inHi) return 1;
  return value < inLo
    ? (value - outLo) / (inLo - outLo)
    : (outHi - value) / (outHi - inHi);
}

/* How likely this species is HERE, given what we can measure.
   Returns null when there is nothing to judge on — which is not the same
   as zero, and must not be rendered as "no fish". */
export function habitatScore(speciesId, { sstF, depthFt, edgeStrength = 0, structureNear = 0, month }) {
  const h = SPECIES_HABITAT[speciesId];
  if (!h) return null;
  if (month && !h.months.includes(month)) return 0;

  const t = fit(sstF, h.sstF);
  const d = depthFt == null ? null : fit(depthFt, h.depthFt);
  // Temperature is a gate, not a term: a fish that cannot be in this water
  // is not more likely because the bottom suits it.
  if (t === 0 || d === 0) return 0;
  if (t == null && d == null) return null;

  const place = h.edge * edgeStrength + h.structure * structureNear;
  const base = (t ?? 0.6) * (d ?? 0.8);
  // Place can only improve a cell that is already habitable, never rescue
  // one that is not.
  return Math.max(0, Math.min(1, base * (0.55 + 0.45 * Math.min(1, place))));
}
