import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fish, Search, ChevronRight, AlertTriangle, Plus, Pencil, BookOpen,
  Trophy, Camera, Trash2, Mail, Anchor, ListChecks, Wrench, Layers, X,
  RotateCcw, Image as ImageIcon, Sparkles, ArrowLeft,
  MapPin, Ruler, ClipboardList, CloudSun, Wind, Waves, Thermometer,
  CheckCircle2, ShieldCheck, MoreHorizontal, BarChart2, Share2, Shuffle,
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
  inputStyle,
} from './components.jsx';
import { identifyPhoto, ANALYSIS_FEATURES } from './identifyPhoto.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';

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
            fontSize: 11, color: T.inkMute, textAlign: 'center', lineHeight: 1.5,
            marginTop: 10, padding: '0 12px',
          }}>
            Sign in syncs your catches, PBs, and photos across your iPhone and iPad.
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', bottom: 30, color: T.inkMute, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
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
  onCapture, onSelectFromLibrary, onViewCatch, onViewCatches, onForecast,
}) {
  const isTablet = screenSize === 'tablet' || screenSize === 'tablet-landscape';
  const isLandscape = screenSize === 'tablet-landscape';
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
          <div style={{ fontSize: 13, color: T.ink }}>
            <strong>Regulations data is more than 7 days old.</strong> Connect to internet when possible to refresh.
          </div>
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
                      fontSize: 12, fontWeight: 800, color: T.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s ? s.commonName : 'Unknown'}
                    </div>
                    <div style={{ fontSize: 10, color: T.inkMute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
            <span style={{ fontSize: 11, color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>TODAY'S CONDITIONS</span>
            {onForecast && (
              <button onClick={onForecast} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 10, fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW FORECAST</button>
            )}
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
          flex: isTablet ? '1 1 0' : '0 0 320px',
          padding: 14, borderRadius: 18,
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
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
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
    <div style={{ padding: isTablet ? '26px 22px' : '18px 16px' }}>
      <H1 size={isTablet ? (isLandscape ? 32 : 30) : 24} style={{ marginBottom: 6 }}>Fish ID</H1>
      <p style={{ fontSize: isTablet ? 16 : 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: isTablet ? 22 : 16 }}>
        Take or upload a photo to identify your catch.
      </p>

      {/* Primary photo capture card */}
      <button onClick={() => fileRef.current?.click()} style={{
        width: '100%', background: T.oceanDeep, color: T.parchment,
        border: `2px solid ${T.brass}`, borderRadius: 6,
        padding: isTablet ? '40px 24px' : '28px 18px',
        cursor: 'pointer', textAlign: 'center', marginBottom: isTablet ? 22 : 18,
        boxShadow: '0 2px 0 rgba(124, 86, 24, 0.15)',
      }}>
        <div style={{
          background: T.brass, color: T.oceanDeep,
          width: isTablet ? 100 : 72, height: isTablet ? 100 : 72,
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: isTablet ? '0 auto 20px' : '0 auto 14px',
        }}>
          <Camera size={isTablet ? 52 : 36} />
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 28 : 20, fontWeight: 600 }}>Photo identification</div>
        <div style={{ fontSize: isTablet ? 15 : 12, color: '#B8C5CD', marginTop: isTablet ? 8 : 4 }}>Take a photo or pick from your library</div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: isTablet ? '14px 0 20px' : '8px 0 14px', color: T.inkMute }}>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
        <SectionLabel style={{ fontSize: isTablet ? 13 : 11 }}>or identify manually</SectionLabel>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: isTablet ? 14 : 10 }}>
        <BigButton isTablet={isTablet} onClick={onBrowse} icon={<Layers size={isTablet ? 32 : 24} />} title="Browse by category" subtitle="Snapper, grouper, mackerel, jacks…" />
        <BigButton isTablet={isTablet} onClick={onSearch} icon={<Search size={isTablet ? 32 : 24} />} title="Search by name" subtitle="Common names, scientific, regional" />
      </div>
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
          <div style={{ fontSize: 13, fontWeight: 800, color: T.ink, letterSpacing: 1.3 }}>MY PERSONAL BESTS</div>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>Log a catch to earn your first PB</div>
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
          minHeight: isTablet ? 200 : 180,
          background: T.parchmentDeep,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {photoUrl
            ? <img src={photoUrl} alt="" style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                display: 'block',
                minHeight: isTablet ? 200 : 180,
              }} />
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

