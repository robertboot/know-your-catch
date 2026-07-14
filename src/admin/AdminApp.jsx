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
import TrainingTab from './TrainingTab.jsx';
import NotificationsTab from './NotificationsTab.jsx';
import {
  brandAsset, refreshBrandAssets, upsertBrandAsset, deleteBrandAsset,
  iosAppIconPublicUrl, uploadIosAppIcon, deleteIosAppIcon, getIosAppIconMeta,
} from '../brand-store.js';
import {
  getCategories, refreshCategories,
  upsertCategory, deactivateCategory, reassignSpecies, seedFromBundled,
  subscribe as subscribeCategoriesStore,
} from '../categories-store.js';
import {
  listSuggestions, approveSuggestion, rejectSuggestion, mergeSuggestion,
} from '../species-suggestions-store.js';
import { researchSpecies } from '../species-research-store.js';
import { SpeciesPickerModal } from './pickers.jsx';
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
  // Guard: refreshSession itself emits TOKEN_REFRESHED which fires
  // onAuthStateChange which updates `session` which re-fires the
  // refresh effect → 429 rate limit within a second. This ref ensures
  // one refresh per full admin-console boot.
  const refreshedOnce = useRef(false);

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
    if (session && !refreshedOnce.current) {
      refreshedOnce.current = true;
      // Post-Pro-upgrade guard: force a token refresh so the storage
      // + REST clients don't ride into a request loop on a JWT signed
      // by a now-rotated key. No-op if the token is fresh. Guarded so
      // it never re-fires on the TOKEN_REFRESHED event this call
      // itself emits.
      client()?.auth.refreshSession().then((r) => {
        if (r?.error) {
          console.warn('[admin] auth.refreshSession error', r.error);
        } else {
          console.log('[admin] auth.refreshSession ok, expires_at=', r?.data?.session?.expires_at);
        }
      }).catch((e) => {
        console.warn('[admin] auth.refreshSession threw', e);
      });
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
      {tab === 'species'       && <SpeciesTab  detailView={detailView} setDetailView={setDetailView} />}
      {tab === 'branding'      && !detailView && <BrandingTab />}
      {tab === 'categories'    && !detailView && <CategoriesTab />}
      {tab === 'training'      && !detailView && <TrainingTab />}
      {tab === 'notifications' && !detailView && <NotificationsTab />}
    </Chrome>
  );
}

