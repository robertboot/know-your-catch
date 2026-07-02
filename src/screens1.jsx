import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fish, Search, ChevronRight, AlertTriangle, Plus, Pencil, BookOpen,
  Trophy, Camera, Trash2, Mail, Anchor, ListChecks, Wrench, Layers, X,
  RotateCcw, Image as ImageIcon, Sparkles, ArrowLeft,
  MapPin, Ruler, ClipboardList, CloudSun, Wind, Waves, Thermometer,
  CheckCircle2, ShieldCheck, MoreHorizontal, BarChart2,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, CATEGORIES, SPECIES, REGULATIONS,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { defaultState, saveState } from './storage.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, seasonState,
  sunPosition, moonPhase, fetchWeatherForTime,
} from './helpers.js';
import { brandAsset } from './brand-store.js';
import { getLocation, getPhoto } from './native.js';
import { savePhoto } from './photos-store.js';
import { downscaleImageDataUrl } from './storage.js';
import {
  StatusPill, SpeciesImage, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, BigButton, SpeciesRow,
  inputStyle,
} from './components.jsx';
import { identifyPhoto, ANALYSIS_FEATURES } from './identifyPhoto.js';

/* ============================================================
   SPLASH
   ============================================================ */
export function SplashScreen({ onContinue }) {
  return (
    <div
      onClick={onContinue}
      style={{
        position: 'fixed', inset: 0, background: T.bgDeep,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, cursor: 'pointer', padding: 24,
      }}
    >
      <img
        src={brandAsset('logo_brand', `${import.meta.env.BASE_URL}brand/reelintel-brand.png`)}
        alt="ReelIntel — identify, check rules, log catch, find better spots. Built for the Gulf of America."
        style={{ maxWidth: 'min(92vw, 460px)', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
      />
      <div style={{ position: 'absolute', bottom: 30, color: T.inkMute, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
        Tap to continue
      </div>
    </div>
  );
}

/* ============================================================
   HOME
   ============================================================ */
const FEATURED_IDS = ['red_snapper', 'king_mackerel', 'gag_grouper', 'mahi', 'greater_amberjack', 'cobia', 'wahoo'];

function regForSpecies(id, jurId) {
  const byJur = REGULATIONS[id];
  if (!byJur) return null;
  return byJur[jurId] || byJur.fed_gulf || Object.values(byJur)[0] || null;
}

const STATUS_TEXT = {
  open:     { label: 'Season Open',   color: T.open },
  closed:   { label: 'Season Closed', color: T.closed },
  upcoming: { label: 'Opens Soon',    color: T.warn },
  caution:  { label: 'Season Open',   color: T.open },
  unknown:  { label: 'Confirm Source', color: T.inkSoft },
};

// Action tile used in the horizontally scrolling quick-actions row on
// home. Fixed flex-basis so each tile keeps a comfortable size and the
// row scrolls instead of squeezing.
function QuickTile({ icon, titleA, titleB, subtitle, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: '0 0 168px',
      background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 18,
      padding: '16px 14px 14px', cursor: 'pointer', textAlign: 'left',
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 176,
      scrollSnapAlign: 'start',
      boxShadow: '0 0 0 1px rgba(25, 212, 242, 0.05) inset',
    }}>
      <div style={{ color: T.brass, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, lineHeight: 1.18, letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {titleA}
        {titleB && <><br />{titleB}</>}
      </div>
      <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.4, flex: 1 }}>{subtitle}</div>
      <ChevronRight size={16} color={T.brass} style={{ alignSelf: 'flex-end' }} />
    </button>
  );
}

function ConditionStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.4, color: T.inkMute, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, color: T.ink, fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function SectionHead({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 2px 10px' }}>
      <SectionLabel style={{ color: T.inkSoft }}>{children}</SectionLabel>
      {action && (
        <button onClick={onAction} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 1, cursor: 'pointer', padding: 0 }}>
          {action}
        </button>
      )}
    </div>
  );
}

