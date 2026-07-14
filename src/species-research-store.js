/* AI species research — thin wrapper over the research-species
   edge function. Called from the admin Quick Add flow when the
   admin taps "Research with AI" after typing a species name.

   Never called from mobile-app code. Admin-only surface. */
import { client } from './supabase-client.js';
import { SPECIES } from './data.js';

/**
 * Research a species by name, returning a partial pre-fill payload
 * for the Quick Add form.
 *
 * @param {Object} opts
 * @param {string} opts.commonName        — required, admin's typed name
 * @param {string} [opts.scientificName]  — optional hint to narrow the model's guess
 * @returns {Promise<{
 *   ok: true,
 *   data: {
 *     scientific?: string,
 *     category?: string,
 *     altNames: string[],
 *     habitat: string,
 *     keyIds: string[],
 *     lookalikes: string[],
 *     sourceNote?: string,
 *   }
 * } | { ok: false, error: string }>}
 */
export async function researchSpecies({ commonName, scientificName }) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  if (!commonName?.trim()) return { ok: false, error: 'commonName required' };

  // Hand the edge function the CURRENT species list so its lookalike
  // suggestions are always drawn from ids that actually exist. The
  // in-memory SPECIES const already reflects the runtime overlay
  // (species-store.applyOverrides mutates it in place on refresh).
  const existingSpeciesIds = SPECIES.map(s => ({
    id: s.id, commonName: s.commonName,
  }));

  const { data, error } = await c.functions.invoke('research-species', {
    body: {
      commonName: commonName.trim(),
      scientificName: (scientificName || '').trim() || undefined,
      existingSpeciesIds,
    },
  });
  if (error) return { ok: false, error: error.message || 'invoke failed' };
  if (data && data.error) {
    // Edge function returned an error body inside a 200 shape (some
    // supabase.functions.invoke versions do that). Pass it up.
    return { ok: false, error: data.detail || data.error };
  }
  return { ok: true, data };
}
