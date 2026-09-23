/* Notifications tab — admin-only.

   Two sub-panels:
     - Launch emails: lists feature_notifications waitlists grouped
       by feature, opens a compose form, fires the send-launch-email
       Edge Function. Test-send-to-me is the safe path before the
       real fan-out.
     - Announcements: full CRUD over the announcements table. Rows
       show up on the app's Home banner while their window is active. */
import React, { useCallback, useEffect, useState } from 'react';
import { T } from '../theme.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, inputStyle,
} from '../components.jsx';
import { listWaitlists, sendLaunchEmail } from '../notifications-store.js';
import {
  listAllAnnouncements, createAnnouncement, updateAnnouncement,
  deleteAnnouncement,
} from '../announcements-store.js';
import {
  refreshRegulationSnapshot, runRegulationAlertScan,
} from '../regulation-alerts-store.js';

const FISH_ID_DEFAULT_SUBJECT = 'Fish ID is live in ReelIntel';
const FISH_ID_DEFAULT_BODY = `<p>Hey angler,</p>
<p>The moment you signed up for &mdash; <strong>Fish ID is now live</strong> in ReelIntel. Point your phone at your catch and get the species in seconds.</p>
<p><a href="https://reelintel.ai">Open ReelIntel &rarr;</a></p>
<p>Tight lines,<br>The ReelIntel team</p>`;

