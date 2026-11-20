/* What the catch log knows — the ONE copy of the buckets and the floors.
 *
 * The Patterns screen already works out, per species, the water
 * temperature / wind / moon / hour an angler's catches actually came in,
 * and it is careful about saying so: below a sample size it shows nothing
 * rather than dress up noise as an insight. Those thresholds are the
 * valuable part, and the suggested spots now lean on the same numbers —
 * so they live here rather than in two places drifting apart. See
 * [[duplicated-knowledge]].
 *
 * This file never RANKS a spot. 71 catches across 28 species is not a
 * model; it cannot tell you where to go. What it can do is recognise a
 * spot that matches water you have caught that species in before, and say
 * so in one sentence — which is a different and much weaker claim, made
 * honestly.
 */

// MIN .. CONFIDENT → early patterns, shown with a caveat. Above
// CONFIDENT → stated plainly. Mirrors the Patterns screen exactly.
export const PATTERNS_MIN_CATCHES = 10;
export const PATTERNS_CONFIDENT_CATCHES = 30;
export const THRESHOLD_SPECIES = 5;
// Weather-gated dimensions need a bigger pool than a bare count: a
// temperature peak off eight catches is one trip's worth of water.
export const THRESHOLD_WEATHER = 12;
export const THRESHOLD_MOON = 15;

export const tempBucket = (t) =>
  t == null ? null : `${Math.floor(t / 5) * 5}–${Math.floor(t / 5) * 5 + 4}°F`;
export const windBucket = (w) => {
  if (w == null) return null;
  const k = w * 0.868976;
  return `${Math.floor(k / 5) * 5}–${Math.floor(k / 5) * 5 + 4} kt`;
};
export const pressBucket = (p) =>
  p == null ? null : `${Math.floor(p / 10) * 10}–${Math.floor(p / 10) * 10 + 9} mb`;
export const moonBucket = (name) => name || null;

/* The most common bucket, and how many catches sit in it. Returns null
   when the pool is too small to have earned an opinion. */
export function peak(rows, bucket, minRows) {
  const pool = (rows || []).filter(r => bucket(r) != null);
  if (pool.length < minRows) return null;
  const counts = new Map();
  for (const r of pool) {
    const b = bucket(r);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count) best = { key, count };
  }
  // A "peak" that holds a third of a two-bucket spread is just the
  // arithmetic, not a pattern.
  if (!best || best.count < 2) return null;
  return { ...best, pool: pool.length };
}

/* Does this spot's water look like water this angler has caught this
   species in? One sentence, or null.
 *
 * Deliberately narrow: temperature only. It is the one dimension both
 * sides measure the same way — the spot carries a real sst_f, and the log
 * carries the temperature recorded at the catch. Wind and moon describe
 * the DAY rather than the PLACE, so they belong on the forecast, not on a
 * mark 31 miles offshore.
 */
export function personalNote(catchLog, speciesId, spotSstF, speciesName) {
  if (spotSstF == null || !speciesId) return null;
  const mine = (catchLog || []).filter(c => c.speciesId === speciesId || c.species_id === speciesId);
  if (mine.length < THRESHOLD_SPECIES) return null;

  const tempOf = (c) => (c.temp_f ?? c.tempF ?? c.conditions?.temp_f ?? null);
  const p = peak(mine.map(c => ({ t: tempOf(c) })), (r) => tempBucket(r.t), THRESHOLD_WEATHER);
  if (!p) return null;

  const lo = parseFloat(p.key);
  const inBand = spotSstF >= lo && spotSstF < lo + 5;
  if (!inBand) return null;

  const soft = mine.length < PATTERNS_CONFIDENT_CATCHES;
  return `${soft ? 'So far, your' : 'Your'} ${speciesName} have come in ${p.key} water`
    + ` — this break reads ${spotSstF.toFixed(1)}°F.`;
}