export function WeatherForecastScreen({ jurisdiction, state }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const [coords, setCoords]   = useState(null);
  const [locLabel, setLocLabel] = useState('');
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
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`geocoding ${r.status}`);
      const j = await r.json();
      const results = (j?.results || []).map(x => ({
        lat: x.latitude, lon: x.longitude,
        label: [x.name, x.admin1, x.country_code].filter(Boolean).join(', '),
      }));
      setSearchResults(results);
      if (results.length === 0) setSearchError('No matches. Try a city name or zip code.');
    } catch (e) {
      setSearchError(e?.message || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r) => {
    setCoords({ lat: r.lat, lon: r.lon });
    setLocLabel(r.label);
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
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px' }}>
      <H1 size={isTablet ? 30 : 22} style={{ marginBottom: 4 }}>Weather Forecast</H1>

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
          <GhostButton onClick={() => setChanging(true)} style={{ padding: '6px 12px', fontSize: 12 }}>
            Change
          </GhostButton>
        </div>
      ) : (
        <Card style={{ marginBottom: 14, padding: isTablet ? 16 : 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <SectionLabel style={{ flex: 1 }}>Change location</SectionLabel>
            <button onClick={() => { setChanging(false); setSearchQ(''); setSearchResults([]); setSearchError(''); }}
              style={{ background: 'transparent', border: 'none', color: T.inkSoft, fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="search" value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
              placeholder="City, state, or zip"
              autoFocus
              style={{
                flex: 1, background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
                borderRadius: 6, color: T.ink, padding: '10px 12px', fontSize: 14,
              }}
            />
            <PrimaryButton onClick={runSearch} disabled={searching || !searchQ.trim()} style={{ width: 'auto', padding: '10px 16px', fontSize: 13 }}>
              {searching ? 'Searching…' : 'Search'}
            </PrimaryButton>
          </div>
          <div style={{ marginBottom: searchResults.length ? 8 : 0 }}>
            <button onClick={useMyLocation} style={{
              background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass,
              borderRadius: 6, padding: '8px 12px', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <MapPin size={14} /> Use my current location
            </button>
          </div>
          {searchError && (
            <div style={{ fontSize: 12, color: T.closed, marginTop: 4 }}>{searchError}</div>
          )}
          {searchResults.length > 0 && (
            <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              {searchResults.map((r, i) => (
                <button key={i} onClick={() => pickResult(r)} style={{
                  background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 6,
                  color: T.ink, padding: '10px 12px', fontSize: 13,
                  textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                }}>
                  <span>{r.label}</span>
                  <span style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace' }}>
                    {r.lat.toFixed(2)}°, {r.lon.toFixed(2)}°
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {loading && !current && (
        <Card style={{ padding: 20, textAlign: 'center', color: T.inkMute, fontSize: 13 }}>
          Loading forecast…
        </Card>
      )}

      {error && !loading && (
        <Card style={{ padding: 14, borderColor: T.closed, fontSize: 13, color: T.closed }}>
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
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: isTablet ? '12px 14px' : '10px 12px',
                      background: T.parchmentDeep, borderRadius: 8,
                      border: `1px solid ${T.cardEdge}`,
                    }}>
                      <div style={{
                        fontSize: isTablet ? 15 : 13, fontWeight: 700, color: T.ink,
                        width: isTablet ? 140 : 110,
                      }}>{day}</div>
                      {weatherIcon(d.weatherCode, isTablet ? 28 : 24, T.brass)}
                      <div style={{ flex: 1, fontSize: isTablet ? 14 : 12, color: T.inkSoft }}>
                        {weatherLabel(d.weatherCode)}
                      </div>
                      <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkMute, minWidth: isTablet ? 96 : 76, textAlign: 'right' }}>
                        {compassDir(d.windDir || 0)} {Math.round(d.windMax || 0)} mph
                      </div>
                      <div style={{
                        fontSize: isTablet ? 16 : 14, fontWeight: 800, color: T.ink,
                        minWidth: isTablet ? 96 : 76, textAlign: 'right',
                      }}>
                        <span style={{ color: T.warn }}>{Math.round(d.tMax)}°</span>
                        <span style={{ color: T.inkMute, margin: '0 6px' }}>·</span>
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
