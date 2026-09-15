/* Weekly Waters Report — review and approve.

   The cron generates a draft every Thursday and stops. Nothing reaches a
   subscriber until someone here has read the rendered email and pressed
   send. The payload of this email is fishing regulations: a wrong season
   mailed to every angler in a state is the one mistake that cannot be
   taken back, and no freshness check is a substitute for a person
   looking at it.

   An edition arrives in one of two states. `draft` is ready to read.
   `blocked` means the generator found a regulation it could not vouch
   for — those rows are listed, and the send button is not offered. */
import React, { useCallback, useEffect, useState } from 'react';
import { T } from '../theme.js';
import { Card, GhostButton, SectionLabel } from '../components.jsx';
import { client, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase-client.js';

const WATERS = [
  { id: 'al_state',    label: 'Alabama' },
  { id: 'ms_state',    label: 'Mississippi' },
  { id: 'la_state',    label: 'Louisiana' },
  { id: 'tx_state',    label: 'Texas' },
  { id: 'fl_state',    label: 'Florida Gulf' },
  { id: 'fl_atlantic', label: 'Florida Atlantic' },
];

const STATUS = {
  draft:     { label: 'Ready to review', color: T.brass },
  blocked:   { label: 'Blocked',         color: T.closed },
  approved:  { label: 'Approved',        color: T.warn },
  sent:      { label: 'Sent',            color: T.open },
  discarded: { label: 'Discarded',       color: T.inkMute },
};

const fmt = (t) => t ? new Date(t).toLocaleString(undefined,
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export default function WeeklyEmailTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState(null);
  // The function's own reply. Kept and shown because three rounds of
  // 'it looks the same' were three rounds of guessing at what a
  // successful-looking call actually returned.
  const [lastReply, setLastReply] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    const c = client();
    if (!c) { setErr('No Supabase client.'); setLoading(false); return; }
    const { data, error } = await c.from('weekly_emails')
      .select('*').order('week_start', { ascending: false }).limit(40);
    if (error) setErr(error.message); else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Raw fetch rather than functions.invoke. invoke collapses every
     failure into "Failed to send a request to the Edge Function" — a
     boot crash, a 500, a CORS preflight rejection and a network drop all
     read identically, which is three rounds of guessing. This reports
     the status line and the body. */
  const generate = async (jurisdiction) => {
    setBusy('generate'); setErr('');
    const url = `${SUPABASE_URL}/functions/v1/weekly-report-generate`;
    try {
      const c = client();
      const { data: sess } = await c.auth.getSession();
      const token = sess?.session?.access_token || SUPABASE_ANON_KEY;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ jurisdiction, force: true }),
      });
      const raw = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* not JSON — show it raw */ }
      setLastReply({
        at: new Date().toISOString(), jurisdiction,
        status: `${res.status} ${res.statusText}`,
        data: parsed ?? raw.slice(0, 1200),
        error: res.ok ? null : `HTTP ${res.status}`,
      });
      if (!res.ok) setErr(`Generate failed — HTTP ${res.status}. See the box above.`);
      else if (parsed?.skipped) setErr(`Nothing generated: ${parsed.skipped}`);
      await load();
    } catch (e) {
      // A throw here is the network layer, not the function: DNS, CORS
      // preflight, or the function not answering at all.
      setLastReply({
        at: new Date().toISOString(), jurisdiction, status: 'no response',
        data: { url, message: String(e?.message || e) },
        error: 'the request never reached the function',
      });
      setErr('The request never reached the function — see the box above.');
    } finally { setBusy(''); }
  };

  const act = async (id, opts) => {
    setBusy(id); setErr('');
    try {
      const c = client();
      const { data, error } = await c.functions.invoke('weekly-report-send', {
        body: { id, ...opts },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
      return data;
    } catch (e) {
      setErr(e?.message || 'Send failed.');
    } finally { setBusy(''); }
  };

  const discard = async (id) => {
    setBusy(id);
    const c = client();
    await c.from('weekly_emails').update({ status: 'discarded' }).eq('id', id);
    await load(); setBusy('');
  };

  return (
    <div>
      <SectionLabel>Weekly Waters Report</SectionLabel>
      <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginBottom: 14, maxWidth: '62ch' }}>
        Drafts are generated every Thursday, one per waters with subscribers. Nothing sends until you
        read it and approve it here. Send a test to yourself first — it is the only way to see how a
        real mail client renders it.
      </div>

      <Card style={{ marginBottom: 16, padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: T.inkMute, marginBottom: 10 }}>
          GENERATE A DRAFT NOW
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {WATERS.map(w => (
            <GhostButton key={w.id} disabled={busy === 'generate'} onClick={() => generate(w.id)}>
              {w.label}
            </GhostButton>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 10, lineHeight: 1.5 }}>
          Waters with no subscribers build nothing and say so.
        </div>
        {lastReply && (
          <div style={{ marginTop: 12, padding: 10, background: T.oceanDeep,
                        border: `1px solid ${T.cardEdge}`, borderRadius: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2,
                          color: T.inkMute, marginBottom: 6 }}>
              LAST GENERATE — {lastReply.jurisdiction}
              {lastReply.status ? ` · ${lastReply.status}` : ''}
            </div>
            <pre style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: T.inkSoft,
                          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
{JSON.stringify(
  lastReply.error ? { error: lastReply.error, detail: lastReply.data } : lastReply.data,
  null, 2)}
            </pre>
          </div>
        )}
      </Card>

      {err && (
        <Card style={{ marginBottom: 12, padding: 12, borderColor: `${T.closed}66` }}>
          <div style={{ fontSize: 13, color: T.closed }}>{err}</div>
        </Card>
      )}

      {loading && <div style={{ color: T.inkMute, fontSize: 13 }}>Loading…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ color: T.inkMute, fontSize: 13 }}>No editions yet.</div>
      )}

      {rows.map(r => {
        const st = STATUS[r.status] || STATUS.draft;
        const open = openId === r.id;
        const changes = Array.isArray(r.payload?.changes) ? r.payload.changes : [];
        const blockers = Array.isArray(r.block_reasons) ? r.block_reasons : [];
        return (
          <Card key={r.id} style={{ marginBottom: 10, padding: 0, overflow: 'hidden',
                                    borderColor: r.status === 'blocked' ? `${T.closed}55` : T.cardEdge }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
                color: st.color, border: `1px solid ${st.color}55`, padding: '3px 8px', borderRadius: 999,
              }}>{st.label}</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{r.subject}</div>
                <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 3 }}>
                  week of {r.week_start} · {r.recipient_count} recipient{r.recipient_count === 1 ? '' : 's'} ·
                  {' '}{changes.length} change{changes.length === 1 ? '' : 's'} · generated {fmt(r.generated_at)}
                  {r.sent_at ? ` · sent ${fmt(r.sent_at)}` : ''}
                  {/* The updater's backlog. Shown because it is worth knowing, and
                      greyed because it never stops a send — only the regulations
                      this edition prints can do that. */}
                  {r.payload?.stale_coverage > 0 && (
                    <span style={{ color: T.inkMute }}>
                      {' '}· {r.payload.stale_coverage} of {r.payload.total_rows} rows past re-check
                    </span>
                  )}
                </div>
              </div>
              <GhostButton onClick={() => setOpenId(open ? null : r.id)}>
                {open ? 'Hide' : 'Review'}
              </GhostButton>
            </div>

            {open && (
              <div style={{ borderTop: `1px solid ${T.cardEdge}`, padding: 14 }}>

                {blockers.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: T.closed, marginBottom: 6 }}>
                      This edition cannot send — {blockers.length} regulation{blockers.length === 1 ? '' : 's'} could not be verified
                    </div>
                    <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6 }}>
                      {blockers.slice(0, 12).map((b, i) => (
                        <div key={i}>
                          {b.species_id} in {b.jurisdiction_id} — {b.reason}
                          {b.days != null ? ` (${b.days} days old)` : ''}
                        </div>
                      ))}
                      {blockers.length > 12 && <div>…and {blockers.length - 12} more</div>}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
                      These are regulations this edition would have printed. Fix them in Regulations,
                      then generate the draft again.
                      {r.payload?.refresh_timed_out && (
                        <>
                          {' '}The automatic re-check ran out of time on this pass — it is still working
                          through them in the background, so generating again in a few minutes may clear
                          some without any work from you.
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* The rendered email itself. An iframe with no allow-same-origin
                    so the preview cannot touch the admin console around it —
                    this html is built by a function, but it is still a document
                    being rendered inside a privileged page. */}
                <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1.2, color: T.inkMute, marginBottom: 8 }}>
                  PREVIEW
                </div>
                <iframe
                  title={`Preview ${r.week_start}`}
                  sandbox=""
                  srcDoc={r.html}
                  style={{ width: '100%', height: 620, border: `1px solid ${T.cardEdge}`,
                           borderRadius: 10, background: '#06111F' }}
                />

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  <GhostButton disabled={busy === r.id} onClick={() => act(r.id, { test: true })}>
                    Send a test to me
                  </GhostButton>
                  {r.status === 'draft' && (
                    <button
                      disabled={busy === r.id}
                      onClick={() => {
                        const n = r.recipient_count;
                        if (window.confirm(`Send this to ${n} angler${n === 1 ? '' : 's'} in ${r.jurisdiction_id}? This cannot be undone.`)) {
                          act(r.id, {});
                        }
                      }}
                      style={{
                        background: T.brass, color: T.oceanDeep, border: 'none', borderRadius: 10,
                        padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                      }}>
                      Approve &amp; send to {r.recipient_count}
                    </button>
                  )}
                  {r.status !== 'sent' && r.status !== 'discarded' && (
                    <GhostButton disabled={busy === r.id} onClick={() => discard(r.id)}>Discard</GhostButton>
                  )}
                </div>

                {r.send_error && (
                  <div style={{ fontSize: 12.5, color: T.warn, marginTop: 10, lineHeight: 1.5 }}>
                    {r.send_error}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
