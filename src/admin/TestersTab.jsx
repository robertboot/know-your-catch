/* Testers tab — admin-only.

   One question drove this screen: did the person who sent feedback
   actually create an account? Feedback arrives from a public form with
   a hand-typed email, so a tester can send notes having never signed
   up — and that is exactly the case worth chasing. The email is matched
   against auth.users (trimmed + lower-cased, because people capitalise
   and add trailing spaces), and each row says plainly whether an
   account exists and what they have done with it.

   Everything comes from one RPC: tester_feedback_admin(). auth.users is
   unreadable with the anon key, so the join happens server-side behind
   an admin check (supabase/tester-feedback-admin.sql). */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { T } from '../theme.js';
import { Card, GhostButton, SectionLabel } from '../components.jsx';
import { client } from '../supabase-client.js';
import { getLastSession } from '../auth.js';
import { draftToHtml, draftToText } from '../email-signature.js';

const SPOTS_TOTAL = 25;

const FIELDS = [
  ['tested',    'What did you test?'],
  ['worked',    'What worked?'],
  ['confusing', 'What was confusing?'],
  ['broke',     'Did anything break?'],
  ['wish',      'Wishes it existed'],
];

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function Pill({ tone, children }) {
  const c = { ok: T.open, warn: T.warn, bad: T.closed, mute: T.inkMute }[tone] || T.inkMute;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
      color: c, border: `1px solid ${c}55`, background: `${c}14`,
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function Row({ r }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState('');
  const [copied, setCopied] = useState(false);
  const hasAccount = !!r.user_id;
  const answered = FIELDS.filter(([k]) => (r[k] || '').trim());

  const mailto = `mailto:${encodeURIComponent(r.email)}` +
    `?subject=${encodeURIComponent('Thanks for testing ReelIntel')}` +
    `&body=${encodeURIComponent(
      `Hi ${(r.name || '').split(' ')[0] || 'there'},\n\n` +
      `Thanks for putting ReelIntel through its paces — genuinely useful feedback.\n\n`)}`;

  const answeredCount = answered.length;

  const makeDraft = async () => {
    const c = client();
    if (!c || drafting) return;
    setDrafting(true); setDraftErr(''); setOpen(true);
    try {
      const token = getLastSession()?.access_token;
      const { data, error } = await c.functions.invoke('draft-tester-reply', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: {
          name: r.name, tested: r.tested, worked: r.worked, confusing: r.confusing,
          broke: r.broke, wish: r.wish,
          hasAccount: !!r.user_id, catches: r.catches,
        },
      });
      if (error || !data?.draft) {
        setDraftErr(
          data?.detail || error?.message ||
          'Draft failed — is draft-tester-reply deployed?');
      } else {
        setDraft(data.draft);
      }
    } catch (e) {
      setDraftErr(e?.message || String(e));
    } finally {
      setDrafting(false);
    }
  };

  const copyDraft = async () => {
    const text = draftToText(draft);
    try {
      // Write text/html AND text/plain: a mail client takes the HTML
      // (signature intact), anything else falls back to the text.
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html':  new Blob([draftToHtml(draft)], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true); setTimeout(() => setCopied(false), 2200);
    } catch { /* clipboard blocked — the textarea is still selectable */ }
  };

  // Opens the mail client with the draft already in the body.
  const mailtoDraft = `mailto:${encodeURIComponent(r.email)}` +
    `?subject=${encodeURIComponent('Thanks for testing ReelIntel')}` +
    `&body=${encodeURIComponent(draftToText(draft))}`;

  return (
    <Card style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 190 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>{r.name || '(no name)'}</div>
          <div style={{ fontSize: 12.5, color: T.inkMute, wordBreak: 'break-all' }}>{r.email}</div>
        </div>

        {/* The headline fact: account or not. */}
        {hasAccount
          ? <Pill tone="ok">✓ Account</Pill>
          : <Pill tone="bad">No account</Pill>}
        {hasAccount && !r.email_confirmed_at && <Pill tone="warn">Unconfirmed</Pill>}
        {hasAccount && (
          <Pill tone="mute">
            {r.catches == null ? 'usage n/a' : `${r.catches} catches`}
            {r.pbs != null ? ` · ${r.pbs} PB` : ''}
          </Pill>
        )}

        <div style={{ fontSize: 11.5, color: T.inkMute, whiteSpace: 'nowrap' }}>{fmt(r.submitted_at)}</div>
        <GhostButton onClick={() => setOpen(o => !o)} style={{ padding: '7px 12px', fontSize: 12.5 }}>
          {open ? 'Hide' : `Feedback (${answeredCount})`}
        </GhostButton>
        {answeredCount > 0 && (
          <GhostButton onClick={makeDraft} disabled={drafting}
            style={{ padding: '7px 12px', fontSize: 12.5, color: T.brass, borderColor: T.brass }}>
            {drafting ? 'Drafting…' : draft ? 'Redraft' : 'Draft reply'}
          </GhostButton>
        )}
        <a href={mailto} className="rl-tappable" style={{
          color: T.brass, border: `1px solid ${T.brass}`, borderRadius: 8,
          padding: '7px 12px', fontSize: 12.5, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
        }}>Reply</a>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${T.cardEdge}`, padding: '14px 15px', display: 'grid', gap: 13 }}>
          {hasAccount ? (
            <div style={{ fontSize: 12, color: T.inkMute }}>
              Account created {fmt(r.account_created_at)} · last sign-in {fmt(r.last_sign_in_at)}
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: T.warn, lineHeight: 1.5 }}>
              No account matches this email. They may have signed up with a
              different address, or sent feedback without creating one —
              worth a reply before counting the spot.
            </div>
          )}
          {answered.length === 0 && (
            <div style={{ fontSize: 13, color: T.inkMute }}>No written answers.</div>
          )}
          {answered.map(([k, label]) => (
            <div key={k}>
              <SectionLabel style={{ marginBottom: 4 }}>{label}</SectionLabel>
              <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{r[k]}</div>
            </div>
          ))}
          {(draft || draftErr) && (
            <div style={{
              border: `1px solid ${T.brass}55`, borderRadius: 12, padding: 13,
              background: 'rgba(25,212,242,0.05)',
            }}>
              <SectionLabel style={{ marginBottom: 8 }}>Suggested reply</SectionLabel>
              {draftErr ? (
                <div style={{ color: T.closed, fontSize: 13, lineHeight: 1.5 }}>{draftErr}</div>
              ) : (
                <>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck
                    style={{
                      width: '100%', boxSizing: 'border-box', minHeight: 220,
                      background: T.parchmentDeep, color: T.ink,
                      border: `1px solid ${T.cardEdge}`, borderRadius: 10,
                      padding: '11px 13px', fontSize: 14, lineHeight: 1.6,
                      fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
                    <GhostButton onClick={copyDraft} style={{ padding: '8px 14px', fontSize: 13 }}>
                      {copied ? '✓ Copied with signature' : 'Copy + signature'}
                    </GhostButton>
                    <a href={mailtoDraft} style={{
                      color: T.oceanDeep, background: T.brass, borderRadius: 8,
                      padding: '8px 14px', fontSize: 13, fontWeight: 800,
                      textDecoration: 'none', whiteSpace: 'nowrap',
                    }}>Open in Mail</a>
                    <span style={{ fontSize: 11.5, color: T.inkMute, alignSelf: 'center' }}>
                      Editable — read it before sending. Copy keeps the signature
                      formatted; Mail sends the plain-text version.
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
          {r.screenshot_path && (
            <div style={{ fontSize: 12.5, color: T.inkSoft }}>
              Screenshot: <code style={{ color: T.brass }}>{r.screenshot_path}</code>
              {' '}(tester-feedback bucket)
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function TestersTab() {
  const [rows, setRows]   = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    const c = client();
    if (!c) { setError('Supabase not configured.'); return; }
    setBusy(true); setError('');
    const { data, error: err } = await c.rpc('tester_feedback_admin');
    setBusy(false);
    if (err) {
      setError(
        /not authorised/i.test(err.message)
          ? 'Signed-in email is not the admin allowlist address.'
          : `${err.message} — has supabase/tester-feedback-admin.sql been run?`);
      return;
    }
    setRows(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const withAcct = rows.filter(r => r.user_id).length;
    const used = rows.filter(r => (r.catches || 0) > 0).length;
    return { total: rows.length, withAcct, noAcct: rows.length - withAcct, used };
  }, [rows]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <SectionLabel style={{ marginBottom: 6 }}>Tester feedback</SectionLabel>
            <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.6 }}>
              <strong style={{ color: T.brass }}>{stats.total}</strong> / {SPOTS_TOTAL} submissions ·
              {' '}<strong style={{ color: T.open }}>{stats.withAcct}</strong> with an account ·
              {' '}<strong style={{ color: stats.noAcct ? T.closed : T.inkMute }}>{stats.noAcct}</strong> without ·
              {' '}<strong>{stats.used}</strong> have logged a catch
            </div>
          </div>
          <GhostButton onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</GhostButton>
        </div>
        {error && (
          <div role="alert" style={{
            marginTop: 10, padding: 10, borderRadius: 8,
            background: T.closedBg, color: T.closed, fontSize: 12.5, lineHeight: 1.5,
          }}>{error}</div>
        )}
      </Card>

      {!error && rows.length === 0 && !busy && (
        <Card style={{ padding: 26, textAlign: 'center', color: T.inkMute, fontSize: 14 }}>
          No submissions yet. They arrive from the form at /testers.
        </Card>
      )}

      {rows.map(r => <Row key={r.id} r={r} />)}
    </div>
  );
}
