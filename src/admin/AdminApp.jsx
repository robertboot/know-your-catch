/* Admin console — species overlay + brand asset editor (Phase 1 + 2).

   URL: /#/admin. Only mounted when Vite's __KYC_ADMIN__ define is true
   (web build only) and the local anglerEmail matches the allowlist.

   Auth: Supabase email + password. Single admin allowlist; RLS write
   policies enforce the same email server-side.

   Tabs:
    - Species — list, add, edit species metadata + upload / manage
      species photos into the fish-photos bucket.
    - Branding — upload / preview / revert overrides for the runtime-
      swappable brand images (header logo, JSX splash, hero image). */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { T } from '../theme.js';
import { SPECIES, CATEGORIES } from '../data.js';
import { client, isConfigured } from '../supabase-client.js';
import {
  upsertSpecies, refreshSpecies,
  deactivateSpecies, reactivateSpecies,
  speciesPhotoOverrideAll,
  addSpeciesPhoto, deleteSpeciesPhoto, setPrimarySpeciesPhoto,
  subscribe as subscribeSpeciesStore,
} from '../species-store.js';
import {
  brandAsset, refreshBrandAssets, upsertBrandAsset, deleteBrandAsset,
} from '../brand-store.js';
import {
  getCategories, refreshCategories,
  upsertCategory, deactivateCategory, reassignSpecies, seedFromBundled,
  subscribe as subscribeCategoriesStore,
} from '../categories-store.js';
import { speciesPhoto } from '../helpers.js';
import { uploadImage } from './upload.js';
import {
  Card, PrimaryButton, GhostButton, SectionLabel, H1, Field, inputStyle,
} from '../components.jsx';

const ADMIN_EMAILS = ['Robertb1023@me.com'];
const normEmail = (e) => (e || '').trim().toLowerCase();
const isAdminEmail = (e) => ADMIN_EMAILS.map(normEmail).includes(normEmail(e));

/* Runtime-swappable brand assets. Each key mirrors an image referenced
   by a component; the fallback is the bundled path under public/brand/.
   The Branding tab renders one row per key. */
const BRAND_ASSETS = [
  {
    key: 'logo_horizontal',
    label: 'Header logo',
    desc: 'Renders in the top bar on every screen. Wide horizontal format works best.',
    fallback: `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`,
  },
  {
    key: 'logo_brand',
    label: 'Splash logo',
    desc: 'JSX splash screen — shown for 2.2s between iOS launch storyboard and app boot.',
    fallback: `${import.meta.env.BASE_URL}brand/reelintel-brand.png`,
  },
  {
    key: 'hero_tuna',
    label: 'Home hero image',
    desc: 'Background photo behind the home-screen title card.',
    fallback: `${import.meta.env.BASE_URL}brand/hero-tuna.png`,
  },
];

export default function AdminApp(props) {
  return (
    <ErrorBoundary onExit={props.onExit}>
      <AdminAppInner {...props} />
    </ErrorBoundary>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[admin]', err, info); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return (
      <Chrome title="Admin — Crashed" onExit={this.props.onExit}>
        <Card>
          <p style={{ margin: 0, fontSize: 13, color: T.closed, fontWeight: 700 }}>
            {e?.name || 'Error'}: {e?.message || String(e)}
          </p>
          {e?.stack && (
            <pre style={{ marginTop: 10, fontSize: 10, color: T.inkSoft, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 240 }}>
              {String(e.stack)}
            </pre>
          )}
        </Card>
      </Chrome>
    );
  }
}

function AdminAppInner({ localAnglerEmail, onExit }) {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

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

  useEffect(() => {
    if (session) {
      refreshSpecies().catch(() => {});
      refreshBrandAssets().catch(() => {});
    }
  }, [session]);

  if (!isConfigured()) return <ConfigMissing onExit={onExit} />;
  if (!sessionChecked)  return <Loading />;
  if (!session)         return <SignIn allowedEmail={localAnglerEmail} onExit={onExit} />;

  const email = session.user?.email;
  if (!isAdminEmail(email)) return <NotAuthorized email={email} onExit={onExit} />;

  return <SignedInShell email={email} onExit={onExit} />;
}

/* ============================================================
   Auth screens
   ============================================================ */
