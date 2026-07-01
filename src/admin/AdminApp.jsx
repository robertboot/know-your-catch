/* Admin console — species editor (Phase 1).

   URL: /#/admin. Only mounted when Vite's __KYC_ADMIN__ define is true
   (web build only) and the local anglerEmail matches the allowlist.
   The mount decision is enforced in App.jsx; this module trusts that
   gate and focuses on the UI.

   Auth:
    - Supabase magic-link OTP. Sends a link to the admin email; on
      click, Supabase writes the session into the URL fragment.
    - After sign-in, the session's email is re-checked against the
      allowlist before enabling the save button. Frontend gate is
      belt-and-suspenders; the real fence is the write RLS policy
      that compares auth.jwt() -> 'email' to the admin address.

   Editor:
    - Merges bundled SPECIES with any Supabase overlay already applied
      by species-store on boot.
    - Shows a per-row badge indicating whether that row is bundled
      only or overridden.
    - Add / Edit both use the same form (Edit prefills, Add starts
      empty). Save = upsertSpecies() which round-trips to Supabase
      and refreshes the cache. */
import React, { useState, useEffect, useMemo } from 'react';
import { T } from '../theme.js';
import { SPECIES, CATEGORIES } from '../data.js';
import { client, isConfigured } from '../supabase-client.js';
import { upsertSpecies, refreshSpecies } from '../species-store.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, H1, Field, inputStyle,
} from '../components.jsx';

const ADMIN_EMAILS = ['Robertb1023@me.com'];
const normEmail = (e) => (e || '').trim().toLowerCase();
const isAdminEmail = (e) => ADMIN_EMAILS.map(normEmail).includes(normEmail(e));

export default function AdminApp({ localAnglerEmail, onExit }) {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  // Initial session pickup — includes the case where the magic-link
  // callback just landed in the URL fragment. detectSessionInUrl: true
  // in supabase-client makes createClient consume the fragment.
  useEffect(() => {
    let live = true;
    const c = client();
    if (!c) { setSessionChecked(true); return; }
    c.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session || null);
      setSessionChecked(true);
    });
    const { data: sub } = c.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess || null);
    });
    return () => { live = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  // Once signed in, refresh the species overlay so the editor sees the
  // freshest state (in case another admin edited concurrently).
  useEffect(() => {
    if (session) refreshSpecies().catch(() => {});
  }, [session]);

  const supaConfigured = isConfigured();

  if (!supaConfigured) return <ConfigMissing onExit={onExit} />;
  if (!sessionChecked)  return <Loading />;
  if (!session)         return <SignIn allowedEmail={localAnglerEmail} onExit={onExit} />;

  const email = session.user?.email;
  if (!isAdminEmail(email)) return <NotAuthorized email={email} onExit={onExit} />;

  return <SpeciesEditor email={email} onExit={onExit} />;
}

/* ============================================================
   Auth screens
   ============================================================ */

function SignIn({ allowedEmail, onExit }) {
  const [email, setEmail] = useState(allowedEmail || ADMIN_EMAILS[0]);
  const [status, setStatus] = useState('idle');  // idle | sending | sent | error
  const [error, setError] = useState('');
  const send = async () => {
    setStatus('sending'); setError('');
    if (!isAdminEmail(email)) {
      setStatus('error'); setError('That email is not on the admin allowlist.'); return;
    }
    const c = client();
    if (!c) { setStatus('error'); setError('Supabase is not configured.'); return; }
    const { error } = await c.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    });
    if (error) { setStatus('error'); setError(error.message); return; }
    setStatus('sent');
  };
  return (
    <Chrome title="Admin — Sign in" onExit={onExit}>
      <Card>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
          Enter the admin email to receive a magic sign-in link. The
          link opens this same page with an active session.
        </p>
        <Field label="Admin email" value={email} onChange={setEmail} type="email" />
        <div style={{ marginTop: 14 }}>
          <PrimaryButton onClick={send} disabled={status === 'sending' || status === 'sent'}>
            {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Link sent — check your email' : 'Send magic link'}
          </PrimaryButton>
        </div>
        {status === 'error' && (
          <div role="alert" style={{ marginTop: 10, fontSize: 12, color: T.closed }}>{error}</div>
        )}
      </Card>
    </Chrome>
  );
}

