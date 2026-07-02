import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Fish, ChevronLeft, BookOpen, Bell, ClipboardList, Camera, MoreHorizontal,
  Home as HomeIcon, Settings as SettingsIcon,
} from 'lucide-react';
import { T, screenSize, containerMaxWidth } from './theme.js';
import { DISCLAIMER_VERSION } from './data.js';
import { loadState, saveState, defaultState } from './storage.js';
import { migratePhotosToStore } from './photos-store.js';
import { refreshFeeds } from './regsync.js';
import { refreshSpecies, subscribe as subscribeSpecies } from './species-store.js';
import { brandAsset, refreshBrandAssets, subscribe as subscribeBrand } from './brand-store.js';
import { jurisdictionById, isStale } from './helpers.js';
import {
  DisclaimerModal, JurisdictionPickerModal, InfoModal, KeepConfirmModal,
  FavoritePickerModal, AccountSetupModal,
} from './components.jsx';
import {
  SplashScreen, HomeScreen, IdentifyScreen, CategoriesScreen, CategoryScreen, SearchScreen,
  PhotoAnalyzingScreen, PhotoResultScreen, LogMenuScreen, QuickLogScreen,
} from './screens1.jsx';
import {
  SpeciesDetailScreen, RegulationsListScreen, RegulationDetailScreen,
  RegulationAlertsScreen,
  SpeciesListScreen, PBsScreen, PBDetailScreen, PBEntryScreen, SettingsScreen,
  CatchLogScreen, CatchEntryScreen, CatchDetailScreen, QuizScreen,
} from './screens2.jsx';

// Web-only admin console. When __KYC_ADMIN__ is false (ios:build) the
// ternary constant-folds to null and Rollup drops both the dynamic
// import and the admin/ subtree from the bundle.
const AdminApp = __KYC_ADMIN__
  ? lazy(() => import('./admin/AdminApp.jsx'))
  : null;

const ADMIN_EMAIL = 'robertb1023@me.com';

const ALERT_COUNT = 2;

