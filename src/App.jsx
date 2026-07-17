import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import {
  Fish, ChevronLeft, BookOpen, Bell, ClipboardList, Camera,
  Home as HomeIcon, Settings as SettingsIcon,
} from 'lucide-react';
import { T, screenSize, containerMaxWidth, chromeHeights, typeScale, cols } from './theme.js';
import { ScreenSizeContext } from './screen-size.js';
import { DISCLAIMER_VERSION } from './data.js';
import { loadState, saveState, defaultState } from './storage.js';
import { migratePhotosToStore } from './photos-store.js';
import { refreshFeeds } from './regsync.js';
import { refreshSpecies, subscribe as subscribeSpecies } from './species-store.js';
import { initModel } from './model-loader.js';
import { brandAsset, refreshBrandAssets, subscribe as subscribeBrand } from './brand-store.js';
import { refreshCategories, subscribe as subscribeCategories } from './categories-store.js';
import { fetchRegulations, subscribe as subscribeRegulations } from './regulations-store.js';
import { subscribe as subscribeAuth, signInWithPassword, signUp, resetPassword } from './auth.js';
import {
  pullAll as cloudPullAll,
  syncChanges as cloudSyncChanges,
  subscribe as subscribeSyncStatus,
  getStatus as getSyncStatus,
  getLastSyncedAt as getCloudLastSynced,
  forceSync as cloudForceSync,
  mergeUserState as cloudMergeUserState,
} from './cloudsync.js';
import { SyncPill } from './auth-ui.jsx';
import { jurisdictionById, isStale, dataUrlToFile } from './helpers.js';
import { saveModelFeedback } from './training-store.js';
import { reconcileSuggestions } from './species-suggestions-store.js';
import {
  DisclaimerModal, JurisdictionPickerModal, InfoModal, KeepConfirmModal,
  FavoritePickerModal, AccountSetupModal, IdentificationConfirmCard,
  SignInModal,
  WelcomeIntroModal, FishingProfileSetupModal,
  CropStep,
} from './components.jsx';
import { PROFILE_FIELDS, profileFieldsComplete } from './screens2.jsx';
import {
  SplashScreen, HomeScreen, IdentifyScreen, CategoriesScreen, CategoryScreen, SearchScreen,
  PhotoAnalyzingScreen, PhotoResultScreen, WeatherForecastScreen,
} from './screens1.jsx';
import { getPhoto } from './native.js';
import {
  SpeciesDetailScreen, RegulationsListScreen, RegulationDetailScreen,
  RegulationAlertsScreen,
  SpeciesListScreen, PBsScreen, PBDetailScreen, PBEntryScreen, SettingsScreen,
  CatchLogScreen, CatchEntryScreen, CatchDetailScreen, QuizScreen,
} from './screens2.jsx';
import { PatternsScreen } from './screens_patterns.jsx';
import NotificationsDrawer, { useAnnouncementInbox } from './notifications-inbox.jsx';

// Web-only admin console. When __KYC_ADMIN__ is false (ios:build) the
// ternary constant-folds to null and Rollup drops both the dynamic
// import and the admin/ subtree from the bundle.
const AdminApp = __KYC_ADMIN__
  ? lazy(() => import('./admin/AdminApp.jsx'))
  : null;

const ADMIN_EMAIL = 'robertb1023@me.com';