function NotAuthorized({ email, onExit }) {
  return (
    <Chrome title="Admin — Not authorized" onExit={onExit}>
      <Card>
        <p style={{ margin: 0, fontSize: 13, color: T.inkSoft, lineHeight: 1.55 }}>
          You're signed in as <strong>{email}</strong>, which is not on the
          admin allowlist. Sign out and try again with the admin email.
        </p>
        <div style={{ marginTop: 14 }}>
          <GhostButton onClick={async () => { await client()?.auth?.signOut(); }}>Sign out</GhostButton>
        </div>
      </Card>
    </Chrome>
  );
}

function ConfigMissing({ onExit }) {
  return (
    <Chrome title="Admin — Not configured" onExit={onExit}>
      <Card>
        <p style={{ margin: 0, fontSize: 13, color: T.inkSoft, lineHeight: 1.55 }}>
          Supabase env vars aren't set. Put <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code> in a <code>.env.local</code> at the
          repo root, then rebuild.
        </p>
      </Card>
    </Chrome>
  );
}

function Loading() {
  return (
    <Chrome title="Admin">
      <Card>
        <div style={{ fontSize: 13, color: T.inkSoft }}>Loading session…</div>
      </Card>
    </Chrome>
  );
}

/* ============================================================
   Species editor
   ============================================================ */

function SpeciesEditor({ email, onExit }) {
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() =>
    [...SPECIES].sort((a, b) => a.commonName.localeCompare(b.commonName)),
    [SPECIES.length]  // trigger re-sort when count changes (add case)
  );
  const filtered = filter.trim()
    ? sorted.filter(s => {
        const q = filter.toLowerCase();
        return s.commonName.toLowerCase().includes(q)
          || (s.scientific || '').toLowerCase().includes(q)
          || s.id.toLowerCase().includes(q);
      })
    : sorted;

  const editing = selectedId ? SPECIES.find(s => s.id === selectedId) : null;

  const signOut = async () => {
    await client()?.auth?.signOut();
  };

  if (creating || editing) {
    return (
      <Chrome title={editing ? `Edit — ${editing.commonName}` : 'Add species'} onExit={() => { setSelectedId(null); setCreating(false); }}>
        <SpeciesForm
          initial={editing || null}
          onDone={() => { setSelectedId(null); setCreating(false); }}
          onCancel={() => { setSelectedId(null); setCreating(false); }}
        />
      </Chrome>
    );
  }

  return (
    <Chrome title="Admin — Species" onExit={onExit}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="search"
          placeholder="Filter by name, scientific, or id…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <GhostButton onClick={() => setCreating(true)} style={{ padding: '10px 14px', flexShrink: 0 }}>+ Add</GhostButton>
      </div>
      <div style={{ fontSize: 11, color: T.inkMute, margin: '0 4px 10px' }}>
        Signed in as {email}. {SPECIES.length} species total; {filtered.length} shown.
        {' '}<button onClick={signOut} style={{ background: 'none', border: 'none', color: T.brass, cursor: 'pointer', padding: 0, textDecoration: 'underline', fontSize: 11 }}>Sign out</button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {filtered.map(sp => (
          <Card key={sp.id} onClick={() => setSelectedId(sp.id)} style={{ padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{sp.commonName}</div>
              <div style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace' }}>{sp.id}</div>
            </div>
            <div style={{ fontSize: 12, color: T.inkSoft, fontStyle: 'italic', marginTop: 2 }}>{sp.scientific}</div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: T.inkMute, padding: 12, textAlign: 'center' }}>No matches.</div>
        )}
      </div>
    </Chrome>
  );
}