export default function NotificationsTab() {
  const [sub, setSub] = useState('launch'); // 'launch' | 'announcements' | 'reg_alerts'
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${T.cardEdge}` }}>
        <SubTab id="launch"        cur={sub} onClick={setSub} label="Launch emails" />
        <SubTab id="announcements" cur={sub} onClick={setSub} label="In-app banners" />
        <SubTab id="reg_alerts"    cur={sub} onClick={setSub} label="Reg alerts" />
      </div>
      {sub === 'launch'        && <LaunchEmailsPanel />}
      {sub === 'announcements' && <AnnouncementsPanel />}
      {sub === 'reg_alerts'    && <RegAlertsPanel />}
    </div>
  );
}

function SubTab({ id, cur, onClick, label }) {
  const active = cur === id;
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        background: 'transparent', border: 'none',
        color: active ? T.brass : T.inkMute,
        padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700,
        borderBottom: `2px solid ${active ? T.brass : 'transparent'}`,
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}

/* ============================================================
   Launch emails
   ============================================================ */
function LaunchEmailsPanel() {
  const [waitlists, setWaitlists] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [selectedFeature, setSelectedFeature] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listWaitlists();
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    setError('');
    setWaitlists(r.rows);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  if (selectedFeature) {
    return (
      <ComposeForm
        feature={selectedFeature.feature}
        waiting={selectedFeature.waiting}
        onBack={() => { setSelectedFeature(null); refresh(); }}
      />
    );
  }

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel>Feature waitlists</SectionLabel>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 3 }}>
            One row per active waitlist. Fish ID's launch email is pre-filled below.
          </div>
        </div>
        <GhostButton onClick={refresh} disabled={loading} style={{ padding: '8px 12px', fontSize: 12 }}>
          {loading ? 'Loading…' : 'Refresh'}
        </GhostButton>
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {waitlists.length === 0 && !loading && (
        <Card style={{ padding: 20, textAlign: 'center', color: T.inkMute, fontSize: 13 }}>
          No feature waitlists yet. Users opt in from the app; you can also compose a launch email to send only to yourself as a test.
          <div style={{ marginTop: 12 }}>
            <PrimaryButton
              onClick={() => setSelectedFeature({ feature: 'fish_id', waiting: 0 })}
              style={{ padding: '10px 16px' }}
            >
              Compose Fish ID launch email
            </PrimaryButton>
          </div>
        </Card>
      )}

      {waitlists.map(w => (
        <Card
          key={w.feature}
          style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, fontFamily: 'monospace' }}>
              {w.feature}
            </div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 3 }}>
              {w.waiting} waiting · {w.notified} already notified
            </div>
          </div>
          <PrimaryButton
            onClick={() => setSelectedFeature(w)}
            style={{ padding: '10px 16px', width: 'auto', flexShrink: 0 }}
          >
            Compose &amp; send
          </PrimaryButton>
        </Card>
      ))}
    </>
  );
}

function ComposeForm({ feature, waiting, onBack }) {
  const isFishId = feature === 'fish_id';
  const [subject, setSubject]   = useState(isFishId ? FISH_ID_DEFAULT_SUBJECT : '');
  const [htmlBody, setHtmlBody] = useState(isFishId ? FISH_ID_DEFAULT_BODY : '');
  const [confirmText, setConfirmText] = useState('');
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState(null);
  const [error, setError]     = useState('');

  const canTest = !!subject && !!htmlBody;
  const canSend = canTest && confirmText.trim().toUpperCase() === 'SEND';

  const testSend = async () => {
    setTesting(true); setError(''); setResult(null);
    const r = await sendLaunchEmail({ feature, subject, html_body: htmlBody, test_only: true });
    setTesting(false);
    if (!r.ok) { setError(r.error || 'test send failed'); return; }
    setResult({ ...r, test: true });
  };

  const realSend = async () => {
    if (!canSend) return;
    setSending(true); setError(''); setResult(null);
    const r = await sendLaunchEmail({ feature, subject, html_body: htmlBody, test_only: false });
    setSending(false);
    if (!r.ok) { setError(r.error || 'send failed'); return; }
    setResult(r);
    setConfirmText('');
  };

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel>Compose launch email</SectionLabel>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 3 }}>
            Feature <code style={{ color: T.ink }}>{feature}</code> · {waiting} on the waitlist
          </div>
        </div>
        <GhostButton onClick={onBack}>← Back</GhostButton>
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Subject</SectionLabel>
        <input
          type="text" value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="e.g. Fish ID is live in ReelIntel"
          style={inputStyle}
        />

        <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Body (HTML)</SectionLabel>
        <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 6 }}>
          Basic HTML supported: &lt;p&gt;, &lt;strong&gt;, &lt;a href&gt;, &lt;br&gt;.
        </div>
        <textarea
          rows={10} value={htmlBody} onChange={e => setHtmlBody(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        />

        <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Preview</SectionLabel>
        <div style={{
          background: '#fff', color: '#0b1a2a',
          padding: 12, borderRadius: 6, border: `1px solid ${T.cardEdge}`,
          fontSize: 13, lineHeight: 1.55,
        }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>{subject || '(no subject)'}</div>
          <div dangerouslySetInnerHTML={{ __html: htmlBody || '(empty body)' }} />
        </div>
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Send test to yourself</SectionLabel>
        <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 8 }}>
          Sends to the currently signed-in admin only. No waitlist rows are touched.
        </div>
        <GhostButton onClick={testSend} disabled={!canTest || testing} style={{ padding: '10px 14px', fontSize: 13 }}>
          {testing ? 'Sending test…' : 'Test send to my email'}
        </GhostButton>
      </Card>

      <Card style={{ borderColor: T.closed }}>
        <SectionLabel style={{ marginBottom: 6, color: T.closed }}>
          Send to {waiting} waiting users
        </SectionLabel>
        <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 10 }}>
          Type <strong style={{ color: T.ink }}>SEND</strong> to confirm. Each recipient's notified_at is stamped on success — no double-sends on retry.
        </div>
        <input
          type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
          placeholder="Type SEND to confirm"
          style={{ ...inputStyle, marginBottom: 10, borderColor: canSend ? T.closed : T.cardEdge }}
        />
        <button
          onClick={realSend}
          disabled={!canSend || sending}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 8,
            border: 'none', fontSize: 14, fontWeight: 800,
            cursor: !canSend || sending ? 'not-allowed' : 'pointer',
            background: !canSend || sending ? '#2A3E4D' : T.closed,
            color: !canSend || sending ? T.inkMute : '#fff',
          }}
        >
          {sending ? 'Sending…' : `Send to ${waiting} users`}
        </button>
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
      {result && (
        <div style={{
          padding: 10, background: T.openBg || 'rgba(50,209,123,0.14)',
          color: T.open, borderRadius: 8, fontSize: 12,
          border: `1px solid ${T.open}`,
        }}>
          {result.test ? 'Test complete.' : 'Send complete.'}
          {' '}Sent: <strong>{result.sent}</strong>
          {' · '}Failed: <strong>{result.failed}</strong>
          {result.message ? ` · ${result.message}` : ''}
        </div>
      )}
    </>
  );
}

/* ============================================================
   Announcements (in-app banners)
   ============================================================ */
function AnnouncementsPanel() {
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | row

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listAllAnnouncements();
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    setError('');
    setRows(r.rows);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (id) => {
    if (!window.confirm('Delete this announcement? Cannot be undone.')) return;
    const r = await deleteAnnouncement(id);
    if (!r.ok) { setError(r.error || 'delete failed'); return; }
    refresh();
  };

  if (editing) {
    return (
      <AnnouncementForm
        row={editing === 'new' ? null : editing}
        onSaved={() => { setEditing(null); refresh(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel>In-app announcement banners</SectionLabel>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 3 }}>
            One at a time renders at top of Home during its active window.
          </div>
        </div>
        <GhostButton onClick={refresh} disabled={loading} style={{ padding: '8px 12px', fontSize: 12 }}>
          {loading ? 'Loading…' : 'Refresh'}
        </GhostButton>
        <PrimaryButton onClick={() => setEditing('new')} style={{ padding: '10px 16px', width: 'auto', flexShrink: 0 }}>
          New announcement
        </PrimaryButton>
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      {rows.length === 0 && !loading && (
        <Card style={{ padding: 20, textAlign: 'center', color: T.inkMute, fontSize: 13 }}>
          No announcements yet. Create one to show a banner at top of Home.
        </Card>
      )}

      {rows.map(r => {
        const now = Date.now();
        const start = new Date(r.starts_at).getTime();
        const end   = r.ends_at ? new Date(r.ends_at).getTime() : Infinity;
        const state = now < start ? 'scheduled' : now > end ? 'expired' : 'active';
        const stateColor = state === 'active' ? T.open : state === 'scheduled' ? T.brass : T.inkMute;
        return (
          <Card key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.title}
                <span style={{
                  fontSize: 9, letterSpacing: 1, fontWeight: 800,
                  background: stateColor, color: T.oceanDeep,
                  padding: '2px 7px', borderRadius: 999, textTransform: 'uppercase',
                }}>{state}</span>
              </div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.body}
              </div>
              <div style={{ fontSize: 10, color: T.inkMute, marginTop: 4 }}>
                {new Date(r.starts_at).toLocaleString()}
                {r.ends_at ? ` → ${new Date(r.ends_at).toLocaleString()}` : ' → (no end)'}
                {' · '}audience: {r.audience}
                {r.dismissible ? ' · dismissible' : ' · sticky'}
              </div>
            </div>
            <GhostButton onClick={() => setEditing(r)} style={{ padding: '6px 10px', fontSize: 11 }}>Edit</GhostButton>
            <GhostButton onClick={() => remove(r.id)} style={{ padding: '6px 10px', fontSize: 11, color: T.closed, borderColor: T.closed }}>Delete</GhostButton>
          </Card>
        );
      })}
    </>
  );
}

function AnnouncementForm({ row, onSaved, onCancel }) {
  const isEdit = !!row;
  const [title,       setTitle]       = useState(row?.title || '');
  const [body,        setBody]        = useState(row?.body  || '');
  const [ctaLabel,    setCtaLabel]    = useState(row?.cta_label || '');
  const [ctaUrl,      setCtaUrl]      = useState(row?.cta_url   || '');
  const [startsAt,    setStartsAt]    = useState(toLocalInput(row?.starts_at || new Date().toISOString()));
  const [endsAt,      setEndsAt]      = useState(toLocalInput(row?.ends_at || ''));
  const [audience,    setAudience]    = useState(row?.audience || 'all');
  const [dismissible, setDismissible] = useState(row?.dismissible ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setError('');
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    setSaving(true);
    const fields = {
      title: title.trim(),
      body: body.trim(),
      cta_label: ctaLabel.trim() || null,
      cta_url:   ctaUrl.trim()   || null,
      starts_at: fromLocalInput(startsAt) || new Date().toISOString(),
      ends_at:   fromLocalInput(endsAt),
      audience,
      dismissible,
    };
    const r = isEdit
      ? await updateAnnouncement(row.id, fields)
      : await createAnnouncement(fields);
    setSaving(false);
    if (!r.ok) { setError(r.error || 'save failed'); return; }
    onSaved();
  };

  return (
    <>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel>{isEdit ? 'Edit announcement' : 'New announcement'}</SectionLabel>
        </div>
        <GhostButton onClick={onCancel}>← Back</GhostButton>
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Title</SectionLabel>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Short, bold headline" style={inputStyle} />

        <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Body</SectionLabel>
        <input type="text" value={body} onChange={e => setBody(e.target.value)} placeholder="One-line description" style={inputStyle} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div>
            <SectionLabel style={{ marginBottom: 6 }}>CTA label</SectionLabel>
            <input type="text" value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="e.g. Learn more" style={inputStyle} />
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 6 }}>CTA URL</SectionLabel>
            <input type="url" value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div>
            <SectionLabel style={{ marginBottom: 6 }}>Starts at</SectionLabel>
            <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <SectionLabel style={{ marginBottom: 6 }}>Ends at (optional)</SectionLabel>
            <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div>
            <SectionLabel style={{ marginBottom: 6 }}>Audience</SectionLabel>
            <select value={audience} onChange={e => setAudience(e.target.value)} style={inputStyle}>
              <option value="all">Everyone</option>
              <option value="signed_in">Signed-in users only</option>
              <option value="signed_out">Signed-out visitors only</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ fontSize: 13, color: T.ink, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={dismissible} onChange={e => setDismissible(e.target.checked)} />
              Dismissible (user can X it away)
            </label>
          </div>
        </div>
      </Card>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create announcement'}
        </PrimaryButton>
      </div>
    </>
  );
}

/* datetime-local inputs use "YYYY-MM-DDTHH:mm" in the user's local TZ.
   Convert to/from ISO for storage. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* ============================================================
   Regulation change alerts (3.5)
   ============================================================
   Two admin actions:
     1. Refresh snapshot — pushes the bundled REGULATIONS from this
        client build into public.regulation_snapshot. Must run after
        every data.js update or the scan can't detect real changes.
     2. Run alert check (test) — invokes the scan-regulation-alerts
        edge function with test_only=true. Emails go to the admin's
        own inbox and regulation_alerts_sent is NOT updated so the
        dry-run doesn't poison future scans.
   A "run for real now" affordance is intentionally NOT exposed to
   avoid accidental mass-send; pg_cron fires the real run daily. */
function RegAlertsPanel() {
  const [snapStatus, setSnapStatus] = useState('idle'); // 'idle' | 'refreshing' | 'ok' | 'err'
  const [snapResult, setSnapResult] = useState(null);
  const [scanStatus, setScanStatus] = useState('idle');
  const [scanResult, setScanResult] = useState(null);
  const [err, setErr] = useState('');

  const doRefresh = async () => {
    setSnapStatus('refreshing'); setErr(''); setSnapResult(null);
    const r = await refreshRegulationSnapshot();
    if (!r.ok) { setSnapStatus('err'); setErr(r.error || 'refresh failed'); return; }
    setSnapStatus('ok'); setSnapResult(r);
  };

  const doTestScan = async () => {
    setScanStatus('running'); setErr(''); setScanResult(null);
    const r = await runRegulationAlertScan({ testOnly: true });
    if (!r.ok) { setScanStatus('err'); setErr(r.error || 'scan failed'); return; }
    setScanStatus('ok'); setScanResult(r);
  };

  return (
    <>
      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Refresh snapshot</SectionLabel>
        <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
          Pushes the bundled REGULATIONS from this build into
          <code style={{ color: T.ink, marginLeft: 4, marginRight: 4 }}>regulation_snapshot</code>.
          Run this after every data.js update — otherwise the daily scan
          will compare last-week's snapshot against itself and never
          detect a real change.
        </div>
        <PrimaryButton
          onClick={doRefresh}
          disabled={snapStatus === 'refreshing'}
          style={{ width: 'auto', padding: '10px 16px', fontSize: 12 }}
        >
          {snapStatus === 'refreshing' ? 'Refreshing…' : 'Refresh regulation snapshot'}
        </PrimaryButton>
        {snapResult && (
          <div style={{ marginTop: 10, fontSize: 12, color: T.open }}>
            ✓ Wrote {snapResult.rows} (species × jurisdiction) rows.
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Run alert check now (test)</SectionLabel>
        <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10, lineHeight: 1.5 }}>
          Invokes the <code style={{ color: T.ink }}>scan-regulation-alerts</code> edge
          function with <code style={{ color: T.ink }}>test_only=true</code>. Any emails go
          to <strong>your admin inbox only</strong>. The
          <code style={{ color: T.ink, marginLeft: 4, marginRight: 4 }}>regulation_alerts_sent</code>
          cache is NOT written — the test can be run repeatedly without
          suppressing tomorrow's real run.
        </div>
        <GhostButton
          onClick={doTestScan}
          disabled={scanStatus === 'running'}
          style={{ padding: '10px 14px', fontSize: 12 }}
        >
          {scanStatus === 'running' ? 'Running…' : 'Run alert check now (test)'}
        </GhostButton>
        {scanResult && (
          <div style={{
            marginTop: 10, padding: 10, borderRadius: 6,
            background: 'rgba(52, 209, 123, 0.14)', border: `1px solid ${T.open}`,
            fontSize: 12, color: T.open,
          }}>
            ✓ Users checked: {scanResult.usersChecked} · Alerts detected: {scanResult.alertsInserted} · Emails sent: {scanResult.emailsSent} · Emails failed: {scanResult.emailsFailed}
          </div>
        )}
      </Card>

      <Card style={{ borderColor: T.cardEdge }}>
        <SectionLabel style={{ marginBottom: 6 }}>Scheduling</SectionLabel>
        <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5 }}>
          The real scan runs daily via pg_cron at <strong>12:00 UTC</strong>
          {' '}(~7am Central / 6am Mountain). Job name:
          {' '}<code style={{ color: T.ink }}>reelintel_reg_alerts_daily</code>.
          Managed by migration
          {' '}<code style={{ color: T.ink }}>regulation_alerts_cron</code>.
          {' '}Every user whose starred species has a diff since the last
          snapshot gets an email and an in-app alert. Duplicates are
          suppressed via
          {' '}<code style={{ color: T.ink }}>regulation_alerts_sent</code>.
        </div>
      </Card>

      {err && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {err}
        </div>
      )}
    </>
  );
}