function FeaturedCard({ species, status, bag, onClick }) {
  const st = STATUS_TEXT[status] || STATUS_TEXT.unknown;
  const bagLabel = bag != null ? `Bag Limit: ${bag}` : 'No Bag Limit';
  return (
    <button onClick={onClick} style={{
      flex: '0 0 168px', background: T.card, border: `1px solid ${T.cardEdge}`,
      borderRadius: 14, padding: 10, cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        position: 'relative', borderRadius: 10, height: 116, marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
        boxShadow: `inset 0 0 0 1px ${T.cardEdge}`,
      }}>
        <SpeciesImage species={species} size={150} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {species.commonName}
      </div>
      <div style={{ fontSize: 12.5, color: st.color, fontWeight: 700, marginTop: 4 }}>{st.label}</div>
      <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{bagLabel}</div>
    </button>
  );
}

function ScrollDots({ count, active }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: i === active ? T.brass : 'rgba(148, 163, 184, 0.35)',
          display: 'inline-block',
        }} />
      ))}
    </div>
  );
}

export function HomeScreen({
  state, jurisdiction, stale, screenSize, onChangeJurisdiction,
  onIdentify, onRegulations, onReport, onSpecies, onSpeciesList, onPBs,
  onCompare, onRegulationAlerts, onQuiz, onLogMenu, onPatterns,
}) {
  const isTablet = screenSize === 'tablet' || screenSize === 'tablet-landscape';
  const jurId = jurisdiction?.id || 'fed_gulf';
  const featured = FEATURED_IDS
    .map(id => {
      const s = speciesById(id);
      if (!s) return null;
      const r = regForSpecies(id, jurId);
      return { s, status: r ? seasonState(r.open).status : 'unknown', bag: r?.bagLimit };
    })
    .filter(Boolean);
  const anyClosed = featured.some(f => f.status === 'closed');

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Current Location */}
      <Card style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 14 }}>
        <div style={{ color: T.brass, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}>
          <MapPin size={22} strokeWidth={2.2} />
        </div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, letterSpacing: 1.6, color: T.brass, fontWeight: 800 }}>CURRENT LOCATION</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {jurisdiction ? jurisdiction.name : 'Select fishing waters'}
          </div>
          <div style={{ fontSize: 10.5, color: T.inkMute, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {jurisdiction ? jurisdiction.agency : 'Tap change to pick your waters'}
          </div>
        </div>
        <button onClick={onChangeJurisdiction} style={{
          background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
          padding: '5px 10px', borderRadius: 7, fontSize: 10.5, fontWeight: 800,
          letterSpacing: 1.3, cursor: 'pointer', textTransform: 'uppercase', flexShrink: 0,
        }}>Change</button>
      </Card>

      {stale && (
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 12 }}>
          <AlertTriangle size={20} color={T.warn} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: T.ink }}>
            <strong>Regulations data is more than 7 days old.</strong> Connect to internet when possible to refresh.
          </div>
        </Card>
      )}

      {/* Hero — Identify Your Catch.
          Content drives height; the image fills the resulting card via
          object-fit cover, with a left-side gradient keeping the
          headline legible without dimming the fish. */}
      <div style={{
        position: 'relative', marginTop: 14, borderRadius: 18, overflow: 'hidden',
        border: `1px solid ${T.cardEdge}`,
        background: '#031B33',
      }}>
        <img
          src={brandAsset('hero_tuna', `${import.meta.env.BASE_URL}brand/hero-tuna.png`)}
          alt=""
          aria-hidden
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'left center',
            pointerEvents: 'none', display: 'block',
          }}
        />
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          background: 'linear-gradient(90deg, #031B33 0%, rgba(3, 27, 51, 0.94) 22%, rgba(3, 27, 51, 0.55) 38%, rgba(3, 27, 51, 0) 58%)',
          pointerEvents: 'none',
        }} />

        <div style={{ position: 'relative', padding: '20px 18px 18px', maxWidth: 270 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, letterSpacing: 1.2 }}>BUILD YOUR</div>
          <div style={{
            fontSize: 40, fontWeight: 900, color: T.brass, letterSpacing: 2,
            lineHeight: 1, marginTop: 2,
            textShadow: '0 0 22px rgba(25, 212, 242, 0.45)',
            fontFamily: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
          }}>FISHING MAP</div>
          <div style={{ fontSize: 13.5, color: T.ink, lineHeight: 1.4, marginTop: 12, maxWidth: 220 }}>
            Save photos, species, GPS, and conditions—then use your log to find better spots.
          </div>
          <button onClick={onLogMenu || onReport} style={{
            marginTop: 14, background: T.brass, color: T.oceanDeep, border: 'none',
            padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
            letterSpacing: 1.6, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 10,
            boxShadow: '0 8px 24px rgba(25, 212, 242, 0.35)',
          }}>
            <Camera size={16} strokeWidth={2.4} /> LOG YOUR CATCH
          </button>
        </div>
      </div>

      {/* Quick Actions — phone: horizontally scrolling row so tiles
          keep a comfortable width; tablet: 2x2 grid using the extra
          screen real estate so all tiles are visible at once. */}
      <div
        className={isTablet ? undefined : 'kyc-hscroll'}
        style={isTablet ? {
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
          margin: '14px 0 0',
        } : {
          display: 'flex', gap: 10,
          overflowX: 'auto', overflowY: 'hidden',
          margin: '14px -16px 0', padding: '0 16px 6px',
          scrollSnapType: 'x proximity',
        }}
      >
        <QuickTile
          icon={<BarChart2 size={28} strokeWidth={1.8} />}
          titleA="PATTERNS"
          subtitle="What's working in your log"
          onClick={onPatterns}
        />
        <QuickTile
          icon={<Camera size={28} strokeWidth={1.8} />}
          titleA="FISH" titleB="ID"
          subtitle="Point, shoot, get the species"
          onClick={onIdentify}
        />
        <QuickTile
          icon={<ClipboardList size={28} strokeWidth={1.8} />}
          titleA="CHECK" titleB="REGULATIONS"
          subtitle="Rules, limits, and seasons"
          onClick={onRegulations}
        />
        <QuickTile
          icon={<Sparkles size={28} strokeWidth={1.8} />}
          titleA="FISH ID" titleB="QUIZ"
          subtitle="Test your ID, limits, and seasons"
          onClick={onQuiz}
        />
      </div>

      {/* Conditions + Regulation Alerts — both cards sized to their natural
          content with breathing room. The whole row scrolls horizontally
          so neither card has to squeeze itself into half-width. */}
      <div
        className="kyc-hscroll"
        style={{
          display: 'flex', gap: 12, marginTop: 14,
          overflowX: 'auto', overflowY: 'hidden',
          margin: '14px -16px 0', padding: '0 16px 6px',
          scrollSnapType: 'x proximity',
        }}
      >
        {/* Conditions */}
        <Card style={{
          flex: '0 0 320px', padding: 14, borderRadius: 18,
          display: 'flex', flexDirection: 'column', scrollSnapAlign: 'start',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 11, color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>TODAY'S CONDITIONS</span>
            <button onClick={onRegulations} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 10, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW FORECAST</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <CloudSun size={32} color={T.warn} strokeWidth={1.8} />
              <div style={{ fontSize: 26, fontWeight: 900, color: T.ink, marginTop: 4, lineHeight: 1 }}>82°</div>
              <div style={{ fontSize: 10, color: T.inkMute, marginTop: 4, whiteSpace: 'nowrap' }}>Partly Cloudy</div>
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <ConditionStat label="WIND"     value="SE 14 mph" />
              <ConditionStat label="WATER"    value="79°" />
              <ConditionStat label="WAVES"    value="2.1 ft" />
              <ConditionStat label="PRESSURE" value="30.12 in" />
            </div>
          </div>
        </Card>

        {/* Regulation Alerts */}
        <Card style={{
          flex: '0 0 320px', padding: 14, borderRadius: 18,
          display: 'flex', flexDirection: 'column', scrollSnapAlign: 'start',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 11, color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>REGULATION ALERTS</span>
            <button onClick={onRegulationAlerts || onRegulations} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 10, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW ALL</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <ShieldCheck size={36} color={anyClosed ? T.warn : T.open} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: T.ink, fontWeight: 800, lineHeight: 1.25 }}>
                {anyClosed ? 'Active closure' : 'No Active Closures'}
              </div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.4 }}>
                {anyClosed
                  ? 'A featured species is closed in these waters.'
                  : `All clear in ${jurisdiction ? jurisdiction.name : 'these waters'}.`}
              </div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8, lineHeight: 1.4 }}>
                Always check before you head out.
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Featured Species */}
      <Card style={{ marginTop: 14, padding: 14, borderRadius: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: T.ink, fontWeight: 800, letterSpacing: 1.2 }}>FEATURED SPECIES</span>
          <button onClick={onSpeciesList} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 10, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0 }}>VIEW ALL</button>
        </div>
        <div className="kyc-hscroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, margin: '0 -14px', padding: '0 14px 4px' }}>
          {featured.map(f => (
            <FeaturedCard key={f.s.id} species={f.s} status={f.status} bag={f.bag} onClick={() => onSpecies(f.s.id)} />
          ))}
        </div>
        <ScrollDots count={Math.min(featured.length, 4)} active={0} />
      </Card>

      {/* My Personal Bests */}
      <button onClick={onPBs} style={{
        marginTop: 14, width: '100%',
        background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 18,
        padding: '16px 14px', cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Trophy size={28} color={T.brass} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, letterSpacing: 1.3 }}>MY PERSONAL BESTS</div>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>View your top catches and milestones</div>
        </div>
        {state?.pbs && Object.keys(state.pbs).length > 0 && (
          <span style={{ background: T.brass, color: T.oceanDeep, fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 999 }}>
            {Object.keys(state.pbs).length}
          </span>
        )}
        <ChevronRight size={18} color={T.brass} />
      </button>

      <div style={{ marginTop: 22, padding: '14px 12px', borderTop: `1px solid ${T.cardEdge}`, fontSize: 11, color: T.inkMute, textAlign: 'center' }}>
        ReelIntel · Built for the Gulf of America · v{DATA_VERSION}
      </div>
    </div>
  );
}

