import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fish, Search, ChevronRight, AlertTriangle, Plus, Pencil, BookOpen,
  Trophy, Camera, Trash2, Mail, Anchor, ListChecks, Wrench, Layers, X,
  RotateCcw, Image as ImageIcon, Sparkles, ArrowLeft, Check, Flag,
  MapPin, Ruler, ClipboardList, CloudSun, Wind, Waves, Thermometer,
  CheckCircle2, ShieldCheck, MoreHorizontal, BarChart2, Share2, Shuffle,
  Crosshair, Save as SaveIcon,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, CATEGORIES, SPECIES,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { regulationFor } from './regulations-store.js';
import { defaultState, saveState } from './storage.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, seasonState,
  sunPosition, moonPhase, fetchWeatherForTime, catchPhotos,
  pbPhotos, buildPBReport, shareReport,
} from './helpers.js';
import { brandAsset } from './brand-store.js';
import { useScreenSize } from './screen-size.js';
import { getCategories, subscribe as subscribeCategories } from './categories-store.js';
import { getLocation, getPhoto } from './native.js';
import { savePhoto, photoThumbUrl, photoDisplayUrl, photoAsDataUrl } from './photos-store.js';
import {
  StatusPill, SpeciesImage, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, BigButton, SpeciesRow,
  PhotoImg,
  inputStyle,
} from './components.jsx';
import { identifyPhoto, ANALYSIS_FEATURES } from './identifyPhoto.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';
import { SpeciesPickerModal } from './admin/pickers.jsx';

/* ============================================================
   SPLASH
   ============================================================
   Two modes:
    - showLogin=false: plain hold-splash (session exists, warming
      the UI for 2.2s). Tap or timer dismisses.
    - showLogin=true:  splash + login CTAs (Sign in / Create account).
      No auto-dismiss, no "continue without signing in" — session
      presence IS the gate to the app. The angler must complete the
      magic-link roundtrip to progress. */
export function SplashScreen({
  onContinue,
  showLogin = false,
  onSignIn,
  onCreateAccount,
}) {
  const showCTAs = !!showLogin;
  return (
    <div
      onClick={showCTAs ? undefined : onContinue}
      style={{
        position: 'fixed', inset: 0, background: T.bgDeep,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: showCTAs ? 'flex-start' : 'center',
        zIndex: 200, cursor: showCTAs ? 'default' : 'pointer', padding: 24,
        paddingTop: showCTAs ? 'max(env(safe-area-inset-top), 32px)' : 24,
        paddingBottom: showCTAs ? 'max(env(safe-area-inset-bottom), 24px)' : 24,
        overflowY: 'auto',
      }}
    >
      <img
        src={brandAsset('logo_brand', `${import.meta.env.BASE_URL}brand/reelintel-brand.png`)}
        alt="ReelIntel — identify, check rules, log catch, find better spots. Built for the Gulf of America."
        style={{
          maxWidth: 'min(92vw, 460px)',
          maxHeight: showCTAs ? '54vh' : '82vh',
          objectFit: 'contain', display: 'block',
          marginTop: showCTAs ? 12 : 0,
        }}
      />

      {showCTAs ? (
        <div style={{
          marginTop: 28, width: '100%', maxWidth: 340,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <PrimaryButton onClick={onSignIn}>
            Sign in
          </PrimaryButton>
          <GhostButton onClick={onCreateAccount} style={{ borderColor: T.brass, color: T.brass }}>
            Create an account
          </GhostButton>
          <div style={{
            fontSize: 12, color: T.inkMute, textAlign: 'center', lineHeight: 1.5,
            marginTop: 10, padding: '0 12px',
          }}>
            Sign in syncs your catches, PBs, and photos across your iPhone and iPad.
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', bottom: 30, color: T.inkMute, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' }}>
          Loading…
        </div>
      )}
    </div>
  );
}

/* ============================================================
   HOME
   ============================================================ */
const FEATURED_IDS = ['red_snapper', 'king_mackerel', 'gag_grouper', 'mahi', 'greater_amberjack', 'cobia', 'wahoo'];

function regForSpecies(id, jurId) {
  // Prefer the exact jurisdiction, then federal Gulf, then any
  // verified/bundled row we can find. regulationFor() walks the
  // verified Supabase overlay → bundled precedence per lookup.
  const primary = regulationFor(id, jurId).regulation;
  if (primary) return primary;
  const fed = regulationFor(id, 'fed_gulf').regulation;
  if (fed) return fed;
  return null;
}

const STATUS_TEXT = {
  open:     { label: 'Season Open',   color: T.open },
  closed:   { label: 'Season Closed', color: T.closed },
  upcoming: { label: 'Opens Soon',    color: T.warn },
  caution:  { label: 'Season Open',   color: T.open },
  unknown:  { label: 'Season varies', color: T.inkSoft },
};

// Action tile used in the horizontally scrolling quick-actions row on
// home. Fixed flex-basis so each tile keeps a comfortable size and the
// row scrolls instead of squeezing.
//
// Layout — always the same, whether or not a background image is set:
//   - Icon: top-left. When bgImage is set, gets a drop-shadow so it
//     stays legible over any artwork; otherwise plain cyan on the
//     card's dark background.
//   - Title stack (titleA / optional titleB): bottom-left, bold
//     uppercase.
//   - Subtitle: below title stack, one line.
//   - Chevron: bottom-right.
// When bgImage is set:
//   - <img> covers the tile via absolute inset:0 + objectFit:cover.
//   - A dark bottom-anchored gradient scrim (transparent top → dark
//     bottom) sits between the image and the text so titles stay
//     legible without dimming the artwork.
//   - If the image fails to load, we fall back to the flat
//     card-background layout so a missing asset doesn't ship a blank
//     tile.
function QuickTile({ icon, titleA, titleB, subtitle, onClick, bgImage, alt, isTablet = false }) {
  const hasBg = !!bgImage;
  const [bgFailed, setBgFailed] = React.useState(false);
  const usingBg = hasBg && !bgFailed;

  const textShadow = usingBg
    ? '0 1px 3px rgba(0,0,0,0.85), 0 0 12px rgba(0,0,0,0.55)'
    : 'none';
  const iconShadow = usingBg
    ? 'drop-shadow(0 1px 3px rgba(0,0,0,0.7)) drop-shadow(0 0 8px rgba(25,212,242,0.35))'
    : 'none';

  // Tablet: tile container is locked to the artwork's native 4:5
  // aspect ratio (600×750). With object-fit:cover and matched aspect,
  // no cropping happens — the full illustration renders. Titles scale
  // down slightly because the 4-column grid gives each tile ~1/4 of
  // the container width.
  const tileFlex         = isTablet ? undefined : '0 0 168px';
  const tileAspectRatio  = isTablet ? '4 / 5' : undefined;
  const tileMinHeight    = isTablet ? undefined : 176;
  const tileBorderRadius = isTablet ? 20 : 18;
  const bgFit            = 'cover';
  const bgPosition       = 'top';
  const bgBackground     = usingBg ? T.oceanDeep : T.card;
  const titleFontSize    = isTablet ? 17 : 15;
  const subtitleFontSize = isTablet ? 13 : 12;
  const iconInset        = isTablet ? 12 : 14;
  const textInset        = isTablet ? 12 : 14;
  const textBottom       = isTablet ? 10 : 12;
  const chevronBottom    = isTablet ? 10 : 12;
  const chevronRight     = isTablet ? 10 : 12;
  const chevronSize      = isTablet ? 18 : 18;

  return (
    <button onClick={onClick} style={{
      flex: tileFlex,
      position: 'relative',
      background: bgBackground,
      border: `1px solid ${T.cardEdge}`, borderRadius: tileBorderRadius,
      padding: 0, cursor: 'pointer', textAlign: 'left',
      aspectRatio: tileAspectRatio,
      minHeight: tileMinHeight,
      scrollSnapAlign: 'start',
      boxShadow: '0 0 0 1px rgba(25, 212, 242, 0.05) inset',
      overflow: 'hidden',
    }}>
      {usingBg && (
        <>
          <img
            src={bgImage}
            alt={alt || ''}
            loading="eager"
            onError={() => setBgFailed(true)}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: bgFit, objectPosition: bgPosition,
              display: 'block', userSelect: 'none',
              pointerEvents: 'none',
            }}
          />
          {/* Bottom-anchored gradient scrim keeps the title stack
              legible over any artwork focal point. Light at the top so
              the icon area shows the illustration; dark at the bottom
              where the copy lives. */}
          <div aria-hidden="true" style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(3,10,25,0) 0%, rgba(3,10,25,0.15) 45%, rgba(3,10,25,0.80) 100%)',
            pointerEvents: 'none',
          }} />
        </>
      )}

      {/* Icon — top-left. Only shown in the fallback (no-bg) state;
          the tile artwork already bakes in the icon. */}
      {!usingBg && (
        <div style={{
          position: 'absolute', top: iconInset, left: iconInset,
          color: T.brass,
        }}>{icon}</div>
      )}

      {/* Title + subtitle — bottom-left. Uppercase title reads over
          the scrim; subtitle stays soft but with a subtle text-shadow
          so it doesn't disappear over a light patch. */}
      <div style={{
        position: 'absolute', left: textInset, right: chevronRight + chevronSize + 8, bottom: textBottom,
      }}>
        <div style={{
          fontSize: titleFontSize, fontWeight: 800, color: T.ink,
          lineHeight: 1.18, letterSpacing: 0.3, textTransform: 'uppercase',
          textShadow,
        }}>
          {titleA}
          {titleB && <><br />{titleB}</>}
        </div>
        {subtitle && (
          <div style={{
            fontSize: subtitleFontSize, color: usingBg ? '#D3E3EC' : T.inkMute,
            lineHeight: 1.4, marginTop: 4, textShadow,
          }}>{subtitle}</div>
        )}
      </div>

      {/* Chevron — bottom-right. */}
      <ChevronRight
        size={chevronSize}
        color={T.brass}
        style={{
          position: 'absolute', bottom: chevronBottom, right: chevronRight,
          filter: iconShadow,
        }}
      />
    </button>
  );
}