function SpeciesForm({ initial, onDone, onCancel }) {
  const [id, setId]                   = useState(initial?.id || '');
  const [commonName, setCommonName]   = useState(initial?.commonName || '');
  const [scientific, setScientific]   = useState(initial?.scientific || '');
  const [category, setCategory]       = useState(initial?.category || CATEGORIES[0]?.id || '');
  const [altNames, setAltNames]       = useState((initial?.altNames || []).join(', '));
  const [keyIds, setKeyIds]           = useState((initial?.keyIds || []).join('\n'));
  const [lookalikes, setLookalikes]   = useState((initial?.lookalikes || []).join(', '));
  const [habitat, setHabitat]         = useState(initial?.habitat || '');
  const [typicalSize, setTypicalSize] = useState(initial?.typicalSize || '');
  const [reefFish, setReefFish]       = useState(!!initial?.reefFish);
  const [hms, setHms]                 = useState(!!initial?.hms);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const isNew = !initial;

  const save = async () => {
    setError('');
    if (!id.trim() || !commonName.trim()) {
      setError('id and common name are required.');
      return;
    }
    setSaving(true);
    const payload = {
      id: id.trim(),
      commonName: commonName.trim(),
      scientific: scientific.trim(),
      category,
      altNames: altNames.split(',').map(s => s.trim()).filter(Boolean),
      keyIds: keyIds.split('\n').map(s => s.trim()).filter(Boolean),
      lookalikes: lookalikes.split(',').map(s => s.trim()).filter(Boolean),
      habitat: habitat.trim(),
      typicalSize: typicalSize.trim(),
      reefFish,
      hms,
    };
    const { ok, error } = await upsertSpecies(payload);
    setSaving(false);
    if (!ok) { setError(error || 'Save failed.'); return; }
    onDone();
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>id (immutable key)</SectionLabel>
        <input
          type="text" value={id} onChange={e => setId(e.target.value)}
          disabled={!isNew} placeholder="e.g. red_snapper"
          style={{ ...inputStyle, opacity: isNew ? 1 : 0.55 }}
        />
        <Field label="Common name"     value={commonName}  onChange={setCommonName}  placeholder="Red Snapper" />
        <Field label="Scientific name" value={scientific}  onChange={setScientific}  placeholder="Lutjanus campechanus" />
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Category</SectionLabel>
          <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Field label="Alt names (comma-separated)" value={altNames} onChange={setAltNames} placeholder="Sow Snapper, Genuine Red" />
      </Card>

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Key ID cues (one per line)</SectionLabel>
        <textarea
          value={keyIds} onChange={e => setKeyIds(e.target.value)}
          rows={6}
          placeholder={'Pinkish-red body fading to pale belly\nDistinctive red iris\nAnal fin pointed and triangular'}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <Field label="Lookalikes (comma-separated species ids)" value={lookalikes} onChange={setLookalikes} placeholder="vermilion_snapper, lane_snapper" />
      </Card>

      <Card>
        <Field label="Habitat" value={habitat} onChange={setHabitat} placeholder="Reefs, wrecks, ledges in 60–300 ft." />
        <Field label="Typical size" value={typicalSize} onChange={setTypicalSize} placeholder="15–30 in" />
        <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.ink }}>
            <input type="checkbox" checked={reefFish} onChange={e => setReefFish(e.target.checked)} />
            Reef fish
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: T.ink }}>
            <input type="checkbox" checked={hms} onChange={e => setHms(e.target.checked)} />
            HMS (Highly Migratory Species)
          </label>
        </div>
      </Card>

      {error && <div role="alert" style={{ fontSize: 12, color: T.closed }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : (isNew ? 'Create species' : 'Save changes')}
        </PrimaryButton>
      </div>
    </div>
  );
}

/* ============================================================
   Chrome — shared header/back layout
   ============================================================ */
function Chrome({ title, children, onExit }) {
  return (
    <div style={{
      background: T.bgGradient, minHeight: '100vh', color: T.ink,
      maxWidth: 720, margin: '0 auto', padding: 16, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
        <H1 size={22}>{title}</H1>
        {onExit && (
          <button onClick={onExit} style={{
            background: 'transparent', border: 'none', color: T.brass,
            cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 4,
          }}>← Back to app</button>
        )}
      </div>
      {children}
    </div>
  );
}