/* ============================================================
   IDENTIFY — photo-first
   ============================================================ */
export function IdentifyScreen({ onPhoto, onBrowse, onSearch }) {
  const fileRef = useRef(null);

  // When user picks/captures a photo, read it as base64 and hand to onPhoto.
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onPhoto(reader.result); // data URL
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={24} style={{ marginBottom: 6 }}>Fish ID</H1>
      <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
        Take or upload a photo to identify your catch.
      </p>

      {/* Primary photo capture card */}
      <button onClick={() => fileRef.current?.click()} style={{
        width: '100%', background: T.oceanDeep, color: T.parchment,
        border: `2px solid ${T.brass}`, borderRadius: 6, padding: '28px 18px',
        cursor: 'pointer', textAlign: 'center', marginBottom: 18,
        boxShadow: '0 2px 0 rgba(124, 86, 24, 0.15)',
      }}>
        <div style={{ background: T.brass, color: T.oceanDeep, width: 72, height: 72, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Camera size={36} />
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 600 }}>Photo identification</div>
        <div style={{ fontSize: 12, color: '#B8C5CD', marginTop: 4 }}>Take a photo or pick from your library</div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 14px', color: T.inkMute }}>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
        <SectionLabel style={{ fontSize: 11 }}>or identify manually</SectionLabel>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <BigButton onClick={onBrowse} icon={<Layers size={24} />} title="Browse by category" subtitle="Snapper, grouper, mackerel, jacks…" />
        <BigButton onClick={onSearch} icon={<Search size={24} />} title="Search by name" subtitle="Common names, scientific, regional" />
      </div>
    </div>
  );
}