function SignIn({ allowedEmail, onExit }) {
  const [email, setEmail]       = useState(allowedEmail || ADMIN_EMAILS[0]);
  const [password, setPassword] = useState('');
  const [status, setStatus]     = useState('idle');
  const [error, setError]       = useState('');
  const submit = async () => {
    setStatus('signing_in'); setError('');
    if (!isAdminEmail(email)) {
      setStatus('error'); setError('That email is not on the admin allowlist.'); return;
    }
    if (!password) {
      setStatus('error'); setError('Password required.'); return;
    }
    const c = client();
    if (!c) { setStatus('error'); setError('Supabase is not configured.'); return; }
    try {
      const { error: err } = await c.auth.signInWithPassword({ email, password });
      if (err) {
        setStatus('error');
        setError(typeof err?.message === 'string' ? err.message : String(err));
        return;
      }
    } catch (thrown) {
      setStatus('error');
      setError(thrown?.message ? String(thrown.message) : String(thrown));
      return;
    }
    setStatus('idle');
  };
  return (
    <Chrome title="Admin — Sign in" onExit={onExit}>
      <Card>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
          Sign in with the admin email and password.
        </p>
        <SectionLabel style={{ marginBottom: 6, marginTop: 10 }}>Admin email</SectionLabel>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="username" style={inputStyle}
        />
        <SectionLabel style={{ marginBottom: 6, marginTop: 10 }}>Password</SectionLabel>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          style={inputStyle}
        />
        <div style={{ marginTop: 14 }}>
          <PrimaryButton onClick={submit} disabled={status === 'signing_in'}>
            {status === 'signing_in' ? 'Signing in…' : 'Sign in'}
          </PrimaryButton>
        </div>
        {status === 'error' && (
          <div role="alert" style={{ marginTop: 10, fontSize: 12, color: T.closed }}>
            {String(error)}
          </div>
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
          Signed in as <strong>{email}</strong>, not on the admin allowlist.
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
          <code>VITE_SUPABASE_ANON_KEY</code> in a <code>.env.local</code>, then restart the dev server.
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
   Signed-in shell — tabs + active tab content
   ============================================================ */
function SignedInShell({ email, onExit }) {
  const [tab, setTab] = useState('species'); // 'species' | 'branding' | 'categories'
  const [detailView, setDetailView] = useState(null); // e.g. { kind:'species-edit', id }

  const signOut = async () => { await client()?.auth?.signOut(); };

  const clearDetail = () => setDetailView(null);
  const switchTab = (t) => { setDetailView(null); setTab(t); };

  return (
    <Chrome
      title={detailView?.title || 'ReelIntel Admin'}
      onExit={detailView ? clearDetail : onExit}
      exitLabel={detailView ? '← Back' : '← Back to app'}
    >
      {!detailView && (
        <>
          <TabBar tab={tab} onTab={switchTab} />
          <div style={{ fontSize: 11, color: T.inkMute, margin: '10px 4px 12px' }}>
            Signed in as {email}.
            {' '}<button onClick={signOut} style={{ background: 'none', border: 'none', color: T.brass, cursor: 'pointer', padding: 0, textDecoration: 'underline', fontSize: 11 }}>Sign out</button>
          </div>
        </>
      )}
      {tab === 'species'    && <SpeciesTab  detailView={detailView} setDetailView={setDetailView} />}
      {tab === 'branding'   && !detailView && <BrandingTab />}
      {tab === 'categories' && !detailView && <CategoriesTab />}
    </Chrome>
  );
}

function TabBar({ tab, onTab }) {
  const tabs = [
    { id: 'species',    label: 'Species' },
    { id: 'categories', label: 'Categories' },
    { id: 'branding',   label: 'Branding' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${T.cardEdge}`, marginBottom: 4 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onTab(t.id)} style={{
          background: 'transparent', border: 'none',
          color: tab === t.id ? T.brass : T.inkMute,
          padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
          borderBottom: `2px solid ${tab === t.id ? T.brass : 'transparent'}`,
          marginBottom: -1,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

/* ============================================================
   Species tab
   ============================================================ */
function SpeciesTab({ detailView, setDetailView }) {
  const [filter, setFilter] = useState('');

  const sorted = useMemo(() =>
    [...SPECIES].sort((a, b) => a.commonName.localeCompare(b.commonName)),
    // Re-sort when SPECIES changes (add / edit lands via species-store notify)
    [SPECIES.length, SPECIES.map(s => s.id).join(',')]
  );
  const filtered = filter.trim()
    ? sorted.filter(s => {
        const q = filter.toLowerCase();
        return s.commonName.toLowerCase().includes(q)
          || (s.scientific || '').toLowerCase().includes(q)
          || s.id.toLowerCase().includes(q);
      })
    : sorted;

  if (detailView?.kind === 'species-edit') {
    const editing = detailView.id ? SPECIES.find(s => s.id === detailView.id) : null;
    return (
      <SpeciesForm
        initial={editing || null}
        onDone={() => setDetailView(null)}
        onCancel={() => setDetailView(null)}
      />
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="search" placeholder="Filter by name, scientific, or id…"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <GhostButton
          onClick={() => setDetailView({ kind: 'species-edit', id: null, title: 'Add species' })}
          style={{ padding: '10px 14px', flexShrink: 0 }}
        >+ Add</GhostButton>
      </div>
      <div style={{ fontSize: 11, color: T.inkMute, margin: '0 4px 10px' }}>
        {SPECIES.length} species total; {filtered.length} shown.
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {filtered.map(sp => {
          const photo = speciesPhoto(sp.id);
          return (
            <Card
              key={sp.id}
              onClick={() => setDetailView({ kind: 'species-edit', id: sp.id, title: `Edit — ${sp.commonName}` })}
              style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div style={{
                width: 84, height: 56, flexShrink: 0,
                background: T.parchmentDeep, borderRadius: 6,
                overflow: 'hidden', border: `1px solid ${T.cardEdge}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {photo?.url
                  ? <img src={photo.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 9, color: T.inkMute, textAlign: 'center' }}>no<br/>photo</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sp.commonName}
                    {sp.active === false && (
                      <span style={{
                        fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase',
                        background: T.warnBg, color: T.warn, border: `1px solid ${T.warn}`,
                        padding: '2px 6px', borderRadius: 4, fontWeight: 800,
                      }}>Deactivated</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace' }}>{sp.id}</div>
                </div>
                <div style={{ fontSize: 12, color: T.inkSoft, fontStyle: 'italic', marginTop: 2 }}>{sp.scientific}</div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ fontSize: 13, color: T.inkMute, padding: 12, textAlign: 'center' }}>No matches.</div>
        )}
      </div>
    </>
  );
}

function SpeciesForm({ initial, onDone, onCancel }) {
  // Reads the runtime merged categories list (bundled + Supabase
  // overlay) and subscribes so a new category added on the
  // Categories tab appears in this dropdown live.
  const [liveCategories, setLiveCategories] = useState(() => getCategories());
  useEffect(() => subscribeCategoriesStore(() => setLiveCategories(getCategories())), []);

  const [id, setId]                   = useState(initial?.id || '');
  const [commonName, setCommonName]   = useState(initial?.commonName || '');
  const [scientific, setScientific]   = useState(initial?.scientific || '');
  const [category, setCategory]       = useState(initial?.category || liveCategories[0]?.id || '');
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
            {liveCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <Field label="Alt names (comma-separated)" value={altNames} onChange={setAltNames} placeholder="Sow Snapper, Genuine Red" />
      </Card>

      {!isNew && <SpeciesPhotoManager speciesId={id} speciesName={commonName} />}

      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>Key ID cues (one per line)</SectionLabel>
        <textarea
          value={keyIds} onChange={e => setKeyIds(e.target.value)} rows={6}
          placeholder={'Pinkish-red body fading to pale belly\nDistinctive red iris'}
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

      {!isNew && (
        <Card>
          <SectionLabel style={{ marginBottom: 6 }}>Status</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, flex: 1 }}>
              {initial.active === false
                ? 'Deactivated — hidden from pickers and classifier. Historical catches still resolve.'
                : 'Active — offered in pickers and classifier candidates.'}
            </div>
            {initial.active === false ? (
              <GhostButton
                onClick={async () => {
                  setSaving(true);
                  const res = await reactivateSpecies(initial.id);
                  setSaving(false);
                  if (!res.ok) setError(res.error || 'Reactivate failed.');
                  else onDone();
                }}
                disabled={saving}
                style={{ padding: '8px 14px', color: T.open, borderColor: T.open }}
              >Reactivate</GhostButton>
            ) : (
              <GhostButton
                onClick={async () => {
                  if (!window.confirm(`Deactivate ${initial.commonName}? Historical catches will still resolve, but it will disappear from pickers and the classifier.`)) return;
                  setSaving(true);
                  const res = await deactivateSpecies(initial.id);
                  setSaving(false);
                  if (!res.ok) setError(res.error || 'Deactivate failed.');
                  else onDone();
                }}
                disabled={saving}
                style={{ padding: '8px 14px', color: T.closed, borderColor: T.closed }}
              >Deactivate</GhostButton>
            )}
          </div>
        </Card>
      )}

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
   Species photo manager — shown inside SpeciesForm for existing rows
   ============================================================ */
function SpeciesPhotoManager({ speciesId, speciesName }) {
  const [overridePhotos, setOverridePhotos] = useState(() => speciesPhotoOverrideAll(speciesId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Bundled fallback (photos/manifest.json) — shown when no overrides
  // exist yet so the admin knows what the current live photo is.
  const bundled = speciesPhoto(speciesId);
  const showingBundled = overridePhotos.length === 0 && bundled?.url;

  const refresh = () => setOverridePhotos(speciesPhotoOverrideAll(speciesId));

  const onFile = async (file, { primary }) => {
    if (!file) return;
    setBusy(true); setError('');
    const up = await uploadImage({
      bucket: 'fish-photos',
      pathPrefix: speciesId,
      file,
      downscale: true,
      maxDim: 1600,
      quality: 0.82,
    });
    if (!up.ok) { setBusy(false); setError(up.error || 'Upload failed'); return; }
    const add = await addSpeciesPhoto({
      speciesId, url: up.url, isPrimary: primary,
      credit: null, license: null, source: 'admin-upload',
    });
    setBusy(false);
    if (!add.ok) { setError(add.error || 'Save failed'); return; }
    refresh();
  };

  const remove = async (photoId) => {
    if (!window.confirm('Delete this photo?')) return;
    setBusy(true); setError('');
    const del = await deleteSpeciesPhoto(photoId);
    setBusy(false);
    if (!del.ok) { setError(del.error || 'Delete failed'); return; }
    refresh();
  };

  const makePrimary = async (photoId) => {
    setBusy(true); setError('');
    const set = await setPrimarySpeciesPhoto(photoId, speciesId);
    setBusy(false);
    if (!set.ok) { setError(set.error || 'Failed'); return; }
    refresh();
  };

  return (
    <Card>
      <SectionLabel style={{ marginBottom: 8 }}>Photos</SectionLabel>
      {showingBundled && (
        <div style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', padding: 8, background: T.parchmentDeep, borderRadius: 6 }}>
          <div style={{ width: 90, height: 60, background: T.oceanDeep, borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <img src={bundled.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          </div>
          <div style={{ flex: 1, fontSize: 12, color: T.inkSoft, lineHeight: 1.4 }}>
            Currently showing the bundled fallback. Upload a photo below to override.
            {bundled.credit && <div style={{ fontSize: 10, color: T.inkMute, marginTop: 3 }}>Credit: {bundled.credit}</div>}
          </div>
        </div>
      )}
      {overridePhotos.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
          {overridePhotos.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, background: T.parchmentDeep, borderRadius: 6, border: p.is_primary ? `2px solid ${T.brass}` : `1px solid ${T.cardEdge}` }}>
              <div style={{ width: 90, height: 60, background: T.oceanDeep, borderRadius: 4, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <img src={p.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.inkSoft }}>
                {p.is_primary
                  ? <div style={{ color: T.brass, fontWeight: 700, fontSize: 11 }}>PRIMARY</div>
                  : <button onClick={() => makePrimary(p.id)} disabled={busy}
                      style={{ background: 'none', border: `1px solid ${T.brass}`, color: T.brass, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>
                      Set as primary
                    </button>}
              </div>
              <button onClick={() => remove(p.id)} disabled={busy}
                style={{ background: 'transparent', border: 'none', color: T.closed, cursor: 'pointer', fontSize: 18, padding: 4 }}
                aria-label="Delete photo">✕</button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f, { primary: overridePhotos.length === 0 });
          e.target.value = '';
        }}
      />
      <PrimaryButton onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : (overridePhotos.length === 0 ? 'Upload primary photo' : 'Upload another')}
      </PrimaryButton>
      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.closed }}>{error}</div>}
      <div style={{ fontSize: 10, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
        Downscaled to 1600px on upload. Set one photo as PRIMARY — that's what the app shows on cards, lightboxes, and share reports.
      </div>
    </Card>
  );
}

/* ============================================================
   Branding tab
   ============================================================ */
/* ============================================================
   Categories tab — cloud-first overlay editor.
   Seed from bundled on first visit, then admin can add / rename /
   reorder / toggle active / hard-delete with bulk reassign.
   ============================================================ */
function CategoriesTab() {
  const [rows, setRows] = useState(() => getCategories());
  const [editing, setEditing] = useState(null); // category being edited (or 'new')
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Seed from bundled if the table is empty on first visit. Cheap +
  // idempotent — seedFromBundled short-circuits when count > 0.
  useEffect(() => {
    (async () => {
      setBusy(true);
      const seeded = await seedFromBundled();
      const refr = await refreshCategories();
      setBusy(false);
      if (!seeded.ok) setErr(seeded.error);
      if (!refr.ok && refr.error !== 'not-configured') setErr(refr.error);
      setRows(getCategories());
    })();
  }, []);

  // Re-render when either overlay refreshes. Categories = when a new
  // category is added or an existing one is renamed/reordered.
  // Species = when a species's category assignment is reassigned in
  // place (SPECIES const gets mutated but its length stays constant,
  // so we need an explicit notify to recompute counts + refresh the
  // dropdown before delete).
  const [speciesVersion, setSpeciesVersion] = useState(0);
  useEffect(() => subscribeCategoriesStore(() => setRows(getCategories())), []);
  useEffect(() => subscribeSpeciesStore(() => setSpeciesVersion(v => v + 1)), []);

  const speciesCounts = useMemo(() => {
    const map = {};
    for (const s of SPECIES) map[s.category] = (map[s.category] || 0) + 1;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speciesVersion, rows.length]);

  const moveRow = async (idx, dir) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= rows.length) return;
    const a = rows[idx];
    const b = rows[nextIdx];
    setBusy(true);
    // Swap sort_orders — both upserts fire; local re-sort happens on
    // the next refresh.
    await upsertCategory({
      id: a.id, label: a.name, sort_order: nextIdx, icon_key: a.icon_key || null,
      rep_species_id: a.rep_species_id || null, is_active: true,
    });
    await upsertCategory({
      id: b.id, label: b.name, sort_order: idx, icon_key: b.icon_key || null,
      rep_species_id: b.rep_species_id || null, is_active: true,
    });
    setBusy(false);
  };

  if (editing) {
    return (
      <CategoryForm
        initial={editing === 'new' ? null : editing}
        onDone={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: T.inkSoft, padding: '4px 4px 8px', lineHeight: 1.5 }}>
        Admin renames, adds, reorders, hides — mobile installs pull the merged list
        on next boot. Bundled seed remains the offline-first floor if the cloud
        table is ever wiped.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton onClick={() => setEditing('new')} style={{ flex: 1 }}>+ Add category</PrimaryButton>
        <GhostButton
          onClick={async () => {
            // Clears the localStorage overlay + re-pulls both stores
            // so any drift between the admin UI and Supabase reality
            // resolves without a DevTools operation.
            try {
              localStorage.removeItem('kyc_categories_overrides_v1');
              localStorage.removeItem('kyc_species_overrides_v1');
              localStorage.removeItem('kyc_species_photos_v1');
            } catch {}
            setBusy(true);
            await refreshCategories();
            await refreshSpecies();
            setBusy(false);
            setRows(getCategories());
          }}
          disabled={busy}
          style={{ padding: '10px 14px', fontSize: 12 }}
        >
          {busy ? 'Refreshing…' : 'Refresh from Supabase'}
        </GhostButton>
      </div>
      {err && <div role="alert" style={{ fontSize: 12, color: T.closed }}>{err}</div>}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px',
            borderTop: i > 0 ? `1px solid ${T.cardEdge}` : 'none',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => moveRow(i, -1)} disabled={busy || i === 0} style={miniBtn(i === 0)}>▲</button>
              <button onClick={() => moveRow(i, +1)} disabled={busy || i === rows.length - 1} style={miniBtn(i === rows.length - 1)}>▼</button>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{r.name}</div>
              <div style={{ fontSize: 11, color: T.inkMute, fontFamily: 'monospace' }}>{r.id} · {speciesCounts[r.id] || 0} species</div>
            </div>
            <GhostButton onClick={() => setEditing(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</GhostButton>
          </div>
        ))}
      </Card>
    </div>
  );
}

const miniBtn = (disabled) => ({
  background: 'transparent',
  border: `1px solid ${disabled ? 'transparent' : T.cardEdge}`,
  color: disabled ? T.inkMute : T.brass,
  padding: '2px 6px', borderRadius: 4, cursor: disabled ? 'default' : 'pointer',
  fontSize: 10, lineHeight: 1,
});

function CategoryForm({ initial, onDone, onCancel }) {
  const isNew = !initial;
  const [id, setId]                = useState(initial?.id || '');
  const [label, setLabel]          = useState(initial?.name || '');
  const [sortOrder, setSortOrder]  = useState(initial?.sort_order ?? 0);
  const [iconKey, setIconKey]      = useState(initial?.icon_key || '');
  const [repSpeciesId, setRepSpId] = useState(initial?.rep_species_id || '');
  const [saving, setSaving]        = useState(false);
  const [error, setError]          = useState('');
  const [showDelete, setShowDelete] = useState(false);

  // Also subscribes to species-store so this recomputes when a
  // species is reassigned to a different category before the delete
  // flow opens. Otherwise the "N species assigned" message can lag.
  const [speciesVersion, setSpeciesVersion] = useState(0);
  useEffect(() => subscribeSpeciesStore(() => setSpeciesVersion(v => v + 1)), []);
  const speciesInCat = useMemo(
    () => SPECIES.filter(s => s.category === initial?.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial?.id, speciesVersion]
  );

  const save = async () => {
    setError('');
    if (!id.trim() || !label.trim()) { setError('id and label required'); return; }
    setSaving(true);
    const { ok, error } = await upsertCategory({
      id: id.trim(), label: label.trim(), sort_order: +sortOrder || 0,
      icon_key: iconKey.trim() || null,
      rep_species_id: repSpeciesId.trim() || null,
      is_active: true,
    });
    setSaving(false);
    if (!ok) { setError(error || 'save failed'); return; }
    onDone();
  };

  if (showDelete) {
    return (
      <CategoryDeleteFlow
        category={initial}
        speciesInCat={speciesInCat}
        onCancel={() => setShowDelete(false)}
        onDone={onDone}
      />
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 6 }}>id (kebab-case slug)</SectionLabel>
        <input type="text" value={id} onChange={e => setId(e.target.value)}
          disabled={!isNew} placeholder="e.g. pelagic"
          style={{ ...inputStyle, opacity: isNew ? 1 : 0.55 }} />
        <Field label="Label"       value={label}     onChange={setLabel}    placeholder="Pelagic" />
        <Field label="Sort order"  value={String(sortOrder)} onChange={(v) => setSortOrder(v.replace(/[^0-9]/g, ''))} placeholder="0" />
        <Field label="Icon key (lucide-react name; blank = default)" value={iconKey} onChange={setIconKey} placeholder="Fish" />
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Representative species (drives the browse tile photo)</SectionLabel>
          <select value={repSpeciesId} onChange={e => setRepSpId(e.target.value)} style={inputStyle}>
            <option value="">— none —</option>
            {SPECIES.map(s => <option key={s.id} value={s.id}>{s.commonName}</option>)}
          </select>
        </div>
      </Card>

      {error && <div role="alert" style={{ fontSize: 12, color: T.closed }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving…' : (isNew ? 'Create category' : 'Save changes')}
        </PrimaryButton>
      </div>

      {!isNew && (
        <GhostButton onClick={() => setShowDelete(true)}
          style={{ width: '100%', color: T.closed, borderColor: T.closed, marginTop: 6 }}>
          Delete this category
        </GhostButton>
      )}
    </div>
  );
}

function CategoryDeleteFlow({ category, speciesInCat, onCancel, onDone }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = getCategories().filter(c => c.id !== category.id);
  const needsReassign = speciesInCat.length > 0;

  const doDelete = async () => {
    setBusy(true); setError('');
    if (needsReassign) {
      if (!target) { setBusy(false); setError('Pick a target category first.'); return; }
      const re = await reassignSpecies(speciesInCat.map(s => s.id), target);
      if (!re.ok) { setBusy(false); setError(re.error || 'reassign failed'); return; }
    }
    const de = await deactivateCategory(category.id);
    setBusy(false);
    if (!de.ok) { setError(de.error || 'delete failed'); return; }
    onDone();
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <SectionLabel style={{ marginBottom: 8 }}>Delete "{category.name}"?</SectionLabel>
        {needsReassign ? (
          <>
            <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginBottom: 10 }}>
              <strong>{speciesInCat.length}</strong> {speciesInCat.length === 1 ? 'species is' : 'species are'} assigned to this category and must be moved to a different one before it can be deleted.
            </div>
            <SectionLabel style={{ marginBottom: 6 }}>Move to</SectionLabel>
            <select value={target} onChange={e => setTarget(e.target.value)} style={inputStyle}>
              <option value="">— pick a category —</option>
              {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.5 }}>
              Species that will be moved: {speciesInCat.map(s => s.commonName).join(', ')}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
            No species are currently assigned to this category. Safe to remove.
          </div>
        )}
      </Card>

      {error && <div role="alert" style={{ fontSize: 12, color: T.closed }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={doDelete} disabled={busy || (needsReassign && !target)}
          style={{ flex: 1, background: T.closed, color: '#fff' }}>
          {busy ? 'Working…' : (needsReassign ? `Move ${speciesInCat.length} + delete` : 'Delete')}
        </PrimaryButton>
      </div>
    </div>
  );
}

function BrandingTab() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12, color: T.inkSoft, padding: '4px 4px 8px', lineHeight: 1.5 }}>
        Runtime-swappable brand images. Uploads land in the <code>brand-assets</code> bucket
        and override the bundled defaults on the next app boot for all installs.
        For iOS native icon + launch storyboard changes, see <code>resources/</code> and rerun
        <code>npm run ios:assets</code> — those require a rebuild + TestFlight resubmit.
      </div>
      {BRAND_ASSETS.map(a => <BrandAssetRow key={a.key} asset={a} />)}
    </div>
  );
}

