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
import { SPECIES } from '../data.js';
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
import {
  fetchRegulations, adminListRegulations, adminUpsertRegulation,
  adminVerifyRegulation, adminUnverifyRegulation, draftWithAI,
  regulationAge, regulationAgePhrase,
  adminMarkAllStale, adminCountStalable,
} from '../regulations-store.js';
import { JURISDICTIONS } from '../data.js';
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
      {tab === 'regulations'   && !detailView && <RegulationsTab />}
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
    { id: 'regulations',   label: 'Regulations' },
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

  // Hoisted ABOVE the panel === 'suggestions' early return so hook
  // count stays constant across sub-tab switches. Previously this
  // useMemo sat below the early return and caused React #300
  // ("Rendered fewer hooks than expected") whenever an admin toggled
  // to Suggestions and back. The sort is cheap so computing it on
  // the Suggestions branch too is a non-issue.
  const sorted = useMemo(() =>
    [...SPECIES].sort((a, b) => a.commonName.localeCompare(b.commonName)),
    // Re-sort when SPECIES changes (add / edit lands via species-store notify)
    [SPECIES.length, SPECIES.map(s => s.id + (s.active === false ? ':d' : '')).join(',')]
  );

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
          onClick={() => setDetailView({ kind: 'species-edit', id: null, title: 'Add species' })}
          style={{ padding: '10px 14px', flexShrink: 0 }}
        >+ Add Species</PrimaryButton>
      </div>
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
  const [typicalLengthIn, setTypicalLengthIn] = useState(initial?.typicalLengthIn || '');
  const [typicalWeightLb, setTypicalWeightLb] = useState(initial?.typicalWeightLb || '');
  const [worldRecordLb,  setWorldRecordLb]  = useState(initial?.worldRecordLb  || '');
  const [geoRange,       setGeoRange]       = useState(initial?.geoRange       || '');
  const [edibility,      setEdibility]      = useState(initial?.edibility      || '');
  const [seasonality,    setSeasonality]    = useState(initial?.seasonality    || '');
  const [reefFish, setReefFish]       = useState(!!initial?.reefFish);
  const [hms, setHms]                 = useState(!!initial?.hms);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [researching, setResearching] = useState(false);
  const [sourceNote, setSourceNote]   = useState('');

  const isNew = !initial;

  // Uniqueness-preserving union for comma-separated list fields.
  const unionCsv = (existingText, incomingArr) => {
    const cur = existingText.split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set(cur.map(x => x.toLowerCase()));
    for (const v of incomingArr) {
      const trimmed = String(v || '').trim();
      if (!trimmed) continue;
      if (seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      cur.push(trimmed);
    }
    return cur.join(', ');
  };

  // Uniqueness-preserving union for newline-separated list (keyIds).
  const unionLines = (existingText, incomingArr) => {
    const cur = existingText.split('\n').map(s => s.trim()).filter(Boolean);
    const seen = new Set(cur.map(x => x.toLowerCase()));
    for (const v of incomingArr) {
      const trimmed = String(v || '').trim();
      if (!trimmed) continue;
      if (seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      cur.push(trimmed);
    }
    return cur.join('\n');
  };

  const doResearch = async () => {
    if (researching || !commonName.trim()) return;
    setError('');

    // Fetch first — until we know what the model returned we can't
    // tell whether any overwrite would actually happen.
    setResearching(true);
    const r = await researchSpecies({
      commonName: commonName.trim(),
      scientificName: scientific.trim(),
    });
    setResearching(false);
    if (!r.ok) { setError(r.error || 'research failed'); return; }
    const d = r.data || {};

    // Compute which scalar fields the AI has content for AND which of
    // ours already have content. The list of collisions drives the
    // overwrite prompt.
    const collisions = [];
    if (d.scientific && scientific.trim())                 collisions.push('scientific');
    if (d.category   && category)                          collisions.push('category');
    if ((d.habitat || '').trim() && habitat.trim())        collisions.push('habitat');
    if (d.typicalLengthIn && typicalLengthIn.trim())       collisions.push('typical length');
    if (d.typicalWeightLb && typicalWeightLb.trim())       collisions.push('typical weight');
    if (d.worldRecordLb   && worldRecordLb.trim())         collisions.push('world record');
    if (d.geoRange        && geoRange.trim())              collisions.push('geographic range');
    if (d.edibility       && edibility)                    collisions.push('edibility');
    if (d.seasonality     && seasonality.trim())           collisions.push('seasonality');
    const overwriteAll = collisions.length > 0
      ? window.confirm(
          `Some fields already have values (${collisions.join(', ')}). ` +
          `Overwrite with AI suggestions? Cancel = keep your text values, ` +
          `just add new alt names and lookalikes.`
        )
      : true;

    // Apply. For scalars: overwrite iff (empty) OR (user said yes).
    // For list fields (altNames, keyIds, lookalikes): if overwrite=yes,
    // replace with AI values; if no, MERGE union of existing + AI so
    // "just add new stuff" works.
    if (d.scientific && (overwriteAll || !scientific.trim())) setScientific(d.scientific);
    if (d.category   && (overwriteAll || !category))          setCategory(d.category);
    if (d.habitat    && (overwriteAll || !habitat.trim()))     setHabitat(d.habitat);
    if (d.typicalLengthIn && (overwriteAll || !typicalLengthIn.trim())) setTypicalLengthIn(d.typicalLengthIn);
    if (d.typicalWeightLb && (overwriteAll || !typicalWeightLb.trim())) setTypicalWeightLb(d.typicalWeightLb);
    if (d.worldRecordLb   && (overwriteAll || !worldRecordLb.trim()))   setWorldRecordLb(d.worldRecordLb);
    if (d.geoRange        && (overwriteAll || !geoRange.trim()))        setGeoRange(d.geoRange);
    if (d.edibility       && (overwriteAll || !edibility))              setEdibility(d.edibility);
    if (d.seasonality     && (overwriteAll || !seasonality.trim()))     setSeasonality(d.seasonality);

    const aiAlt   = Array.isArray(d.altNames)   ? d.altNames   : [];
    const aiCues  = Array.isArray(d.keyIds)     ? d.keyIds     : [];
    const aiLooks = Array.isArray(d.lookalikes) ? d.lookalikes : [];
    setAltNames(overwriteAll   ? aiAlt.join(', ')   : unionCsv(altNames, aiAlt));
    setKeyIds(overwriteAll     ? aiCues.join('\n')  : unionLines(keyIds, aiCues));
    setLookalikes(overwriteAll ? aiLooks.join(', ') : unionCsv(lookalikes, aiLooks));

    setSourceNote(d.sourceNote || '');
  };

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
      typicalLengthIn: typicalLengthIn.trim(),
      typicalWeightLb: typicalWeightLb.trim(),
      worldRecordLb:   worldRecordLb.trim(),
      geoRange:        geoRange.trim(),
      edibility:       edibility || '',
      seasonality:     seasonality.trim(),
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
      {/* AI Research — fills category / habitat / keyIds / altNames /
          lookalikes for the current common name. Same pipeline the
          Quick Add modal uses. Overwrite-confirm gates any field
          already populated; cancel-to-merge for list fields. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={doResearch}
          disabled={researching || !commonName.trim()}
          style={{
            background: 'transparent',
            border: `1.5px solid ${researching || !commonName.trim() ? T.inkMute : '#5ecdf2'}`,
            color: researching || !commonName.trim() ? T.inkMute : '#5ecdf2',
            borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 800,
            cursor: researching || !commonName.trim() ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          {researching ? <>Researching {commonName || 'species'}…</> : <>✨ Research with AI</>}
        </button>
        <div style={{ fontSize: 11, color: T.inkMute, flex: 1, minWidth: 200 }}>
          Fills category, habitat, key IDs, alt names, and lookalikes from Claude.
          Every field stays editable — nothing auto-saves.
        </div>
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
        <Field label="Typical size (display)" value={typicalSize} onChange={setTypicalSize} placeholder='15–30 in' />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginTop: 4 }}>
          <Field label="Typical length (inches)" value={typicalLengthIn} onChange={setTypicalLengthIn} placeholder="24-40 or typical 28" />
          <Field label="Typical weight (lb)"    value={typicalWeightLb} onChange={setTypicalWeightLb} placeholder="5-15 or typical 8" />
          <Field label="World record (lb)"       value={worldRecordLb}   onChange={setWorldRecordLb}   placeholder="124.75" />
        </div>
        <Field label="Geographic range" value={geoRange} onChange={setGeoRange} placeholder="Gulf of Mexico, western Atlantic" />
        <div style={{ marginTop: 8 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Edibility</SectionLabel>
          <select value={edibility} onChange={e => setEdibility(e.target.value)} style={inputStyle}>
            <option value="">— unset —</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
        <Field label="Seasonality notes" value={seasonality} onChange={setSeasonality} placeholder="Spring spawning run inshore; offshore migration in fall" />
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

/* ============================================================
   Regulations tab — draft (AI or manual) → verify → publish
   ============================================================ */
function RegulationsTab() {
  const [jurId, setJurId] = useState(JURISDICTIONS[0].id);
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [editRow, setEditRow] = useState(null);   // full row edit modal
  const [verifyRow, setVerifyRow] = useState(null); // verify modal
  const [drafting, setDrafting] = useState(null); // speciesId being drafted
  // Sort control — 'species' (alphabetical, default) or 'age' (oldest
  // verified first so admin can knock out the most-stale first).
  const [sortMode, setSortMode] = useState('species');
  // Count of verified-and-older-than-a-year rows for the bulk button
  // label. Recomputed on refresh via adminCountStalable.
  const [stalableCount, setStalableCount] = useState(0);
  const [markingStale, setMarkingStale] = useState(false);

  const jur = JURISDICTIONS.find(j => j.id === jurId);
  const activeSpecies = useMemo(
    () => SPECIES.filter(s => s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName)),
    []
  );

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const r = await adminListRegulations({ jurisdictionId: jurId });
    setLoading(false);
    if (!r.ok) { setError(r.error || 'load failed'); return; }
    setError('');
    setRows(r.rows);
    // Fire the stalable count in parallel — cheap head query.
    adminCountStalable({ jurisdictionId: jurId }).then((cnt) => {
      if (cnt?.ok) setStalableCount(cnt.count);
    });
  }, [jurId]);
  useEffect(() => { refresh(); }, [refresh]);

  const rowsBySpecies = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.species_id, r);
    return m;
  }, [rows]);

  const doMarkAllStale = async () => {
    if (stalableCount === 0) return;
    const conf = window.prompt(
      `Mark all ${stalableCount} regulations for ${jur.name} that were verified more than 1 year ago as STALE?\n\n` +
      `They'll drop from mobile users' view until you re-draft + re-verify. Type MARK STALE to confirm.`,
      ''
    );
    if (conf !== 'MARK STALE') return;
    setMarkingStale(true);
    const r = await adminMarkAllStale({ jurisdictionId: jurId });
    setMarkingStale(false);
    if (!r.ok) { setError(r.error || 'mark-stale failed'); return; }
    refresh();
  };

  const doDraft = async (species) => {
    setDrafting(species.id);
    setError('');
    const r = await draftWithAI({ species, jurisdiction: jur });
    setDrafting(null);
    if (!r.ok) { setError(r.error || 'draft failed'); return; }
    const existing = rowsBySpecies.get(species.id);
    const payload = {
      species_id: species.id,
      jurisdiction_id: jurId,
      season_text: r.draft.seasonText,
      min_size_in: r.draft.minSizeIn,
      max_size_in: r.draft.maxSizeIn,
      bag_limit:   r.draft.bagLimit,
      boat_limit:  r.draft.boatLimit,
      notes:       r.draft.notes,
      source_note: r.draft.sourceNote,
      // Keep verified status if the row was already verified — draft
      // shouldn't clobber a verified record silently. Open the edit
      // modal so the admin can review the AI's numbers against the
      // existing verified ones.
      status:      existing?.status === 'verified' ? 'verified' : 'draft',
      drafted_by:  'ai',
      source_url:  existing?.source_url || '',
    };
    const up = await adminUpsertRegulation(payload);
    if (!up.ok) { setError(up.error || 'save failed'); return; }
    refresh();
    setEditRow(up.row);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 220 }}>
          <SectionLabel style={{ marginBottom: 4 }}>Jurisdiction</SectionLabel>
          <select value={jurId} onChange={e => setJurId(e.target.value)} style={inputStyle}>
            {JURISDICTIONS.map(j => (
              <option key={j.id} value={j.id}>{j.name} · {j.agency}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 160 }}>
          <SectionLabel style={{ marginBottom: 4 }}>Sort</SectionLabel>
          <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={inputStyle}>
            <option value="species">Species (A–Z)</option>
            <option value="age">Age (oldest verified first)</option>
          </select>
        </div>
        <GhostButton onClick={refresh} disabled={loading} style={{ padding: '10px 14px' }}>
          {loading ? 'Loading…' : 'Refresh'}
        </GhostButton>
      </div>

      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: '8px 10px', borderRadius: 8, background: T.parchmentDeep,
        border: `1px solid ${T.cardEdge}`,
      }}>
        <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: T.inkSoft, lineHeight: 1.4 }}>
          <strong style={{ color: T.ink }}>Refresh cycle helper</strong> — annual FWC / NOAA rewrite pass.
          Flips verified rows older than 1 year to <strong>stale</strong> so they show up as needing re-draft.
        </div>
        <GhostButton
          onClick={doMarkAllStale}
          disabled={stalableCount === 0 || markingStale}
          style={{ padding: '8px 12px', fontSize: 12, color: T.warn, borderColor: T.warn }}
        >
          {markingStale
            ? 'Marking…'
            : `Mark all verified > 1yr as stale (${stalableCount})`}
        </GhostButton>
      </div>

      <div style={{ fontSize: 11, color: T.inkMute, padding: '4px 4px', lineHeight: 1.5 }}>
        <strong style={{ color: T.ink }}>Draft with AI</strong> generates a compliance-drafted regulation. It
        stays as a DRAFT — never visible to mobile app users — until you tap Verify with a source URL.
        Bundled fallback in the app still renders when there's no verified row here.
      </div>

      {error && (
        <div role="alert" style={{ padding: 10, background: T.closedBg, color: T.closed, borderRadius: 8, fontSize: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {(() => {
          // Sort by species (default) or by age (oldest verified first;
          // no-regulation and drafts sink to the bottom of the age
          // ordering so they don't crowd out true stale-verified rows).
          const items = activeSpecies.slice();
          if (sortMode === 'age') {
            items.sort((a, b) => {
              const ra = rowsBySpecies.get(a.id) || null;
              const rb = rowsBySpecies.get(b.id) || null;
              const daysA = ra && ra.status === 'verified' && ra.verified_at
                ? -(new Date(ra.verified_at).getTime()) : Number.POSITIVE_INFINITY;
              const daysB = rb && rb.status === 'verified' && rb.verified_at
                ? -(new Date(rb.verified_at).getTime()) : Number.POSITIVE_INFINITY;
              if (daysA !== daysB) return daysB - daysA;
              return a.commonName.localeCompare(b.commonName);
            });
          }
          return items;
        })().map(sp => {
          const row = rowsBySpecies.get(sp.id) || null;
          const status = row?.status || 'none';
          const badge =
            status === 'verified' ? { bg: T.open,   fg: T.oceanDeep, label: 'Verified' }
          : status === 'draft'    ? { bg: T.brass,  fg: T.oceanDeep, label: 'Draft' }
          : status === 'stale'    ? { bg: T.warn,   fg: T.oceanDeep, label: 'Stale' }
          : status === 'disputed' ? { bg: T.closed, fg: '#fff',      label: 'Disputed' }
          :                         { bg: T.parchmentDeep, fg: T.inkMute, label: 'None' };
          const isDrafting = drafting === sp.id;
          const short = (row) => {
            if (!row) return '';
            const parts = [];
            if (row.season_text)  parts.push(row.season_text);
            if (row.min_size_in != null) parts.push(`min ${row.min_size_in}"`);
            if (row.max_size_in != null) parts.push(`max ${row.max_size_in}"`);
            if (row.bag_limit   != null) parts.push(`bag ${row.bag_limit}`);
            if (row.boat_limit  != null) parts.push(`boat ${row.boat_limit}`);
            return parts.join(' · ');
          };
          // Age line + colour: default/subtle-brass/warn based on tier.
          const age = row ? regulationAge(row) : null;
          const ageColor = !age                 ? T.inkMute
                         : age.tier === 'fresh' ? T.inkMute
                         : age.tier === 'aging' ? T.brass
                         :                        T.warn;
          const ageLine = row ? regulationAgePhrase(row) : null;
          return (
            <Card key={sp.id} style={{ padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{sp.commonName}</div>
                  <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                    {short(row) || <em style={{ color: T.inkMute }}>no regulation on file</em>}
                  </div>
                  {ageLine && (
                    <div style={{ fontSize: 10, color: ageColor, marginTop: 3, fontWeight: 600 }}>
                      {ageLine}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800,
                  padding: '3px 8px', borderRadius: 999,
                  background: badge.bg, color: badge.fg,
                }}>{badge.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <GhostButton
                  onClick={() => doDraft(sp)}
                  disabled={isDrafting}
                  style={{ padding: '6px 10px', fontSize: 11 }}
                >
                  {isDrafting ? 'Drafting…' : (row ? 'Re-draft with AI' : 'Draft with AI')}
                </GhostButton>
                {row && (
                  <GhostButton onClick={() => setEditRow(row)} style={{ padding: '6px 10px', fontSize: 11 }}>
                    Edit
                  </GhostButton>
                )}
                {row && row.status !== 'verified' && (
                  <GhostButton
                    onClick={() => setVerifyRow(row)}
                    style={{ padding: '6px 10px', fontSize: 11, color: T.open, borderColor: T.open }}
                  >
                    Verify
                  </GhostButton>
                )}
                {row && row.status === 'verified' && (
                  <GhostButton
                    onClick={async () => {
                      const reason = window.prompt('Un-verify reason (visible in source_note):', '');
                      if (reason == null) return;
                      const r = await adminUnverifyRegulation(row.id, reason);
                      if (!r.ok) setError(r.error || 'un-verify failed');
                      else refresh();
                    }}
                    style={{ padding: '6px 10px', fontSize: 11, color: T.warn, borderColor: T.warn }}
                  >
                    Un-verify
                  </GhostButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {editRow && (
        <RegulationEditModal
          row={editRow}
          jurisdiction={jur}
          species={SPECIES.find(s => s.id === editRow.species_id)}
          onCancel={() => setEditRow(null)}
          onSaved={async (patch) => {
            const r = await adminUpsertRegulation({ ...editRow, ...patch });
            if (!r.ok) { setError(r.error || 'save failed'); return; }
            setEditRow(null);
            refresh();
          }}
        />
      )}

      {verifyRow && (
        <RegulationVerifyModal
          row={verifyRow}
          jurisdiction={jur}
          species={SPECIES.find(s => s.id === verifyRow.species_id)}
          onCancel={() => setVerifyRow(null)}
          onVerified={async (sourceUrl) => {
            const email = (typeof window !== 'undefined' && window.__kycAdminEmail) || null;
            const r = await adminVerifyRegulation(verifyRow.id, {
              sourceUrl, sessionEmail: email,
            });
            if (!r.ok) { setError(r.error || 'verify failed'); return; }
            setVerifyRow(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function RegulationEditModal({ row, jurisdiction, species, onCancel, onSaved }) {
  const [seasonText, setSeasonText] = useState(row.season_text || '');
  const [minSize,    setMinSize]    = useState(row.min_size_in != null ? String(row.min_size_in) : '');
  const [maxSize,    setMaxSize]    = useState(row.max_size_in != null ? String(row.max_size_in) : '');
  const [bag,        setBag]        = useState(row.bag_limit   != null ? String(row.bag_limit)   : '');
  const [boat,       setBoat]       = useState(row.boat_limit  != null ? String(row.boat_limit)  : '');
  const [notes,      setNotes]      = useState(row.notes || '');
  const [sourceNote, setSourceNote] = useState(row.source_note || '');
  const [sourceUrl,  setSourceUrl]  = useState(row.source_url  || '');

  const num = (s) => (s.trim() === '' ? null : Number(s));

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3,27,51,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 12,
        maxWidth: 520, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px 8px', flexShrink: 0 }}>
          <H1 size={17}>{species?.commonName || row.species_id} — {jurisdiction?.name}</H1>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4 }}>
            Status: <strong>{row.status}</strong> · drafted by {row.drafted_by}
          </div>
        </div>
        <div style={{ padding: '0 18px 12px', overflowY: 'auto', flex: 1, display: 'grid', gap: 10 }}>
          <Field label="Season (freeform)" value={seasonText} onChange={setSeasonText} placeholder="Year-round · Jun 1 - Aug 31 · etc." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            <Field label="Min size (in)" value={minSize} onChange={setMinSize} placeholder="16" />
            <Field label="Max size (in)" value={maxSize} onChange={setMaxSize} placeholder="27" />
            <Field label="Bag limit (per angler / day)" value={bag} onChange={setBag} placeholder="2" />
            <Field label="Boat limit"       value={boat} onChange={setBoat} placeholder="8" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>Notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>Source note (AI note or your citation)</div>
            <textarea value={sourceNote} onChange={e => setSourceNote(e.target.value)} rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <Field label="Source URL (required for Verify)" value={sourceUrl} onChange={setSourceUrl}
            placeholder={jurisdiction?.regsUrl || 'https://…'} />
        </div>
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${T.cardEdge}`,
          background: T.card, display: 'flex', gap: 8, justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onSaved({
            season_text: seasonText.trim() || null,
            min_size_in: num(minSize),
            max_size_in: num(maxSize),
            bag_limit:   num(bag),
            boat_limit:  num(boat),
            notes:       notes.trim() || null,
            source_note: sourceNote.trim() || null,
            source_url:  sourceUrl.trim() || null,
          })} style={{ padding: '8px 16px' }}>
            Save draft
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function RegulationVerifyModal({ row, jurisdiction, species, onCancel, onVerified }) {
  const [sourceUrl, setSourceUrl] = useState(row.source_url || jurisdiction?.regsUrl || '');
  const [confirmed, setConfirmed] = useState(false);
  const canVerify = !!sourceUrl.trim() && confirmed;
  const today = new Date().toLocaleDateString();
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3,27,51,0.75)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 12,
        padding: 18, maxWidth: 500, width: '100%',
      }}>
        <H1 size={17} style={{ marginBottom: 4 }}>Verify regulation</H1>
        <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
          <strong style={{ color: T.ink }}>{species?.commonName || row.species_id}</strong> in <strong style={{ color: T.ink }}>{jurisdiction?.name}</strong>.
          Verifying makes this regulation visible to mobile app users. Requires a citable source.
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field
            label="Source URL (required)"
            value={sourceUrl} onChange={setSourceUrl}
            placeholder={jurisdiction?.regsUrl || 'https://…'}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: T.ink, cursor: 'pointer', lineHeight: 1.5 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: T.brass, marginTop: 2 }} />
            <span>I verified these regulations against the source above on {today}.</span>
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <GhostButton onClick={onCancel}>Cancel</GhostButton>
            <PrimaryButton
              onClick={() => onVerified(sourceUrl.trim())}
              disabled={!canVerify}
              style={{ padding: '8px 16px', opacity: canVerify ? 1 : 0.5 }}
            >
              Verify &amp; publish
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