/* ============================================================
   LOG MENU — three ways to log a catch
   ============================================================ */
export function LogMenuScreen({ onQuickLog, onIdentify, onUploadPhoto }) {
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={24} style={{ marginBottom: 6 }}>Log your catch</H1>
      <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: 18 }}>
        Three ways to add a catch to your logbook.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <BigButton
          onClick={onQuickLog}
          icon={<Camera size={24} />}
          title="Quick log"
          subtitle="Take photo, get back to fishing — we'll fill in the rest"
        />
        <BigButton
          onClick={onIdentify}
          icon={<Sparkles size={24} />}
          title="Fish ID"
          subtitle="Identify and log your catch"
        />
        <BigButton
          onClick={onUploadPhoto}
          icon={<ImageIcon size={24} />}
          title="Upload photo"
          subtitle="Log a fish you already caught from a saved photo"
        />
      </div>
    </div>
  );
}

/* ============================================================
   QUICK LOG — camera-first, everything else in the background
   ============================================================
   Opens native camera immediately. On capture we save the catch with
   whatever environmental data we can gather in a bounded time:
     - GPS is satellite-based → works offline. 10s timeout / skip on
       permission denial. If nothing comes back, lat/lon stay null.
     - Sun + moon are pure math from the timestamp + lat/lon; always
       computed when GPS returned coords.
     - Weather (open-meteo) is the only step that needs internet. 5s
       AbortController budget; anything longer commits weather=null.
   The catch persists with status:'quick' so the Logbook can flag it
   and prompt the angler to fill in species / measurements later. */