function BrandAssetRow({ asset }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const currentUrl = brandAsset(asset.key, asset.fallback);
  const overridden = currentUrl !== asset.fallback;

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    const isSvg = file.type === 'image/svg+xml' || (file.name || '').toLowerCase().endsWith('.svg');
    const up = await uploadImage({
      bucket: 'brand-assets',
      pathPrefix: asset.key,
      file,
      downscale: !isSvg,
      maxDim: 2400,
      quality: 0.9,
    });
    if (!up.ok) { setBusy(false); setError(up.error || 'Upload failed'); return; }
    const set = await upsertBrandAsset({ key: asset.key, url: up.url });
    setBusy(false);
    if (!set.ok) { setError(set.error || 'Save failed'); return; }
  };

  const revert = async () => {
    if (!window.confirm(`Revert ${asset.label} to bundled default?`)) return;
    setBusy(true); setError('');
    const del = await deleteBrandAsset(asset.key);
    setBusy(false);
    if (!del.ok) { setError(del.error || 'Failed'); return; }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{
          width: 100, height: 100, flexShrink: 0,
          background: T.parchmentDeep, borderRadius: 6,
          overflow: 'hidden', border: `1px solid ${T.cardEdge}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {currentUrl
            ? <img src={currentUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 10, color: T.inkMute }}>no image</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{asset.label}</div>
            {overridden
              ? <span style={{ fontSize: 10, color: T.brass, fontWeight: 700 }}>OVERRIDDEN</span>
              : <span style={{ fontSize: 10, color: T.inkMute }}>bundled</span>}
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4, lineHeight: 1.4 }}>{asset.desc}</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              ref={fileRef} type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]; if (f) onFile(f);
                e.target.value = '';
              }}
            />
            <GhostButton onClick={() => fileRef.current?.click()} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
              {busy ? 'Uploading…' : (overridden ? 'Replace' : 'Upload override')}
            </GhostButton>
            {overridden && (
              <GhostButton onClick={revert} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
                Revert to bundled
              </GhostButton>
            )}
          </div>
          {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.closed }}>{error}</div>}
        </div>
      </div>
    </Card>
  );
}

/* ============================================================
   Chrome — shared header/back layout
   ============================================================ */
function Chrome({ title, children, onExit, exitLabel = '← Back to app' }) {
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
          }}>{exitLabel}</button>
        )}
      </div>
      {children}
    </div>
  );
}