function TabBar({ tab, onTab }) {
  const tabs = [
    { id: 'species',       label: 'Species' },
    { id: 'training',      label: 'Training' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'categories',    label: 'Categories' },
    { id: 'branding',      label: 'Branding' },
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
  // 'active' | 'deactivated' | 'all' — default 'active' since most
  // review passes only care about live species.
  const [statusFilter, setStatusFilter] = useState('active');
  // Species tab now has two sub-panels: the existing species list and
  // the new suggestion queue where user-submitted custom species land.
  const [panel, setPanel] = useState('list');
  // Quick Add modal — a compact form for the common case of "just get
  // this species in the system so I can upload training photos to it,
  // I'll flesh out the details later." The full SpeciesForm below is
  // still the right form for a considered addition (~15 fields).
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddToast, setQuickAddToast] = useState('');
  React.useEffect(() => {
    if (!quickAddToast) return;
    const t = setTimeout(() => setQuickAddToast(''), 4000);
    return () => clearTimeout(t);
  }, [quickAddToast]);
  if (panel === 'suggestions') {
    return (
      <>
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.cardEdge}`, marginBottom: 12 }}>
          <SpeciesSubTabBtn active={false}                          onClick={() => setPanel('list')}>Species</SpeciesSubTabBtn>
          <SpeciesSubTabBtn active={true}                           onClick={() => setPanel('suggestions')}>Suggestions</SpeciesSubTabBtn>
        </div>
        <SpeciesSuggestionsPanel />
      </>
    );
  }

  const sorted = useMemo(() =>
    [...SPECIES].sort((a, b) => a.commonName.localeCompare(b.commonName)),
    // Re-sort when SPECIES changes (add / edit lands via species-store notify)
    [SPECIES.length, SPECIES.map(s => s.id + (s.active === false ? ':d' : '')).join(',')]
  );
  const activeCount      = sorted.filter(s => s.active !== false).length;
  const deactivatedCount = sorted.length - activeCount;
  const byStatus = sorted.filter(s => {
    if (statusFilter === 'active')       return s.active !== false;
    if (statusFilter === 'deactivated')  return s.active === false;
    return true;
  });
  const filtered = filter.trim()
    ? byStatus.filter(s => {
        const q = filter.toLowerCase();
        return s.commonName.toLowerCase().includes(q)
          || (s.scientific || '').toLowerCase().includes(q)
          || s.id.toLowerCase().includes(q);
      })
    : byStatus;

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
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${T.cardEdge}`, marginBottom: 12 }}>
        <SpeciesSubTabBtn active={true}  onClick={() => setPanel('list')}>Species</SpeciesSubTabBtn>
        <SpeciesSubTabBtn active={false} onClick={() => setPanel('suggestions')}>Suggestions</SpeciesSubTabBtn>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <StatusChip
          active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}
          label={`Active · ${activeCount}`} color={T.open}
        />
        <StatusChip
          active={statusFilter === 'deactivated'} onClick={() => setStatusFilter('deactivated')}
          label={`Deactivated · ${deactivatedCount}`} color={T.warn}
        />
        <StatusChip
          active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}
          label={`All · ${sorted.length}`} color={T.brass}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="search" placeholder="Filter by name, scientific, or id…"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <PrimaryButton
          onClick={() => setQuickAddOpen(true)}
          style={{ padding: '10px 14px', flexShrink: 0 }}
        >+ Quick Add</PrimaryButton>
        <GhostButton
          onClick={() => setDetailView({ kind: 'species-edit', id: null, title: 'Add species' })}
          style={{ padding: '10px 14px', flexShrink: 0 }}
        >+ Add (full)</GhostButton>
      </div>
      {quickAddToast && (
        <div role="status" style={{
          padding: '8px 12px', marginBottom: 10,
          background: 'rgba(94,224,172,0.14)', border: `1px solid ${T.open}`,
          borderRadius: 8, color: T.open, fontSize: 12, fontWeight: 700,
        }}>
          {quickAddToast}
        </div>
      )}
      {quickAddOpen && (
        <QuickAddSpeciesModal
          existingIds={new Set(SPECIES.map(s => s.id))}
          onCancel={() => setQuickAddOpen(false)}
          onSaved={(commonName) => {
            setQuickAddOpen(false);
            setQuickAddToast(`Added — you can now upload training photos to ${commonName}.`);
          }}
        />
      )}
      <div style={{ fontSize: 11, color: T.inkMute, margin: '0 4px 10px' }}>
        {filtered.length} shown · {activeCount} active · {deactivatedCount} deactivated.
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

/* Sub-tab pill for the Species top-level tab (Species / Suggestions).
   Mirrors the pattern TrainingTab uses so the visual language stays
   consistent across the admin. */
function SpeciesSubTabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', padding: '10px 14px',
      color: active ? T.brass : T.inkMute,
      fontWeight: 700, fontSize: 13, cursor: 'pointer',
      borderBottom: `2px solid ${active ? T.brass : 'transparent'}`,
      marginBottom: -1,
    }}>{children}</button>
  );
}

function SpeciesSuggestionsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [rejectPickerFor, setRejectPickerFor] = useState(null);
  const [mergePickerFor,  setMergePickerFor]  = useState(null);
  const [approveEditFor,  setApproveEditFor]  = useState(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const r = await listSuggestions({ status: statusFilter === 'all' ? null : statusFilter });
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    setError(''); setRows(r.rows);
  }, [statusFilter]);
  useEffect(() => { refresh(); }, [refresh]);

  const doReject = async (id, reason) => {
    setRejectPickerFor(null);
    const r = await rejectSuggestion(id, reason);
    if (!r.ok) return setError(r.error || 'reject failed');
    refresh();
  };
  const doMerge = async (id, existingId) => {
    setMergePickerFor(null);
    const r = await mergeSuggestion(id, existingId);
    if (!r.ok) return setError(r.error || 'merge failed');
    refresh();
  };
  const doApprove = async (row, patch) => {
    setApproveEditFor(null);
    const r = await approveSuggestion(row.id, patch);
    if (!r.ok) return setError(r.error || 'approve failed');
    refresh();
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {['pending', 'approved', 'rejected', 'merged', 'all'].map(k => (
          <button key={k} onClick={() => setStatusFilter(k)} style={{
            background: statusFilter === k ? T.brass : 'transparent',
            color: statusFilter === k ? T.oceanDeep : T.brass,
            border: `1.5px solid ${T.brass}`,
            padding: '5px 12px', borderRadius: 999,
            fontSize: 11, fontWeight: 800, letterSpacing: 0.5, cursor: 'pointer',
          }}>
            {k === 'all' ? 'All' : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <GhostButton onClick={refresh} disabled={loading} style={{ padding: '6px 12px', fontSize: 12 }}>
          {loading ? 'Loading…' : 'Refresh'}
        </GhostButton>
      </div>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {rows.length === 0 && !loading && (
        <Card style={{ fontSize: 13, color: T.inkMute, textAlign: 'center', padding: 24 }}>
          No {statusFilter === 'all' ? '' : statusFilter} suggestions.
        </Card>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map(row => (
          <Card key={row.id}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, flex: 1 }}>
                {row.common_name}
              </div>
              <span style={{
                fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800,
                color: (row.status === 'approved' || row.status === 'merged') ? T.open
                     : row.status === 'rejected' ? T.closed
                     : T.brass,
              }}>{row.status}</span>
            </div>
            {row.scientific_name && (
              <div style={{ fontSize: 12, color: T.inkSoft, fontStyle: 'italic' }}>{row.scientific_name}</div>
            )}
            {row.alt_names && (
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>alt: {row.alt_names}</div>
            )}
            {row.notes && (
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>notes: {row.notes}</div>
            )}
            <div style={{ fontSize: 10, color: T.inkMute, marginTop: 6 }}>
              submitted {row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—'}
              {' · '}client id <code>{row.client_species_id || '—'}</code>
              {row.approved_species_id && <> · → <code>{row.approved_species_id}</code></>}
              {row.rejection_reason && <> · reason: {row.rejection_reason}</>}
            </div>
            {row.status === 'pending' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <GhostButton
                  onClick={() => setApproveEditFor(row)}
                  style={{ padding: '6px 12px', fontSize: 12, color: T.open, borderColor: T.open }}
                >
                  Approve
                </GhostButton>
                <GhostButton
                  onClick={() => setRejectPickerFor(row)}
                  style={{ padding: '6px 12px', fontSize: 12, color: T.closed, borderColor: T.closed }}
                >
                  Reject
                </GhostButton>
                <GhostButton
                  onClick={() => setMergePickerFor(row)}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  Merge into existing
                </GhostButton>
              </div>
            )}
          </Card>
        ))}
      </div>

      {approveEditFor && (
        <ApproveSuggestionModal
          suggestion={approveEditFor}
          onCancel={() => setApproveEditFor(null)}
          onConfirm={(patch) => doApprove(approveEditFor, patch)}
        />
      )}

      {rejectPickerFor && (
        <RejectSuggestionModal
          suggestion={rejectPickerFor}
          onCancel={() => setRejectPickerFor(null)}
          onPick={(reason) => doReject(rejectPickerFor.id, reason)}
        />
      )}

      {mergePickerFor && (
        <SpeciesPickerModal
          speciesOptions={SPECIES.filter(s => s.active !== false)}
          onCancel={() => setMergePickerFor(null)}
          onPick={(existingId) => doMerge(mergePickerFor.id, existingId)}
          title={`Merge “${mergePickerFor.common_name}” into…`}
          isTablet
        />
      )}
    </>
  );
}

function ApproveSuggestionModal({ suggestion, onCancel, onConfirm }) {
  const [commonName, setCommonName] = useState(suggestion.common_name || '');
  const [scientific, setScientific] = useState(suggestion.scientific_name || '');
  const [altNames,   setAltNames]   = useState(suggestion.alt_names || '');
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`,
        borderRadius: 12, padding: 18, maxWidth: 460, width: '100%',
      }}>
        <H1 size={18} style={{ marginBottom: 12 }}>Approve suggestion</H1>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>Common name</div>
            <input type="text" value={commonName} onChange={e => setCommonName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>Scientific name</div>
            <input type="text" value={scientific} onChange={e => setScientific(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>Alt names (comma-separated)</div>
            <input type="text" value={altNames} onChange={e => setAltNames(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
            <PrimaryButton
              onClick={() => onConfirm({ commonName, scientificName: scientific, altNames })}
              style={{ padding: '8px 14px' }}
              disabled={!commonName.trim()}
            >
              Approve &amp; add species
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function RejectSuggestionModal({ suggestion, onCancel, onPick }) {
  const REASONS = [
    { key: 'not_a_fish',           label: 'Not a fish' },
    { key: 'duplicate_of_existing', label: 'Duplicate of existing species' },
    { key: 'not_in_scope',         label: "Not in scope for this app" },
    { key: 'spam',                 label: 'Spam / abuse' },
    { key: 'other',                label: 'Other' },
  ];
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`,
        borderRadius: 12, padding: 18, maxWidth: 460, width: '100%',
      }}>
        <H1 size={18} style={{ marginBottom: 6 }}>Reject “{suggestion.common_name}”</H1>
        <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 12 }}>
          The reason is surfaced to the submitting user on their next sync.
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {REASONS.map(r => (
            <button
              key={r.key} type="button"
              onClick={() => onPick(r.key)}
              style={{
                background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
                color: T.ink, padding: '10px 12px', borderRadius: 8,
                fontSize: 13, textAlign: 'left', cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </div>
    </div>
  );
}

/* Small toggleable chip used by the Species tab's active/deactivated
   filter row. Kept local since no other tab needs it right now. */
/* Quick Add species — compact modal for the common "just get this
   species into the system so I can start uploading training photos
   to it" case. Full details (habitat, lookalikes, illustration, etc.)
   go to the ~15-field SpeciesForm below via the Edit button on the
   list row.

   Auto-derived on save:
     id       — slug of the common name, collision-checked live
     active   — true
     altNames — [] (edit later)
     lookalikes — [] (edit later)
     habitat  — '' (edit later)
     image    — null (SpeciesImage falls back to the FishMark
                placeholder illustration)

   Save rides the same upsertSpecies path the full form uses, so
   the new species immediately appears in every consumer of the
   SPECIES overlay: Training → Upload picker, mobile app species
   picker on next refresh, Regulations list. */
function QuickAddSpeciesModal({ existingIds, onCancel, onSaved }) {
  const [commonName, setCommonName] = useState('');
  const [scientific, setScientific] = useState('');
  const [category, setCategory]     = useState('');
  const [cue1, setCue1] = useState('');
  const [cue2, setCue2] = useState('');
  const [cue3, setCue3] = useState('');
  const [cue4, setCue4] = useState('');
  const [cue5, setCue5] = useState('');
  const [altNamesText, setAltNamesText] = useState('');
  const [habitat, setHabitat] = useState('');
  const [lookalikes, setLookalikes] = useState([]); // string[] ids
  const [sourceNote, setSourceNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState('');

  const activeCategories = getCategories();
  const derivedId = React.useMemo(() => {
    return (commonName || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
  }, [commonName]);
  const idCollision = derivedId && existingIds.has(derivedId);
  const missingRequired = !commonName.trim() || !scientific.trim() || !category;

  const doResearch = async () => {
    if (researching || !commonName.trim()) return;
    setError('');
    // If the admin has already filled anything except the two name
    // fields, ask before overwriting.
    const anyFilled = !!(
      category || cue1.trim() || cue2.trim() || cue3.trim() || cue4.trim() || cue5.trim() ||
      altNamesText.trim() || habitat.trim() || lookalikes.length > 0
    );
    if (anyFilled && !window.confirm(
      'Some fields have values already. Overwrite with AI suggestions? (Common name + scientific stay as you typed them.)'
    )) return;

    setResearching(true);
    const r = await researchSpecies({
      commonName: commonName.trim(),
      scientificName: scientific.trim(),
    });
    setResearching(false);
    if (!r.ok) { setError(r.error || 'research failed'); return; }
    const d = r.data || {};
    if (d.scientific && !scientific.trim()) setScientific(d.scientific);
    if (d.category) setCategory(d.category);
    setAltNamesText((d.altNames || []).join(', '));
    setHabitat(d.habitat || '');
    setLookalikes(Array.isArray(d.lookalikes) ? d.lookalikes.slice(0, 6) : []);
    setSourceNote(d.sourceNote || '');
    const cues = Array.isArray(d.keyIds) ? d.keyIds : [];
    setCue1(cues[0] || '');
    setCue2(cues[1] || '');
    setCue3(cues[2] || '');
    setCue4(cues[3] || '');
    setCue5(cues[4] || '');
  };

  const removeLookalike = (id) => {
    setLookalikes(prev => prev.filter(x => x !== id));
  };

  const save = async () => {
    setError('');
    if (missingRequired) {
      setError('Common name, scientific name, and category are required.');
      return;
    }
    if (idCollision) return; // guard also enforced by disabled state
    setBusy(true);
    const keyIds = [cue1, cue2, cue3, cue4, cue5]
      .map(c => (c || '').trim())
      .filter(Boolean);
    const altNames = altNamesText.split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const payload = {
      id: derivedId,
      commonName: commonName.trim(),
      scientific: scientific.trim(),
      category,
      active: true,
      altNames,
      lookalikes: lookalikes.filter(id => existingIds.has(id)),
      habitat: habitat.trim(),
      keyIds,
      image: null,
    };
    const r = await upsertSpecies(payload);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'save failed'); return; }
    onSaved(commonName.trim());
  };

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`,
        borderRadius: 12, padding: 18, maxWidth: 500, width: '100%',
      }}>
        <H1 size={18} style={{ marginBottom: 4 }}>Quick Add species</H1>
        <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
          Enough to start uploading training photos. Habitat, lookalikes,
          illustration, and the rest can be filled in later via Edit.
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Common name <span style={{ color: T.warn }}>*</span>
            </div>
            <input
              type="text" value={commonName}
              onChange={e => setCommonName(e.target.value)}
              placeholder="e.g. Cero Mackerel"
              style={inputStyle}
              autoFocus
            />
            {derivedId && (
              <div style={{
                fontSize: 11, marginTop: 4,
                color: idCollision ? T.closed : T.inkMute,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}>
                {idCollision
                  ? `${derivedId} already exists — edit that species instead or change the name.`
                  : `will be saved as: ${derivedId}`}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Scientific name <span style={{ color: T.warn }}>*</span>
            </div>
            <input
              type="text" value={scientific}
              onChange={e => setScientific(e.target.value)}
              placeholder="e.g. Scomberomorus regalis"
              style={{ ...inputStyle, fontStyle: 'italic' }}
            />
          </div>

          {/* AI research trigger — pre-populates category, habitat,
              keyIds, altNames, lookalikes. Populated fields remain
              fully editable; nothing auto-saves until the admin taps
              Add species. */}
          <div>
            <button
              type="button"
              onClick={doResearch}
              disabled={researching || !commonName.trim()}
              style={{
                width: '100%', padding: '10px 14px',
                background: 'transparent',
                border: `1.5px solid ${researching || !commonName.trim() ? T.inkMute : '#5ecdf2'}`,
                color: researching || !commonName.trim() ? T.inkMute : '#5ecdf2',
                borderRadius: 8, fontWeight: 800, fontSize: 13,
                cursor: researching || !commonName.trim() ? 'not-allowed' : 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {researching
                ? <>Researching {commonName || 'species'}…</>
                : <>✨ Research with AI</>}
            </button>
          </div>

          {sourceNote && (
            <div style={{
              padding: '8px 10px', borderRadius: 8,
              background: 'rgba(94,205,242,0.08)',
              border: `1px solid rgba(94,205,242,0.35)`,
              fontSize: 11, color: T.inkSoft, lineHeight: 1.5,
            }}>
              <strong style={{ color: '#5ecdf2', letterSpacing: 0.5 }}>AI-SUGGESTED.</strong>
              {' '}Review each field before saving. {sourceNote}
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Category <span style={{ color: T.warn }}>*</span>
            </div>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={inputStyle}
            >
              <option value="">Pick a category…</option>
              {activeCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Alt / regional names <span style={{ color: T.inkMute, fontWeight: 400 }}>(comma-separated, optional)</span>
            </div>
            <input
              type="text" value={altNamesText}
              onChange={e => setAltNamesText(e.target.value)}
              placeholder="e.g. painted mackerel, kingfish, spotted mackerel"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Habitat <span style={{ color: T.inkMute, fontWeight: 400 }}>(optional)</span>
            </div>
            <textarea
              value={habitat}
              onChange={e => setHabitat(e.target.value)}
              rows={3}
              placeholder="Depth range, structure preference, migration notes…"
              style={{ ...inputStyle, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
              Key ID cues <span style={{ color: T.inkMute, fontWeight: 400 }}>(optional — up to 5)</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <input type="text" value={cue1} onChange={e => setCue1(e.target.value)} placeholder="1. Distinctive yellow stripe along body" style={inputStyle} />
              <input type="text" value={cue2} onChange={e => setCue2(e.target.value)} placeholder="2. Second distinguishing feature" style={inputStyle} />
              <input type="text" value={cue3} onChange={e => setCue3(e.target.value)} placeholder="3. Third distinguishing feature" style={inputStyle} />
              <input type="text" value={cue4} onChange={e => setCue4(e.target.value)} placeholder="4. Fourth (optional)" style={inputStyle} />
              <input type="text" value={cue5} onChange={e => setCue5(e.target.value)} placeholder="5. Fifth (optional)" style={inputStyle} />
            </div>
          </div>

          {lookalikes.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
                Lookalikes <span style={{ color: T.inkMute, fontWeight: 400 }}>(tap to remove)</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {lookalikes.map(id => {
                  const sp = SPECIES.find(s => s.id === id);
                  const label = sp?.commonName || id;
                  return (
                    <button
                      key={id} type="button"
                      onClick={() => removeLookalike(id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: T.parchmentDeep, color: T.ink,
                        border: `1px solid ${T.cardEdge}`, borderRadius: 999,
                        padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                      }}
                      title="Click to remove"
                    >
                      {label}
                      <span style={{ color: T.inkMute, fontSize: 14, lineHeight: 1 }}>×</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div role="alert" style={{ fontSize: 12, color: T.closed }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: 'transparent', border: 'none', color: T.inkMute,
                fontSize: 12, cursor: 'pointer', padding: '8px 4px',
              }}
            >
              Add more details later →
            </button>
            <div style={{ flex: 1 }} />
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
            <PrimaryButton
              onClick={save}
              disabled={busy || missingRequired || idCollision}
              style={{ padding: '8px 16px' }}
            >
              {busy ? 'Saving…' : 'Add species'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ active, onClick, label, color }) {
  return (
    <button onClick={onClick} style={{
      background: active ? color : 'transparent',
      color: active ? T.oceanDeep : color,
      border: `1.5px solid ${color}`,
      padding: '5px 12px', borderRadius: 999,
      fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
      cursor: 'pointer',
    }}>{label}</button>
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
        Runtime-swappable brand images (logos, hero) go into the <code>brand-assets</code> bucket
        and override the bundled defaults on the next app boot for all installs.
        <br /><br />
        <strong style={{ color: T.ink }}>The iOS App Icon is different.</strong> It's baked
        into the .app bundle at build time and can't be swapped over-the-air.
        Uploading a new icon here <em>stages</em> it for the next iOS build
        that Robert ships to TestFlight/App Store. Existing installs won't
        see the change until Apple approves the build (typically 24-48 hours)
        and users download the update.
      </div>
      {BRAND_ASSETS.map(a => <BrandAssetRow key={a.key} asset={a} />)}
      <IosAppIconCard />
    </div>
  );
}

function IosAppIconCard() {
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState('');
  const [saved, setSaved]         = useState(false);
  const [meta, setMeta]           = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileRef = useRef(null);

  const refreshMeta = async () => {
    const m = await getIosAppIconMeta();
    setMeta(m);
    if (m?.exists) {
      const url = iosAppIconPublicUrl();
      // Cache-bust so a fresh upload shows immediately.
      setPreviewUrl(url ? `${url}?t=${Date.now()}` : null);
    } else {
      setPreviewUrl(null);
    }
  };

  useEffect(() => { refreshMeta(); }, []);

  const onFile = async (file) => {
    if (!file) return;
    setError(''); setSaved(false);

    if (file.type !== 'image/png') {
      setError('Must be a PNG file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(`File is ${(file.size / (1024 * 1024)).toFixed(1)} MB — must be under 5 MB.`);
      return;
    }
    const dims = await new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload  = () => { URL.revokeObjectURL(objectUrl); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
      img.src = objectUrl;
    });
    if (!dims) { setError('Could not read the image.'); return; }
    if (dims.w !== 1024 || dims.h !== 1024) {
      setError(`Must be exactly 1024×1024 (this file is ${dims.w}×${dims.h}).`);
      return;
    }

    setBusy(true);
    const r = await uploadIosAppIcon(file);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'Upload failed'); return; }
    setSaved(true);
    await refreshMeta();
  };

  const clear = async () => {
    if (!window.confirm('Clear the staged icon? The next iOS build will fall back to the tracked resources/icon.png.')) return;
    setBusy(true); setError(''); setSaved(false);
    const r = await deleteIosAppIcon();
    setBusy(false);
    if (!r.ok) { setError(r.error || 'Delete failed'); return; }
    await refreshMeta();
  };

  // iOS home-screen mask is roughly 22.37% of the icon side. On our
  // 100px preview that's ~22px, giving a fair approximation of what
  // the phone will render.
  const previewRadius = 22;

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{
          width: 100, height: 100, flexShrink: 0,
          background: T.parchmentDeep, borderRadius: previewRadius,
          overflow: 'hidden', border: `1px solid ${T.cardEdge}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {previewUrl
            ? <img src={previewUrl} alt="Staged app icon"
                   style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 10, color: T.inkMute, textAlign: 'center', padding: 6 }}>
                No staged icon
              </span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>iOS App Icon</div>
            {meta?.exists
              ? <span style={{ fontSize: 10, color: T.brass, fontWeight: 700 }}>STAGED</span>
              : <span style={{ fontSize: 10, color: T.inkMute }}>tracked default</span>}
          </div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4, lineHeight: 1.45 }}>
            Required: <strong>1024×1024 PNG</strong>, no transparency, no rounded
            corners (Apple applies the mask). Keep the glyph well clear of the edges.
          </div>
          <div style={{
            fontSize: 11, color: T.inkSoft, marginTop: 8, lineHeight: 1.45,
            background: T.parchmentDeep, padding: '8px 10px', borderRadius: 6,
            border: `1px solid ${T.cardEdge}`,
          }}>
            Uploading here prepares the icon for the <strong>next iOS build</strong>.
            It doesn't change the icon on phones that already have the app installed
            until Robert ships a new TestFlight/App Store build and Apple approves it.
            Turn-around: usually 24-48 hours.
          </div>
          {meta?.exists && meta.updated_at && (
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6 }}>
              Staged {new Date(meta.updated_at).toLocaleString()}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              ref={fileRef} type="file" accept="image/png"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]; if (f) onFile(f);
                e.target.value = '';
              }}
            />
            <GhostButton onClick={() => fileRef.current?.click()} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
              {busy ? 'Uploading…' : (meta?.exists ? 'Replace staged icon' : 'Upload icon')}
            </GhostButton>
            {meta?.exists && (
              <GhostButton onClick={clear} disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }}>
                Clear staged icon
              </GhostButton>
            )}
          </div>
          {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.closed }}>{error}</div>}
          {saved && !error && (
            <div style={{ marginTop: 8, fontSize: 12, color: T.open, fontWeight: 700 }}>
              Icon staged for next build.
            </div>
          )}
        </div>
      </div>
    </Card>
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