export function QuickLogScreen({ state, jurisdiction, update, onDone, onCancel }) {
  const [phase, setPhase] = React.useState('opening'); // opening | saving | done | cancelled
  const [err, setErr] = React.useState(null);
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let alive = true;
    (async () => {
      try {
        const dataUrl = await getPhoto({ cameraOnly: true });
        if (!alive) return;
        if (!dataUrl) { setPhase('cancelled'); onCancel && onCancel(); return; }
        setPhase('saving');

        // Kick off GPS + weather in parallel with the photo downscale
        // so nothing sits idle. Each has its own timeout so a slow one
        // doesn't stall the save.
        const gpsPromise = getLocation({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
          .then(pos => ({ lat: pos.lat, lon: pos.lon }))
          .catch(() => ({ lat: null, lon: null }));

        const downscaled = await downscaleImageDataUrl(dataUrl);
        const photoEntry = await savePhoto(downscaled);

        const { lat, lon } = await gpsPromise;
        const when = new Date();

        // Weather via the shared helper — Quick Log is always "now"
        // so it'll hit the live branch, but keeping the same call
        // site as backdated uploads means one path to test + fix.
        const weather = await fetchWeatherForTime({ lat, lon, when });
        const sun = lat != null && lon != null ? sunPosition(when, lat, lon) : null;
        const moon = moonPhase(when);

        const entry = {
          id: `catch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          status: 'quick',
          speciesId: null,
          dateIso: when.toISOString(),
          lat, lon,
          length: null,
          weight: null,
          notes: null,
          photos: [photoEntry],
          photo: photoEntry,
          jurisdiction: jurisdiction?.id || null,
          sunAlt: sun ? sun.altitudeDeg : null,
          sunAz:  sun ? sun.azimuthDeg  : null,
          moonPhase: moon.phase,
          moonIllum: moon.illumination,
          moonName: moon.name,
          weather,
        };
        update({ catchLog: [entry, ...(state.catchLog || [])] });
        if (!alive) return;
        setPhase('done');
        onDone && onDone(entry);
      } catch (e) {
        setErr(e?.message || 'Quick log failed');
        setPhase('cancelled');
        onCancel && onCancel();
      }
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      minHeight: 'calc(100vh - 168px)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center',
    }}>
      <div>
        <div style={{ fontSize: 13, letterSpacing: 2, color: T.brass, fontWeight: 800, marginBottom: 12 }}>
          {phase === 'opening' ? 'OPENING CAMERA…'
            : phase === 'saving' ? 'SAVING CATCH…'
            : phase === 'done' ? 'LOGGED' : 'CANCELLED'}
        </div>
        <div style={{ fontSize: 13, color: T.inkSoft, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>
          {phase === 'saving' ? 'Fetching GPS, sun, and weather in the background — this only takes a moment.'
            : phase === 'done' ? 'Back to fishing.'
            : phase === 'cancelled' ? 'No photo taken.'
            : 'Point the camera at your fish and shoot.'}
        </div>
        {err && <div role="alert" style={{ marginTop: 12, fontSize: 12, color: T.closed }}>{err}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — analyzing
   ============================================================ */
export function PhotoAnalyzingScreen({ imageDataUrl, onResult }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let alive = true;
    const stepTimer = setInterval(() => {
      setStep(s => (s + 1) % ANALYSIS_FEATURES.length);
    }, 500);
    identifyPhoto(imageDataUrl).then(result => {
      if (!alive) return;
      clearInterval(stepTimer);
      onResult(result);
    });
    return () => { alive = false; clearInterval(stepTimer); };
  }, [imageDataUrl, onResult]);

  return (
    <div style={{ position: 'relative', minHeight: '70vh' }}>
      <div style={{ position: 'relative' }}>
        <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', display: 'block', maxHeight: '50vh', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(8,38,53,0.0) 40%, rgba(8,38,53,0.85) 100%)' }} />
      </div>
      <div style={{ padding: '20px 18px', background: T.oceanDeep, color: T.parchment }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Sparkles size={20} color={T.brass} />
          <H1 size={20} style={{ color: T.parchment }}>Analyzing photo…</H1>
        </div>
        <SectionLabel style={{ color: T.brass, marginBottom: 10 }}>Examining features</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ANALYSIS_FEATURES.map((f, i) => (
            <div key={i} style={{
              fontSize: 13, color: i <= step ? T.parchment : '#7A8B96',
              transition: 'color 0.3s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i <= step ? T.brass : '#3B4A57',
                display: 'inline-block', transition: 'background 0.3s',
              }} />
              {f}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18, fontSize: 11, color: '#7A8B96', fontStyle: 'italic', textAlign: 'center' }}>
          On-device analysis · no internet required
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — result
   ============================================================ */
export function PhotoResultScreen({ result, imageDataUrl, onPickSpecies, onLogCatch, onRetake, onManual }) {
  const { confidence, candidates } = result || {};

  if (!candidates || candidates.length === 0 || confidence === 'low') {
    return (
      <div style={{ padding: '18px 16px' }}>
        <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginBottom: 14, border: `2px solid ${T.cardEdge}` }} />
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle size={22} color={T.warn} />
            <div>
              <div style={{ fontWeight: 700, color: T.brassDeep, fontSize: 14 }}>Couldn't identify confidently</div>
              <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                The image was too uncertain to commit to a species. Try a clearer photo, or identify manually.
              </div>
            </div>
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={onRetake}><RotateCcw size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</PrimaryButton>
          <GhostButton onClick={onManual} style={{ width: '100%' }}>Identify manually instead</GhostButton>
        </div>
      </div>
    );
  }

  // HIGH confidence — confirmed result for top candidate
  if (confidence === 'high') {
    const top = candidates[0];
    const s = speciesById(top.speciesId);
    return (
      <div style={{ padding: '14px 14px' }}>
        <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', marginBottom: 12, border: `2px solid ${T.brass}` }}>
          <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 14px 12px', background: 'linear-gradient(to top, rgba(8,38,53,0.92), transparent)', color: T.parchment }}>
            <SectionLabel style={{ color: T.brass }}>Confirmed</SectionLabel>
            <H1 size={22} style={{ color: T.parchment, marginTop: 2 }}>{s?.commonName || top.speciesId}</H1>
            <div style={{ fontStyle: 'italic', fontSize: 12, color: '#B8C5CD' }}>{s?.scientific}</div>
          </div>
        </div>

        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 8 }}>What we saw</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 14, lineHeight: 1.55 }}>
            {top.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>

        {s?.lookalikes?.length > 0 && (
          <Card style={{ marginBottom: 12, background: T.parchmentDeep, borderColor: T.brass }}>
            <SectionLabel style={{ marginBottom: 6 }}>Confirm with your eyes</SectionLabel>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10 }}>
              Even a confident match can be wrong on lookalikes. Glance at these — does one fit better?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.lookalikes.map(otherId => {
                const o = speciesById(otherId);
                if (!o) return null;
                return (
                  <button key={otherId} onClick={() => onPickSpecies(otherId)} style={{
                    background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, padding: '8px 10px',
                    borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}>
                    <SpeciesImage species={o} size={32} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: T.ink }}>It's a {o.commonName}</div>
                      <div style={{ fontSize: 11, color: T.inkMute }}>Tap to switch</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {onLogCatch && (
            <PrimaryButton onClick={() => onLogCatch(top.speciesId)}>Log this catch</PrimaryButton>
          )}
          <GhostButton onClick={() => onPickSpecies(top.speciesId)} style={{ width: '100%' }}>See full details & regulations</GhostButton>
          <GhostButton onClick={onRetake} style={{ width: '100%' }}><RotateCcw size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</GhostButton>
        </div>
      </div>
    );
  }

  // MEDIUM confidence — narrowed-to-N disambiguation
  return (
    <div style={{ padding: '14px 14px' }}>
      <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, marginBottom: 12, border: `2px solid ${T.cardEdge}` }} />
      <SectionLabel style={{ marginBottom: 4 }}>Not confident enough to confirm</SectionLabel>
      <H1 size={22} style={{ marginBottom: 4 }}>Narrowed to {candidates.length}</H1>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5 }}>
        Pick the one that matches your fish. Tap a card to see full details and the discriminating features.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {candidates.map(c => {
          const s = speciesById(c.speciesId);
          if (!s) return null;
          return (
            <Card key={c.speciesId} onClick={() => onPickSpecies(c.speciesId)} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <SpeciesImage species={s} size={50} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                {c.evidence?.length > 0 && (
                  <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4, lineHeight: 1.35 }}>{c.evidence.join(' · ')}</div>
                )}
              </div>
              <ChevronRight size={18} color={T.brass} />
            </Card>
          );
        })}
      </div>
      <GhostButton onClick={onRetake} style={{ width: '100%', marginBottom: 8 }}><RotateCcw size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</GhostButton>
      <GhostButton onClick={onManual} style={{ width: '100%' }}>It's none of these — identify manually</GhostButton>
    </div>
  );
}

/* ============================================================
   CATEGORIES & CATEGORY
   ============================================================ */
// Representative species for each category's browse tile. Chosen as the
// most iconic Gulf-of-America (or, for non-Gulf categories, the most
// recognisable) member with a NOAA photo on file. If a representative
// has no photo, the tile falls back to the first species in the
// category that does.
const CATEGORY_REP_SPECIES = {
  snapper:  'red_snapper',
  grouper:  'red_grouper',
  tilefish: 'golden_tilefish',
  jacks:    'greater_amberjack',
  mackerel: 'king_mackerel',
  tuna:     'yellowfin_tuna',
  billfish: 'swordfish',
  trigger:  'gray_triggerfish',
  sharks:   'blacktip_shark',
  cobia:    'cobia',
  wahoo:    'wahoo',
  cod:      'atlantic_cod',
  sturgeon: 'atlantic_sturgeon',
  flatfish: 'summer_flounder',
  bait:     'atlantic_menhaden',
  reef:     'mahi',
};

export function CategoriesScreen({ onPick }) {
  const counts = useMemo(() => {
    const map = {};
    SPECIES.forEach(s => { map[s.category] = (map[s.category] || 0) + 1; });
    return map;
  }, []);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Browse by category</H1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {CATEGORIES.map(c => {
          const repId = CATEGORY_REP_SPECIES[c.id];
          const rep = (repId && speciesById(repId))
            || SPECIES.find(s => s.category === c.id) // fallback: first in category
            || null;
          return (
            <Card key={c.id} onClick={() => onPick(c.id)} style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                height: 110,
                background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {rep ? (
                  <SpeciesImage species={rep} size={180} style={{ borderRadius: 0, height: 110 }} />
                ) : null}
              </div>
              <div style={{ padding: '10px 12px 12px' }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 700, color: T.ink }}>{c.name}</div>
                <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{counts[c.id] || 0} species</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryScreen({ catId, state, update, onPick }) {
  const cat = CATEGORIES.find(c => c.id === catId);
  const favSet = useMemo(() => new Set(state?.favorites || []), [state?.favorites]);
  const toggleFav = (id) => {
    if (!update) return;
    const next = new Set(favSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ favorites: Array.from(next) });
  };
  const list = useMemo(() => {
    const base = SPECIES.filter(s => s.category === catId)
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    return base.sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));
  }, [catId, favSet]);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>{cat?.name || 'Category'}</H1>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 14 }}>{list.length} species</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(s => <SpeciesRow key={s.id} species={s} onClick={() => onPick(s.id)} favorited={favSet.has(s.id)} onToggleFavorite={() => toggleFav(s.id)} />)}
      </div>
    </div>
  );
}

/* ============================================================
   SEARCH
   ============================================================ */
export function SearchScreen({ state, onPick }) {
  const [q, setQ] = useState('');
  const favSet = useMemo(() => new Set(state?.favorites || []), [state?.favorites]);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase().trim();
    return SPECIES.map(s => {
      let score = 0; let matchedAlt = null;
      if (s.commonName.toLowerCase().includes(lower)) score += 10;
      if (s.scientific.toLowerCase().includes(lower)) score += 5;
      s.altNames.forEach(a => {
        if (a.toLowerCase().includes(lower)) { score += 8; matchedAlt = a; }
      });
      if (s.category.toLowerCase().includes(lower)) score += 2;
      if (favSet.has(s.id)) score += 1; // tie-breaker: starred fish surface first
      return { s, score, matchedAlt };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  }, [q, favSet]);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Search</H1>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={18} color={T.inkMute} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Type a fish name…"
          style={{ ...inputStyle, paddingLeft: 38, fontSize: 15, background: T.card }}
        />
      </div>
      {!q && (
        <div style={{ fontSize: 13, color: T.inkMute, padding: '20px 12px', textAlign: 'center', background: T.parchmentDeep, borderRadius: 4 }}>
          Try "snapper," "mahi," "kingfish," "mangrove," or any Gulf species name.
        </div>
      )}
      {q && results.length === 0 && (
        <div style={{ fontSize: 13, color: T.inkMute, padding: 12 }}>No matches. Try a different spelling or category.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(r => (
          <Card key={r.s.id} onClick={() => onPick(r.s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <SpeciesImage species={r.s} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600 }}>{r.s.commonName}</div>
              {r.matchedAlt && <div style={{ fontSize: 11, color: T.brassDeep }}>also: {r.matchedAlt}</div>}
              <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{r.s.scientific}</div>
            </div>
            <ChevronRight size={18} color={T.brass} />
          </Card>
        ))}
      </div>
    </div>
  );
}