const currentHashRoute = () =>
  (typeof window !== 'undefined' && window.location.hash.replace(/^#\/?/, '')) || '';

export default function App() {
  const [state, setState] = useState(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [stack, setStack] = useState([{ name: 'home' }]);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerReadOnly, setDisclaimerReadOnly] = useState(false);
  const [showJur, setShowJur] = useState(false);
  const [showBoundaryInfo, setShowBoundaryInfo] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  // Home "Finish setup" nudge is dismissible per-session — a user
  // who tapped X on it doesn't get pestered until next launch.
  const [finishSetupDismissed, setFinishSetupDismissed] = useState(false);
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
  // Cloud auth session + sync status. Session drives the sign-in
  // prompt on Logbook / PBs; syncStatus feeds the header pill.
  const [session, setSession] = useState(null);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  // Bell badge count — active + not-dismissed notifications
  // (announcements + launch emails). The drawer reads the same
  // hook internally so both stay in sync.
  const { unreadCount: inboxUnread } = useAnnouncementInbox();

  // Load persisted state on mount.
  useEffect(() => {
    const s = loadState();
    setState(s);
    setLoaded(true);
    // Onboarding chain: disclaimer → jurisdiction → account → favorites.
    // Disclaimer is accept-once for the app's lifetime — no forced
    // re-accept on version bumps. Apple's guidance only requires the
    // disclaimer be available to view, not re-accepted. The link in
    // Settings covers ongoing access. Once ANY accepted-version value
    // is on file we skip.
    // Onboarding chain: intro → disclaimer → jurisdiction → account
    // → favorites → profile. Each step is gated on the flag set by
    // the previous step so an existing user who already accepted
    // the disclaimer never sees intro or disclaimer again.
    if (!s.onboardingIntroSeen && !s.disclaimerAcceptedVersion) setShowIntro(true);
    else if (!s.disclaimerAcceptedVersion) setShowDisclaimer(true);
    else if (!s.jurisdiction) setShowJur(true);
    else if (!s.onboardingAccountComplete) setShowAccount(true);
    else if (!s.onboardingFavoritesComplete) setShowFavorites(true);
    else if (!s.onboardingProfileDone) setShowProfileSetup(true);

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
    // Refresh species + brand + categories overlays from Supabase
    // (no-ops until env vars are set). Subscribers re-render when
    // overrides land.
    refreshSpecies().catch(() => {});
    refreshBrandAssets().catch(() => {});
    refreshCategories().catch(() => {});
    fetchRegulations().catch(() => {});
    // Kick off the ML model fetch/cache in the background. First
    // launch online: downloads the promoted model (~1 MB) and caches
    // it. Subsequent launches: fast cache-hit unless a newer version
    // has been published. Failures are silent — the classifier
    // gracefully degrades to the manual-picker fallback.
    initModel().catch(() => {});
  }, []);

  // Re-fetch the verified regulations overlay every time the app
  // returns to the foreground (not just cold boot). iOS keeps the
  // webview alive for days — without this, an angler who verified
  // new regs in the admin (or a season that flipped overnight) kept
  // seeing the stale overlay until they force-killed the app.
  // Throttled to once per 5 minutes so tab-switching on web doesn't
  // hammer Supabase. Offline failures stay silent — last-known-good
  // cache keeps rendering.
  const lastRegsFetchRef = useRef(Date.now());
  useEffect(() => {
    const REFETCH_MIN_MS = 5 * 60 * 1000;
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() - lastRegsFetchRef.current < REFETCH_MIN_MS) return;
      lastRegsFetchRef.current = Date.now();
      fetchRegulations().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  // Overlay subscriptions: bump a version counter on every notify so
  // screens re-read the (mutated in place) SPECIES const + brandAsset()
  // lookups reflect the latest cache.
  useEffect(() => subscribeSpecies(() => setSpeciesVersion(v => v + 1)), []);
  useEffect(() => subscribeBrand(() => setSpeciesVersion(v => v + 1)), []);
  useEffect(() => subscribeCategories(() => setSpeciesVersion(v => v + 1)), []);
  useEffect(() => subscribeRegulations(() => setSpeciesVersion(v => v + 1)), []);
  // Auth + sync subscriptions.
  useEffect(() => subscribeAuth(setSession), []);
  useEffect(() => subscribeSyncStatus(setSyncStatus), []);

  // On sign-in: pull the server snapshot and merge with local. Server
  // wins on conflict — the state was already committed on this device
  // via update(), so anything server-only is a delta from another
  // device that we want. Local-only rows will get pushed by the
  // syncChanges hook on the next state write.
  const pullSessionRef = useRef(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || pullSessionRef.current === uid) return;
    pullSessionRef.current = uid;
    let alive = true;
    (async () => {
      const snap = await cloudPullAll(uid);
      if (!alive || !snap) return;
      setState(prev => {
        const localById = new Map((prev.catchLog || []).map(c => [c.id, c]));
        for (const c of snap.catches) localById.set(c.id, c);
        const catchLog = Array.from(localById.values())
          .sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''));
        const pbs = { ...(prev.pbs || {}), ...snap.pbs };
        // If the server has this user's email + we don't have anglerEmail
        // set locally, adopt it so downstream views (share reports,
        // profile card) render nicely.
        const anglerEmail = (prev.anglerEmail || '').trim() || session.user?.email || '';
        // user_state: non-destructive merge — see cloudsync.mergeUserState.
        // Local wins for keys the server has never seen (a device that
        // was signed-out and populated favorites / units / notes
        // uploads those on the next syncChanges call). Server wins
        // when it has a non-empty value.
        const merged = cloudMergeUserState(prev, snap.userState);
        const next = { ...prev, ...merged, catchLog, pbs, anglerEmail };
        saveState(next);
        return next;
      });
      // Post-pull: reconcile custom-species suggestions with server
      // statuses. Admin-approved suggestions get their real species
      // id stamped into state.customSpecies AND every catchLog row
      // previously logged against the custom_XXX id is remapped to
      // the real species. Best-effort.
      try {
        // Sample the freshly-merged state via a no-op setState so we
        // reconcile against POST-pull data, not the useEffect closure.
        let curCustom = [];
        let curCatchLog = [];
        setState(prev => {
          curCustom = prev.customSpecies || [];
          curCatchLog = prev.catchLog || [];
          return prev;
        });
        const recon = await reconcileSuggestions({
          customSpecies: curCustom,
          catchLog: curCatchLog,
        });
        if (alive && recon.changed) {
          setState(prev => {
            const next = {
              ...prev,
              customSpecies: recon.customSpecies,
              catchLog: recon.catchLog,
            };
            saveState(next);
            return next;
          });
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [session]);

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

  // Splash-dismiss timer. Only auto-dismisses when a session exists
  // (returning signed-in angler gets a 2.2s hold before home). If no
  // session, the splash stays up with sign-in CTAs — there is no
  // "continue without signing in" path; session presence IS the app
  // gate.
  useEffect(() => {
    if (!loaded) return;
    if (!session) return;
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, [loaded, session]);

  // Splash auth modal state — Sign in and Create account both open
  // the same modal; splashInitialMode picks which tab starts active.
  const [splashSignInOpen, setSplashSignInOpen] = useState(false);
  const [splashInitialMode, setSplashInitialMode] = useState('signin');

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
      // Fire-and-forget cross-device sync. syncChanges is debounced
      // per-record so a run of rapid edits collapses to one write.
      // Signed-out or no-Supabase = silent no-op.
      const uid = session?.user?.id;
      if (uid) { try { cloudSyncChanges(prev, next, uid); } catch {} }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveError, session]);

  const screen = stack[stack.length - 1];

  // Track recently-viewed species. Whenever the top screen is a
  // species detail, prepend that id to state.recentSpecies (dedup +
  // cap at 8). Cheap and centralized — every route that opens
  // species goes through push({ name: 'species', id }) so this catches
  // all of them without touching each caller.
  useEffect(() => {
    if (screen?.name !== 'species' || !screen.id) return;
    setState(prev => {
      const list = Array.isArray(prev.recentSpecies) ? prev.recentSpecies : [];
      const next = [screen.id, ...list.filter(x => x !== screen.id)].slice(0, 8);
      if (JSON.stringify(next) === JSON.stringify(list)) return prev;
      const merged = { ...prev, recentSpecies: next };
      saveState(merged);
      return merged;
    });
  }, [screen?.name, screen?.id]);

  // Scroll persistence across the stack. push()/reset() save the
  // current top's scroll position; a route-change effect resets to 0
  // for the new screen; pop() restores the saved position after the
  // next paint so back-navigation feels stable. Key by stack-index so
  // repeated visits to the same route don't stomp each other.
  const scrollByRouteRef = useRef({});
  const scrollRootRef = useRef(null);
  const currentScrollY = () => (scrollRootRef.current?.scrollTop ?? 0) || window.scrollY || 0;
  const setScrollY = (y) => {
    if (scrollRootRef.current) scrollRootRef.current.scrollTop = y;
    else window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  };
  const push  = (s) => {
    scrollByRouteRef.current[stack.length - 1] = currentScrollY();
    setStack(st => [...st, s]);
  };
  const pop   = () => setStack(st => {
    if (st.length <= 1) return st;
    const nextLen = st.length - 1;
    const saved = scrollByRouteRef.current[nextLen - 1] || 0;
    // Restore after paint so the new screen's content is measurable.
    requestAnimationFrame(() => setScrollY(saved));
    return st.slice(0, -1);
  });
  const reset = (s) => {
    scrollByRouteRef.current = {};
    setStack(Array.isArray(s) ? s : [s]);
  };

  // On any forward route change, scroll the content region to top.
  // Depends on the full stack length + the top screen's identity so
  // pushing a new species detail or swapping the top screen mid-stack
  // both trigger the reset. Restored-scroll on pop() runs after this
  // effect and overrides the top-scroll (later effect wins).
  useEffect(() => {
    if (scrollRootRef.current) scrollRootRef.current.scrollTop = 0;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [stack.length, screen.name, screen.id, screen.speciesId, screen.editingId, screen.catId]);

  // App-wide session gate: the splash renders whenever we're loading
  // OR the angler is signed out. There is no signed-out branch inside
  // the app itself — Settings, Home, Logbook etc. all render only
  // when session is truthy. This makes it structurally impossible for
  // any screen to show a stale "Sign in" affordance to a signed-in
  // user, or to show real data to a signed-out one.
  if (showSplash || !loaded || !session) {
    const showLogin = loaded && !session;
    return (
      <>
        <SplashScreen
          showLogin={showLogin}
          onContinue={() => loaded && session && setShowSplash(false)}
          onSignIn={() => { setSplashInitialMode('signin'); setSplashSignInOpen(true); }}
          onCreateAccount={() => { setSplashInitialMode('signup'); setSplashSignInOpen(true); }}
        />
        {splashSignInOpen && (
          <SignInModal
            initialEmail={state.anglerEmail || ''}
            initialMode={splashInitialMode}
            onClose={() => setSplashSignInOpen(false)}
            onSignIn={async ({ email, password }) => {
              const res = await signInWithPassword({ email, password });
              if (res?.ok) update({ anglerEmail: email });
              return res;
            }}
            onSignUp={async ({ email, password }) => {
              const res = await signUp({ email, password });
              if (res?.ok) update({ anglerEmail: email });
              return res;
            }}
            onResetPassword={async ({ email }) => {
              const res = await resetPassword({ email });
              if (res?.ok) update({ anglerEmail: email });
              return res;
            }}
          />
        )}
      </>
    );
  }

  // /#/admin — web build only. On reelintel.ai this is reachable via
  // /admin (main.jsx normalises the pathname into the hash before
  // mount). Admin surfaces are gated by:
  //   1. Signed-in Supabase session (real, verified email)
  //   2. Email matches the admin allowlist (currently one address)
  // Fallback to state.anglerEmail is kept for iOS dev / gh-pages
  // preview where the session may not be present, but on the web
  // build we require a real session to prevent anyone from unlocking
  // admin by typing an email into onboarding.
  if (__KYC_ADMIN__ && AdminApp && hashRoute === 'admin') {
    const sessionEmail = (session?.user?.email || '').trim().toLowerCase();
    const localEmail   = (state.anglerEmail   || '').trim().toLowerCase();
    const authedEmail  = __KYC_WEB__ ? sessionEmail : (sessionEmail || localEmail);

    // Signed out on the web deploy → show the sign-in modal only. No
    // hint of what /admin is for. Search engines can't index this
    // (public/robots.txt Disallow /admin).
    if (__KYC_WEB__ && !session) {
      return (
        <div style={{
          minHeight: '100vh', background: T.bgDeep, color: T.parchment,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            maxWidth: 380, width: '100%',
            background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 16,
            padding: '28px 24px',
          }}>
            <div style={{ fontSize: 25, fontWeight: 800, color: T.ink, marginBottom: 10 }}>Sign in</div>
            <p style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.55, margin: '0 0 16px' }}>
              Enter your email and password.
            </p>
            <SignInModal
              initialEmail={state.anglerEmail || ''}
              initialMode="signin"
              onClose={() => {}}
              onSignIn={async ({ email, password }) => {
                const res = await signInWithPassword({ email, password });
                if (res?.ok) update({ anglerEmail: email });
                return res;
              }}
              onSignUp={async ({ email, password }) => {
                const res = await signUp({ email, password });
                if (res?.ok) update({ anglerEmail: email });
                return res;
              }}
              onResetPassword={async ({ email }) => {
                const res = await resetPassword({ email });
                if (res?.ok) update({ anglerEmail: email });
                return res;
              }}
            />
          </div>
        </div>
      );
    }

    if (authedEmail && authedEmail === ADMIN_EMAIL) {
      return (
        <Suspense fallback={<SplashScreen />}>
          <AdminApp
            localAnglerEmail={state.anglerEmail}
            onExit={() => { window.location.hash = ''; }}
          />
        </Suspense>
      );
    }

    // Signed in but not on the allowlist — no info leak about what
    // this URL does. Force sign-out button.
    if (__KYC_WEB__ && session) {
      return (
        <div style={{
          minHeight: '100vh', background: T.bgDeep, color: T.parchment,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div style={{
            maxWidth: 380, width: '100%', textAlign: 'center',
            background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 16,
            padding: '28px 24px',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, marginBottom: 8 }}>Not authorized</div>
            <p style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.55, margin: '0 0 20px' }}>
              This account doesn't have access.
            </p>
            <button
              onClick={async () => {
                const { signOut } = await import('./auth.js');
                await signOut();
                window.location.href = '/';
              }}
              style={{
                background: T.brass, color: T.oceanDeep, border: 'none',
                padding: '10px 20px', borderRadius: 8, fontSize: 15, fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      );
    }
  }

  const jurisdiction = jurisdictionById(state.jurisdiction);
  const stale = isStale(state.syncMeta);

  /* Shared post-capture pipeline for both camera entry points.
     Only the capture invocation differs:
       - Home hero "Log Your Catch" button → source: 'prompt' (system
         picker offering Take Photo or Choose from Library)
       - Footer center tab action → source: 'camera' (camera-direct,
         no chooser, straight to the live viewfinder)
     After capture: photo_analyzing runs identifyPhoto on-device and
     lands on catch_entry with photo + top species + confidence pre-
     filled. Fully offline. */
  const startCaptureFlow = async (source = 'prompt') => {
    const dataUrl = await getPhoto({ source });
    if (!dataUrl) {
      // Native camera denial: drop the angler on catch_entry with no
      // photo so they can still log manually. Chooser cancels stay
      // on the current screen (empty-handed but intentional).
      if (source === 'camera') push({ name: 'catch_entry' });
      return;
    }
    // Straight to analyzing → catch-entry confirm. No forced crop page:
    // the confirm page already offers an optional Crop button, so the
    // angler is never blocked on framing before seeing the result.
    push({ name: 'photo_analyzing', imageDataUrl: dataUrl, fromCapture: true });
  };

  // Legacy-user "Finish setup" nudge. Fires when the required step
  // (jurisdiction) is missing or the optional profile is incomplete
  // AND the user hasn't explicitly dismissed the chip this session.
  // The step it opens is the FIRST missing one.
  const missingSetup = (
    !state.jurisdiction ||
    !profileFieldsComplete(state)
  );
  const startFinishSetup = () => {
    if (!state.jurisdiction) setShowJur(true);
    else if (!profileFieldsComplete(state)) setShowProfileSetup(true);
  };

  const homeProps = {
    state, jurisdiction, stale, screenSize: size,
    onChangeJurisdiction: () => setShowJur(true),
    finishSetupVisible: missingSetup && !finishSetupDismissed && !!state.disclaimerAcceptedVersion,
    onFinishSetup: startFinishSetup,
    onDismissFinishSetup: () => setFinishSetupDismissed(true),
    onIdentify:   () => push({ name: 'identify' }),
    // Fish ID upload → straight to analyzing → results. No manual crop
    // page: the angler wants the answer, not a framing chore. (Crop
    // stays available on the catch-entry confirm page when logging.)
    onUploadPhoto:(dataUrl) => push({ name: 'photo_analyzing', imageDataUrl: dataUrl }),
    onBrowse:     () => push({ name: 'categories' }),
    onCompare:    () => push({ name: 'species_list' }),
    onRegulations:() => push({ name: 'regulations' }),
    onRegulationAlerts: () => push({ name: 'regulation_alerts' }),
    onQuiz:        () => push({ name: 'quiz' }),
    onReport:     () => push({ name: 'catch_entry' }),
    // Home hero — two distinct entry points share the same post-
    // capture pipeline, only the native picker differs:
    //   onCapture             → camera-direct (source='camera')
    //   onSelectFromLibrary   → library-only (source='library')
    //   onLogMenu             → legacy prompt (kept as safety fallback)
    onLogMenu:            () => startCaptureFlow('prompt'),
    onCapture:            () => startCaptureFlow('camera'),
    onSelectFromLibrary:  () => startCaptureFlow('library'),
    onPatterns:   () => push({ name: 'patterns' }),
    onForecast:   () => push({ name: 'forecast' }),
    onSpecies:    (id) => push({ name: 'species', id }),
    onSpeciesList:() => push({ name: 'species_list' }),
    onPBs:        () => push({ name: 'pbs' }),
    onViewCatch:  (id) => push({ name: 'catch_detail', id }),
    onViewCatches: () => push({ name: 'catch_log' }),
  };

  // Build the body based on current screen.
  let body;
  switch (screen.name) {
    case 'home':
      body = <HomeScreen {...homeProps} />;
      break;
    case 'identify':
      body = <IdentifyScreen
        state={state}
        jurisdiction={jurisdiction}
        onPhoto={(dataUrl) => push({ name: 'photo_analyzing', imageDataUrl: dataUrl })}
        onBrowse={() => push({ name: 'categories' })}
        onCategory={(catId) => push({ name: 'category', catId })}
        onSearch={() => push({ name: 'search' })}
        onQuiz={() => push({ name: 'quiz' })}
        onSpecies={(id) => push({ name: 'species', id })}
      />;
      break;
    case 'patterns':
      body = <PatternsScreen
        state={state}
        onPickSpecies={(id) => push({ name: 'species', id })}
      />;
      break;
    case 'photo_crop':
      body = <CropStep
        imageSrc={screen.imageDataUrl}
        onCancel={() => {
          // "Retake" — throw away this photo, back to the flow the user
          // came from. From the capture flow, drop the crop screen and
          // let the tab/home state resurface. From the Identify tab
          // upload, do the same.
          setStack(st => st.filter(s => s.name !== 'photo_crop'));
        }}
        onSkip={() => {
          // Pass the original through unchanged — same result the app
          // produced before the crop step existed.
          setStack(st => [...st.slice(0, -1), {
            name: 'photo_analyzing',
            imageDataUrl: screen.imageDataUrl,
            fromCapture: screen.fromCapture,
          }]);
        }}
        onConfirm={({ dataUrl, bbox }) => {
          // Persist BOTH: the original for the logbook + the crop for
          // inference. The catch record picks these up via prefilledPhoto
          // (original) + photoCrop (cropped) when we route to catch_entry.
          setStack(st => [...st.slice(0, -1), {
            name: 'photo_analyzing',
            imageDataUrl: dataUrl,
            originalDataUrl: screen.imageDataUrl,
            cropBbox: bbox,
            fromCapture: screen.fromCapture,
          }]);
        }}
      />;
      break;
    case 'photo_analyzing':
      body = <PhotoAnalyzingScreen
        imageDataUrl={screen.imageDataUrl}
        jurisdictionId={jurisdiction?.id || null}
        onResult={(result) => {
          // Capture-flow origin: interpose the identification
          // confirmation card between the analyzing animation and
          // catch_entry. The card gives the angler 3s to accept or
          // correct the model's pick. If identifyPhoto returns no
          // resolvable species (or confidence is really low with no
          // top candidate) we skip the card and land straight on
          // catch_entry so they can pick manually — no wasted step.
          if (screen.fromCapture) {
            const top = (result && result.candidates && result.candidates[0]) || null;
            const aiIdentifiedSpeciesId = top ? top.speciesId : null;
            const aiConfidence =
              result && typeof result.confidenceScore === 'number' ? result.confidenceScore
              : result?.confidence === 'high'   ? 0.85
              : result?.confidence === 'medium' ? 0.55
              : result?.confidence === 'low'    ? 0.30
              : null;
            // originalDataUrl (if any) is the full-res photo the user
            // captured before the crop step; imageDataUrl is what was
            // fed to the model (potentially cropped). The logbook wants
            // the original for display, so prefilledPhoto uses it when
            // available.
            const originalForLog = screen.originalDataUrl || screen.imageDataUrl;
            if (!aiIdentifiedSpeciesId) {
              setStack(st => [...st.slice(0, -1), {
                name: 'catch_entry',
                prefilledPhoto: originalForLog,
                aiConfidence,
                aiIdentifiedSpeciesId: null,
                aiWasConfirmed: false,
              }]);
              return;
            }
            // Unified photo-confirm page: catch entry opens with the
            // overlay (photo + metadata verdict + species confirm) —
            // replaces the old separate identify_confirm card.
            setStack(st => [...st.slice(0, -1), {
              name: 'catch_entry',
              aiIdentifiedSpeciesId,
              aiConfidence,
              confirmPhoto: {
                imageDataUrl: originalForLog,
                aiIdentifiedSpeciesId,
                aiConfidence,
                candidates: (result?.candidates || []).slice(0, 5),
              },
            }]);
            return;
          }
          // Legacy Fish-ID-tab flow: results screen with candidates.
          setStack(st => [...st.slice(0, -1), {
            name: 'photo_result',
            imageDataUrl: screen.imageDataUrl,
            originalDataUrl: screen.originalDataUrl,
            result,
          }]);
        }}
      />;
      break;
    case 'identify_confirm':
      body = <IdentificationConfirmCard
        imageDataUrl={screen.imageDataUrl}
        aiIdentifiedSpeciesId={screen.aiIdentifiedSpeciesId}
        aiConfidence={screen.aiConfidence}
        onConfirm={() => {
          setStack(st => [...st.slice(0, -1), {
            name: 'catch_entry',
            preselectSpeciesId: screen.aiIdentifiedSpeciesId,
            prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl,
            aiIdentifiedSpeciesId: screen.aiIdentifiedSpeciesId,
            aiConfidence: screen.aiConfidence,
            aiWasConfirmed: true,
          }]);
        }}
        onCorrect={() => {
          // Skip to catch_entry with no species preselection so the
          // angler picks from the dropdown. The AI's original pick
          // + confidence + aiWasConfirmed:false ride along so we can
          // measure the model's real-world accuracy later.
          setStack(st => [...st.slice(0, -1), {
            name: 'catch_entry',
            prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl,
            aiIdentifiedSpeciesId: screen.aiIdentifiedSpeciesId,
            aiConfidence: screen.aiConfidence,
            aiWasConfirmed: false,
          }]);
        }}
        onSuggestNew={() => {
          // Fish isn't in the database at all — catch entry with the
          // add-species modal open; local placeholder + admin review.
          setStack(st => [...st.slice(0, -1), {
            name: 'catch_entry',
            prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl,
            aiIdentifiedSpeciesId: screen.aiIdentifiedSpeciesId,
            aiConfidence: screen.aiConfidence,
            aiWasConfirmed: false,
            openSuggestOnMount: true,
          }]);
        }}
      />;
      break;
    case 'photo_result':
      body = <PhotoResultScreen
        result={screen.result}
        imageDataUrl={screen.imageDataUrl}
        onPickSpecies={(id) => push({ name: 'species', id })}
        onConfirmSave={(topPickSpeciesId) => {
          // Save & Continue tapped when the feedback strip is unset
          // — implicit model_confirmation fire + navigate. Fire is
          // fire-and-forget so offline / network hiccups don't gate
          // saving the catch.
          dataUrlToFile(screen.imageDataUrl, 'confirmation.jpg').then((file) => {
            if (file) saveModelFeedback({
              file, speciesId: topPickSpeciesId,
              originalSpeciesId: topPickSpeciesId,
              source: 'model_confirmation',
            }).catch(() => {});
          });
          push({ name: 'catch_entry', preselectSpeciesId: topPickSpeciesId, prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl });
        }}
        onConfirmFeedbackOnly={(topPickSpeciesId) => {
          // Feedback strip's "Yes, correct" — fire model_confirmation
          // but don't navigate; the user stays on the result screen.
          dataUrlToFile(screen.imageDataUrl, 'confirmation.jpg').then((file) => {
            if (file) saveModelFeedback({
              file, speciesId: topPickSpeciesId,
              originalSpeciesId: topPickSpeciesId,
              source: 'model_confirmation',
            }).catch(() => {});
          });
        }}
        onSaveWithoutFeedback={(topPickSpeciesId) => {
          // Save tapped after the strip already banked the confirmation
          // — just navigate; skip the double-fire.
          push({ name: 'catch_entry', preselectSpeciesId: topPickSpeciesId, prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl });
        }}
        onCorrectSave={(correctSpeciesId, originalSpeciesId) => {
          dataUrlToFile(screen.imageDataUrl, 'correction.jpg').then((file) => {
            if (file) saveModelFeedback({
              file, speciesId: correctSpeciesId,
              originalSpeciesId,
              source: 'model_correction',
            }).catch(() => {});
          });
          push({ name: 'catch_entry', preselectSpeciesId: correctSpeciesId, prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl });
        }}
        onSuggestNew={() => {
          // Unknown fish — route to catch entry with the scanned photo
          // attached and the add-species modal open. The species lands
          // locally right away and queues for admin review.
          push({
            name: 'catch_entry',
            prefilledPhoto: screen.originalDataUrl || screen.imageDataUrl,
            openSuggestOnMount: true,
          });
        }}
        onRetake={() => setStack(st => st.filter(s => s.name !== 'photo_crop' && s.name !== 'photo_analyzing' && s.name !== 'photo_result'))}
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
      body = <RegulationAlertsScreen state={state} jurisdiction={jurisdiction} onPick={(id) => push({ name: 'regulation', id })} onEditFavorites={() => setShowFavorites(true)} />;
      break;
    case 'forecast':
      body = <WeatherForecastScreen jurisdiction={jurisdiction} state={state} update={update} />;
      break;
    case 'quiz':
      body = <QuizScreen state={state} jurisdiction={jurisdiction}
        update={update}
        onPickSpecies={(id) => push({ name: 'species', id })}
        onBack={pop} />;
      break;
    case 'catch_log':
      body = <CatchLogScreen
        state={state}
        signedIn={!!session}
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
        aiConfidence={screen.aiConfidence}
        aiIdentifiedSpeciesId={screen.aiIdentifiedSpeciesId}
        aiWasConfirmed={screen.aiWasConfirmed}
        openUploadOnMount={screen.openUploadOnMount}
        openSuggestOnMount={screen.openSuggestOnMount}
        confirmPhoto={screen.confirmPhoto}
        onDone={() => reset([{ name: 'catch_log' }])}
        onCancel={pop}
        onHome={() => reset([{ name: 'home' }])}
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
        signedIn={!!session}
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
                session={session}
                syncStatus={syncStatus}
                lastSyncedAt={getCloudLastSynced()}
                onForceSync={() => { const uid = session?.user?.id; if (uid) cloudForceSync(state, uid); }}
                onChangeJurisdiction={() => setShowJur(true)}
                onShowDisclaimer={() => { setDisclaimerReadOnly(true); setShowDisclaimer(true); }}
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

  const speciesActive = ['species_list', 'species', 'categories', 'category', 'search'].includes(screen.name);
  const identifyActive = ['identify', 'photo_crop', 'photo_analyzing', 'photo_result'].includes(screen.name);

  const chrome = chromeHeights(size);
  const type = typeScale(size);
  const gridCols = cols(size);
  const screenCtx = { size, type, cols: gridCols, chrome };
  return (
    <ScreenSizeContext.Provider value={screenCtx}>
    <div data-screen-size={size} style={{
      background: T.bgGradient, minHeight: '100vh', color: T.ink,
      maxWidth: containerMaxWidth(size), margin: '0 auto', position: 'relative',
      boxShadow: '0 0 60px rgba(0,0,0,0.5)',
      fontSize: type.body,
      // Push the chrome-height CSS vars into the tree so the safe-area
      // content-region padding scales with tablet.
      '--kyc-header-height': `${chrome.header}px`,
      '--kyc-footer-height': `${chrome.footer}px`,
    }}>
      {/* Top app bar — fixed to the viewport with safe-area padding so
          the header can't scroll into the iOS status bar area. Centered
          via the same maxWidth as the outer container. */}
      <div style={{
        background: T.oceanDeep, color: T.parchment,
        padding: 0, paddingTop: 'env(safe-area-inset-top)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        borderBottom: `1px solid ${T.cardEdge}`,
        position: 'fixed', top: 0, left: 0, right: 0,
        maxWidth: containerMaxWidth(size), margin: '0 auto',
        zIndex: 50,
      }}>
        {/* Header left cluster. Layout, left-to-right:
              1. Back chevron  — only when stack.length > 1
              2. ReelIntel wordmark — ALWAYS renders (any screen, any depth).
                 Tapping resets the stack to home.
            The wordmark MUST be present on every screen — if this <img> is
            ever conditionally skipped we regress the "logo missing on
            non-home pages" bug. The render-time assertion below fires a
            console.warn so any future regression surfaces during dev/QA. */}
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, height: chrome.header }}>
          {stack.length > 1 && (
            <button
              onClick={pop}
              aria-label="Back"
              style={{
                background: 'transparent', border: 'none', color: T.parchment,
                padding: '0 4px 0 10px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', flexShrink: 0,
              }}
            >
              <ChevronLeft size={22} strokeWidth={2.2} />
            </button>
          )}
          <button
            onClick={() => reset([{ name: 'home' }])}
            aria-label="ReelIntel — home"
            style={{
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              display: 'flex', alignItems: 'center', flex: 1, minWidth: 0,
              height: chrome.header,
            }}
          >
            <img
              ref={(el) => {
                if (!el && typeof console !== 'undefined') {
                  console.warn('[header] wordmark img element failed to mount — logo will be missing');
                }
              }}
              src={brandAsset('logo_horizontal', `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`)}
              alt="ReelIntel"
              style={{
                height: Math.round(chrome.header * 0.78), width: 'auto', maxWidth: '100%',
                display: 'block', objectFit: 'contain',
                marginLeft: stack.length > 1 ? 4 : (size === 'phone' ? 12 : 20),
              }}
            />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12, flexShrink: 0 }}>
          {/* Sync pill: signed-in users get the real status. Signed-out
              users get an honest "Not signed in" affordance that
              opens the sign-in modal. Shown on non-home routes; on
              Home the same feature lives on the header sign-in chip
              below. */}
          {!isHome && (
            <SyncPill
              status={session ? syncStatus : 'signed_out'}
              onClick={() => session ? push({ name: 'settings' }) : setShowSignInModal(true)}
            />
          )}
          {/* Home header: sign-in chip when signed-out so a new user
              can move from local-only to synced without hunting for
              it in Settings. Signed-in users don't see it — their
              synced state is implicit + the SyncPill covers status
              on other screens. */}
          {isHome && !session && (
            <button
              onClick={() => setShowSignInModal(true)}
              style={{
                background: 'transparent', color: T.brass,
                border: `1px solid ${T.brass}`,
                padding: '5px 10px', borderRadius: 999,
                fontSize: 12, fontWeight: 800, letterSpacing: 0.8,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Sign in
            </button>
          )}
          {isHome && (
            <button
              onClick={() => setShowNotifications(true)}
              style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer', position: 'relative' }}
              aria-label={inboxUnread > 0 ? `Notifications (${inboxUnread})` : 'Notifications'}
            >
              <Bell size={24} strokeWidth={1.8} />
              {inboxUnread > 0 && (
                <span style={{
                  position: 'absolute', top: -3, right: -4, background: T.brass, color: T.oceanDeep,
                  fontSize: 12, fontWeight: 800, minWidth: 18, height: 18, borderRadius: 9,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                  boxShadow: '0 0 10px rgba(25, 212, 242, 0.55)',
                }}>{inboxUnread}</span>
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
          position: 'fixed', top: 'env(safe-area-inset-top)', left: 0, right: 0,
          maxWidth: containerMaxWidth(size), margin: '0 auto',
          zIndex: 60,
          background: '#3A0F12', borderBottom: `1px solid ${T.closed}`,
          color: T.parchment, padding: '10px 14px',
          fontSize: 14, lineHeight: 1.45,
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

      {/* Scrolling content region — leaves room for the fixed header
          + footer + their respective safe-area insets so nothing sits
          under the tab bar or in the notch. data-scroll-root marks
          it for the route-change scroll-to-top effect. */}
      <div
        ref={scrollRootRef}
        data-scroll-root
        style={{
          paddingTop: 'calc(var(--kyc-header-height) + env(safe-area-inset-top))',
          paddingBottom: 'calc(var(--kyc-footer-height) + env(safe-area-inset-bottom))',
          minHeight: '100vh',
        }}>
        {body}
      </div>

      {/* Toast — quick-log confirmation + stale-quick nag. Fixed at the
          top center over the current viewport, auto-dismisses. */}
      {toast && (
        <div role="status" style={{
          position: 'fixed',
          top: `calc(env(safe-area-inset-top) + var(--kyc-header-height) + 12px)`,
          left: '50%', transform: 'translateX(-50%)',
          background: toast.kind === 'nag' ? T.warnBg : T.openBg,
          border: `1px solid ${toast.kind === 'nag' ? T.warn : T.open}`,
          color: toast.kind === 'nag' ? T.warn : T.open,
          padding: '10px 16px', borderRadius: 8, fontSize: 15, fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          zIndex: 200, maxWidth: 'calc(100% - 32px)',
        }}>
          {toast.text}
        </div>
      )}


      {/* Bottom tab bar — fixed to the viewport so it stays put during
          scroll and doesn't leave a white gap under a bounced list
          when iOS overscrolls. Safe-area padding leaves room for the
          home indicator. */}
      {/* Bottom tab bar — 5 slots with a raised center capture action.
          Home | Logbook | [camera] | Regulations | Fish ID. Logbook
          moved to slot 2 and Fish ID to slot 5 per angler feedback —
          Logbook is a more frequent destination than Fish ID. The
          center slot is an unlabeled action (not a tab): it never
          highlights, it always triggers the shared capture flow.
          Padding tightened so the row hugs the bottom safe area. */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        maxWidth: containerMaxWidth(size), margin: '0 auto',
        background: T.oceanDeep,
        borderTop: `1px solid ${T.cardEdge}`,
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
        padding: `${size === 'phone' ? 6 : 10}px 4px 0`,
        paddingBottom: `calc(${size === 'phone' ? 4 : 8}px + env(safe-area-inset-bottom))`,
        zIndex: 50,
      }}>
        <TabBtn size={size} label="Home"        active={activeTab === 'home'}                          onClick={() => reset([{ name: 'home' }])}         icon={<HomeIcon />} />
        <TabBtn size={size} label="Logbook"     active={activeTab === 'logbook'}                        onClick={() => reset([{ name: 'catch_log' }])}    icon={<BookOpen />} />
        <CenterCaptureBtn size={size} onClick={() => startCaptureFlow('camera')} />
        <TabBtn size={size} label="Regulations" active={activeTab === 'regulations'}                    onClick={() => reset([{ name: 'regulations' }])}  icon={<ClipboardList />} />
        <TabBtn size={size} label="Fish ID"     active={identifyActive}                                onClick={() => reset([{ name: 'identify' }])}     icon={<Fish />} />
      </div>

      {showIntro && (
        <WelcomeIntroModal
          onContinue={() => {
            update({ onboardingIntroSeen: true });
            setShowIntro(false);
            if (!state.disclaimerAcceptedVersion) setShowDisclaimer(true);
            else if (!state.jurisdiction) setShowJur(true);
            else if (!state.onboardingAccountComplete) setShowAccount(true);
            else if (!state.onboardingFavoritesComplete) setShowFavorites(true);
            else if (!state.onboardingProfileDone) setShowProfileSetup(true);
          }}
        />
      )}

      {showDisclaimer && (
        <DisclaimerModal
          readOnly={disclaimerReadOnly}
          onClose={() => { setShowDisclaimer(false); setDisclaimerReadOnly(false); }}
          onAccept={() => {
            update({ disclaimerAcceptedVersion: DISCLAIMER_VERSION });
            setShowDisclaimer(false);
            if (!state.jurisdiction) setShowJur(true);
            else if (!state.onboardingAccountComplete) setShowAccount(true);
            else if (!state.onboardingFavoritesComplete) setShowFavorites(true);
            else if (!state.onboardingProfileDone) setShowProfileSetup(true);
          }}
        />
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
            if (!state.onboardingProfileDone) setShowProfileSetup(true);
          }}
          onSkip={() => {
            update({ onboardingFavoritesComplete: true });
            setShowFavorites(false);
            if (!state.onboardingProfileDone) setShowProfileSetup(true);
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
          <p style={{ marginTop: 12, lineHeight: 1.55, color: T.inkMute, fontSize: 15 }}>
            If your trip crosses the line, rules in effect depend on where the fish was caught — not where you're heading.
          </p>
        </InfoModal>
      )}

      {showProfileSetup && (
        <FishingProfileSetupModal
          initial={{
            anglerIsCaptain:   state.anglerIsCaptain,
            anglerFisherType:  state.anglerFisherType,
            anglerExperience:  state.anglerExperience,
            anglerTripFreq:    state.anglerTripFreq,
          }}
          fields={PROFILE_FIELDS}
          hasCommercialCaveat
          onDone={(values) => {
            update({
              ...values,
              onboardingProfileDone: true,
              anglerProfileCompletedAt: new Date().toISOString(),
            });
            setShowProfileSetup(false);
          }}
          onSkip={() => {
            // Skipped counts as "done" so we don't nag them next launch.
            // They can still fill in fields later in Settings.
            update({ onboardingProfileDone: true });
            setShowProfileSetup(false);
          }}
        />
      )}

      {keepFor && <KeepConfirmModal species={keepFor} onClose={() => setKeepFor(null)} />}

      <NotificationsDrawer
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      {/* User-triggered sign in / sign up from Home header + SyncPill.
          Onboarding also opens SignInModal earlier (via the
          onboarding chain around line 350), but that flow is a
          modal-in-modal path with different wrapper chrome. */}
      {showSignInModal && !session && (
        <div
          onClick={() => setShowSignInModal(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 500,
            background: 'rgba(3, 27, 51, 0.78)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 400,
              background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 16,
              padding: '24px 22px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 23, fontWeight: 800, color: T.ink }}>Sign in</div>
              <button
                onClick={() => setShowSignInModal(false)}
                style={{ background: 'transparent', border: 'none', color: T.inkMute, fontSize: 14, cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
            <p style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.5, margin: '0 0 14px' }}>
              Keeps your catches, PBs, and starred species backed up and synced across your devices. Sign out anytime — your local log stays.
            </p>
            <SignInModal
              initialEmail={state.anglerEmail || ''}
              initialMode="signin"
              onClose={() => setShowSignInModal(false)}
              onSignIn={async ({ email, password }) => {
                const res = await signInWithPassword({ email, password });
                if (res?.ok) { update({ anglerEmail: email }); setShowSignInModal(false); }
                return res;
              }}
              onSignUp={async ({ email, password }) => {
                const res = await signUp({ email, password });
                if (res?.ok) { update({ anglerEmail: email }); setShowSignInModal(false); }
                return res;
              }}
              onResetPassword={async ({ email }) => {
                const res = await resetPassword({ email });
                if (res?.ok) update({ anglerEmail: email });
                return res;
              }}
            />
          </div>
        </div>
      )}

      {/* Sign in with Apple — DELIBERATELY NOT WIRED.
          To enable in a future pass:
            1. iOS entitlement: com.apple.developer.applesignin in
               ios/App/App/App.entitlements.
            2. App Store Connect: enable "Sign In with Apple" on the
               com.reelintel.app bundle identifier.
            3. Supabase Auth → Providers → Apple: enable with Team ID +
               Services ID + Key.
            4. Add @capacitor-community/apple-sign-in as a dep and
               call SignInWithApple.authorize({...}) → then
               supabase.auth.signInWithIdToken({ provider: 'apple',
               token, nonce }).
          The plugin was previously installed and unwired — it stayed
          idle in the bundle and emitted AuthorizationError 1000 when
          native code tried to reach its handler. Removed from
          package.json to eliminate the auto-attempt. */}
    </div>
    </ScreenSizeContext.Provider>
  );
}

const TAB_ACTIVE   = '#5ecdf2';
const TAB_INACTIVE = '#8494a8';

function TabBtn({ label, active, onClick, icon, size = 'phone' }) {
  const iconSize  = size === 'phone' ? 23 : size === 'tablet' ? 26 : 28;
  const labelSize = size === 'phone' ? 11 : size === 'tablet' ? 13 : 14;
  const gap       = size === 'phone' ? 5 : 7;
  const color = active ? TAB_ACTIVE : TAB_INACTIVE;
  const scaledIcon = React.isValidElement(icon)
    ? React.cloneElement(icon, { size: iconSize, strokeWidth: 2 })
    : icon;
  return (
    <button onClick={onClick} style={{
      background: 'transparent', border: 'none', color,
      padding: '4px 0', cursor: 'pointer', display: 'flex', flexDirection: 'column',
      alignItems: 'center', gap, fontSize: labelSize, fontWeight: active ? 700 : 600,
      letterSpacing: 0.2,
      minWidth: 0,
    }}>
      <span style={{ color }}>{scaledIcon}</span>
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );
}

/* Center capture action — an action slot in the tab bar, not a tab.
   56px filled circle in the brand light-blue, seated in a 64px socket
   colored like the tab-bar itself so it reads as raised through the
   top edge. No labels, no active state; always triggers the shared
   capture flow. */
function CenterCaptureBtn({ onClick, size = 'phone' }) {
  const socket = size === 'phone' ? 64 : 72;
  const btn    = size === 'phone' ? 56 : 64;
  const icon   = size === 'phone' ? 28 : 32;
  return (
    <div style={{
      position: 'relative', display: 'flex', justifyContent: 'center',
      alignItems: 'flex-start',
    }}>
      <div style={{
        position: 'absolute',
        top: -(socket / 2 + 4),
        left: '50%', transform: 'translateX(-50%)',
        width: socket, height: socket, borderRadius: '50%',
        background: T.oceanDeep,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <button onClick={onClick} aria-label="Log a catch" style={{
          width: btn, height: btn, borderRadius: '50%',
          background: '#5ecdf2', border: 'none',
          color: '#062330', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'auto',
        }}>
          <Camera size={icon} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