function ConditionStat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: 1.4, color: T.inkMute, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, color: T.ink, fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function SectionHead({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 2px 10px' }}>
      <SectionLabel style={{ color: T.inkSoft }}>{children}</SectionLabel>
      {action && (
        <button onClick={onAction} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: 'pointer', padding: 0 }}>
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
      <div style={{ fontSize: 17, fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {species.commonName}
      </div>
      <div style={{ fontSize: 14.5, color: st.color, fontWeight: 700, marginTop: 4 }}>{st.label}</div>
      <div style={{ fontSize: 14, color: T.inkMute, marginTop: 2 }}>{bagLabel}</div>
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
  onCapture, onSelectFromLibrary, onViewCatch, onViewCatches, onForecast,
  finishSetupVisible, onFinishSetup, onDismissFinishSetup,
}) {
  const isTablet = screenSize === 'tablet' || screenSize === 'tablet-landscape';
  const isLandscape = screenSize === 'tablet-landscape';
  const heroTilt = useTilt(12);
  // Recent catches strip below the quick-actions row. Show the 10
  // newest; hidden if the angler hasn't logged anything yet.
  const recentCatches = useMemo(() => {
    const list = (state.catchLog || []).slice();
    list.sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''));
    return list.slice(0, 10);
  }, [state.catchLog]);
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
      {/* Current Regulations — read-only display line above the hero.
          Jurisdiction switching moved to Settings → Waters. Anglers
          asked repeatedly for this to stop being a tappable card on
          home; keep it as a small header line. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 2px', marginBottom: 4,
      }}>
        <MapPin size={isTablet ? 18 : 15} strokeWidth={2.2} color={T.brass} style={{ flexShrink: 0 }} />
        <div style={{
          fontSize: isTablet ? 17 : 14, color: T.parchment, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1,
        }}>
          Current Regulations: <span style={{ color: T.ink, fontWeight: 800 }}>{jurisdiction?.name || '—'}</span>
        </div>
      </div>

      {stale && (
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 12 }}>
          <AlertTriangle size={20} color={T.warn} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 15, color: T.ink }}>
            <strong>Regulations data is more than 7 days old.</strong> Connect to internet when possible to refresh.
          </div>
        </Card>
      )}

      {finishSetupVisible && (
        <Card style={{
          background: T.parchmentDeep, borderColor: T.brass,
          marginTop: 12, display: 'flex', gap: 12, alignItems: 'center',
          borderRadius: 12, padding: 12,
        }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%',
            background: T.brass, color: T.oceanDeep,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>
              Finish setting up
            </div>
            <div style={{ fontSize: 14, color: T.inkMute, marginTop: 2, lineHeight: 1.4 }}>
              {!jurisdiction ? 'Pick your fishing waters to see regulations.'
                             : 'Tell us a bit about how you fish (optional).'}
            </div>
          </div>
          <button
            onClick={onFinishSetup}
            style={{
              background: T.brass, color: T.oceanDeep, border: 'none',
              padding: '7px 12px', borderRadius: 6,
              fontSize: 14, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Finish
          </button>
          <button
            onClick={onDismissFinishSetup}
            aria-label="Dismiss setup nudge"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.inkMute, padding: 4, display: 'flex', flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </Card>
      )}

      <AnnouncementBanner />

      {/* Hero — Identify Your Catch.
          Content drives height; the image fills the resulting card via
          object-fit cover, with a left-side gradient keeping the
          headline legible without dimming the fish. On iPad we bump
          font + padding sizes so the text block sits comfortably, and
          set a minHeight so the tuna has real vertical room and isn't
          cropped at the fin/tail. */}
      <div style={{
        position: 'relative', marginTop: 14, borderRadius: 18, overflow: 'hidden',
        border: `1px solid ${T.cardEdge}`,
        background: '#031B33',
        minHeight: isTablet ? (isLandscape ? 520 : 460) : undefined,
      }}>
        {/* Ken Burns drift on the wrapper + gyroscope tilt on the img so
            the tuna feels alive. Overscan hides the edges as it moves. */}
        <div aria-hidden className="kyc-kenburns" style={{
          position: 'absolute', inset: '-10%', pointerEvents: 'none',
        }}>
          <img
            src={brandAsset('hero_tuna', `${import.meta.env.BASE_URL}brand/hero-tuna.png`)}
            alt=""
            aria-hidden
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: '52% center',
              pointerEvents: 'none', display: 'block',
              transform: `translate(${heroTilt.x}px, ${heroTilt.y}px)`,
              transition: 'transform 120ms ease-out', willChange: 'transform',
            }}
          />
        </div>
        <div aria-hidden style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
          background: isTablet
            ? 'linear-gradient(90deg, #031B33 0%, rgba(3, 27, 51, 0.92) 28%, rgba(3, 27, 51, 0.50) 45%, rgba(3, 27, 51, 0) 65%)'
            : 'linear-gradient(90deg, #031B33 0%, rgba(3, 27, 51, 0.94) 22%, rgba(3, 27, 51, 0.55) 38%, rgba(3, 27, 51, 0) 58%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative',
          padding: isTablet ? '36px 32px 32px' : '20px 18px 18px',
          maxWidth: isTablet ? 500 : 320,
        }}>
          <div style={{
            fontSize: isTablet ? 19 : 13, fontWeight: 800, color: T.brass,
            letterSpacing: 1.4,
          }}>BUILD YOUR</div>
          {/* Two-line headline so the copy never overflows the fish
              art at narrow widths. Line-height ~0.95 keeps them
              feeling like one thought. */}
          <div style={{
            fontSize: isTablet ? (isLandscape ? 76 : 68) : 34, fontWeight: 900, color: T.ink,
            letterSpacing: 0.5, lineHeight: 0.95,
            marginTop: isTablet ? 10 : 4,
            fontFamily: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
          }}>
            <span style={{ display: 'block' }}>Log your</span>
            <span style={{ display: 'block' }}>catch</span>
          </div>
          <div style={{
            fontSize: isTablet ? 21 : 13.5, color: T.ink, lineHeight: 1.45,
            marginTop: isTablet ? 20 : 10,
            maxWidth: isTablet ? 480 : 260,
          }}>
            Snap your catch. We'll log the species, location, and conditions — and build your fishing map.
          </div>
          {/* Two-button row: primary Take Photo (camera-direct) + secondary
              Select Photo (library only). Both feed the same shared post-
              capture pipeline (identify → confirmation card → catch entry).
              The distinction is only which native picker fires. */}
          <div style={{ display: 'flex', gap: isTablet ? 14 : 10, marginTop: isTablet ? 22 : 14 }}>
            <button
              onClick={onCapture || onLogMenu || onReport}
              aria-label="Take a photo"
              style={{
                flex: 1, background: T.brass, color: T.oceanDeep, border: 'none',
                padding: isTablet ? '14px 18px' : '10px 12px', borderRadius: 10,
                fontSize: isTablet ? 15 : 12.5, fontWeight: 800,
                letterSpacing: 1.2, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                gap: isTablet ? 10 : 8,
                boxShadow: '0 8px 24px rgba(25, 212, 242, 0.30)',
                minHeight: isTablet ? 52 : 44,
              }}
            >
              <Camera size={isTablet ? 28 : 22} strokeWidth={2} /> TAKE PHOTO
            </button>
            <button
              onClick={onSelectFromLibrary || onLogMenu || onReport}
              aria-label="Select photo from library"
              style={{
                flex: 1, background: 'transparent', color: T.brass,
                border: `1.5px solid ${T.brass}`,
                padding: isTablet ? '14px 18px' : '10px 12px', borderRadius: 10,
                fontSize: isTablet ? 15 : 12.5, fontWeight: 800,
                letterSpacing: 1.2, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                gap: isTablet ? 10 : 8,
                minHeight: isTablet ? 52 : 44,
              }}
            >
              <ImageIcon size={isTablet ? 28 : 22} strokeWidth={2} /> SELECT PHOTO
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions — phone: horizontally scrolling row so tiles
          keep a comfortable width; tablet: one row, 4 equal columns,
          each tile locked to the artwork's 4:5 aspect ratio so the
          full illustration renders with zero crop. */}
      <div
        className={isTablet ? undefined : 'kyc-hscroll'}
        style={isTablet ? {
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          margin: '18px 0 0',
        } : {
          display: 'flex', gap: 10,
          overflowX: 'auto', overflowY: 'hidden',
          margin: '14px -16px 0', padding: '0 16px 6px',
          scrollSnapType: 'x proximity',
        }}
      >
        <QuickTile
          isTablet={isTablet}
          icon={<BarChart2 size={28} strokeWidth={1.8} />}
          titleA="PATTERNS"
          subtitle="What's working in your log"
          onClick={onPatterns}
          bgImage={`${import.meta.env.BASE_URL}marketing/tile-patterns.jpg`}
          alt="Patterns — what's working in your log"
        />
        <QuickTile
          isTablet={isTablet}
          icon={<Camera size={28} strokeWidth={1.8} />}
          titleA="FISH" titleB="ID"
          subtitle="Point, shoot, get the species"
          onClick={onIdentify}
          bgImage={`${import.meta.env.BASE_URL}marketing/tile-fish-id.jpg`}
          alt="Fish ID — point, shoot, get the species"
        />
        <QuickTile
          isTablet={isTablet}
          icon={<ClipboardList size={28} strokeWidth={1.8} />}
          titleA="CHECK" titleB="REGULATIONS"
          subtitle="Rules, limits, and seasons"
          onClick={onRegulations}
          bgImage={`${import.meta.env.BASE_URL}marketing/tile-check-regs.jpg`}
          alt="Check regulations — rules, limits, and seasons"
        />
        <QuickTile
          isTablet={isTablet}
          icon={<Sparkles size={28} strokeWidth={1.8} />}
          titleA="FISH ID" titleB="QUIZ"
          subtitle="Test your ID, limits, and seasons"
          onClick={onQuiz}
          bgImage={`${import.meta.env.BASE_URL}marketing/tile-fish-quiz.jpg`}
          alt="Fish ID quiz — test your ID, limits, and seasons"
        />
      </div>

      {/* Recent Catches — horizontally-scrolling preview strip. Tap a
          tile to jump straight into the catch's detail view. Hidden
          when the angler hasn't logged anything yet — no point in an
          empty strip taking space. */}
      {recentCatches.length > 0 && (
        <>
          <SectionHead
            action={onViewCatches ? 'VIEW ALL' : undefined}
            onAction={onViewCatches}
          >
            RECENT CATCHES
          </SectionHead>
          <div
            className={isTablet ? undefined : 'kyc-hscroll'}
            style={isTablet ? {
              display: 'grid',
              gridTemplateColumns: screenSize === 'tablet-landscape' ? 'repeat(5, 1fr)' : 'repeat(4, 1fr)',
              gap: 12,
            } : {
              display: 'flex', gap: 10,
              overflowX: 'auto', overflowY: 'hidden',
              margin: '0 -16px', padding: '0 16px 6px',
              scrollSnapType: 'x proximity',
            }}
          >
            {recentCatches.map(c => {
              const s = c.speciesId ? speciesById(c.speciesId) : null;
              const cp = catchPhotos(c);
              const thumb = cp.length > 0 ? photoThumbUrl(cp[0]) : null;
              const when = new Date(c.dateIso);
              const dateLabel = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const sizeLabel = c.length != null
                ? `${c.length} ${state.units === 'metric' ? 'cm' : 'in'}`
                : (c.weight != null ? `${c.weight} ${state.units === 'metric' ? 'kg' : 'lb'}` : '');
              return (
                <button
                  key={c.id}
                  onClick={() => onViewCatch && onViewCatch(c.id)}
                  style={{
                    flex: '0 0 132px',
                    background: T.card, border: `1px solid ${T.cardEdge}`,
                    borderRadius: 14, padding: 0, cursor: 'pointer', textAlign: 'left',
                    display: 'flex', flexDirection: 'column',
                    scrollSnapAlign: 'start',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{
                    width: '100%', aspectRatio: '1 / 1', background: T.parchmentDeep,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {thumb ? (
                      <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : s ? (
                      <SpeciesImage species={s} size={80} />
                    ) : (
                      <Camera size={30} color={T.inkMute} />
                    )}
                  </div>
                  <div style={{ padding: '8px 10px 10px' }}>
                    <div style={{
                      fontSize: 14, fontWeight: 800, color: T.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s ? s.commonName : 'Unknown'}
                    </div>
                    <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sizeLabel ? `${sizeLabel} · ` : ''}{dateLabel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Conditions + Regulation Alerts.
          Phone: horizontal scroll row so each card keeps a comfortable
          width and the user swipes between them.
          Tablet: split the row 50/50 across the full container width —
          scrolling makes no sense with the room the iPad canvas offers. */}
      <div
        className={isTablet ? undefined : 'kyc-hscroll'}
        style={isTablet ? {
          display: 'flex', gap: 16, marginTop: 14,
        } : {
          display: 'flex', gap: 12,
          overflowX: 'auto', overflowY: 'hidden',
          margin: '14px -16px 0', padding: '0 16px 6px',
          scrollSnapType: 'x proximity',
        }}
      >
        {/* Conditions */}
        <Card style={{
          flex: isTablet ? '1 1 0' : '0 0 320px',
          padding: 14, borderRadius: 18,
          display: 'flex', flexDirection: 'column', scrollSnapAlign: 'start',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 12, color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>TODAY'S CONDITIONS</span>
            {onForecast && (
              <button onClick={onForecast} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW FORECAST</button>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <CloudSun size={32} color={T.warn} strokeWidth={1.8} />
              <div style={{ fontSize: 29, fontWeight: 900, color: T.ink, marginTop: 4, lineHeight: 1 }}>82°</div>
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 4, whiteSpace: 'nowrap' }}>Partly Cloudy</div>
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
          flex: isTablet ? '1 1 0' : '0 0 320px',
          padding: 14, borderRadius: 18,
          display: 'flex', flexDirection: 'column', scrollSnapAlign: 'start',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
            <span style={{ fontSize: 12, color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>REGULATION ALERTS</span>
            <button onClick={onRegulationAlerts || onRegulations} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW ALL</button>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <ShieldCheck size={36} color={anyClosed ? T.warn : T.open} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, color: T.ink, fontWeight: 800, lineHeight: 1.25 }}>
                {anyClosed ? 'Active closure' : 'No Active Closures'}
              </div>
              <div style={{ fontSize: 14, color: T.inkSoft, marginTop: 4, lineHeight: 1.4 }}>
                {anyClosed
                  ? 'A featured species is closed in these waters.'
                  : `All clear in ${jurisdiction ? jurisdiction.name : 'these waters'}.`}
              </div>
              <div style={{ fontSize: 14, color: T.inkSoft, marginTop: 8, lineHeight: 1.4 }}>
                Always check before you head out.
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Featured Species */}
      <Card style={{ marginTop: 14, padding: 14, borderRadius: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: T.ink, fontWeight: 800, letterSpacing: 1.2 }}>FEATURED SPECIES</span>
          <button onClick={onSpeciesList} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0 }}>VIEW ALL</button>
        </div>
        <div className="kyc-hscroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, margin: '0 -14px', padding: '0 14px 4px' }}>
          {featured.map(f => (
            <FeaturedCard key={f.s.id} species={f.s} status={f.status} bag={f.bag} onClick={() => onSpecies(f.s.id)} />
          ))}
        </div>
        <ScrollDots count={Math.min(featured.length, 4)} active={0} />
      </Card>

      {/* My Personal Bests — dynamic. When the angler has one or
          more PBs on file, show a rotating spotlight card with the
          photo, key stats, share, and shuffle. Otherwise the compact
          entry-point button. */}
      <PBSpotlightCard
        state={state}
        onPBs={onPBs}
        onView={(id) => onPBs && onPBs(id)}
        isTablet={isTablet}
      />

      <div style={{ marginTop: 22, padding: '14px 12px', borderTop: `1px solid ${T.cardEdge}`, fontSize: 12, color: T.inkMute, textAlign: 'center' }}>
        ReelIntel · Built for the Gulf of America · v{DATA_VERSION}
      </div>
    </div>
  );
}

/* ============================================================
   IDENTIFY — search-first, camera present but honest
   ============================================================
   Layout (top to bottom):
     1) Search bar (live filter over SPECIES)
     2) Category chips (horizontal scroll — replaces the old Browse card)
     3) Compact "Identify by photo" card with a BETA badge
     4) "Tell them apart" → Fish ID Quiz card
     5) Your species (favorites) or Recently viewed (last 5)

   Offline-first: search, category nav, quiz, and species status all
   read from bundled data. No fetch anywhere on this screen. */
/* Gyroscope tilt → small parallax offset {x,y} in px. On iOS 13+ the
   motion sensor needs a one-time permission requested from a user
   gesture, so we ask on the first tap anywhere; until then (and on
   unsupported devices) the offset stays 0 and the Ken Burns drift
   carries the motion on its own. */
function useTilt(maxPx = 14) {
  const [t, setT] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let raf = 0, attached = false;
    const onOrient = (e) => {
      const gx = Math.max(-1, Math.min(1, (e.gamma || 0) / 28));      // left/right
      const gy = Math.max(-1, Math.min(1, ((e.beta || 0) - 45) / 28)); // front/back
      if (raf) return;
      raf = requestAnimationFrame(() => { setT({ x: gx * maxPx, y: gy * maxPx }); raf = 0; });
    };
    const attach = () => { if (attached) return; attached = true; window.addEventListener('deviceorientation', onOrient, true); };
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
    let onFirstTouch = null;
    if (DOE && typeof DOE.requestPermission === 'function') {
      onFirstTouch = () => {
        DOE.requestPermission().then(res => { if (res === 'granted') attach(); }).catch(() => {});
      };
      window.addEventListener('pointerdown', onFirstTouch, { once: true });
    } else if (DOE) {
      attach();
    }
    return () => {
      if (onFirstTouch) window.removeEventListener('pointerdown', onFirstTouch);
      if (attached) window.removeEventListener('deviceorientation', onOrient, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [maxPx]);
  return t;
}

export function IdentifyScreen({
  state, jurisdiction, autoScan, onExitHome,
  onPhoto, onBrowse, onCategory, onSearch, onQuiz, onSpecies,
}) {
  const tilt = useTilt(14);
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const fileRef = useRef(null);
  const [q, setQ] = useState('');

  // "Scan Another" from the results page lands here and opens the photo
  // picker immediately so the angler can shoot the next fish.
  const autoScanRef = useRef(false);
  useEffect(() => {
    if (autoScan && !autoScanRef.current) {
      autoScanRef.current = true;
      setTimeout(() => fileRef.current?.click(), 150);
    }
  }, [autoScan]);

  // X-ing out of the photo picker (take-photo / library / file sheet)
  // returns to Home. The file input fires a native 'cancel' event when
  // dismissed without a selection (iOS 16.4+ / modern browsers).
  useEffect(() => {
    const el = fileRef.current;
    if (!el || !onExitHome) return undefined;
    const onCancel = () => onExitHome();
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onExitHome]);

  // When user picks/captures a photo, read it as base64 and hand to
  // onPhoto. Same behaviour as the old hero — only the presentation
  // changed. Native + web both use the file input; iOS renders a
  // sheet with Take Photo / Choose from Library.
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  // Active species list — same filter Regs / Species screens use.
  const activeSpecies = useMemo(
    () => SPECIES.filter(s => s.active !== false),
    []
  );
  const speciesCount = activeSpecies.length;

  // Live search over common + scientific + alt names. Sorted by
  // best-effort match rank: startsWith common → contains common →
  // alt / scientific.
  const searchResults = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return [];
    const rows = [];
    for (const s of activeSpecies) {
      const cn = s.commonName.toLowerCase();
      const sci = s.scientific?.toLowerCase() || '';
      const alt = (s.altNames || []).map(a => a.toLowerCase());
      let rank = -1;
      let matchedAlt = null;
      if (cn.startsWith(lower)) rank = 0;
      else if (cn.includes(lower)) rank = 1;
      else if (alt.some(a => a.includes(lower))) {
        rank = 2;
        matchedAlt = (s.altNames || []).find(a => a.toLowerCase().includes(lower));
      }
      else if (sci.includes(lower)) rank = 3;
      if (rank >= 0) rows.push({ s, rank, matchedAlt });
    }
    return rows.sort((a, b) => a.rank - b.rank || a.s.commonName.localeCompare(b.s.commonName)).slice(0, 12);
  }, [q, activeSpecies]);

  // Categories: filter by ones that have any active species so the
  // chip row doesn't show empty categories after overlay updates.
  // Reads from the live categories-store overlay (not the bundled
  // fallback) so admin-added categories in Supabase show up here on
  // the next refresh cycle. Subscribes below so this list rebuilds
  // when the overlay refreshes.
  const [catsTick, bumpCats] = useState(0);
  useEffect(() => subscribeCategories(() => bumpCats(v => v + 1)), []);
  const categoriesWithSpecies = useMemo(() => {
    const has = new Set(activeSpecies.map(s => s.category));
    return getCategories().filter(c => has.has(c.id));
  }, [activeSpecies, catsTick]);

  // "Your species" (favorites) if present; else last recently viewed.
  const favIds = Array.isArray(state?.favorites) ? state.favorites : [];
  const recentIds = Array.isArray(state?.recentSpecies) ? state.recentSpecies : [];
  const showList = favIds.length > 0 ? favIds.slice(0, 5) : recentIds.slice(0, 5);
  const showListKind = favIds.length > 0 ? 'favorites' : 'recent';

  // Rotating example lookalike pair for the Quiz card subtitle. Read
  // the first species whose lookalikes list has ≥2 entries so the
  // subtitle names three real fish and rotates as SPECIES ships.
  const quizExamplePair = useMemo(() => {
    const anchor = activeSpecies.find(s => Array.isArray(s.lookalikes) && s.lookalikes.length >= 2);
    if (!anchor) return 'Tell apart look-alike fish';
    const [a, b] = anchor.lookalikes;
    const spA = speciesById(a); const spB = speciesById(b);
    if (!spA || !spB) return 'Tell apart look-alike fish';
    // Short name — trim "Snapper" / "Grouper" suffix if all three share it.
    const short = (n) => n.replace(/\s+(Snapper|Grouper|Mackerel|Tuna)$/i, '');
    const suffixMatch = anchor.commonName.match(/\s+(Snapper|Grouper|Mackerel|Tuna)$/i);
    const suffix = suffixMatch ? suffixMatch[1] : null;
    if (suffix && spA.commonName.endsWith(suffix) && spB.commonName.endsWith(suffix)) {
      return `${short(anchor.commonName)} vs. ${short(spA.commonName)} vs. ${short(spB.commonName)} ${suffix}`;
    }
    return `${anchor.commonName} vs. ${spA.commonName} vs. ${spB.commonName}`;
  }, [activeSpecies]);

  // Season status for a species in the current jurisdiction. Same
  // logic as Regulations list, returns { key, label, bg, fg }.
  const seasonForSpecies = (id) => {
    const reg = jurisdiction ? regulationFor(id, jurisdiction.id).regulation : null;
    if (!reg) return { key: 'unknown', label: 'Varies', bg: 'rgba(251,191,36,0.16)', fg: '#fbbf24' };
    const st = seasonState(reg.open).status;
    if (st === 'open')     return { key: 'open',     label: 'Open',     bg: 'rgba(52,211,153,0.14)', fg: '#5ee0ac' };
    if (st === 'closed')   return { key: 'closed',   label: 'Closed',   bg: 'rgba(248,113,113,0.14)', fg: '#f87171' };
    if (st === 'upcoming') return { key: 'upcoming', label: 'Opens soon', bg: 'rgba(251,191,36,0.16)', fg: '#fbbf24' };
    return { key: 'unknown', label: 'Varies', bg: 'rgba(251,191,36,0.16)', fg: '#fbbf24' };
  };

  // Shared inline styles matching the spec's token palette. Kept
  // inline to avoid a new CSS file — the tokens all resolve against
  // the existing theme.js gradient / colors.
  const screenBg = '#0a1624';
  const cardBg = '#11233a';
  const searchBg = '#12263d';
  const identifyBg = '#0f2438';
  const accent = '#5ecdf2';
  const accentText = '#062330';
  const secondaryText = '#8ea3ba';
  const mutedText = '#6f86a0';
  const chipText = '#cfe0f0';

  // Parent must NOT be display:grid — the chip row uses negative
  // horizontal margins (0 -16px) to punch through the screen padding
  // for edge-to-edge scroll, and CSS Grid counts those negative
  // margins as horizontal contribution, widening the container past
  // the viewport → a whole-screen horizontal scrollbar. Flex column
  // ignores per-item horizontal margins, so the same negative-margin
  // trick works without leaking width.
  const outerPadX = isTablet ? 22 : 16;
  return (
    <div style={{
      background: screenBg,
      minHeight: '100%',
      padding: isTablet ? '20px 22px 24px' : '14px 16px 20px',
      display: 'flex', flexDirection: 'column',
      gap: isTablet ? 16 : 14,
      // Belt: prevent any child that accidentally overflows from
      // triggering the outer scrollbar. Not a fix for the root cause
      // — the grid→flex switch is — but a cheap guardrail.
      maxWidth: '100%', boxSizing: 'border-box',
    }}>
      {/* 1) Search bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: searchBg,
        border: '1px solid rgba(94,205,242,0.28)', borderRadius: 12,
        padding: '10px 12px',
      }}>
        <Search size={isTablet ? 22 : 18} color={accent} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${speciesCount} species…`}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            color: '#e5edf5', fontSize: isTablet ? 16 : 14,
            padding: 0,
          }}
        />
        {q && (
          <button
            onClick={() => setQ('')}
            aria-label="Clear search"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: mutedText, padding: 4, display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Live search results — only when there's a query. Tapping a
          row opens species detail via onSpecies (which also records
          it into state.recentSpecies via the App-level tracker). */}
      {q.trim() && (
        <div style={{ display: 'grid', gap: 8 }}>
          {searchResults.length === 0 && (
            <div style={{ fontSize: 15, color: mutedText, padding: '6px 4px' }}>
              No matches for &ldquo;{q.trim()}&rdquo;. Try common name, scientific, or a regional name.
            </div>
          )}
          {searchResults.map(({ s, matchedAlt }) => (
            <button
              key={s.id}
              onClick={() => onSpecies?.(s.id)}
              style={{
                background: cardBg, border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 12, padding: 10,
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              <SpeciesImage species={s} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#e5edf5' }}>
                  {s.commonName}
                </div>
                <div style={{ fontSize: 12, color: secondaryText, fontStyle: 'italic', marginTop: 2 }}>
                  {s.scientific}
                </div>
                {matchedAlt && (
                  <div style={{ fontSize: 12, color: '#b7935a', marginTop: 2 }}>
                    also: {matchedAlt}
                  </div>
                )}
              </div>
              <ChevronRight size={18} color={accent} />
            </button>
          ))}
        </div>
      )}

      {/* 2) Category chips — horizontal scroll, single row.
          Negative margin matches the outer padding so the row sits
          edge-to-edge without introducing a screen-level horizontal
          scroll (the outer container is flex column — see comment
          above the return). */}
      {!q.trim() && (
        <div
          className="kyc-hscroll"
          style={{
            display: 'flex', gap: 8,
            overflowX: 'auto', overflowY: 'hidden',
            marginLeft: -outerPadX, marginRight: -outerPadX,
            padding: `0 ${outerPadX}px 4px`,
            scrollSnapType: 'x proximity',
            maxWidth: `calc(100% + ${outerPadX * 2}px)`,
          }}
        >
          {categoriesWithSpecies.map(c => (
            <button
              key={c.id}
              onClick={() => onCategory?.(c.id)}
              style={{
                flex: '0 0 auto',
                background: searchBg,
                border: '1px solid rgba(255,255,255,0.07)',
                color: chipText,
                fontSize: 14.5, fontWeight: 600,
                padding: '8px 12px', borderRadius: 9,
                cursor: 'pointer', whiteSpace: 'nowrap',
                scrollSnapAlign: 'start',
              }}
            >
              {c.name}
            </button>
          ))}
          {/* Overflow tail: full-list "Browse all" chip in case the
              user prefers the categories index. */}
          {onBrowse && (
            <button
              onClick={onBrowse}
              style={{
                flex: '0 0 auto',
                background: 'transparent',
                border: `1px solid ${accent}`,
                color: accent,
                fontSize: 14.5, fontWeight: 700,
                padding: '8px 12px', borderRadius: 9,
                cursor: 'pointer', whiteSpace: 'nowrap',
                scrollSnapAlign: 'start',
              }}
            >
              Browse all →
            </button>
          )}
        </div>
      )}

      {/* 3) Dominant "Click to SCAN" hero tile with underwater tuna
          BG image anchored right, text anchored left over a
          left-heavy dark scrim.
          Phone: full-container width, 220px tall.
          iPad portrait: full-container width, 300px tall.
          iPad landscape: full-container width, 340px tall.
          Source asset: public/brand/fish_scan_bg.jpg
          (2129x739, aspect 2.88:1). object-position:right center
          keeps the fish + reticle in view at narrower phone crops.
          Fallback gradient renders if the asset is missing. */}
      {!q.trim() && (
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Click to scan a fish by photo"
          style={{
            position: 'relative',
            width: '100%', textAlign: 'left', cursor: 'pointer',
            background: identifyBg,
            border: '1px solid rgba(94,205,242,0.35)', borderRadius: 18,
            padding: 0,
            height: isTablet ? (size === 'tablet-landscape' ? 460 : 400) : 320,
            overflow: 'hidden',
            boxShadow: '0 6px 22px rgba(0, 0, 0, 0.35)',
          }}
        >
          {/* Background image — centered, with a slow Ken Burns drift on
              the wrapper and a gyroscope tilt-parallax on the img so it
              feels alive. Overscan (inset -10%) hides the edges as it
              scales / shifts. */}
          <div aria-hidden className="kyc-kenburns" style={{
            position: 'absolute', inset: '-10%', pointerEvents: 'none',
          }}>
            <img
              src={`${import.meta.env.BASE_URL}brand/fish_scan_bg.jpg`}
              alt=""
              aria-hidden
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              style={{
                width: '100%', height: '100%',
                objectFit: 'cover', objectPosition: '66% center',
                display: 'block', userSelect: 'none', pointerEvents: 'none',
                transform: `translate(${tilt.x}px, ${tilt.y}px)`,
                transition: 'transform 120ms ease-out',
                willChange: 'transform',
              }}
            />
          </div>
          {/* Scrim — LEFT-HEAVY so the copy on the left half stays
              readable while the fish on the right stays visually
              intact. Solid dark on the left → nearly transparent on
              the right. */}
          <div aria-hidden style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, rgba(6,20,36,0.85) 0%, rgba(6,20,36,0.65) 35%, rgba(6,20,36,0.30) 60%, rgba(6,20,36,0.15) 100%)',
            zIndex: 1, pointerEvents: 'none',
          }} />

          {/* Targeting reticle — centered over the photo, reinforces the
              "line up the fish and tap" scan metaphor. */}
          <div aria-hidden style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 1, pointerEvents: 'none',
            color: 'rgba(94, 205, 242, 0.9)',
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
          }}>
            <Crosshair size={isTablet ? 140 : 104} strokeWidth={1.4} />
          </div>

          {/* Content — anchored left over the darkened side. */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2,
            padding: isTablet ? '22px 26px' : '18px 18px',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}>
            {/* Top: BETA badge on the left (no more camera circle —
                the fish image carries the visual weight). */}
            <span style={{
              background: 'rgba(251,191,36,0.18)', color: '#fbbf24',
              fontSize: isTablet ? 11 : 10, fontWeight: 800, letterSpacing: '0.08em',
              padding: '5px 9px', borderRadius: 6, textTransform: 'uppercase',
              border: '1px solid rgba(251, 191, 36, 0.35)',
              whiteSpace: 'nowrap',
            }}>
              Beta
            </span>

            {/* Bottom block: title + subtitle, left-anchored and
                width-capped so the copy never spills onto the fish. */}
            <div style={{
              // Cap so long copy wraps in the left half. On narrow
              // phones (<360px CSS) drop to ~55% of container width so
              // the fish still peeks through the right edge.
              maxWidth: isTablet ? (size === 'tablet-landscape' ? 560 : 460) : 220,
            }}>
              <div style={{
                fontSize: isTablet ? (size === 'tablet-landscape' ? 44 : 40) : 30,
                fontWeight: 900, letterSpacing: 0.2,
                color: '#f7fbff', lineHeight: 1.02,
                textShadow: '0 2px 10px rgba(0, 0, 0, 0.55)',
              }}>
                Click to SCAN
              </div>
              <div style={{
                fontSize: isTablet ? 16 : 13, color: '#d8e4ee',
                marginTop: 8, lineHeight: 1.35, fontWeight: 500,
                textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
              }}>
                Take or pick a photo — always confirm the species
              </div>
            </div>
          </div>
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      {/* 4) Tell them apart → Fish ID Quiz card */}
      {!q.trim() && (
        <div>
          <div style={{
            fontSize: 11.5, fontWeight: 600, color: mutedText,
            letterSpacing: '0.13em', textTransform: 'uppercase',
            padding: '0 2px 8px',
          }}>
            Tell them apart
          </div>
          <button
            onClick={onQuiz}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              background: cardBg,
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14,
              padding: 14,
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: 'rgba(251,191,36,0.16)', color: '#fbbf24',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Sparkles size={22} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: isTablet ? 17 : 15, fontWeight: 800, color: '#e5edf5' }}>
                Fish ID Quiz
              </div>
              <div style={{
                fontSize: isTablet ? 13 : 12, color: secondaryText, marginTop: 3, lineHeight: 1.4,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {quizExamplePair}
              </div>
            </div>
            <span style={{
              background: accent, color: accentText,
              fontSize: 15, fontWeight: 800,
              padding: '8px 14px', borderRadius: 8,
              flexShrink: 0,
            }}>
              Start
            </span>
          </button>
        </div>
      )}

      {/* 5) Your species (favorites) or Recently viewed */}
      {!q.trim() && (
        <div>
          <div style={{
            fontSize: 11.5, fontWeight: 600, color: mutedText,
            letterSpacing: '0.13em', textTransform: 'uppercase',
            padding: '0 2px 8px',
          }}>
            {showListKind === 'favorites' ? 'Your species' : 'Recently viewed'}
          </div>
          {showList.length === 0 ? (
            <div style={{
              background: cardBg, border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12, padding: 14, textAlign: 'center',
              color: secondaryText, fontSize: 15, lineHeight: 1.55,
            }}>
              Search a species or tap a category above to build up your list.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {showList.map(id => {
                const s = speciesById(id);
                if (!s) return null;
                const st = seasonForSpecies(id);
                return (
                  <button
                    key={id}
                    onClick={() => onSpecies?.(id)}
                    style={{
                      background: cardBg,
                      border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
                      padding: 10,
                      display: 'flex', alignItems: 'center', gap: 12,
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <SpeciesImage species={s} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#e5edf5' }}>
                        {s.commonName}
                      </div>
                      <div style={{ fontSize: 12, color: '#7f95ad', fontStyle: 'italic', marginTop: 2 }}>
                        {s.scientific}
                      </div>
                    </div>
                    <span style={{
                      background: st.bg, color: st.fg,
                      fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
                      padding: '4px 8px', borderRadius: 6,
                      textTransform: 'uppercase',
                      flexShrink: 0,
                    }}>
                      {st.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* LogMenuScreen removed in build 16 — the app now goes camera-first
   from a single entry point (Home hero + tab bar center action). */

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

        const photoEntry = await savePhoto(dataUrl);

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
        <div style={{ fontSize: 15, letterSpacing: 2, color: T.brass, fontWeight: 800, marginBottom: 12 }}>
          {phase === 'opening' ? 'OPENING CAMERA…'
            : phase === 'saving' ? 'SAVING CATCH…'
            : phase === 'done' ? 'LOGGED' : 'CANCELLED'}
        </div>
        <div style={{ fontSize: 15, color: T.inkSoft, maxWidth: 320, margin: '0 auto', lineHeight: 1.5 }}>
          {phase === 'saving' ? 'Fetching GPS, sun, and weather in the background — this only takes a moment.'
            : phase === 'done' ? 'Back to fishing.'
            : phase === 'cancelled' ? 'No photo taken.'
            : 'Point the camera at your fish and shoot.'}
        </div>
        {err && <div role="alert" style={{ marginTop: 12, fontSize: 14, color: T.closed }}>{err}</div>}
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — analyzing
   ============================================================ */
export function PhotoAnalyzingScreen({ imageDataUrl, jurisdictionId, onResult }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let alive = true;
    const stepTimer = setInterval(() => {
      setStep(s => (s + 1) % ANALYSIS_FEATURES.length);
    }, 500);
    identifyPhoto(imageDataUrl, { jurisdictionId }).then(result => {
      if (!alive) return;
      clearInterval(stepTimer);
      onResult(result);
    });
    return () => { alive = false; clearInterval(stepTimer); };
  }, [imageDataUrl, jurisdictionId, onResult]);

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
              fontSize: 15, color: i <= step ? T.parchment : '#7A8B96',
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
        <div style={{ marginTop: 18, fontSize: 12, color: '#7A8B96', fontStyle: 'italic', textAlign: 'center' }}>
          On-device analysis · no internet required
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — result
   ============================================================ */
/* Fits a piece of text on ONE line by shrinking font-size in 4px
   steps until scrollWidth stops overflowing offsetWidth. Starts at
   maxSize, floors at minSize. Runs synchronously in a layout effect
   so the user never sees a mid-shrink flash. */
function AutoFitText({ text, maxSize, minSize, style }) {
  const ref = React.useRef(null);
  const [fontSize, setFontSize] = React.useState(maxSize);
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    let size = maxSize;
    ref.current.style.fontSize = size + 'px';
    while (size > minSize && ref.current.scrollWidth > ref.current.offsetWidth) {
      size -= 4;
      ref.current.style.fontSize = size + 'px';
    }
    setFontSize(size);
  }, [text, maxSize, minSize]);
  return (
    <div ref={ref} style={{
      ...style,
      fontSize,
      width: '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}>
      {text}
    </div>
  );
}

/* Circular confidence dial. Filled ring representing pct (0-100)
   with the number centered. SVG so it stays crisp on retina and
   scales without pixelation. */
function ConfidenceRing({ pct, size = 60 }) {
  const stroke = Math.max(4, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const dashOffset = circ * (1 - clamped / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r}
        stroke="rgba(255,255,255,0.15)" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r}
        stroke="#5ecdf2" strokeWidth={stroke} fill="none"
        strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        fontSize={Math.round(size * 0.30)} fontWeight="800" fill="#ffffff">
        {clamped}%
      </text>
    </svg>
  );
}

/* Side-by-side modal opened from a Compare row. Shows the user's
   photo against the lookalike's reference plus each species' top
   ID cues so the angler can eyeball the difference. */
function CompareLookalikesModal({ topSpecies, lookalikeSpecies, userPhoto, isTablet, onClose, onPickLookalike, onNoneMatch }) {
  if (!lookalikeSpecies) return null;
  const topCues   = (topSpecies?.keyIds || []).slice(0, 3);
  const otherCues = (lookalikeSpecies?.keyIds || []).slice(0, 3);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(3,27,51,0.85)', backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: isTablet ? 'center' : 'flex-end',
      justifyContent: 'center',
      padding: isTablet ? 24 : 0,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#0f2438', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: isTablet ? 16 : 0,
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        width: '100%', maxWidth: isTablet ? 720 : '100%',
        maxHeight: isTablet ? '85vh' : '92vh',
        display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexShrink: 0,
        }}>
          <SectionLabel style={{ color: '#5ecdf2', flex: 1 }}>SIDE-BY-SIDE COMPARE</SectionLabel>
          <button onClick={onClose} aria-label="Close comparison" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.inkSoft, padding: 4, display: 'flex',
          }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{
                width: '100%', aspectRatio: '1 / 1', overflow: 'hidden',
                borderRadius: 10, border: '1.5px solid #5ecdf2', background: '#0a1420',
              }}>
                <img src={userPhoto} alt="Your catch" style={{
                  width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                }} />
              </div>
              <div style={{ fontSize: 11, color: '#5ecdf2', fontWeight: 800, letterSpacing: '0.15em', marginTop: 6 }}>
                MODEL SAYS
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 20, color: T.ink, marginTop: 2 }}>
                {topSpecies?.commonName || '—'}
              </div>
            </div>
            <div>
              <div style={{
                width: '100%', aspectRatio: '1 / 1', overflow: 'hidden',
                borderRadius: 10, border: '1.5px solid rgba(255,255,255,0.12)', background: '#0a1420',
              }}>
                <SpeciesImage species={lookalikeSpecies} size={400}
                  style={{ width: '100%', height: '100%', borderRadius: 0 }} />
              </div>
              <div style={{ fontSize: 11, color: T.inkMute, fontWeight: 800, letterSpacing: '0.15em', marginTop: 6 }}>
                LOOKALIKE
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 20, color: T.ink, marginTop: 2 }}>
                {lookalikeSpecies.commonName}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <SectionLabel style={{ color: '#5ecdf2', marginBottom: 6 }}>Marks of {topSpecies?.commonName || 'match'}</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 14, lineHeight: 1.5 }}>
                {topCues.map((c, i) => <li key={i}>{c}</li>)}
                {topCues.length === 0 && <li style={{ color: T.inkMute }}>No cues on file.</li>}
              </ul>
            </div>
            <div>
              <SectionLabel style={{ color: T.inkMute, marginBottom: 6 }}>Marks of {lookalikeSpecies.commonName}</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 14, lineHeight: 1.5 }}>
                {otherCues.map((c, i) => <li key={i}>{c}</li>)}
                {otherCues.length === 0 && <li style={{ color: T.inkMute }}>No cues on file.</li>}
              </ul>
            </div>
          </div>
        </div>

        <div style={{
          padding: `12px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)`,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column', gap: 8,
          flexShrink: 0,
        }}>
          <PrimaryButton onClick={onPickLookalike} style={{ width: '100%', minHeight: 52, fontSize: 17, fontWeight: 800 }}>
            Actually, this is the {lookalikeSpecies.commonName}
          </PrimaryButton>
          <button type="button" onClick={onNoneMatch} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.inkMute, fontSize: 14, fontWeight: 700, padding: '8px 4px',
            textAlign: 'center',
          }}>
            None of these — pick a different species
          </button>
        </div>
      </div>
    </div>
  );
}

export function PhotoResultScreen({ result, imageDataUrl, onPickSpecies, onConfirmSave, onCorrectSave, onConfirmFeedbackOnly, onCorrectFeedbackOnly, onSaveWithoutFeedback, onRetake, onScanAnother, onManual, onSuggestNew }) {
  const { confidence, candidates } = result || {};
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const [modal, setModal] = useState(null);
  // feedbackState: 'unset' until the angler taps CONFIRM (banks the
  // training feedback for the displayed species). Report wrong ID
  // corrects the displayed species in place and resets this to 'unset'.
  const [feedbackState, setFeedbackState] = useState('unset');
  // overrideId: set when the angler corrects via Report wrong ID — the
  // result page then shows THIS species instead of the model's pick,
  // without leaving the page. Nothing is saved until CONFIRM / Save.
  const [overrideId, setOverrideId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const lookalikesRef = useRef(null);

  // No confident pick AND no manual override yet — show the
  // couldn't-identify fallback. Once the angler picks a species via
  // "Pick the species", overrideId is set and we fall through to the
  // main results view (labelled YOUR PICK) so they can CONFIRM / Save
  // the same way Report Wrong ID lands them.
  if ((!candidates || candidates.length === 0) && !overrideId) {
    return (
      <div style={{ padding: '18px 16px' }}>
        <img src={imageDataUrl} alt="Your catch" style={{
          width: '100%', maxHeight: 220, objectFit: 'cover',
          borderRadius: 6, marginBottom: 14, border: `2px solid ${T.cardEdge}`,
        }} />
        <Card style={{ background: 'rgba(198,102,102,0.12)', borderColor: '#c66', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle size={22} color="#c66" />
            <div>
              <div style={{ fontWeight: 700, color: T.ink, fontSize: 16 }}>Couldn't identify confidently</div>
              <div style={{ fontSize: 15, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                The image was too uncertain to commit to a species. Try a clearer photo, or identify manually.
              </div>
            </div>
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Manual ID: open the searchable species list (same picker as
              the confirm flow). Picking one records a model_correction
              (photo labeled with the true species → training signal)
              and routes to catch entry. */}
          <PrimaryButton onClick={() => setShowPicker(true)}>
            <Search size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Pick the species
          </PrimaryButton>
          <GhostButton onClick={onRetake} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RotateCcw size={16} /> Try another photo
          </GhostButton>
          {onSuggestNew && (
            <button onClick={onSuggestNew} style={{
              background: 'transparent', border: 'none', color: T.brass,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              padding: 8, textDecoration: 'underline',
            }}>
              Fish not in the app? Add it to the database
            </button>
          )}
        </div>

        {showPicker && (
          <SpeciesPickerModal
            speciesOptions={SPECIES.filter(s => s.active !== false)}
            currentSpeciesId={null}
            onCancel={() => setShowPicker(false)}
            onPick={(sid) => {
              // Match Report Wrong ID: correct in place and re-render
              // as the main results view so the angler can CONFIRM /
              // Save. Don't jump straight to catch entry.
              setShowPicker(false);
              setOverrideId(sid);
              setFeedbackState('unset');
            }}
            title="What species is it?"
          />
        )}
      </div>
    );
  }

  // top may be null when we fell through from the no-candidates
  // branch after the angler picked a species manually. In that case
  // isCorrected is always true (overrideId is set) and the model
  // never had a pick to record as "wrong".
  const top = (candidates && candidates.length > 0) ? candidates[0] : null;
  const isCorrected = !!overrideId;
  const displayedId = overrideId || top.speciesId;
  const topSpecies = speciesById(displayedId);
  const scorePct = top ? Math.round((top.score || 0) * 100) : 0;
  const pillTier = isCorrected
    ? { label: 'YOUR PICK', bg: T.warn, ink: '#062330' }
    : top.score >= 0.85 ? { label: 'CONFIRMED MATCH', bg: '#5ecdf2', ink: '#062330' }
    : top.score >= 0.60 ? { label: 'LIKELY MATCH',    bg: '#5ecdf2', ink: '#062330' }
    :                     { label: 'LOW CONFIDENCE',  bg: '#8ea3ba', ink: '#062330' };

  // CONFIRM: bank feedback for the displayed species (correction if the
  // angler overrode the pick, otherwise a confirmation), stay on page.
  const doConfirm = () => {
    setFeedbackState('confirmed');
    if (isCorrected) { if (onCorrectFeedbackOnly) onCorrectFeedbackOnly(displayedId, top?.speciesId ?? null); }
    else { if (onConfirmFeedbackOnly) onConfirmFeedbackOnly(displayedId); }
  };
  // SAVE TO LOGBOOK: navigate to catch entry with the displayed species.
  // Skip the feedback double-fire if CONFIRM already banked it.
  const doSave = () => {
    if (feedbackState === 'confirmed') { if (onSaveWithoutFeedback) onSaveWithoutFeedback(displayedId); }
    else if (isCorrected) { if (onCorrectSave) onCorrectSave(displayedId, top?.speciesId ?? null); }
    else { if (onConfirmSave) onConfirmSave(displayedId); }
  };

  const keyIds = (topSpecies?.keyIds || []).slice(0, 3);
  const lookalikeIds = (topSpecies?.lookalikes || []).slice(0, 3);
  const lookalikes = lookalikeIds.map(id => speciesById(id)).filter(Boolean);

  const scrollToLookalikesOrPicker = () => {
    if (lookalikes.length === 0) { onManual(); return; }
    if (lookalikesRef.current?.scrollIntoView) {
      lookalikesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const heroAspect = isTablet ? '4 / 3' : '3 / 4';
  const nameSize   = isTablet ? 72 : 56;
  const sciSize    = isTablet ? 22 : 18;
  const ringSize   = isTablet ? 72 : 60;

  return (
    <div style={{ padding: '14px 14px 140px', position: 'relative' }}>
      {/* HERO PHOTO — user's photo full-bleed with overlaid identity */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 14, border: '1.5px solid #5ecdf2',
        marginBottom: 14, aspectRatio: heroAspect, background: '#0a1420',
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
      }}>
        <img src={imageDataUrl} alt="Your catch" style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%', objectFit: 'cover',
          display: 'block',
        }} />
        <div aria-hidden style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '48%',
          background: 'linear-gradient(to top, rgba(6,20,36,0.94) 15%, rgba(6,20,36,0.55) 60%, transparent 100%)',
          pointerEvents: 'none',
        }} />
        {/* Content stacked one column: pill → name (auto-fit one line)
            → scientific → dial + horizontal CONFIDENCE label. */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          padding: isTablet ? '22px 22px' : '18px 16px',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: pillTier.bg, color: pillTier.ink,
            padding: '5px 10px', borderRadius: 999,
            fontSize: 12, fontWeight: 800, letterSpacing: '0.15em',
            marginBottom: 10,
          }}>
            <Check size={12} strokeWidth={3} />
            {pillTier.label}
          </div>
          <AutoFitText
            text={topSpecies?.commonName || top.speciesId}
            maxSize={nameSize}
            minSize={36}
            style={{
              fontFamily: 'Georgia, serif', fontStyle: 'italic',
              lineHeight: 0.95,
              color: '#ffffff', fontWeight: 400,
              letterSpacing: '-0.01em',
            }}
          />
          {topSpecies?.scientific && (
            <div style={{
              fontStyle: 'italic', fontSize: sciSize,
              color: '#8ea3ba', marginTop: 4,
            }}>
              {topSpecies.scientific}
            </div>
          )}
          {!isCorrected && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginTop: 12,
            }}>
              <ConfidenceRing pct={scorePct} size={ringSize} />
              <div style={{
                fontSize: 12, fontWeight: 800, letterSpacing: '0.15em',
                color: '#ffffff',
              }}>
                CONFIDENCE
              </div>
            </div>
          )}
        </div>

        {/* Save-catch action — floppy icon superimposed bottom-right of
            the photo. Logs the catch with the displayed species. */}
        <button
          onClick={doSave}
          aria-label="Save catch"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 3,
            display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            background: 'rgba(6,20,36,0.72)', border: '1.5px solid #5ecdf2',
            color: '#5ecdf2', borderRadius: 12, padding: '8px 12px',
            cursor: 'pointer', backdropFilter: 'blur(4px)',
          }}
        >
          <SaveIcon size={26} strokeWidth={2} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>SAVE CATCH</span>
        </button>
      </div>

      <style>{`@keyframes kycFeedbackIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }`}</style>

      {/* Save to Logbook / Scan Another buttons removed — Save catch is
          now the floppy icon superimposed on the photo above. */}

      {/* WHY THIS MATCH FITS — species-authored ID cues */}
      {keyIds.length > 0 && (
        <div style={{
          position: 'relative', overflow: 'hidden',
          background: '#11233a', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14, padding: 14, marginBottom: 14,
        }}>
          <SectionLabel style={{ color: '#5ecdf2', marginBottom: 10 }}>WHY THIS MATCH FITS</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative', zIndex: 1 }}>
            {keyIds.map((cue, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                  flexShrink: 0,
                  width: 22, height: 22, borderRadius: 999,
                  background: 'rgba(94,205,242,0.18)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginTop: 1,
                }}>
                  <Check size={13} color="#5ecdf2" strokeWidth={3} />
                </div>
                <div style={{ fontSize: 16, color: T.ink, lineHeight: 1.4, flex: 1 }}>{cue}</div>
              </div>
            ))}
          </div>
          <ShieldCheck aria-hidden size={110} color="#5ecdf2" style={{
            position: 'absolute', top: -18, right: -18,
            opacity: 0.15, pointerEvents: 'none', zIndex: 0,
          }} />
        </div>
      )}

      {/* COMPARE LOOKALIKES */}
      {lookalikes.length > 0 && (
        <div ref={lookalikesRef} style={{
          background: '#11233a', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14, padding: 14, marginBottom: 14,
        }}>
          <SectionLabel style={{ color: '#5ecdf2', marginBottom: 8 }}>COMPARE LOOKALIKES</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {lookalikes.map((s, i) => {
              const distinguisher = (s.keyIds?.[0] || '').trim();
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0',
                  borderBottom: i < lookalikes.length - 1
                    ? '1px dashed rgba(255,255,255,0.06)' : 'none',
                }}>
                  <SpeciesImage species={s} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, color: T.ink }}>{s.commonName}</div>
                    {distinguisher && (
                      <div style={{
                        fontSize: 14, color: T.inkSoft, marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {distinguisher}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setModal({ lookalikeId: s.id })}
                    style={{
                      flexShrink: 0,
                      background: 'transparent', border: '1px solid #5ecdf2',
                      color: '#5ecdf2', borderRadius: 8,
                      padding: '6px 12px', fontSize: 14, fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Compare
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STICKY BOTTOM ACTION BAR — sits above the tab bar. The
          `bottom` offset combines the safe area (home indicator on
          iPhones) with the tab bar content height (~72px covers both
          phone and tablet without overlap). */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${isTablet ? 76 : 60}px)`,
        zIndex: 20,
        padding: '12px 14px',
        background: 'rgba(4,22,42,0.96)',
        backdropFilter: 'blur(6px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', gap: 10,
      }}>
        {feedbackState === 'confirmed' ? (
          <div style={{
            flex: 2, minHeight: 52, animation: 'kycFeedbackIn 220ms ease-out',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'rgba(50,209,123,0.14)', border: `1.5px solid ${T.open}`,
            color: T.open, borderRadius: 10, fontSize: 16, fontWeight: 800,
          }}>
            <Check size={18} strokeWidth={3} /> ID confirmed
          </div>
        ) : (
          <PrimaryButton
            onClick={doConfirm}
            style={{
              flex: 2, minHeight: 52, fontSize: 18, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Check size={20} strokeWidth={3} /> CONFIRM
          </PrimaryButton>
        )}
        {feedbackState === 'confirmed' ? (
          // Once confirmed, "wrong ID" no longer applies — offer the next
          // scan instead. Behaves like Click-to-Scan (photo/library/file).
          <GhostButton
            onClick={onScanAnother || onRetake}
            style={{
              flex: 1, minHeight: 52, fontSize: 14, fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <RotateCcw size={15} /> Scan Another
          </GhostButton>
        ) : (
          <GhostButton
            onClick={() => setShowPicker(true)}
            style={{
              flex: 1, minHeight: 52, fontSize: 14, fontWeight: 800,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: T.warn, borderColor: T.warn,
            }}
          >
            <Flag size={15} /> Report Wrong ID
          </GhostButton>
        )}
      </div>

      {/* Report wrong ID picker — updates the displayed species IN
          PLACE (overrideId) and stays on the results page. Nothing is
          saved until CONFIRM or Save to Logbook. */}
      {showPicker && (
        <SpeciesPickerModal
          speciesOptions={SPECIES.filter(s => s.active !== false && s.id !== displayedId)}
          currentSpeciesId={displayedId}
          onCancel={() => setShowPicker(false)}
          onPick={(newSpeciesId) => {
            setShowPicker(false);
            setOverrideId(newSpeciesId);
            setFeedbackState('unset'); // ID changed — re-confirm needed
          }}
          title="What species is it?"
        />
      )}

      {/* Escape hatch below the top pick: the scanned fish may not be
          in the database at all. Routes to catch entry with the photo
          attached and the add-species modal open — the species lands
          locally right away and queues for admin review. */}
      {onSuggestNew && (
        <button onClick={onSuggestNew} style={{
          background: 'transparent', border: 'none', color: T.brass,
          fontSize: 15, fontWeight: 700, cursor: 'pointer',
          padding: '4px 8px 12px', textDecoration: 'underline',
          display: 'block', margin: '0 auto',
        }}>
          Fish not in the app? Add it to the database
        </button>
      )}

      {modal?.lookalikeId && (
        <CompareLookalikesModal
          topSpecies={topSpecies}
          lookalikeSpecies={speciesById(modal.lookalikeId)}
          userPhoto={imageDataUrl}
          isTablet={isTablet}
          onClose={() => setModal(null)}
          onPickLookalike={() => {
            const chosen = modal.lookalikeId;
            setModal(null);
            // Same as Report Wrong ID: correct the species IN PLACE and
            // stay on the results page so the angler can CONFIRM / Save.
            setOverrideId(chosen);
            setFeedbackState('unset');
          }}
          onNoneMatch={() => {
            setModal(null);
            onManual();
          }}
        />
      )}
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
  const { size, cols: gridCols, type } = useScreenSize();
  // Re-render when the categories overlay refreshes so admin edits
  // reflect immediately on the mobile app after the next boot pull.
  const [, bump] = useState(0);
  useEffect(() => subscribeCategories(() => bump(v => v + 1)), []);
  const activeCategories = getCategories();
  const counts = useMemo(() => {
    const map = {};
    SPECIES.forEach(s => { map[s.category] = (map[s.category] || 0) + 1; });
    return map;
  }, []);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={type.h1} style={{ marginBottom: 14 }}>Browse by category</H1>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols.categories}, 1fr)`, gap: size === 'phone' ? 12 : 16 }}>
        {activeCategories.map(c => {
          // Admin-set rep_species_id from the overlay wins; otherwise
          // fall back to the bundled CATEGORY_REP_SPECIES map, then
          // to the first species in the category.
          const repId = c.rep_species_id || CATEGORY_REP_SPECIES[c.id];
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
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: T.ink }}>{c.name}</div>
                <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{counts[c.id] || 0} species</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function CategoryScreen({ catId, state, update, onPick }) {
  const cat = getCategories().find(c => c.id === catId) || CATEGORIES.find(c => c.id === catId);
  const favSet = useMemo(() => new Set(state?.favorites || []), [state?.favorites]);
  const toggleFav = (id) => {
    if (!update) return;
    const next = new Set(favSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ favorites: Array.from(next) });
  };
  const list = useMemo(() => {
    const base = SPECIES.filter(s => s.category === catId && s.active !== false)
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
    return base.sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0));
  }, [catId, favSet]);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>{cat?.name || 'Category'}</H1>
      <div style={{ fontSize: 14, color: T.inkMute, marginBottom: 14 }}>{list.length} species</div>
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
    return SPECIES.filter(s => s.active !== false).map(s => {
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
          style={{ ...inputStyle, paddingLeft: 38, fontSize: 17, background: T.card }}
        />
      </div>
      {!q && (
        <div style={{ fontSize: 15, color: T.inkMute, padding: '20px 12px', textAlign: 'center', background: T.parchmentDeep, borderRadius: 4 }}>
          Try "snapper," "mahi," "kingfish," "mangrove," or any Gulf species name.
        </div>
      )}
      {q && results.length === 0 && (
        <div style={{ fontSize: 15, color: T.inkMute, padding: 12 }}>No matches. Try a different spelling or category.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(r => (
          <Card key={r.s.id} onClick={() => onPick(r.s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <SpeciesImage species={r.s} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600 }}>{r.s.commonName}</div>
              {r.matchedAlt && <div style={{ fontSize: 12, color: T.brassDeep }}>also: {r.matchedAlt}</div>}
              <div style={{ fontSize: 12, color: T.inkMute, fontStyle: 'italic' }}>{r.s.scientific}</div>
            </div>
            <ChevronRight size={18} color={T.brass} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   WEATHER FORECAST
   ============================================================
   Multi-day forecast driven by Open-Meteo. Uses the last catch's
   coordinates as an anchor if the user hasn't granted geolocation
   this session, otherwise asks native. Falls back to the geographic
   center of the current jurisdiction so the screen always shows
   *something* actionable rather than a blank error state. */
/* ============================================================
   Home — PB spotlight card (dynamic random pick + share)
   ============================================================
   Renders a random PB with photo, key stats, and Share + Shuffle
   controls. Falls back to the old static entry-point button when
   the angler has no PBs on file yet. */
function PBSpotlightCard({ state, onPBs, onView, isTablet }) {
  const pbs = state?.pbs || {};
  const ids = useMemo(() => Object.keys(pbs), [pbs]);
  // Pick a random PB; a shuffle counter forces a new pick without
  // reshuffling every render.
  const [shuffle, setShuffle] = useState(0);
  const currentId = useMemo(() => {
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)];
    // shuffle dep is intentional to reroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffle, ids]);
  const [sharing, setSharing] = useState(false);

  // Zero-PB case: keep the compact button so onboarding is unchanged.
  if (!currentId) {
    return (
      <button onClick={onPBs} style={{
        marginTop: 14, width: '100%',
        background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 18,
        padding: '16px 14px', cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Trophy size={28} color={T.brass} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink, letterSpacing: 1.3 }}>MY PERSONAL BESTS</div>
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>Log a catch to earn your first PB</div>
        </div>
        <ChevronRight size={18} color={T.brass} />
      </button>
    );
  }

  const pb = pbs[currentId];
  const sp = speciesById(currentId);
  const photos = pbPhotos(pb);
  const photo = photos[0] || null;
  const photoUrl = photo ? photoDisplayUrl(photo) : null;
  const anglerName = state.anglerName || '';
  const units = state.units;

  // Runtime dump: raw pb.photos / pb.photo / resolved URL / typeof.
  // This is the trace we need to see when the spotlight fails to show
  // a photo — one line, per render, so we can diff against Catch
  // Detail (which uses the same PhotoImg + same resolver now).
  useEffect(() => {
    if (typeof console === 'undefined') return;
    // eslint-disable-next-line no-console
    console.log('[PBSpotlight] resolve', {
      pbId: currentId,
      hasPhotosArray: Array.isArray(pb.photos),
      photosLen: Array.isArray(pb.photos) ? pb.photos.length : null,
      firstEntryType: photo ? typeof photo : 'null',
      firstEntryShape: photo && typeof photo === 'object'
        ? Object.keys(photo)
        : (typeof photo === 'string' ? photo.slice(0, 24) + '…' : null),
      legacyPhotoField: pb.photo ? (typeof pb.photo === 'string' ? pb.photo.slice(0, 24) + '…' : Object.keys(pb.photo)) : null,
      resolvedUrl: photoUrl ? (photoUrl.slice ? photoUrl.slice(0, 80) + '…' : String(photoUrl).slice(0, 80)) : null,
    });
  }, [currentId, photo, photoUrl, pb]);
  const primary = pb.primaryMetric === 'weight'
    ? { val: formatWeight(pb.weight, units), label: 'Weight' }
    : { val: formatSize(pb.length, units), label: 'Length' };
  const secondary = pb.primaryMetric === 'weight'
    ? { val: formatSize(pb.length, units), label: 'Length' }
    : { val: formatWeight(pb.weight, units), label: 'Weight' };
  const dateLabel = pb.date
    ? new Date(pb.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  const doShare = async (e) => {
    e.stopPropagation();
    if (sharing || !sp) return;
    setSharing(true);
    try {
      const text = buildPBReport({ anglerName, species: sp, pb, units });
      const dataUrls = (await Promise.all(photos.slice(0, 3).map(photoAsDataUrl))).filter(Boolean);
      await shareReport({
        title: `${(anglerName || 'My').trim() || 'My'} ${sp.commonName} PB`,
        text, photoDataUrls: dataUrls,
        fileName: `pb-${currentId}`,
      });
    } finally {
      setSharing(false);
    }
  };

  const doShuffle = (e) => {
    e.stopPropagation();
    if (ids.length <= 1) return;
    setShuffle(n => n + 1);
  };

  const openDetail = () => onView && onView(currentId);

  return (
    <div style={{
      marginTop: 14,
      background: T.card, border: `1px solid ${T.brass}55`, borderRadius: 18,
      overflow: 'hidden', position: 'relative',
      boxShadow: '0 0 0 1px rgba(25, 212, 242, 0.05) inset',
    }}>
      {/* Header row — clickable to open PB detail. */}
      <button onClick={openDetail} style={{
        width: '100%', background: 'transparent', border: 'none',
        padding: isTablet ? '14px 18px 8px' : '12px 14px 6px',
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        textAlign: 'left',
      }}>
        <Trophy size={isTablet ? 24 : 20} color={T.brass} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isTablet ? 14 : 11, fontWeight: 800, color: T.brass, letterSpacing: 1.4 }}>
            PERSONAL BEST SPOTLIGHT
          </div>
          <div style={{ fontSize: isTablet ? 11 : 10, color: T.inkMute, marginTop: 2 }}>
            {ids.length} on file · showing 1 at random
          </div>
        </div>
        <ChevronRight size={isTablet ? 20 : 18} color={T.brass} />
      </button>

      {/* Media + stats */}
      <button onClick={openDetail} style={{
        width: '100%', background: 'transparent', border: 'none',
        padding: 0, cursor: 'pointer', textAlign: 'left',
        display: isTablet ? 'flex' : 'block', gap: isTablet ? 18 : 0,
      }}>
        <div style={{
          width: isTablet ? '45%' : '100%',
          // Explicit aspect-ratio gives the container a real height
          // so the <img> height:100% resolves — the earlier layout
          // set only min-height on the flex parent, which meant the
          // img could collapse to 0 tall and the photo never showed.
          aspectRatio: isTablet ? '4 / 3' : '4 / 3',
          background: T.parchmentDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {photo
            ? <PhotoImg
                photo={photo}
                debugTag="PBSpotlight"
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover', objectPosition: 'center',
                  display: 'block',
                }}
              />
            : <Fish size={isTablet ? 72 : 56} color={T.inkMute} strokeWidth={1.3} />}
        </div>
        <div style={{
          flex: isTablet ? 1 : undefined,
          padding: isTablet ? '18px 20px' : '14px 16px',
        }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 24 : 20, fontWeight: 700, color: T.ink }}>
            {sp ? sp.commonName : (currentId || 'Unknown species')}
          </div>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: isTablet ? 11 : 10, letterSpacing: 1.4, color: T.inkMute, fontWeight: 700 }}>
                {primary.label.toUpperCase()}
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 32 : 26, fontWeight: 800, color: T.brass, marginTop: 2 }}>
                {primary.val || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: isTablet ? 11 : 10, letterSpacing: 1.4, color: T.inkMute, fontWeight: 700 }}>
                {secondary.label.toUpperCase()}
              </div>
              <div style={{ fontSize: isTablet ? 16 : 14, fontWeight: 700, color: T.ink, marginTop: 2 }}>
                {secondary.val || '—'}
              </div>
            </div>
          </div>
          {dateLabel && (
            <div style={{ fontSize: isTablet ? 13 : 11, color: T.inkSoft, marginTop: 8 }}>
              {dateLabel}{pb.location ? ` · ${pb.location}` : ''}
            </div>
          )}
        </div>
      </button>

      {/* Actions row */}
      <div style={{
        display: 'flex', gap: 8,
        padding: isTablet ? '12px 20px 16px' : '10px 14px 14px',
        borderTop: `1px solid ${T.cardEdge}`,
      }}>
        <button
          onClick={doShare}
          disabled={sharing}
          style={{
            flex: 1, background: T.brass, color: T.oceanDeep, border: 'none',
            padding: isTablet ? '12px 14px' : '10px 12px', borderRadius: 8,
            fontSize: isTablet ? 14 : 12.5, fontWeight: 800, letterSpacing: 0.8,
            cursor: sharing ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: sharing ? 0.7 : 1,
          }}
        >
          <Share2 size={isTablet ? 18 : 15} /> {sharing ? 'Sharing…' : 'Share'}
        </button>
        <button
          onClick={doShuffle}
          disabled={ids.length <= 1}
          aria-label="Shuffle to another PB"
          style={{
            background: 'transparent', color: T.brass,
            border: `1.5px solid ${T.brass}`,
            padding: isTablet ? '12px 14px' : '10px 12px', borderRadius: 8,
            fontSize: isTablet ? 14 : 12.5, fontWeight: 800, letterSpacing: 0.8,
            cursor: ids.length <= 1 ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            opacity: ids.length <= 1 ? 0.5 : 1,
          }}
        >
          <Shuffle size={isTablet ? 18 : 15} /> Shuffle
        </button>
        <button
          onClick={openDetail}
          style={{
            background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
            padding: isTablet ? '12px 14px' : '10px 12px', borderRadius: 8,
            fontSize: isTablet ? 14 : 12.5, fontWeight: 800, letterSpacing: 0.8,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          View all
        </button>
      </div>
    </div>
  );
}

export function WeatherForecastScreen({ jurisdiction, state, update }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const [coords, setCoords]   = useState(null);
  const [locLabel, setLocLabel] = useState('');
  // Saved fishing spots — synced user state. selectedSpotId tracks
  // which chip is active ('current' = live GPS).
  const spots = Array.isArray(state?.fishingSpots) ? state.fishingSpots : [];
  const [selectedSpotId, setSelectedSpotId] = useState('current');
  // First-visit explainer for the spots feature. Dismiss-once via
  // localStorage; deliberately device-local (a returning user on a
  // new device gets the one-time refresher, which is fine).
  const [showSpotsIntro, setShowSpotsIntro] = useState(() => {
    try { return localStorage.getItem('kyc_spots_intro_dismissed') !== '1'; }
    catch { return true; }
  });
  const dismissSpotsIntro = () => {
    setShowSpotsIntro(false);
    try { localStorage.setItem('kyc_spots_intro_dismissed', '1'); } catch {}
  };

  const selectSpot = (spot) => {
    setSelectedSpotId(spot.id);
    setCoords({ lat: spot.lat, lon: spot.lon });
    setLocLabel(spot.name);
  };
  const starSpot = (id) => {
    if (!update) return;
    update({ fishingSpots: spots.map(sp => ({ ...sp, starred: sp.id === id })) });
  };
  const deleteSpot = (id) => {
    if (!update) return;
    if (!window.confirm('Remove this fishing spot?')) return;
    update({ fishingSpots: spots.filter(sp => sp.id !== id) });
    if (selectedSpotId === id) useMyLocation();
  };
  const saveSpot = (lat, lon, suggestedName) => {
    if (!update) return null;
    const name = window.prompt('Name this fishing spot:', suggestedName || '');
    if (!name || !name.trim()) return null;
    const spot = {
      id: `spot_${Date.now().toString(36)}`,
      name: name.trim(),
      lat, lon,
      // First saved spot becomes the starred home water automatically.
      starred: spots.length === 0,
    };
    update({ fishingSpots: [...spots, spot] });
    return spot;
  };
  const [current, setCurrent] = useState(null);
  const [daily, setDaily]     = useState([]);
  const [hourly, setHourly]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [changing, setChanging]     = useState(false);
  const [searchQ, setSearchQ]       = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]   = useState(false);
  const [searchError, setSearchError] = useState('');

  const useMyLocation = async () => {
    setChanging(false); setSearchQ(''); setSearchResults([]);
    setSelectedSpotId('current');
    try {
      const loc = await getLocation();
      if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
        setCoords({ lat: loc.lat, lon: loc.lon });
        setLocLabel('Your current location');
        return;
      }
    } catch {}
    // If geolocation fails, fall back to jurisdiction center as a safe default.
    const jc = jurisdiction?.center;
    if (jc) {
      setCoords({ lat: jc.lat, lon: jc.lon });
      setLocLabel(jurisdiction.name || 'Selected waters');
    }
  };

  const runSearch = async () => {
    const q = searchQ.trim();
    if (!q) return;
    setSearching(true); setSearchError('');
    try {
      // The geocoder matches PLACE NAMES only — "Gulf Shores, AL"
      // as one string finds nothing, which made zip codes feel
      // mandatory. Split a trailing state (abbreviation or full
      // name) off the query, search on the city alone, then filter
      // the results by that state.
      let namePart = q;
      let stateFilter = null;
      const commaIdx = q.lastIndexOf(',');
      if (commaIdx > 0) {
        const tail = q.slice(commaIdx + 1).trim();
        const full = US_STATES[tail.toUpperCase()] || (
          Object.values(US_STATES).find(n => n.toLowerCase() === tail.toLowerCase())
        );
        if (full) {
          namePart = q.slice(0, commaIdx).trim();
          stateFilter = full.toLowerCase();
        }
      }
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(namePart)}&count=20&language=en&format=json`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`geocoding ${r.status}`);
      const j = await r.json();
      let results = (j?.results || []).map(x => ({
        lat: x.latitude, lon: x.longitude,
        admin1: x.admin1 || '',
        country: x.country_code || '',
        label: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '),
      }));
      if (stateFilter) {
        const filtered = results.filter(x =>
          x.country === 'US' && x.admin1.toLowerCase() === stateFilter);
        // Only narrow when the filter still leaves matches — a miss
        // (admin1 quirk) shouldn't blank the list entirely.
        if (filtered.length > 0) results = filtered;
      } else {
        // No state given: float US matches to the top — this is a
        // Gulf fishing app, Paris TX beats Paris FR.
        results.sort((a, b) => (b.country === 'US') - (a.country === 'US'));
      }
      results = results.slice(0, 8);
      setSearchResults(results);
      if (results.length === 0) setSearchError('No matches. Try "city, state" (e.g. Gulf Shores, AL) or a zip code.');
    } catch (e) {
      setSearchError(e?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r) => {
    setCoords({ lat: r.lat, lon: r.lon });
    setLocLabel(r.label);
    setSelectedSpotId(null); // one-off view, not a saved spot
    setChanging(false); setSearchQ(''); setSearchResults([]);
  };
  const pickAndSaveResult = (r) => {
    const spot = saveSpot(r.lat, r.lon, r.label.split(',')[0]);
    if (spot) selectSpot(spot);
    else pickResult(r);
    setChanging(false); setSearchQ(''); setSearchResults([]);
  };

  // Resolve a lat/lon to fetch from. Priority:
  //   1) Live geolocation (best-effort, silent fallback).
  //   2) Most recent catch's coords.
  //   3) Jurisdiction center (data.js).
  useEffect(() => {
    let alive = true;
    (async () => {
      const recent = (state?.catchLog || []).find(c => c.lat != null && c.lon != null);
      const jurCenter = jurisdiction?.center;
      const fallback = recent
        ? { lat: recent.lat, lon: recent.lon, label: 'Last catch location' }
        : jurCenter
          ? { lat: jurCenter.lat, lon: jurCenter.lon, label: jurisdiction.name || 'Selected waters' }
          : { lat: 27.5, lon: -84, label: 'Gulf of Mexico' };
      try {
        const loc = await getLocation();
        if (!alive) return;
        if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
          setCoords({ lat: loc.lat, lon: loc.lon });
          setLocLabel('Your current location');
          return;
        }
      } catch {}
      if (!alive) return;
      setCoords({ lat: fallback.lat, lon: fallback.lon });
      setLocLabel(fallback.label);
    })();
    return () => { alive = false; };
  }, [state?.catchLog, jurisdiction]);

  useEffect(() => {
    if (!coords) return undefined;
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { lat, lon } = coords;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
          + `&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl,weather_code`
          + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant`
          + `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code`
          + `&forecast_days=7`
          + `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`open-meteo ${r.status}`);
        const j = await r.json();
        if (!alive) return;
        setCurrent(j.current || null);
        // daily arrays are parallel by index
        const d = j.daily || {};
        const days = (d.time || []).map((iso, i) => ({
          date: iso,
          weatherCode: d.weather_code?.[i],
          tMax: d.temperature_2m_max?.[i],
          tMin: d.temperature_2m_min?.[i],
          precip: d.precipitation_sum?.[i],
          windMax: d.wind_speed_10m_max?.[i],
          windDir: d.wind_direction_10m_dominant?.[i],
        }));
        setDaily(days);
        const h = j.hourly || {};
        const nowMs = Date.now();
        const hoursOut = (h.time || []).map((iso, i) => ({
          when: new Date(iso).getTime(),
          temp: h.temperature_2m?.[i],
          precipPct: h.precipitation_probability?.[i],
          wind: h.wind_speed_10m?.[i],
          weatherCode: h.weather_code?.[i],
        })).filter(x => x.when >= nowMs - 60 * 60 * 1000).slice(0, 24);
        setHourly(hoursOut);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Could not load forecast.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [coords]);

  return (
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px', maxWidth: '100%', overflowX: 'hidden' }}>
      <H1 size={isTablet ? 30 : 22} style={{ marginBottom: 4 }}>Weather Forecast</H1>

      {/* One-time explainer for Fishing Spots. */}
      {showSpotsIntro && (
        <Card style={{ marginBottom: 12, padding: isTablet ? 16 : 12, borderColor: T.brass }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: isTablet ? 14 : 12, color: T.inkSoft, lineHeight: 1.55 }}>
              <strong style={{ color: T.ink }}>Fishing Spots</strong> — save the places you fish
              and switch the forecast between them with one tap. Star ★ your main spot
              ("where you fish"): that's the water ReelIntel will watch to recognize and
              notify you of the best fishing days — a feature coming soon.
            </div>
            <button onClick={dismissSpotsIntro} aria-label="Dismiss"
              style={{
                background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass,
                borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 800,
                cursor: 'pointer', flexShrink: 0,
              }}>
              GOT IT
            </button>
          </div>
        </Card>
      )}

      {/* Spots chips — current location + saved spots + add. */}
      <div className="kyc-hscroll" style={{
        display: 'flex', gap: 8, alignItems: 'center',
        overflowX: 'auto', overflowY: 'hidden',
        margin: '0 0 10px', paddingBottom: 4,
      }}>
        <button onClick={useMyLocation} style={{
          flexShrink: 0,
          background: selectedSpotId === 'current' ? T.brass : 'transparent',
          color: selectedSpotId === 'current' ? T.oceanDeep : T.brass,
          border: `1.5px solid ${T.brass}`, borderRadius: 999,
          padding: '7px 14px', fontSize: 14, fontWeight: 800,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          whiteSpace: 'nowrap',
        }}>
          <MapPin size={13} /> Current location
        </button>
        {spots.map(sp => {
          const active = selectedSpotId === sp.id;
          return (
            <span key={sp.id} style={{
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
              background: active ? T.brass : T.parchmentDeep,
              border: `1.5px solid ${active ? T.brass : T.cardEdge}`,
              borderRadius: 999, overflow: 'hidden', whiteSpace: 'nowrap',
            }}>
              <button onClick={() => starSpot(sp.id)}
                aria-label={sp.starred ? `${sp.name} is your main spot` : `Make ${sp.name} your main spot`}
                title="Star = your main fishing spot"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '7px 4px 7px 12px', fontSize: 15, lineHeight: 1,
                  color: sp.starred ? (active ? T.oceanDeep : '#FFC857') : (active ? 'rgba(3,27,51,0.45)' : T.inkMute),
                }}>
                {sp.starred ? '★' : '☆'}
              </button>
              <button onClick={() => selectSpot(sp)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '7px 6px', fontSize: 14, fontWeight: 800,
                color: active ? T.oceanDeep : T.ink, whiteSpace: 'nowrap',
              }}>
                {sp.name}
              </button>
              <button onClick={() => deleteSpot(sp.id)} aria-label={`Remove ${sp.name}`} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '7px 12px 7px 4px', fontSize: 14, lineHeight: 1,
                color: active ? 'rgba(3,27,51,0.55)' : T.inkMute,
              }}>
                ×
              </button>
            </span>
          );
        })}
        <button onClick={() => setChanging(true)} style={{
          flexShrink: 0,
          background: 'transparent', color: T.inkSoft,
          border: `1.5px dashed ${T.cardEdge}`, borderRadius: 999,
          padding: '7px 14px', fontSize: 14, fontWeight: 800,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          + Add spot
        </button>
      </div>

      {/* Location bar: current label + change button OR the search UI. */}
      {!changing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isTablet ? 18 : 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: isTablet ? 15 : 12, color: T.brassDeep, fontWeight: 600 }}>
              {locLabel || (coords ? `${coords.lat.toFixed(2)}°, ${coords.lon.toFixed(2)}°` : '—')}
            </div>
            {coords && (
              <div style={{ fontSize: isTablet ? 12 : 10, color: T.inkMute, marginTop: 2 }}>
                {coords.lat.toFixed(3)}°, {coords.lon.toFixed(3)}°
              </div>
            )}
          </div>
          {coords && selectedSpotId === null && (
            <GhostButton
              onClick={() => { const sp = saveSpot(coords.lat, coords.lon, locLabel.split(',')[0]); if (sp) selectSpot(sp); }}
              style={{ padding: '6px 12px', fontSize: 14, color: T.brass, borderColor: T.brass }}>
              Save spot
            </GhostButton>
          )}
          <GhostButton onClick={() => setChanging(true)} style={{ padding: '6px 12px', fontSize: 14 }}>
            Change
          </GhostButton>
        </div>
      ) : (
        <Card style={{ marginBottom: 14, padding: isTablet ? 16 : 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <SectionLabel style={{ flex: 1 }}>Change location</SectionLabel>
            <button onClick={() => { setChanging(false); setSearchQ(''); setSearchResults([]); setSearchError(''); }}
              style={{ background: 'transparent', border: 'none', color: T.inkSoft, fontSize: 14, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="search" value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              placeholder='e.g. Gulf Shores, AL — or a zip'
              autoFocus
              style={{
                flex: 1, background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
                borderRadius: 6, color: T.ink, padding: '10px 12px', fontSize: 16,
              }}
            />
            <PrimaryButton onClick={runSearch} disabled={searching || !searchQ.trim()} style={{ width: 'auto', padding: '10px 16px', fontSize: 15 }}>
              {searching ? 'Searching…' : 'Search'}
            </PrimaryButton>
          </div>
          <div style={{ marginBottom: searchResults.length ? 8 : 0 }}>
            <button onClick={useMyLocation} style={{
              background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass,
              borderRadius: 6, padding: '8px 12px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <MapPin size={14} /> Use my current location
            </button>
          </div>
          {searchError && (
            <div style={{ fontSize: 14, color: T.closed, marginTop: 4 }}>{searchError}</div>
          )}
          {searchResults.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {searchResults.map((r, i) => (
                <div key={i} style={{
                  background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <button onClick={() => pickResult(r)} style={{
                    background: 'transparent', border: 'none', color: T.ink,
                    fontSize: 15, textAlign: 'left', cursor: 'pointer',
                    flex: 1, minWidth: 0, padding: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.label}
                  </button>
                  <button onClick={() => pickAndSaveResult(r)} style={{
                    background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass,
                    borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 800,
                    cursor: 'pointer', flexShrink: 0,
                  }}>
                    SAVE AS SPOT
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {loading && !current && (
        <Card style={{ padding: 20, textAlign: 'center', color: T.inkMute, fontSize: 15 }}>
          Loading forecast…
        </Card>
      )}

      {error && !loading && (
        <Card style={{ padding: 14, borderColor: T.closed, fontSize: 15, color: T.closed }}>
          {error}
        </Card>
      )}

      {current && !loading && (
        <>
          {/* Current conditions hero */}
          <Card style={{
            marginBottom: 14, padding: isTablet ? 22 : 16,
            display: 'flex', alignItems: 'center', gap: 20,
            background: T.oceanDeep,
          }}>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              {weatherIcon(current.weather_code, isTablet ? 56 : 44, T.warn)}
              <div style={{ fontSize: isTablet ? 44 : 36, fontWeight: 900, color: T.ink, marginTop: 6, lineHeight: 1 }}>
                {Math.round(current.temperature_2m)}°
              </div>
              <div style={{ fontSize: isTablet ? 14 : 11, color: T.inkMute, marginTop: 6 }}>
                {weatherLabel(current.weather_code)}
              </div>
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: isTablet ? 14 : 10 }}>
              <ConditionStat label="WIND"     value={`${compassDir(current.wind_direction_10m || 0)} ${Math.round(current.wind_speed_10m || 0)} mph`} />
              <ConditionStat label="CLOUDS"   value={`${Math.round(current.cloud_cover || 0)}%`} />
              <ConditionStat label="PRESSURE" value={`${(current.pressure_msl || 0).toFixed(1)} mb`} />
              <ConditionStat label="RAIN"     value={`${(current.precipitation || 0).toFixed(2)} mm`} />
            </div>
          </Card>

          {/* Next 24 hours strip */}
          {hourly.length > 0 && (
            <Card style={{ marginBottom: 14, padding: isTablet ? 20 : 14 }}>
              <SectionLabel style={{ marginBottom: 10 }}>Next 24 hours</SectionLabel>
              <div className="kyc-hscroll" style={{
                display: 'flex', gap: isTablet ? 14 : 10,
                overflowX: 'auto', overflowY: 'hidden',
                margin: '0 -8px', padding: '0 8px 6px',
                scrollSnapType: 'x proximity',
              }}>
                {hourly.map((h, i) => {
                  const d = new Date(h.when);
                  const hour = d.getHours();
                  const label = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
                  return (
                    <div key={i} style={{
                      flex: `0 0 ${isTablet ? 84 : 66}px`,
                      textAlign: 'center', padding: '10px 6px',
                      background: T.parchmentDeep, borderRadius: 8,
                      border: `1px solid ${T.cardEdge}`,
                      scrollSnapAlign: 'start',
                    }}>
                      <div style={{ fontSize: isTablet ? 12 : 10, color: T.inkMute, letterSpacing: 0.8 }}>{label}</div>
                      <div style={{ margin: '6px auto' }}>{weatherIcon(h.weatherCode, isTablet ? 26 : 22, T.brass)}</div>
                      <div style={{ fontSize: isTablet ? 18 : 15, fontWeight: 800, color: T.ink }}>{Math.round(h.temp)}°</div>
                      <div style={{ fontSize: isTablet ? 11 : 9, color: T.inkMute, marginTop: 4 }}>{Math.round(h.precipPct || 0)}% rain</div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* 7-day outlook */}
          {daily.length > 0 && (
            <Card style={{ padding: isTablet ? 20 : 14 }}>
              <SectionLabel style={{ marginBottom: 10 }}>7-day outlook</SectionLabel>
              <div style={{ display: 'grid', gap: isTablet ? 10 : 6 }}>
                {daily.map((d, i) => {
                  const dt = new Date(d.date + 'T00:00:00');
                  const day = i === 0
                    ? 'Today'
                    : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                  return (
                    <div key={d.date} style={{
                      // Every cell can shrink (minWidth:0 + ellipsis) so the
                      // row NEVER exceeds the card — the old fixed widths
                      // summed past a phone's width and shoved the whole
                      // page sideways.
                      display: 'flex', alignItems: 'center', gap: isTablet ? 12 : 8,
                      padding: isTablet ? '12px 14px' : '10px 10px',
                      background: T.parchmentDeep, borderRadius: 8,
                      border: `1px solid ${T.cardEdge}`,
                      maxWidth: '100%', overflow: 'hidden',
                    }}>
                      <div style={{
                        fontSize: isTablet ? 15 : 12, fontWeight: 700, color: T.ink,
                        width: isTablet ? 140 : 88, flexShrink: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{day}</div>
                      <span style={{ flexShrink: 0, display: 'inline-flex' }}>
                        {weatherIcon(d.weatherCode, isTablet ? 28 : 22, T.brass)}
                      </span>
                      <div style={{
                        flex: 1, minWidth: 0, fontSize: isTablet ? 14 : 11, color: T.inkSoft,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {weatherLabel(d.weatherCode)}
                      </div>
                      <div style={{ fontSize: isTablet ? 14 : 11, color: T.inkMute, flexShrink: 0, textAlign: 'right' }}>
                        {compassDir(d.windDir || 0)} {Math.round(d.windMax || 0)}
                      </div>
                      <div style={{
                        fontSize: isTablet ? 16 : 13, fontWeight: 800, color: T.ink,
                        flexShrink: 0, textAlign: 'right',
                      }}>
                        <span style={{ color: T.warn }}>{Math.round(d.tMax)}°</span>
                        <span style={{ color: T.inkMute, margin: '0 4px' }}>·</span>
                        <span style={{ color: T.inkSoft }}>{Math.round(d.tMin)}°</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{ fontSize: isTablet ? 12 : 11, color: T.inkMute, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
            Data from Open-Meteo. Always confirm marine conditions with your local NOAA/NWS forecast before heading out.
          </div>
        </>
      )}
    </div>
  );
}

/* US state abbreviation -> full name, for "city, ST" weather-spot
   searches (the geocoder's admin1 field carries the full name). */
const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico',
};

/* Local copy of the compass helper — screens2 keeps its own copy for
   the catch detail screen; duplicating avoids a circular import here. */
function compassDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

/* Compact WMO weather-code → label + icon. Open-Meteo returns a
   code; we map to a coarse category rather than string-per-code. */
function weatherLabel(code) {
  if (code == null) return 'Unknown';
  if (code === 0) return 'Clear';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 85 && code <= 86) return 'Snow showers';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Mixed';
}
function weatherIcon(code, size, color) {
  // Coarse mapping to the icons already imported in this file — same
  // vocabulary as HomeScreen's Today's Conditions card, so the two
  // surfaces feel consistent without a new icon set.
  if (code == null) return <CloudSun size={size} color={color} strokeWidth={1.8} />;
  if (code >= 95 && code <= 99) return <Waves size={size} color={color} strokeWidth={1.8} />; // thunderstorm proxy
  if (code >= 51 && code <= 82) return <Waves size={size} color={color} strokeWidth={1.8} />; // rain
  if (code >= 71 && code <= 77) return <CloudSun size={size} color={color} strokeWidth={1.8} />;
  if (code === 45 || code === 48) return <CloudSun size={size} color={color} strokeWidth={1.8} />;
  return <CloudSun size={size} color={color} strokeWidth={1.8} />;
}
