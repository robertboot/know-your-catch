import React, { useState, useEffect, useCallback } from 'react';
import {
  Fish, ChevronLeft, BookOpen, Bell, ClipboardList,
  Home as HomeIcon, Settings as SettingsIcon,
} from 'lucide-react';
import { T } from './theme.js';
import { DISCLAIMER_VERSION } from './data.js';
import { loadState, saveState, defaultState } from './storage.js';
import { refreshFeeds } from './regsync.js';
import { jurisdictionById, isStale } from './helpers.js';
import {
  DisclaimerModal, JurisdictionPickerModal, InfoModal, KeepConfirmModal,
} from './components.jsx';
import {
  SplashScreen, HomeScreen, IdentifyScreen, CategoriesScreen, CategoryScreen, SearchScreen,
  PhotoAnalyzingScreen, PhotoResultScreen,
} from './screens1.jsx';
import {
  SpeciesDetailScreen, CompareScreen, RegulationsListScreen, RegulationDetailScreen,
  SpeciesListScreen, PBsScreen, PBDetailScreen, PBEntryScreen, SettingsScreen,
  CatchLogScreen, CatchEntryScreen,
} from './screens2.jsx';

const ALERT_COUNT = 2;

export default function App() {
  const [state, setState] = useState(defaultState);
  const [loaded, setLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [stack, setStack] = useState([{ name: 'home' }]);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showJur, setShowJur] = useState(false);
  const [showBoundaryInfo, setShowBoundaryInfo] = useState(false);
  const [keepFor, setKeepFor] = useState(null);

  // Load persisted state on mount.
  useEffect(() => {
    const s = loadState();
    setState(s);
    setLoaded(true);
    if (s.disclaimerAcceptedVersion !== DISCLAIMER_VERSION) setShowDisclaimer(true);
    else if (!s.jurisdiction) setShowJur(true);
    // Refresh the regulations feed in the background (no-op until a feed
    // URL is configured; failures are silent — offline-first).
    refreshFeeds().catch(() => {});
  }, []);

  // Auto-dismiss the splash after a short hold.
  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2200);
    return () => clearTimeout(t);
  }, []);

  // update() merges patch into state and persists.
  const update = useCallback((patch) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      saveState(next);
      return next;
    });
  }, []);

  const screen = stack[stack.length - 1];
  const push  = (s)    => setStack(st => [...st, s]);
  const pop   = ()     => setStack(st => st.length > 1 ? st.slice(0, -1) : st);
  const reset = (s)    => setStack(Array.isArray(s) ? s : [s]);

  if (showSplash || !loaded) {
    return <SplashScreen onContinue={() => loaded && setShowSplash(false)} />;
  }

  const jurisdiction = jurisdictionById(state.jurisdiction);
  const stale = isStale(state.syncMeta);

  const homeProps = {
    state, jurisdiction, stale,
    onChangeJurisdiction: () => setShowJur(true),
    onIdentify:   () => push({ name: 'identify' }),
    onRegulations:() => push({ name: 'regulations' }),
    onReport:     () => push({ name: 'catch_entry' }),
    onSpecies:    (id) => push({ name: 'species', id }),
    onSpeciesList:() => push({ name: 'species_list' }),
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
        onRetake={() => setStack(st => st.filter(s => s.name !== 'photo_analyzing' && s.name !== 'photo_result'))}
        onManual={() => reset([{ name: 'home' }, { name: 'identify' }, { name: 'categories' }])}
      />;
      break;
    case 'categories':
      body = <CategoriesScreen onPick={(catId) => push({ name: 'category', catId })} />;
      break;
    case 'category':
      body = <CategoryScreen catId={screen.catId} onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'search':
      body = <SearchScreen onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'species':
      body = <SpeciesDetailScreen
        id={screen.id} state={state} jurisdiction={jurisdiction} stale={stale}
        onLookalike={(otherId) => push({ name: 'compare', aId: screen.id, bId: otherId })}
        onAddPB={() => push({ name: 'pb_entry', speciesId: screen.id })}
        onFullRegs={() => push({ name: 'regulation', id: screen.id })}
        onKeep={setKeepFor}
        update={update}
      />;
      break;
    case 'compare':
      body = <CompareScreen
        aId={screen.aId} bId={screen.bId}
        onPick={(id) => reset([{ name: 'home' }, { name: 'species', id }])}
      />;
      break;
    case 'regulations':
      body = <RegulationsListScreen state={state} jurisdiction={jurisdiction} onPick={(id) => push({ name: 'regulation', id })} />;
      break;
    case 'catch_log':
      body = <CatchLogScreen state={state} onNew={() => push({ name: 'catch_entry' })} onView={(id) => push({ name: 'catch_detail', id })} />;
      break;
    case 'catch_entry':
      body = <CatchEntryScreen state={state} jurisdiction={jurisdiction} update={update} onDone={() => reset([{ name: 'catch_log' }])} onCancel={pop} />;
      break;
    case 'regulation':
      body = <RegulationDetailScreen id={screen.id} state={state} jurisdiction={jurisdiction} stale={stale} onSpecies={() => push({ name: 'species', id: screen.id })} />;
      break;
    case 'species_list':
      body = <SpeciesListScreen onPick={(id) => push({ name: 'species', id })} />;
      break;
    case 'pbs':
      body = <PBsScreen state={state} onAdd={(id) => push({ name: 'pb_entry', speciesId: id })} onView={(id) => push({ name: 'pb_detail', speciesId: id })} />;
      break;
    case 'pb_detail':
      body = <PBDetailScreen speciesId={screen.speciesId} state={state} update={update}
                onEdit={() => push({ name: 'pb_entry', speciesId: screen.speciesId, edit: true })}
                onBack={pop} />;
      break;
    case 'pb_entry':
      body = <PBEntryScreen speciesId={screen.speciesId} edit={screen.edit} state={state} jurisdiction={jurisdiction} update={update} onDone={pop} />;
      break;
    case 'settings':
      body = <SettingsScreen state={state} jurisdiction={jurisdiction} update={update}
                onChangeJurisdiction={() => setShowJur(true)}
                onShowDisclaimer={() => setShowDisclaimer(true)} />;
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

  return (
    <div style={{
      background: T.bg, minHeight: '100vh', color: T.ink,
      maxWidth: 440, margin: '0 auto', position: 'relative',
      boxShadow: '0 0 60px rgba(0,0,0,0.5)',
    }}>
      {/* Top app bar */}
      <div style={{
        background: T.oceanDeep, color: T.parchment, padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${T.cardEdge}`, position: 'sticky', top: 0, zIndex: 50,
      }}>
        {isHome ? (
          <button onClick={() => reset([{ name: 'home' }])} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={`${import.meta.env.BASE_URL}brand/mark.jpg`} alt="" width={40} height={40} style={{ borderRadius: 9, display: 'block' }} />
            <span style={{ textAlign: 'left', lineHeight: 1 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 700, letterSpacing: 3, color: T.parchment }}>KNOW YOUR</span>
              <span style={{ display: 'block', fontSize: 21, fontWeight: 900, letterSpacing: 2, color: T.brass, marginTop: 2 }}>CATCH</span>
              <span style={{ display: 'block', fontSize: 7.5, fontWeight: 700, letterSpacing: 1.6, color: T.inkSoft, marginTop: 3 }}>IDENTIFY · CHECK RULES · STAY LEGAL</span>
            </span>
          </button>
        ) : (
          <button onClick={pop} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600 }}>
            <ChevronLeft size={20} /> Back
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isHome && (
            <button onClick={() => push({ name: 'regulations' })} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer', position: 'relative' }} aria-label="Alerts">
              <Bell size={22} />
              {ALERT_COUNT > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -3, background: T.brass, color: T.oceanDeep,
                  fontSize: 10, fontWeight: 800, minWidth: 16, height: 16, borderRadius: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{ALERT_COUNT}</span>
              )}
            </button>
          )}
          <button onClick={() => push({ name: 'settings' })} style={{ background: 'transparent', border: 'none', color: T.parchment, padding: 4, cursor: 'pointer' }} aria-label="Settings">
            <SettingsIcon size={20} />
          </button>
        </div>
      </div>

      <div style={{ paddingBottom: 78, minHeight: 'calc(100vh - 132px)' }}>
        {body}
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'sticky', bottom: 0, background: T.oceanDeep,
        borderTop: `1px solid ${T.cardEdge}`, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        padding: '8px 4px 10px', zIndex: 50,
      }}>
        <TabBtn label="Home" active={activeTab === 'home'} onClick={() => reset([{ name: 'home' }])} icon={<HomeIcon size={20} />} />
        <TabBtn label="Species" active={activeTab === 'species'} onClick={() => reset([{ name: 'species_list' }])} icon={<Fish size={20} />} />
        <TabBtn label="Regulations" active={activeTab === 'regulations'} onClick={() => reset([{ name: 'regulations' }])} icon={<ClipboardList size={20} />} />
        <TabBtn label="Logbook" active={activeTab === 'logbook'} onClick={() => reset([{ name: 'catch_log' }])} icon={<BookOpen size={20} />} />
      </div>

      {showDisclaimer && (
        <DisclaimerModal onAccept={() => {
          update({ disclaimerAcceptedVersion: DISCLAIMER_VERSION });
          setShowDisclaimer(false);
          if (!state.jurisdiction) setShowJur(true);
        }} />
      )}

      {showJur && (
        <JurisdictionPickerModal
          current={state.jurisdiction}
          onPick={(id) => { update({ jurisdiction: id }); setShowJur(false); }}
          onClose={() => state.jurisdiction && setShowJur(false)}
          canCancel={!!state.jurisdiction}
          onShowBoundary={() => setShowBoundaryInfo(true)}
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
      alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: active ? 700 : 500,
    }}>
      <span style={{ color: active ? T.brass : T.inkMute }}>{icon}</span>
      {label}
    </button>
  );
}
