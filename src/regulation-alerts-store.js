/* regulation-alerts-store — admin helpers + inbox reads for 3.5.

   Admin (from NotificationsTab):
     refreshRegulationSnapshot()  — walks the bundled SPECIES +
                                   REGULATIONS + JURISDICTIONS and
                                   upserts every (species, jurisdiction)
                                   pair into public.regulation_snapshot
                                   so the scan-regulation-alerts edge
                                   function has a server-side truth.
     runRegulationAlertScan({test_only}) — invokes the edge function.

   User inbox:
     listRegulationAlerts()       — returns rows from
                                   regulation_alert_events for the
                                   signed-in user, most recent first.
     markRegulationAlertRead(id)  — flips read_at on a row so the bell
                                   inbox can hide read items. */
import { client } from './supabase-client.js';
import { SPECIES, JURISDICTIONS, REGULATIONS } from './data.js';

const REG_KEYS = ['open', 'minSize', 'bagLimit', 'gear', 'notes'];

/* Distill the client-side (species, jurisdiction) regulation object
   into a stable shape the edge function can diff. Skips undefined
   values so absence stays canonical. */
function stateForRow(reg) {
  if (!reg) return null;
  const out = {};
  for (const k of REG_KEYS) {
    if (reg[k] !== undefined) out[k] = reg[k];
  }
  return out;
}

/* Admin-only. Pushes the bundled REGULATIONS as-of-this-build into
   public.regulation_snapshot. Runs a chunked upsert to stay under
   PostgREST's row-count budget. Returns { ok, rows, error? }. */
export async function refreshRegulationSnapshot() {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const rows = [];
  for (const s of SPECIES) {
    if (s.active === false) continue;
    const byJur = REGULATIONS[s.id];
    if (!byJur) continue;
    for (const j of JURISDICTIONS) {
      const reg = byJur[j.id];
      const state = stateForRow(reg);
      if (!state) continue;
      rows.push({ species_id: s.id, jurisdiction: j.id, state });
    }
  }
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await c.from('regulation_snapshot').upsert(
      slice, { onConflict: 'species_id,jurisdiction' }
    );
    if (error) return { ok: false, rows: i, error: error.message };
  }
  return { ok: true, rows: rows.length };
}

/* Admin-only. Invokes the edge function. test_only=true limits the
   send to the caller's inbox and skips writing to regulation_alerts_sent
   so the "already notified" cache isn't poisoned by a dry run. */
export async function runRegulationAlertScan({ testOnly = false } = {}) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { data, error } = await c.functions.invoke('scan-regulation-alerts', {
    body: { test_only: testOnly },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...data };
}

/* Inbox read for the bell. Returns rows most recent first, limited
   to 50 so the drawer render stays cheap. */
export async function listRegulationAlerts() {
  const c = client();
  if (!c) return { ok: true, rows: [] };
  const { data, error } = await c.from('regulation_alert_events')
    .select('id, species_id, jurisdiction, change_kind, summary, detail, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return { ok: false, rows: [], error: error.message };
  return { ok: true, rows: data || [] };
}

export async function markRegulationAlertRead(id) {
  const c = client();
  if (!c) return { ok: false, error: 'not-configured' };
  const { error } = await c.from('regulation_alert_events')
    .update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
