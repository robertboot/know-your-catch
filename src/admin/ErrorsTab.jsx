/* Errors tab — admin-only.

   Grouped by fingerprint, not listed raw: the same crash hitting twenty
   people is one bug, and a flat list buries that. Each row shows how
   often it fired, whether it hit guests (the account-less path that is
   easiest to break and hardest to hear about), and the stack. */
import React, { useCallback, useEffect, useState } from 'react';
import { T } from '../theme.js';
import { Card, GhostButton, SectionLabel } from '../components.jsx';
import { client } from '../supabase-client.js';

const WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
];

const fmt = (t) => t ? new Date(t).toLocaleString(undefined,
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

function Row({ r, onResolve }) {
  const [open, setOpen] = useState(false);
  const live = Number(r.unresolved) > 0;
  return (
    <Card style={{ marginBottom: 10, padding: 0, overflow: 'hidden',
                   borderColor: live ? `${T.closed}55` : T.cardEdge }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          color: live ? T.closed : T.inkMute,
          border: `1px solid ${live ? T.closed : T.inkMute}55`,
          padding: '3px 8px', borderRadius: 999,
        }}>{r.kind}</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, wordBreak: 'break-word' }}>
            {r.message}
          </div>
          <div style={{ fontSize: 11.5, color: T.inkMute, marginTop: 3 }}>
            {r.screen ? `on ${r.screen} · ` : ''}{r.occurrences}× ·
            {' '}{Number(r.guests) > 0 ? `${r.guests} guest` : 'signed-in'} ·
            {' '}last {fmt(r.last_seen)}
          </div>
        </div>
        <GhostButton onClick={() => setOpen(o => !o)} style={{ padding: '6px 12px', fontSize: 12 }}>
          {open ? 'Hide' : 'Stack'}
        </GhostButton>
        {live && (
          <GhostButton onClick={() => onResolve(r.fingerprint)}
            style={{ padding: '6px 12px', fontSize: 12, color: T.open, borderColor: T.open }}>
            Mark fixed
          </GhostButton>
        )}
      </div>
      {open && (
        <pre style={{
          margin: 0, padding: '12px 14px', borderTop: `1px solid ${T.cardEdge}`,
          fontSize: 11.5, lineHeight: 1.55, color: T.inkSoft,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto',
        }}>{r.stack || '(no stack)'}</pre>
      )}
    </Card>
  );
}

export default function ErrorsTab() {
  const [rows, setRows] = useState([]);
  const [hours, setHours] = useState(168);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (h = hours) => {
    const c = client();
    if (!c) { setError('Supabase not configured.'); return; }
    setBusy(true); setError('');
    const { data, error: err } = await c.rpc('error_log_grouped', { since_hours: h });
    setBusy(false);
    if (err) { setError(`${err.message} — has supabase/error-log-schema.sql been run?`); return; }
    setRows(data || []);
  }, [hours]);

  useEffect(() => { load(hours); }, [load, hours]);

  const resolve = async (fp) => {
    const c = client();
    if (!c) return;
    await c.rpc('error_log_resolve', { fp });
    load(hours);
  };

  const liveCount = rows.filter(r => Number(r.unresolved) > 0).length;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Client errors</SectionLabel>
            <div style={{ fontSize: 14, color: T.ink }}>
              <strong style={{ color: liveCount ? T.closed : T.open }}>{liveCount}</strong>
              {' '}unresolved · {rows.length} distinct
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {WINDOWS.map(w => (
              <GhostButton key={w.hours} onClick={() => setHours(w.hours)}
                style={{
                  padding: '7px 13px', fontSize: 12.5,
                  color: hours === w.hours ? T.brass : T.inkMute,
                  borderColor: hours === w.hours ? T.brass : T.cardEdge,
                }}>{w.label}</GhostButton>
            ))}
          </div>
          <GhostButton onClick={() => load(hours)} disabled={busy}>
            {busy ? 'Loading…' : 'Refresh'}
          </GhostButton>
        </div>
        {error && (
          <div role="alert" style={{
            marginTop: 10, padding: 10, borderRadius: 8,
            background: T.closedBg, color: T.closed, fontSize: 12.5, lineHeight: 1.5,
          }}>{error}</div>
        )}
      </Card>

      {!error && rows.length === 0 && !busy && (
        <Card style={{ padding: 26, textAlign: 'center', color: T.open, fontSize: 14 }}>
          No errors reported in this window.
        </Card>
      )}
      {rows.map(r => <Row key={r.fingerprint} r={r} onResolve={resolve} />)}
    </div>
  );
}