const currentHashRoute = () =>
  (typeof window !== 'undefined' && window.location.hash.replace(/^#\/?/, '')) || '';

export default function App() {
  const [state, setState] = useState(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [stack, setStack] = useState([{ name: 'home' }]);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showJur, setShowJur] = useState(false);
  const [showBoundaryInfo, setShowBoundaryInfo] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [keepFor, setKeepFor] = useState(null);
  const [hashRoute, setHashRoute] = useState(currentHashRoute);
  // Bump on every species-store notify so components that read SPECIES
  // re-render when the overlay refreshes from Supabase.
  const [, setSpeciesVersion] = useState(0);
  // Responsive: 'phone' | 'tablet' | 'tablet-landscape'. Reflows the
  // outer container so iPad users don't get a 440px column marooned
  // in the middle of the screen. See theme.js for the breakpoints.
  const [size, setSize] = useState(screenSize);
  // Transient banner for the Quick Log flow's post-save confirmation
  // and for stale-quick-log reminders. Auto-clears after 2.4s.
  const [toast, setToast] = useState(null); // { text, kind: 'success' | 'nag' } | null

  // Load persisted state on mount.
  useEffect(() => {
    const s = loadState();
    setState(s);
    setLoaded(true);
    // Onboarding chain: disclaimer → jurisdiction → account → favorites.
    if (s.disclaimerAcceptedVersion !== DISCLAIMER_VERSION) setShowDisclaimer(true);
    else if (!s.jurisdiction) setShowJur(true);
    else if (!s.onboardingAccountComplete) setShowAccount(true);
    else if (!s.onboardingFavoritesComplete) setShowFavorites(true);

    // Background: migrate any legacy data-URL photos to the new
    // photos-store shape. On native (iOS) this writes each photo's
    // JPEG bytes to the app's Documents directory and replaces the
    // inline data URL with a { thumb, src, path } entry — gets the
    // bulk weight out of localStorage. Idempotent; entries already
    // in the new shape are skipped. Only swaps in the migrated state
    // when the angler hasn't already touched state mid-migration.
    const initialJson = JSON.stringify(s);
    migratePhotosToStore(s).then((migrated) => {
      if (migrated === s) return;
      setState(prev => {
        if (JSON.stringify(prev) !== initialJson) return prev;
        saveState(migrated);
        return migrated;
      });
    }).catch(() => {});
    // Refresh the regulations feed in the background (no-op until a feed
    // URL is configured; failures are silent — offline-first).
    refreshFeeds().catch(() => {});
    // Refresh species + brand overlays from Supabase (no-ops until env
    // vars are set). Subscribers re-render when overrides land.
    refreshSpecies().catch(() => {});
    refreshBrandAssets().catch(() => {});
  }, []);

  // Overlay subscriptions: bump a version counter on every notify so
  // screens re-read the (mutated in place) SPECIES const + brandAsset()
  // lookups reflect the latest cache.
  useEffect(() => subscribeSpecies(() => setSpeciesVersion(v => v + 1)), []);
  useEffect(() => subscribeBrand(() => setSpeciesVersion(v => v + 1)), []);

  // Hash routing — only used for /#/admin today. Any change to the
  // hash re-syncs the local route state so the admin console mounts
  // or unmounts accordingly.
  useEffect(() => {
    const onHash = () => setHashRoute(currentHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Auto-clear the transient toast after ~2.4s so the confirmation
  // banner from Quick Log doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // On resume (tab / app visible again after being hidden), if the
  // logbook has any quick-log catches older than 24h, surface a soft
  // reminder so those don't drift indefinitely with no species set.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const pending = (state.catchLog || []).filter(c =>
        c.status === 'quick'
        && c.dateIso && new Date(c.dateIso).getTime() < cutoff
      );
      if (pending.length > 0) {
        setToast({
          text: `${pending.length} ${pending.length === 1 ? 'catch needs' : 'catches need'} details`,
          kind: 'nag',
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [state.catchLog]);

  // Watch window resize so iPad rotation between portrait / landscape
  // moves the container between the 720 / 900 width tiers live.
  useEffect(() => {
    const onResize = () => setSize(screenSize());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Auto-dismiss the splash after a short hold.
  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, []);

  const [saveError, setSaveError] = useState(null); // 'quota' | 'other' | null

  // update() merges patch into state and persists. If localStorage
  // refuses the write (quota or otherwise) we surface a banner so the
  // angler knows their latest catch / PB / photo didn't actually
  // persist — silent swallow was the old behaviour and it cost data.
  const update = useCallback((patch) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      const res = saveState(next);
      if (!res.ok) setSaveError(res.code);
      else if (saveError) setSaveError(null);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError]);

  const screen = stack[stack.length - 1];
  const push  = (s)    => setStack(st => [...st, s]);
  const pop   = ()     => setStack(st => st.length > 1 ? st.slice(0, -1) : st);
  const reset = (s)    => setStack(Array.isArray(s) ? s : [s]);

  if (showSplash || !loaded) {
    return <SplashScreen onContinue={() => loaded && setShowSplash(false)} />;
  }

  // /#/admin — web build only. Rendered above the tab-bar chrome
  // because the admin console owns its own layout.
  if (__KYC_ADMIN__ && AdminApp && hashRoute === 'admin'
      && (state.anglerEmail || '').trim().toLowerCase() === ADMIN_EMAIL) {
    return (
      <Suspense fallback={<SplashScreen />}>
        <AdminApp
          localAnglerEmail={state.anglerEmail}
          onExit={() => { window.location.hash = ''; }}
        />
      </Suspense>
    );
  }

  const jurisdiction = jurisdictionById(state.jurisdiction);
  const stale = isStale(state.syncMeta);

  const homeProps = {
    state, jurisdiction, stale, screenSize: size,
    onChangeJurisdiction: () => setShowJur(true),
    onIdentify:   () => push({ name: 'identify' }),
    onUploadPhoto:(dataUrl) => push({ name: 'photo_analyzing', imageDataUrl: dataUrl }),
    onBrowse:     () => push({ name: 'categories' }),
    onCompare:    () => push({ name: 'species_list' }),
    onRegulations:() => push({ name: 'regulations' }),
    onRegulationAlerts: () => push({ name: 'regulation_alerts' }),
    onQuiz:        () => push({ name: 'quiz' }),
    onReport:     () => push({ name: 'catch_entry' }),
    onLogMenu:    () => push({ name: 'log_menu' }),
    onSpecies:    (id) => push({ name: 'species', id }),
    onSpeciesList:() => push({ name: 'species_list' }),
    onPBs:        () => push({ name: 'pbs' }),
  };

  // Build the body based on current screen.
  let body;
  switch (screen.name) {
    case 'home':
      body = <HomeScreen {...homeProps} />;
      break;
    case 'identify':
      body = <IdentifyScreen
        onPhoto={(dataUrl) => push({ name: 'photo_analyzing', imageDataUrl: dataUrl })}
        onBrowse={() => push({ name: 'categories' })}
        onSearch={() => push({ name: 'search' })}
      />;
      break;
    case 'log_menu':
      body = <LogMenuScreen
        onQuickLog={() => push({ name: 'quick_log' })}
        onIdentify={() => push({ name: 'identify' })}
        onUploadPhoto={() => push({ name: 'catch_entry', openUploadOnMount: true })}
      />;
      break;
    case 'quick_log':
      body = <QuickLogScreen
        state={state} jurisdiction={jurisdiction} update={update}
        onDone={() => {
          setToast({ text: 'Logged — back to fishing', kind: 'success' });
          reset([{ name: 'home' }]);
        }}
        onCancel={() => reset([{ name: 'home' }])}
      />;
      break;
    case 'photo_analyzing':
      body = <PhotoAnalyzingScreen
        imageDataUrl={screen.imageDataUrl}
        onResult={(result) => setStack(st => [...st.slice(0, -1), { name: 'photo_result', imageDataUrl: screen.imageDataUrl, result }])}
      />;
      break;
    case 'photo_result':
      body = <PhotoResultScreen
        result={screen.result}
        imageDataUrl={screen.imageDataUrl}
        onPickSpecies={(id) => push({ name: 'species', id })}
        onLogCatch={(id) => push({ name: 'catch_entry', preselectSpeciesId: id, prefilledPhoto: screen.imageDataUrl })}
        onRetake={() => setStack(st => st.filter(s => s.name !== 'photo_analyzing' && s.name !== 'photo_result'))}
        onManual={() => reset([{ name: 'home' }, { name: 'identify' }, { name: 'categories' }])}
      />;
      break;
    case 'categories':
      body = <CategoriesScreen onPick={(catId) => push({ name: 'category', catId })} />;
      break;
    case 'category':
      body = <CategoryScreen catId={screen.catId} state={state} update={update} onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'search':
      body = <SearchScreen state={state} onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'species':
      body = <SpeciesDetailScreen
        id={screen.id} state={state} jurisdiction={jurisdiction} stale={stale}
        onLookalike={(otherId) => push({ name: 'species', id: otherId })}
        onAddPB={() => push({ name: 'catch_entry', preselectSpeciesId: screen.id })}
        onFullRegs={() => push({ name: 'regulation', id: screen.id })}
        onKeep={setKeepFor}
        update={update}
      />;
      break;
    case 'regulations':
      body = <RegulationsListScreen state={state} jurisdiction={jurisdiction} update={update} onPick={(id) => push({ name: 'regulation', id })} />;
      break;
    case 'regulation_alerts':
      body = <RegulationAlertsScreen state={state} jurisdiction={jurisdiction} onPick={(id) => push({ name: 'regulation', id })} />;
      break;
    case 'quiz':
      body = <QuizScreen state={state} jurisdiction={jurisdiction}
        onPickSpecies={(id) => push({ name: 'species', id })}
        onBack={pop} />;
      break;
    case 'catch_log':
      body = <CatchLogScreen
        state={state}
        onNew={() => push({ name: 'catch_entry' })}
        onView={(id) => push({ name: 'catch_detail', id })}
        onViewPB={(speciesId) => push({ name: 'pb_detail', speciesId })}
      />;
      break;
    case 'catch_entry':
      body = <CatchEntryScreen
        state={state} jurisdiction={jurisdiction} update={update}
        editingId={screen.editingId}
        preselectSpeciesId={screen.preselectSpeciesId}
        prefilledPhoto={screen.prefilledPhoto}
        openUploadOnMount={screen.openUploadOnMount}
        onDone={() => reset([{ name: 'catch_log' }])}
        onCancel={pop}
      />;
      break;
    case 'catch_detail':
      body = <CatchDetailScreen id={screen.id} state={state} update={update} onEdit={() => push({ name: 'catch_entry', editingId: screen.id })} onBack={pop} />;
      break;
    case 'regulation':
      body = <RegulationDetailScreen id={screen.id} state={state} jurisdiction={jurisdiction} stale={stale} onSpecies={() => push({ name: 'species', id: screen.id })} onAddPB={() => push({ name: 'pb_entry', speciesId: screen.id })} />;
      break;
    case 'species_list':
      body = <SpeciesListScreen state={state} jurisdiction={jurisdiction} update={update} onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'pbs':
      body = <PBsScreen state={state}
        onView={(id) => push({ name: 'pb_detail', speciesId: id })}
        onLogCatch={() => push({ name: 'catch_entry' })}
        onViewCatches={() => push({ name: 'catch_log' })} />;
      break;
    case 'pb_detail':
      body = <PBDetailScreen speciesId={screen.speciesId} state={state} update={update}
                onEdit={() => {
                  // PBs are now derived from logged catches. If we know
                  // which catch this PB came from, edit that catch.
                  // Otherwise fall back to the legacy PB Entry editor.
                  const pb = state.pbs?.[screen.speciesId];
                  if (pb?.catchId && (state.catchLog || []).some(c => c.id === pb.catchId)) {
                    push({ name: 'catch_entry', editingId: pb.catchId });
                  } else {
                    push({ name: 'pb_entry', speciesId: screen.speciesId, edit: true });
                  }
                }}
                onBack={pop} />;
      break;
    case 'pb_entry':
      body = <PBEntryScreen speciesId={screen.speciesId} edit={screen.edit} state={state} jurisdiction={jurisdiction} update={update} onDone={pop} />;
      break;
    case 'settings':
      body = <SettingsScreen state={state} jurisdiction={jurisdiction} update={update}
                onChangeJurisdiction={() => setShowJur(true)}
                onShowDisclaimer={() => setShowDisclaimer(true)}
                onEditFavorites={() => setShowFavorites(true)}
                onEditAccount={() => setShowAccount(true)} />;
      break;
    default:
      body = <HomeScreen {...homeProps} />;
  }

  const isHome = screen.name === 'home';
  const activeTab =
    isHome ? 'home' :
    ['regulations', 'regulation'].includes(screen.name) ? 'regulations' :
    ['catch_log', 'catch_entry', 'catch_detail', 'pbs', 'pb_detail', 'pb_entry'].includes(screen.name) ? 'logbook' :
    screen.name === 'settings' ? '' :
    'species';

  const moreActive = screen.name === 'settings';
  const speciesActive = ['species_list', 'species', 'categories', 'category', 'search'].includes(screen.name);
  const identifyActive = ['identify', 'photo_analyzing', 'photo_result'].includes(screen.name);

  return (
    <div data-screen-size={size} style={{
      background: T.bgGradient, minHeight: '100vh', color: T.ink,
      maxWidth: containerMaxWidth(size), margin: '0 auto', position: 'relative',
      boxShadow: '0 0 60px rgba(0,0,0,0.5)',
      fontSize: size === 'phone' ? undefined : 15,
    }}>
      {/* Top app bar */}
      <div style={{
        background: T.oceanDeep, color: T.parchment, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        borderBottom: `1px solid ${T.cardEdge}`, position: 'sticky', top: 0, zIndex: 50,
      }}>
        {isHome ? (
          <button
            onClick={() => reset([{ name: 'home' }])}
            aria-label="ReelIntel — home"
            style={{
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', flex: 1, minWidth: 0,
              height: 72,
            }}
          >
            <img
              src={brandAsset('logo_horizontal', `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`)}
              alt="ReelIntel — identify, check rules, log catch, find better spots"
              style={{
                height: 56, width: 'auto', maxWidth: '100%',
                display: 'block', objectFit: 'contain',
                marginLeft: 12,
              }}
            />
          </button>
        ) : (
          <button onClick={pop} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600 }}>
            <ChevronLeft size={20} /> Back
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingRight: 12, flexShrink: 0 }}>
          {isHome && (
            <button onClick={() => push({ name: 'regulations' })} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer', position: 'relative' }} aria-label="Alerts">
              <Bell size={24} strokeWidth={1.8} />
              {ALERT_COUNT > 0 && (
                <span style={{
                  position: 'absolute', top: -3, right: -4, background: T.brass, color: T.oceanDeep,
                  fontSize: 11, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                  boxShadow: '0 0 10px rgba(25, 212, 242, 0.55)',
                }}>{ALERT_COUNT}</span>
              )}
            </button>
          )}
          <button onClick={() => push({ name: 'settings' })} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer' }} aria-label="Settings">
            <SettingsIcon size={24} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {saveError && (
        <div role="alert" style={{
          position: 'sticky', top: 0, zIndex: 60,
          background: '#3A0F12', borderBottom: `1px solid ${T.closed}`,
          color: T.parchment, padding: '10px 14px',
          fontSize: 12, lineHeight: 1.45,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <strong style={{ color: T.closed }}>
              {saveError === 'quota' ? "Storage is full." : "Couldn't save."}
            </strong>{' '}
            {saveError === 'quota'
              ? 'Your browser is out of space for the app. Delete some catches or photos to free room, then try again.'
              : 'Your last change may not have persisted. See Settings → Export backup to download what you have.'}
          </div>
          <button onClick={() => setSaveError(null)} aria-label="Dismiss" style={{
            background: 'transparent', border: 'none', color: T.parchment, cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>
      )}

      <div style={{ paddingBottom: 96, minHeight: 'calc(100vh - 132px)' }}>
        {body}
      </div>

      {/* Toast — quick-log confirmation + stale-quick nag. Fixed at the
          top center over the current viewport, auto-dismisses. */}
      {toast && (
        <div role="status" style={{
          position: 'fixed', top: 90, left: '50%', transform: 'translateX(-50%)',
          background: toast.kind === 'nag' ? T.warnBg : T.openBg,
          border: `1px solid ${toast.kind === 'nag' ? T.warn : T.open}`,
          color: toast.kind === 'nag' ? T.warn : T.open,
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          zIndex: 200, maxWidth: 'calc(100% - 32px)',
        }}>
          {toast.text}
        </div>
      )}

      {/* Floating action button — Quick Log, home only. Opens camera
          immediately; on capture we save with GPS+sun+moon+weather in
          the background and drop a "Logged" toast on the home screen. */}
      {isHome && (
        <button
          onClick={() => push({ name: 'quick_log' })}
          aria-label="Quick log"
          style={{
            position: 'fixed', bottom: 92, right: `max(16px, calc(50vw - ${containerMaxWidth(size) / 2}px + 16px))`,
            width: 64, height: 64, borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #2EE4FF 0%, #19D4F2 60%, #0F8FAA 100%)',
            border: '3px solid rgba(25, 212, 242, 0.45)',
            color: T.oceanDeep, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 0 6px rgba(25, 212, 242, 0.15), 0 8px 28px rgba(25, 212, 242, 0.55)',
            zIndex: 49,
          }}>
          <Camera size={28} strokeWidth={2.2} />
        </button>
      )}

      {/* Bottom tab bar */}
      <div style={{
        position: 'sticky', bottom: 0, background: T.oceanDeep,
        borderTop: `1px solid ${T.cardEdge}`, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        padding: '10px 4px 14px', zIndex: 50,
      }}>
        <TabBtn label="Home"        active={activeTab === 'home'}                          onClick={() => reset([{ name: 'home' }])}         icon={<HomeIcon size={22} strokeWidth={2} />} />
        <TabBtn label="Identify"    active={identifyActive}                                onClick={() => reset([{ name: 'identify' }])}     icon={<Fish size={22} strokeWidth={2} />} />
        <TabBtn label="Regulations" active={activeTab === 'regulations'}                    onClick={() => reset([{ name: 'regulations' }])}  icon={<ClipboardList size={22} strokeWidth={2} />} />
        <TabBtn label="Logbook"     active={activeTab === 'logbook'}                        onClick={() => reset([{ name: 'catch_log' }])}    icon={<BookOpen size={22} strokeWidth={2} />} />
        <TabBtn label="More"        active={moreActive}                                    onClick={() => push({ name: 'settings' })}        icon={<MoreHorizontal size={22} strokeWidth={2} />} />
      </div>

      {showDisclaimer && (
        <DisclaimerModal onAccept={() => {
          update({ disclaimerAcceptedVersion: DISCLAIMER_VERSION });
          setShowDisclaimer(false);
          if (!state.jurisdiction) setShowJur(true);
          else if (!state.onboardingAccountComplete) setShowAccount(true);
          else if (!state.onboardingFavoritesComplete) setShowFavorites(true);
        }} />
      )}

      {showJur && (
        <JurisdictionPickerModal
          current={state.jurisdiction}
          onPick={(id) => {
            update({ jurisdiction: id });
            setShowJur(false);
            if (!state.onboardingAccountComplete) setShowAccount(true);
            else if (!state.onboardingFavoritesComplete) setShowFavorites(true);
          }}
          onClose={() => state.jurisdiction && setShowJur(false)}
          canCancel={!!state.jurisdiction}
          onShowBoundary={() => setShowBoundaryInfo(true)}
        />
      )}

      {showAccount && (
        <AccountSetupModal
          initialName={state.anglerName}
          initialEmail={state.anglerEmail}
          allowDismiss={state.onboardingAccountComplete}
          onDismiss={() => setShowAccount(false)}
          onSave={({ name, email }) => {
            update({ anglerName: name, anglerEmail: email, onboardingAccountComplete: true });
            setShowAccount(false);
            if (!state.onboardingFavoritesComplete) setShowFavorites(true);
          }}
        />
      )}

      {showFavorites && (
        <FavoritePickerModal
          favorites={state.favorites}
          onDone={(picked) => {
            update({ favorites: picked, onboardingFavoritesComplete: true });
            setShowFavorites(false);
          }}
          onSkip={() => {
            update({ onboardingFavoritesComplete: true });
            setShowFavorites(false);
          }}
        />
      )}

      {showBoundaryInfo && (
        <InfoModal title="State vs. Federal Waters" onClose={() => setShowBoundaryInfo(false)}>
          <p style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
            State waters extend a fixed distance from shore. Beyond that line, you're in federal Gulf waters — and the rules can be different for the same species.
          </p>
          <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
            <li><strong>Florida & Texas:</strong> 9 nautical miles.</li>
            <li><strong>Alabama, Mississippi, Louisiana:</strong> 3 nautical miles.</li>
          </ul>
          <p style={{ marginTop: 12, lineHeight: 1.55, color: T.inkMute, fontSize: 13 }}>
            If your trip crosses the line, rules in effect depend on where the fish was caught — not where you're heading.
          </p>
        </InfoModal>
      )}

      {keepFor && <KeepConfirmModal species={keepFor} onClose={() => setKeepFor(null)} />}
    </div>
  );
}

function TabBtn({ label, active, onClick, icon }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', color: active ? T.brass : T.inkMute,
      padding: '4px 0', cursor: 'pointer', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap: 5, fontSize: 11, fontWeight: active ? 700 : 600,
      letterSpacing: 0.2,
    }}>
      <span style={{
        color: active ? T.brass : T.inkMute,
        filter: active ? 'drop-shadow(0 0 6px rgba(25, 212, 242, 0.55))' : 'none',
      }}>{icon}</span>
      {label}
    </button>
  );
}
