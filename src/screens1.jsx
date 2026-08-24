import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fish, Search, ChevronRight, AlertTriangle, Plus, Pencil, BookOpen, Calendar,
  Trophy, Camera, Trash2, Mail, Anchor, ListChecks, Wrench, Layers, X,
  RotateCcw, Image as ImageIcon, Sparkles, ArrowLeft, Check, Flag,
  MapPin, Ruler, ClipboardList, CloudSun, Wind, Waves, Thermometer,
  CheckCircle2, ShieldCheck, MoreHorizontal, BarChart2, Share2, Shuffle,
  Crosshair, Crop, Save as SaveIcon, Navigation, Sunrise, Sunset, Info, Moon,
  Sun, Cloud, CloudRain, CloudDrizzle, CloudLightning, CloudSnow, CloudFog,
  Star, StarHalf,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, CATEGORIES, SPECIES,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { regulationFor } from './regulations-store.js';
import { defaultState, saveState } from './storage.js';
import {
  speciesById, jurisdictionById, federalJurisdictionFor, getComparison,
  formatSize, formatWeight, regStatus, differs, seasonState,
  sunPosition, moonPhase, fetchWeatherForTime, catchPhotos,
  pbPhotos, buildPBReport, shareReport, isAnglerVisible,
} from './helpers.js';
import {
  airColor, sstColor, windColor, waveColor, currColor, actColor, rainColor,
  biteIndex, nearestTideStation,
  subScores, fishabilityHour, fishabilityColor, fishabilityGrade, fishabilityLabel, ratingWord, bestWindow, sixHourBlocks,
} from './forecast-extras.js';
import { brandAsset } from './brand-store.js';
import { useScreenSize } from './screen-size.js';
import { getCategories, subscribe as subscribeCategories } from './categories-store.js';
import { getLocation, getPhoto } from './native.js';
import { savePhoto, photoThumbUrl, photoDisplayUrl, photoAsDataUrl } from './photos-store.js';
import {
  StatusPill, SpeciesImage, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, BigButton, SpeciesRow,
  PhotoImg, CoachBubble, IdentificationResultCard,
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
  onBrowse,
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
        alt="ReelIntel — identify, check rules, log catch, find better spots. Built for Gulf Coast and Florida Atlantic waters."
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
          {onBrowse && (
            <button
              onClick={onBrowse}
              style={{
                marginTop: 6, background: 'transparent', border: 'none',
                color: T.brass, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: 3, padding: 8,
              }}
            >
              Continue without an account
            </button>
          )}
          <div style={{ fontSize: 11.5, color: T.inkMute, textAlign: 'center', lineHeight: 1.5, padding: '0 12px' }}>
            Browse species, regulations, and the forecast free — no sign-in needed.
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
  // Prefer the exact jurisdiction, then the coast-correct federal
  // fallback (Atlantic → South Atlantic, otherwise Gulf), then any
  // verified/bundled row we can find. regulationFor() walks the
  // verified Supabase overlay → bundled precedence per lookup.
  const primary = regulationFor(id, jurId).regulation;
  if (primary) return primary;
  const fed = regulationFor(id, federalJurisdictionFor(jurId)).regulation;
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

function FeaturedCard({ species, status, bag, onClick, tier = 'phone' }) {
  const st = STATUS_TEXT[status] || STATUS_TEXT.unknown;
  const bagLabel = bag != null ? `Bag Limit: ${bag}` : 'No Bag Limit';
  const sz = tierPick(tier);
  return (
    <button onClick={onClick} style={{
      flex: `0 0 ${sz(168, 216, 276)}px`, background: T.card, border: `1px solid ${T.cardEdge}`,
      borderRadius: 14, padding: sz(10, 12, 14), cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        position: 'relative', borderRadius: 10, height: sz(116, 152, 196), marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
        boxShadow: `inset 0 0 0 1px ${T.cardEdge}`,
      }}>
        <SpeciesImage species={species} size={sz(150, 195, 250)} />
      </div>
      <div style={{ fontSize: sz(17, 19, 22), fontWeight: 800, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {species.commonName}
      </div>
      <div style={{ fontSize: sz(14.5, 16, 18), color: st.color, fontWeight: 700, marginTop: 4 }}>{st.label}</div>
      <div style={{ fontSize: sz(14, 15.5, 17.5), color: T.inkMute, marginTop: 2 }}>{bagLabel}</div>
    </button>
  );
}

/* Pick a value for the current width tier. The phone layout pinned
   most of these sections at literal phone pixel sizes, which on a Mac
   window or an iPad in landscape left them reading as postage stamps
   next to the sections that did scale. */
export const tierPick = (tier) => (phone, tablet, wide) =>
  tier === 'tablet-landscape' ? wide : tier === 'tablet' ? tablet : phone;

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

/* HomeConditions — live "Today's Conditions" card with the Fishability
   gauge, verdict, star rating and a go/no-go call, plus the key readings.
   Fetches the same Open-Meteo + marine data as the forecast screen for a
   resolved home location (last catch → jurisdiction centre → Gulf). */
function HomeConditions({ state, jurisdiction, onForecast, onOceanMaps, isTablet, tier = 'phone' }) {
  const sz = tierPick(tier);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [gaugeOn, setGaugeOn] = useState(false);
  const [tick, setTick] = useState(0); // bumped to re-fetch (foreground + interval)

  // Keep conditions fresh: refetch every 15 min while mounted, and
  // immediately whenever the app returns to the foreground.
  useEffect(() => {
    const bump = () => setTick(t => t + 1);
    const onVis = () => { if (document.visibilityState === 'visible') bump(); };
    const id = setInterval(bump, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setStatus('loading');
      // Location priority: STARRED fishing spot → any saved spot → last
      // catch → jurisdiction centre → Gulf. The starred spot is the
      // angler's chosen "home water" (managed on the Forecast screen).
      const spots = state?.fishingSpots || [];
      const starred = spots.find(s => s.starred) || spots[0] || null;
      const recent = (state?.catchLog || []).find(c => c.lat != null && c.lon != null);
      const jc = jurisdiction?.center;
      const place = starred ? { lat: starred.lat, lon: starred.lon, name: starred.name }
        : recent ? { lat: recent.lat, lon: recent.lon, name: 'Last catch' }
        : jc ? { lat: jc.lat, lon: jc.lon, name: jurisdiction?.name || 'Selected waters' }
        : { lat: 27.5, lon: -84, name: 'Gulf of America' };
      const { lat, lon } = place;
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
          + `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,pressure_msl,weather_code`
          + `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1`
          + `&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=auto`;
        const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
          + `&current=wave_height,wave_period,sea_surface_temperature&timezone=auto`;
        const [r, mr] = await Promise.all([fetch(url), fetch(marineUrl).catch(() => null)]);
        if (!r.ok) throw new Error('wx');
        const j = await r.json();
        const cur = j.current || {};
        let waveFt = null, periodS = null, sstF = null;
        try {
          const mj = mr && mr.ok ? await mr.json() : null;
          const mc = mj?.current;
          if (mc) {
            if (mc.wave_height != null) waveFt = mc.wave_height * 3.28084;
            periodS = mc.wave_period ?? null;
            if (mc.sea_surface_temperature != null) sstF = mc.sea_surface_temperature * 9 / 5 + 32;
          }
        } catch {}
        const bite = biteIndex(new Date(), lat, lon, moonPhase(new Date()).illumination);
        const score = fishabilityHour({ wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, waveFt, periodS, bite });
        if (!alive) return;
        setData({
          placeName: place.name,
          tempF: cur.temperature_2m, windKt: cur.wind_speed_10m, windDir: cur.wind_direction_10m,
          gustKt: cur.wind_gusts_10m, waveFt, periodS, sstF, code: cur.weather_code, score,
          tMax: j.daily?.temperature_2m_max?.[0], tMin: j.daily?.temperature_2m_min?.[0],
        });
        setStatus('ok');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, [state?.catchLog, jurisdiction, state?.fishingSpots, tick]);

  useEffect(() => { setGaugeOn(false); const t = setTimeout(() => setGaugeOn(true), 80); return () => clearTimeout(t); }, [data?.score]);

  const score = data?.score ?? null;
  const sColor = fishabilityColor(score);
  const gSize = sz(118, 138, 176), gStroke = sz(11, 12, 15);
  const gR = (gSize - gStroke) / 2, gC = 2 * Math.PI * gR;
  const gOff = gaugeOn && score != null ? gC * (1 - score / 100) : gC;
  const starVal = score != null ? score / 20 : 0;
  const cta = score == null ? { t: '—', Ic: CloudSun }
    : score >= 85 ? { t: 'GO OFFSHORE', Ic: CheckCircle2 }
    : score >= 70 ? { t: 'GOOD — GET OUT', Ic: CheckCircle2 }
    : score >= 55 ? { t: 'FAIR — STAY NEARSHORE', Ic: AlertTriangle }
    : score >= 40 ? { t: 'MARGINAL', Ic: AlertTriangle }
    : { t: 'STAY IN', Ic: AlertTriangle };

  const Stat = ({ label, value }) => (
    <div>
      <div style={{ fontSize: sz(10, 11, 13), letterSpacing: 1.2, color: T.inkMute, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: sz(16, 18, 21), fontWeight: 800, color: T.ink, marginTop: 2 }}>{value}</div>
    </div>
  );

  return (
    <Card style={{ marginTop: 14, padding: sz(16, 20, 26), borderRadius: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: sz(12, 13.5, 16), color: T.ink, fontWeight: 800, letterSpacing: 1.2 }}>TODAY'S CONDITIONS</span>
          {data?.placeName && (
            <div style={{ fontSize: sz(12, 14, 16), color: T.brassDeep || T.brass, fontWeight: 700, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Star size={sz(12, 14, 16)} color="#FFC857" fill="#FFC857" /> {data.placeName}
            </div>
          )}
        </div>
        {onForecast && <button onClick={onForecast} style={{ flexShrink: 0, background: 'transparent', border: 'none', color: T.brass, fontSize: sz(11, 12.5, 14.5), fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0 }}>VIEW FORECAST ›</button>}
      </div>

      {status === 'loading' && <div style={{ padding: 24, textAlign: 'center', color: T.inkMute, fontSize: 14 }}>Loading conditions…</div>}
      {status === 'error' && <div style={{ padding: 16, textAlign: 'center', color: T.inkMute, fontSize: 14 }}>Conditions unavailable right now.</div>}

      {status === 'ok' && data && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Weather */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: isTablet ? 14 : 10 }}>
              <div style={{ flexShrink: 0 }}>{weatherIcon(data.code, sz(42, 56, 72), T.warn)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: sz(34, 46, 60), fontWeight: 900, color: T.ink, lineHeight: 1 }}>{data.tempF != null ? `${Math.round(data.tempF)}°` : '—'}</div>
                <div style={{ fontSize: sz(13, 16, 19), color: T.inkSoft, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{weatherLabel(data.code)}</div>
                {data.tMax != null && (
                  <div style={{ fontSize: sz(12, 14.5, 17), color: T.inkMute, fontWeight: 700, marginTop: 4 }}>
                    <span style={{ color: T.warn }}>H {Math.round(data.tMax)}°</span>
                    <span style={{ margin: '0 6px' }}>·</span>
                    <span>L {Math.round(data.tMin)}°</span>
                  </div>
                )}
              </div>
            </div>
            {/* Fishability gauge + Why link */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ position: 'relative', width: gSize, height: gSize }}>
                <svg width={gSize} height={gSize}>
                  <circle cx={gSize / 2} cy={gSize / 2} r={gR} fill="none" stroke={T.cardEdge} strokeWidth={gStroke} opacity={0.5} />
                  <circle cx={gSize / 2} cy={gSize / 2} r={gR} fill="none" stroke={sColor} strokeWidth={gStroke} strokeLinecap="round"
                    strokeDasharray={gC} strokeDashoffset={gOff}
                    style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)' }} />
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: sz(32, 42, 54), fontWeight: 900, color: T.ink, lineHeight: 1 }}>{fishabilityGrade(score)}</span>
                  <span style={{ fontSize: sz(8, 10, 12), fontWeight: 800, letterSpacing: 1, color: sColor, marginTop: 2 }}>{fishabilityLabel(score)}</span>
                </div>
              </div>
              {onForecast && (
                <button className="kyc-press" onClick={onForecast} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: T.brass, fontSize: sz(11, 13.5, 16), fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                  Why {fishabilityGrade(score)}? <ChevronRight size={sz(14, 16, 19)} />
                </button>
              )}
            </div>
          </div>

          {/* Condition chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
              <Waves size={14} color={T.brass} /> {data.waveFt != null ? `${data.waveFt.toFixed(1)} ft seas` : 'Seas —'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
              <Wind size={14} color={T.brass} /> {data.windKt != null ? `${compassDir(data.windDir || 0)} ${Math.round(data.windKt)} kt` : 'Wind —'}
            </span>
            {data.periodS != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
                {data.periodS.toFixed(1)} sec period
              </span>
            )}
            {data.sstF != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
                <Thermometer size={14} color={T.brass} /> {Math.round(data.sstF)}° water
              </span>
            )}
          </div>

          {/* Go / no-go call */}
          <button onClick={onForecast} className="kyc-press" style={{
            marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            background: 'transparent', border: `2px solid ${sColor}`, borderRadius: 14, cursor: 'pointer',
            padding: sz(11, 14, 18) + 'px 0', color: sColor, fontSize: sz(14, 17, 20), fontWeight: 900, letterSpacing: 0.8,
          }}>
            <cta.Ic size={sz(18, 21, 25)} /> {cta.t}
          </button>

          {/* Satellite ocean map shortcuts */}
          {onOceanMaps && (
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button onClick={() => onOceanMaps('chl')} className="kyc-press" style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 12, cursor: 'pointer',
                padding: sz(10, 12, 15) + 'px 0', color: T.ink, fontSize: sz(12, 14, 16.5), fontWeight: 800,
              }}>
                <Waves size={16} color="#4fd07a" /> Chlorophyll map
              </button>
              <button onClick={() => onOceanMaps('sst')} className="kyc-press" style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 12, cursor: 'pointer',
                padding: sz(10, 12, 15) + 'px 0', color: T.ink, fontSize: sz(12, 14, 16.5), fontWeight: 800,
              }}>
                <Thermometer size={16} color="#ff9a3d" /> Sea temp map
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function HomeScreen({
  state, jurisdiction, stale, screenSize, onChangeJurisdiction,
  onIdentify, onRegulations, onReport, onSpecies, onSpeciesList, onPBs,
  onCompare, onRegulationAlerts, onQuiz, onLogMenu, onPatterns,
  onCapture, onSelectFromLibrary, onViewCatch, onViewCatches, onForecast, onOceanMaps,
  finishSetupVisible, onFinishSetup, onDismissFinishSetup,
}) {
  const isTablet = screenSize === 'tablet' || screenSize === 'tablet-landscape';
  const isLandscape = screenSize === 'tablet-landscape';
  const sz = tierPick(screenSize);
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
  const closedNames = featured.filter(f => f.status === 'closed').map(f => f.s.commonName);

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
              objectFit: 'contain', objectPosition: 'center center',
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
          {/* One horizontal scroller at every size. Tablet used to use a
              wrapping grid, which turned "recent catches" into a tall
              block that pushed Today's Conditions off-screen — the strip
              reads as a strip on phone and should on iPad too. Cards are
              just wider here. */}
          <div
            className="kyc-hscroll"
            style={{
              display: 'flex', gap: isTablet ? 12 : 10,
              overflowX: 'auto', overflowY: 'hidden',
              margin: isTablet ? '0 -22px' : '0 -16px',
              padding: isTablet ? '0 22px 6px' : '0 16px 6px',
              scrollSnapType: 'x proximity',
            }}
          >
            {recentCatches.map(c => {
              const s = c.speciesId ? speciesById(c.speciesId) : null;
              const cp = catchPhotos(c);
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
                    flex: `0 0 ${sz(132, 214, 288)}px`,
                    background: T.card, border: `1px solid ${T.cardEdge}`,
                    borderRadius: sz(14, 16, 18), padding: 0, cursor: 'pointer', textAlign: 'left',
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
                    {cp.length > 0 ? (
                      // PhotoImg, not a raw <img>: cloud-synced catches
                      // have no local file, and photoThumbUrl is
                      // synchronous so it can't mint a signed URL for the
                      // private bucket. Same fix the logbook grid got.
                      <PhotoImg photo={cp[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : s ? (
                      <SpeciesImage species={s} size={sz(80, 130, 175)} />
                    ) : (
                      <Camera size={sz(30, 44, 56)} color={T.inkMute} />
                    )}
                  </div>
                  <div style={{ padding: sz(8, 10, 13) + 'px ' + sz(10, 13, 16) + 'px ' + sz(10, 12, 15) + 'px' }}>
                    <div style={{
                      fontSize: sz(14, 17, 20), fontWeight: 800, color: T.ink,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {s ? s.commonName : 'Unknown'}
                    </div>
                    <div style={{ fontSize: sz(11, 13, 15), color: T.inkMute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
      {/* Today's Conditions — live, with the Fishability score gauge */}
      <HomeConditions state={state} jurisdiction={jurisdiction} onForecast={onForecast} onOceanMaps={onOceanMaps} isTablet={isTablet} tier={screenSize} />

      {/* Regulation Alerts — full-width, single-line active alert; rely on
          VIEW ALL for the rest. */}
      <Card style={{ marginTop: 14, padding: sz(12, 16, 20) + 'px ' + sz(14, 18, 24) + 'px', borderRadius: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: sz(12, 14, 18) }}>
          <ShieldCheck size={sz(26, 32, 40)} color={anyClosed ? T.warn : T.open} strokeWidth={1.7} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: sz(12, 13.5, 16), color: T.ink, fontWeight: 800, letterSpacing: 1.2, whiteSpace: 'nowrap' }}>REGULATION ALERTS</span>
              <button onClick={onRegulationAlerts || onRegulations} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: sz(11, 12.5, 14.5), fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}>VIEW ALL</button>
            </div>
            <div style={{ fontSize: sz(13, 16, 19), marginTop: 3, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {anyClosed ? (
                <><strong style={{ color: T.warn }}>{closedNames[0]} closed</strong>
                  <span style={{ color: T.inkSoft }}>{closedNames.length > 1 ? ` · +${closedNames.length - 1} more` : ''} in {jurisdiction ? jurisdiction.name : 'these waters'}</span></>
              ) : (
                <><strong style={{ color: T.open }}>All clear</strong>
                  <span style={{ color: T.inkSoft }}> in {jurisdiction ? jurisdiction.name : 'these waters'}</span></>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Featured Species */}
      <Card style={{ marginTop: 14, padding: sz(14, 18, 22), borderRadius: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: sz(12, 13.5, 16), color: T.ink, fontWeight: 800, letterSpacing: 1.2 }}>TARGET SPECIES</span>
          <button onClick={onSpeciesList} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: sz(11, 12.5, 14.5), fontWeight: 800, letterSpacing: 1.2, cursor: 'pointer', padding: 0 }}>VIEW ALL</button>
        </div>
        <div className="kyc-hscroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, margin: '0 -14px', padding: '0 14px 4px' }}>
          {featured.map(f => (
            <FeaturedCard key={f.s.id} species={f.s} status={f.status} bag={f.bag} tier={screenSize} onClick={() => onSpecies(f.s.id)} />
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
  const sz = tierPick(size);
  const fileRef = useRef(null);
  const [q, setQ] = useState('');
  // The crop tip used to live here, on the pre-scan screen, where it was
  // pre-education about a button the angler hadn't met yet. It now lives
  // in PhotoResultScreen anchored to the actual "Crop & try again"
  // button, so it fires at the moment cropping would help.

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
    () => SPECIES.filter(isAnglerVisible),
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
        padding: sz(10, 14, 18) + 'px ' + sz(12, 16, 20) + 'px',
      }}>
        <Search size={sz(18, 24, 30)} color={accent} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${speciesCount} species…`}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            color: '#e5edf5', fontSize: sz(14, 18, 22),
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
              <SpeciesImage species={s} size={sz(38, 52, 66)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: sz(17, 20, 24), fontWeight: 700, color: '#e5edf5' }}>
                  {s.commonName}
                </div>
                <div style={{ fontSize: sz(12, 14.5, 17), color: secondaryText, fontStyle: 'italic', marginTop: 2 }}>
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
                fontSize: sz(14.5, 17, 20), fontWeight: 600,
                padding: sz(8, 11, 14) + 'px ' + sz(12, 16, 20) + 'px', borderRadius: 9,
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
                fontSize: sz(14.5, 17, 20), fontWeight: 700,
                padding: sz(8, 11, 14) + 'px ' + sz(12, 16, 20) + 'px', borderRadius: 9,
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
            height: sz(320, 400, 520),
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
            <Crosshair size={sz(104, 140, 190)} strokeWidth={1.4} />
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
              maxWidth: sz(220, 460, 640),
            }}>
              <div style={{
                fontSize: sz(30, 40, 54),
                fontWeight: 900, letterSpacing: 0.2,
                color: '#f7fbff', lineHeight: 1.02,
                textShadow: '0 2px 10px rgba(0, 0, 0, 0.55)',
              }}>
                Click to SCAN
              </div>
              <div style={{
                fontSize: sz(13, 17, 21), color: '#d8e4ee',
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
            fontSize: sz(11.5, 13.5, 16), fontWeight: 600, color: mutedText,
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
              width: sz(44, 54, 66), height: sz(44, 54, 66), borderRadius: 10,
              background: 'rgba(251,191,36,0.16)', color: '#fbbf24',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Sparkles size={sz(22, 27, 33)} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: sz(15, 19, 23), fontWeight: 800, color: '#e5edf5' }}>
                Fish ID Quiz
              </div>
              <div style={{
                fontSize: sz(12, 15, 18), color: secondaryText, marginTop: 3, lineHeight: 1.4,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {quizExamplePair}
              </div>
            </div>
            <span style={{
              background: accent, color: accentText,
              fontSize: sz(15, 17, 20), fontWeight: 800,
              padding: sz(8, 11, 14) + 'px ' + sz(14, 18, 24) + 'px', borderRadius: 8,
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
            fontSize: sz(11.5, 13.5, 16), fontWeight: 600, color: mutedText,
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
                    <SpeciesImage species={s} size={sz(38, 52, 66)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Georgia, serif', fontSize: sz(17, 20, 24), fontWeight: 700, color: '#e5edf5' }}>
                        {s.commonName}
                      </div>
                      <div style={{ fontSize: sz(12, 14.5, 17), color: '#7f95ad', fontStyle: 'italic', marginTop: 2 }}>
                        {s.scientific}
                      </div>
                    </div>
                    <span style={{
                      background: st.bg, color: st.fg,
                      fontSize: sz(12, 14, 16), fontWeight: 800, letterSpacing: 0.6,
                      padding: sz(4, 6, 8) + 'px ' + sz(8, 11, 14) + 'px', borderRadius: 6,
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
        {/* contain, not cover — this is the angler's first look at what
            they just handed the model, and cover cropped portrait shots
            to a middle band with the head and tail gone. */}
        <img src={imageDataUrl} alt="Your catch" style={{
          display: 'block', width: 'auto', maxWidth: '100%',
          maxHeight: '50vh', objectFit: 'contain', margin: '0 auto',
        }} />
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

export function PhotoResultScreen({ result, imageDataUrl, jurisdiction, onViewRegs, onViewSpecies, onPickSpecies, onConfirmSave, onCorrectSave, onConfirmFeedbackOnly, onCorrectFeedbackOnly, onSaveWithoutFeedback, onRetake, onScanAnother, onManual, onSuggestNew, onCropRetry }) {
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
  // One-time crop tip, anchored to the "Crop & try again" button. Moved
  // here from the pre-scan Fish ID screen: it now fires at the moment
  // cropping would actually help — a low-confidence result with the
  // button on screen — instead of pre-explaining a control the angler
  // hadn't seen yet. Only fires when that button is rendered, so it
  // waits for a low-confidence result rather than burning on the first
  // clean ID.
  const cropBtnRef = useRef(null);
  const [showCropTip, setShowCropTip] = useState(() => {
    try { return localStorage.getItem('kyc_cropid_tip_dismissed') !== '1'; } catch { return true; }
  });
  const dismissCropTip = () => {
    setShowCropTip(false);
    try { localStorage.setItem('kyc_cropid_tip_dismissed', '1'); } catch {}
  };

  // No confident pick AND no manual override yet — show the
  // couldn't-identify fallback. Once the angler picks a species via
  // "Pick the species", overrideId is set and we fall through to the
  // main results view (labelled YOUR PICK) so they can CONFIRM / Save
  // the same way Report Wrong ID lands them.
  // `notConfident` is set when the model scored under the medium floor.
  // It now arrives WITH its top candidates rather than an empty list, so
  // this guard must test the flag as well — otherwise a 0.39 guess would
  // fall through to the main results view and be presented as an ID.
  // Low-confidence picks are shown below as possibilities, never as an
  // answer.
  if ((!candidates || candidates.length === 0) && !overrideId) {
    return (
      <div style={{ padding: '18px 16px' }}>
        {/* Show the WHOLE photo. maxHeight + object-fit:cover cropped a
            portrait shot down to a thin band from its middle, which
            reads as though the app mangled the import — and this is the
            one screen where the angler is judging whether the photo was
            good enough to identify in the first place. */}
        <img src={imageDataUrl} alt="Your catch" style={{
          display: 'block', width: 'auto', maxWidth: '100%',
          maxHeight: isTablet ? '52vh' : '46vh',
          objectFit: 'contain', margin: '0 auto 14px',
          borderRadius: 6, border: `2px solid ${T.cardEdge}`,
        }} />
        {/* Diagnostic line — why the ID went the way it did. Temporary
            while we chase the wide-photo accuracy problem. */}
        {(result?._diag || result?._cropTrace) && (
          <div style={{
            fontSize: 11, color: T.inkMute, marginBottom: 10,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            wordBreak: 'break-word',
          }}>
            {result._diag}{result._cropTrace ? ` · crops ${result._cropTrace}` : ''}
          </div>
        )}
        {result?.aiNote ? (
          // Recognized, but not one of the app's regulated species — show
          // what it looks like so the angler isn't left at a dead end,
          // and nudge them to add it to the database.
          <Card style={{ background: 'rgba(94,205,242,0.12)', borderColor: T.brass, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={22} color={T.brass} />
              <div>
                <div style={{ fontWeight: 700, color: T.ink, fontSize: 16 }}>Not in your database yet</div>
                <div style={{ fontSize: 15, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                  {result.aiNote}
                </div>
                <div style={{ fontSize: 13, color: T.inkMute, marginTop: 6, lineHeight: 1.5 }}>
                  No size or bag rules are stored for this fish. Add it below, or pick the closest match.
                </div>
              </div>
            </div>
          </Card>
        ) : (
          <Card style={{ background: 'rgba(198,102,102,0.12)', borderColor: '#c66', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <AlertTriangle size={22} color="#c66" />
              <div>
                <div style={{ fontWeight: 700, color: T.ink, fontSize: 16 }}>
                  {result?._modelUnavailable ? 'Fish ID model unavailable' : 'Not confident'}
                </div>
                <div style={{ fontSize: 15, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                  The image was too uncertain to commit to a species. Try a clearer photo, or identify manually.
                </div>
                {/* The model's best guesses, shown ONLY as possibilities.
                    Previously these were discarded entirely, so a 0.39
                    top-1 looked identical to a photo of an empty deck.
                    Deliberately plain text with no confirm action — the
                    angler must still pick, so nothing here can be
                    mistaken for an identification. */}
                {Array.isArray(candidates) && candidates.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.2, color: T.inkMute, fontWeight: 700 }}>
                      CLOSEST MATCHES — LOW CONFIDENCE
                    </div>
                    {candidates.slice(0, 3).map((c) => {
                      const sp = speciesById(c.speciesId);
                      return (
                        <div key={c.speciesId} style={{
                          fontSize: 14, color: T.inkSoft, marginTop: 4,
                          display: 'flex', justifyContent: 'space-between', gap: 10,
                        }}>
                          <span>{sp ? sp.commonName : c.speciesId}</span>
                          <span style={{ color: T.inkMute }}>{Math.round((c.score || 0) * 100)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Manual ID: open the searchable species list (same picker as
              the confirm flow). Picking one records a model_correction
              (photo labeled with the true species → training signal)
              and routes to catch entry. */}
          {onCropRetry && (
            <PrimaryButton onClick={onCropRetry}>
              <Crop size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
              Crop to the fish &amp; try again
            </PrimaryButton>
          )}
          <GhostButton onClick={() => setShowPicker(true)} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Search size={16} /> Pick the species
          </GhostButton>
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
            speciesOptions={SPECIES.filter(isAnglerVisible)}
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
            // Dead end otherwise: search a fish we don't carry and the
            // only option is Cancel.
            onRequestSuggest={onSuggestNew ? () => { setShowPicker(false); onSuggestNew(); } : undefined}
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

  const nameSize   = isTablet ? 72 : 56;
  const sciSize    = isTablet ? 22 : 18;
  const ringSize   = isTablet ? 72 : 60;

  // Band comes from the PIPELINE's confidence, never re-derived
  // thresholds — the shared card renders identical language on both
  // routes. notConfident results with candidates land here too (low
  // band, compact recrop strip) instead of the old dead-end screen.
  const band = isCorrected ? null
    : result?.notConfident ? 'low'
    : (confidence || null);

  return (
    <div style={{ padding: '14px 14px 140px', position: 'relative' }}>
      {/* Crop is always available, even on a confident match. */}
      {onCropRetry && band !== 'low' && (
        <div style={{ textAlign: 'right', marginBottom: 10 }}>
          <button onClick={() => { dismissCropTip(); onCropRetry(); }} style={{
            background: 'transparent', border: 'none', color: T.brass, cursor: 'pointer',
            fontSize: 13, fontWeight: 700, padding: 4, display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            <Crop size={14} /> Crop photo &amp; re-ID
          </button>
        </div>
      )}

      {/* THE shared identification result — identical to the Log Catch
          route: photo, species, confidence language, compact low-band
          recrop, legal-to-keep + regulation summary, correction. */}
      <IdentificationResultCard
        onConfirmSpecies={doConfirm}
        photoUrl={imageDataUrl}
        subjectBox={result?._subjectBox}
        species={topSpecies}
        pct={isCorrected ? null : scorePct}
        band={band}
        pickedByUser={isCorrected}
        onCropRetry={onCropRetry ? () => { dismissCropTip(); onCropRetry(); } : null}
        onCorrectSpecies={() => setShowPicker(true)}
        jurisdiction={jurisdiction || null}
        onViewRegs={onViewRegs ? () => onViewRegs(displayedId) : null}
        onViewSpecies={onViewSpecies ? () => onViewSpecies(displayedId) : null}
        photoHeight={isTablet ? 380 : 300}
      />
      <div style={{ marginBottom: 14 }} />

      <style>{`@keyframes kycFeedbackIn { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }`}</style>

      {/* Save to Logbook / Scan Another buttons removed — Save catch is
          now the floppy icon superimposed on the photo above. */}

      {/* Diagnostic line — which identifier answered, and the
          per-crop scores when it was the on-device one. Temporary
          while the wide-photo accuracy problem is being chased. */}
      {(result?._diag || result?._cropTrace) && (
        <div style={{
          fontSize: 11, color: T.inkMute, marginBottom: 10,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          wordBreak: 'break-word',
        }}>
          {result._diag}{result._cropTrace ? ` · crops ${result._cropTrace}` : ''}
        </div>
      )}

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
        <PrimaryButton
          onClick={doSave}
          style={{
            flex: 2, minHeight: 52, fontSize: 18, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Check size={20} strokeWidth={3} /> LOG THIS CATCH
        </PrimaryButton>
        <GhostButton
          onClick={onScanAnother || onRetake}
          style={{
            flex: 1, minHeight: 52, fontSize: 14, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <RotateCcw size={15} /> Scan Another
        </GhostButton>
      </div>

      {/* Report wrong ID picker — updates the displayed species IN
          PLACE (overrideId) and stays on the results page. Nothing is
          saved until CONFIRM or Save to Logbook. */}
      {showPicker && (
        <SpeciesPickerModal
          speciesOptions={SPECIES.filter(s => isAnglerVisible(s) && s.id !== displayedId)}
          currentSpeciesId={displayedId}
          onCancel={() => setShowPicker(false)}
          onPick={(newSpeciesId) => {
            setShowPicker(false);
            setOverrideId(newSpeciesId);
            setFeedbackState('unset'); // ID changed — re-confirm needed
          }}
          onRequestSuggest={onSuggestNew ? () => { setShowPicker(false); onSuggestNew(); } : undefined}
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
  // Hide underscore-prefixed admin-only categories (e.g. _admin misc
  // bucket) from the user-facing browse.
  const activeCategories = getCategories().filter(c => !String(c.id).startsWith('_'));
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
    const base = SPECIES.filter(s => s.category === catId && isAnglerVisible(s))
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
    return SPECIES.filter(isAnglerVisible).map(s => {
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
// Moon-name → glyph, for the "lunar connection" line on each PB card.
const PB_MOON_GLYPH = {
  'New Moon': '🌑', 'Waxing Crescent': '🌒', 'First Quarter': '🌓',
  'Waxing Gibbous': '🌔', 'Full Moon': '🌕', 'Waning Gibbous': '🌖',
  'Last Quarter': '🌗', 'Waning Crescent': '🌘',
};

// Time-of-day from a REAL timestamp (never a date-only value — the
// caller only ever passes a stored dateIso that carries a clock time).
function pbTimeOfDay(dateIso) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return null;
  const h = d.getHours();
  const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const part = h < 5 ? 'Night' : h < 8 ? 'Dawn' : h < 11 ? 'Morning'
    : h < 14 ? 'Midday' : h < 17 ? 'Afternoon' : h < 20 ? 'Dusk' : 'Night';
  return `${clock} · ${part}`;
}

// Compact weather line from a stored weather snapshot: "82° · 11 kt SE · 30% cloud".
function pbWeatherLine(w) {
  if (!w) return null;
  const parts = [];
  if (w.tempF != null) parts.push(`${Math.round(w.tempF)}°`);
  if (w.windMph != null) {
    const kt = Math.round(w.windMph * 0.868976);
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const dir = w.windDir != null ? ` ${dirs[Math.round((w.windDir % 360) / 45) % 8]}` : '';
    parts.push(`${kt} kt${dir}`);
  }
  if (w.cloudPct != null) parts.push(`${Math.round(w.cloudPct)}% cloud`);
  return parts.length ? parts.join(' · ') : null;
}

// Fill in time / weather / moon for a PB. PBs store only a date, so we
// (1) borrow the matching catch's richer snapshot when one exists, and
// (2) always derive the moon phase from the date itself (deterministic,
// works for every PB even with nothing else on file).
function pbEnrich(id, pb, catchLog) {
  const day = pb.date || (pb.dateIso ? pb.dateIso.slice(0, 10) : null);
  let dateIso = pb.dateIso || null;
  let weather = pb.weather || null;
  let moonName = pb.moonName || null;
  let moonIllum = pb.moonIllum != null ? pb.moonIllum : null;
  if ((!dateIso || !weather || !moonName) && Array.isArray(catchLog) && day) {
    const m = catchLog.find(c => c && c.speciesId === id && c.dateIso && c.dateIso.slice(0, 10) === day);
    if (m) {
      dateIso = dateIso || m.dateIso || null;
      weather = weather || m.weather || null;
      moonName = moonName || m.moonName || null;
      if (moonIllum == null && m.moonIllum != null) moonIllum = m.moonIllum;
    }
  }
  if ((!moonName || moonIllum == null) && day) {
    const mp = moonPhase(new Date(`${day}T12:00:00`));
    if (!moonName) moonName = mp.name;
    if (moonIllum == null) moonIllum = mp.illumination;
  }
  return { dateIso, weather, moonName, moonIllum };
}

function PBSpotlightCard({ state, onPBs, onView, isTablet }) {
  const pbs = state?.pbs || {};
  const catchLog = state?.catchLog || [];
  const units = state.units;
  const anglerName = state.anglerName || '';
  const ids = useMemo(() => Object.keys(pbs), [pbs]);
  const [sharingId, setSharingId] = useState(null);

  // Newest trophy first — mirrors the Recent Catches strip's ordering.
  const entries = useMemo(() => ids
    .map(id => ({ id, pb: pbs[id], sp: speciesById(id) }))
    .sort((a, b) => String(b.pb?.date || '').localeCompare(String(a.pb?.date || ''))),
    [ids, pbs]);

  // Zero-PB case: keep the compact button so onboarding is unchanged.
  if (ids.length === 0) {
    return (
      <button onClick={onPBs} style={{
        marginTop: 18, width: '100%',
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

  const doShare = async (e, id) => {
    e.stopPropagation();
    const pb = pbs[id];
    const sp = speciesById(id);
    if (sharingId || !sp || !pb) return;
    setSharingId(id);
    try {
      const photos = pbPhotos(pb);
      const text = buildPBReport({ anglerName, species: sp, pb, units });
      const dataUrls = (await Promise.all(photos.slice(0, 3).map(photoAsDataUrl))).filter(Boolean);
      await shareReport({
        title: `${(anglerName || 'My').trim() || 'My'} ${sp.commonName} PB`,
        text, photoDataUrls: dataUrls,
        fileName: `pb-${id}`,
      });
    } finally {
      setSharingId(null);
    }
  };

  const cardW = isTablet ? 300 : 250;

  return (
    <div style={{ marginTop: 20 }}>
      {/* Celebratory header — a trophy badge + oversized title so the
          section reads as an achievement, not a list item. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: isTablet ? 48 : 42, height: isTablet ? 48 : 42, borderRadius: 13,
          background: `linear-gradient(145deg, ${T.brass}, ${T.brass}bb)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          boxShadow: `0 4px 16px ${T.brass}44`,
        }}>
          <Trophy size={isTablet ? 27 : 23} color={T.oceanDeep} strokeWidth={2} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: isTablet ? 22 : 18, fontWeight: 900, color: T.ink, letterSpacing: 1 }}>
              PERSONAL BESTS
            </span>
            <Sparkles size={isTablet ? 19 : 16} color={T.brass} />
          </div>
          <div style={{ fontSize: isTablet ? 13 : 11.5, color: T.inkMute, marginTop: 2, fontWeight: 600 }}>
            {ids.length} {ids.length === 1 ? 'trophy' : 'trophies'} on the board
          </div>
        </div>
        <button onClick={onPBs} style={{
          background: 'transparent', border: 'none', color: T.brass,
          fontSize: isTablet ? 12 : 11, fontWeight: 800, letterSpacing: 1.2,
          cursor: 'pointer', padding: 0, whiteSpace: 'nowrap', flexShrink: 0,
        }}>VIEW ALL</button>
      </div>

      {/* Horizontally-scrollable trophy strip — one rich card per PB,
          just like Recent Catches but taller and detail-heavy. */}
      <div
        className="kyc-hscroll"
        style={{
          display: 'flex', gap: isTablet ? 12 : 10,
          overflowX: 'auto', overflowY: 'hidden',
          margin: isTablet ? '0 -22px' : '0 -16px',
          padding: isTablet ? '0 22px 6px' : '0 16px 6px',
          scrollSnapType: 'x proximity',
        }}
      >
        {entries.map(({ id, pb, sp }) => {
          const photos = pbPhotos(pb);
          const photo = photos[0] || null;
          const primary = pb.primaryMetric === 'weight'
            ? formatWeight(pb.weight, units) : formatSize(pb.length, units);
          const secondary = pb.primaryMetric === 'weight'
            ? formatSize(pb.length, units) : formatWeight(pb.weight, units);
          const info = pbEnrich(id, pb, catchLog);
          const dateLabel = pb.date
            ? new Date(`${pb.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : null;
          const timeLabel = pbTimeOfDay(info.dateIso);
          const weatherLabel2 = pbWeatherLine(info.weather);
          const moonLabel = info.moonName
            ? `${info.moonName}${info.moonIllum != null ? ` · ${Math.round(info.moonIllum * 100)}% lit` : ''}`
            : null;

          const line = (icon, text, key) => text ? (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ flexShrink: 0, width: 15, display: 'inline-flex', justifyContent: 'center' }}>{icon}</span>
              <span style={{ fontSize: isTablet ? 12.5 : 11.5, color: T.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
            </div>
          ) : null;

          return (
            <button
              key={id}
              onClick={() => onView && onView(id)}
              style={{
                flex: `0 0 ${cardW}px`, width: cardW,
                background: T.card, border: `1px solid ${T.brass}55`,
                borderRadius: 16, padding: 0, cursor: 'pointer', textAlign: 'left',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                scrollSnapAlign: 'start',
                boxShadow: '0 0 0 1px rgba(25, 212, 242, 0.04) inset',
              }}
            >
              {/* Photo with the headline metric + a share affordance. */}
              <div style={{
                position: 'relative', width: '100%', aspectRatio: '4 / 3',
                background: T.parchmentDeep,
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                {photo
                  ? <PhotoImg photo={photo} alt={sp ? sp.commonName : ''} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
                  : <Fish size={isTablet ? 64 : 52} color={T.inkMute} strokeWidth={1.3} />}
                {/* Headline metric badge */}
                <div style={{
                  position: 'absolute', left: 8, bottom: 8,
                  background: 'rgba(3,27,51,0.82)', borderRadius: 10,
                  padding: '3px 10px', display: 'flex', alignItems: 'baseline', gap: 5,
                }}>
                  <span style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 22 : 19, fontWeight: 800, color: T.brass }}>
                    {primary || '—'}
                  </span>
                  {secondary && <span style={{ fontSize: isTablet ? 11 : 10, color: T.ink, opacity: 0.85 }}>{secondary}</span>}
                </div>
                {/* Share this trophy */}
                <button
                  onClick={(e) => doShare(e, id)}
                  disabled={sharingId === id}
                  aria-label={`Share ${sp ? sp.commonName : ''} personal best`}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 34, height: 34, borderRadius: 999,
                    background: 'rgba(3,27,51,0.72)', color: T.ink,
                    border: '1px solid rgba(255,255,255,0.28)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: sharingId === id ? 'default' : 'pointer',
                    opacity: sharingId === id ? 0.6 : 1,
                  }}
                >
                  <Share2 size={15} />
                </button>
              </div>

              {/* Species + enriched detail stack. */}
              <div style={{ padding: isTablet ? '12px 14px 14px' : '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 19 : 17, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sp ? sp.commonName : (id || 'Unknown species')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {line(<Calendar size={13} color={T.inkMute} />, dateLabel ? `${dateLabel}${pb.location ? ` · ${pb.location}` : ''}` : null, 'date')}
                  {line(<Sun size={13} color={T.brass} />, timeLabel, 'time')}
                  {line(<Wind size={13} color={T.brass} />, weatherLabel2, 'wx')}
                  {line(<span style={{ fontSize: 13, lineHeight: 1 }}>{PB_MOON_GLYPH[info.moonName] || '🌙'}</span>, moonLabel, 'moon')}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WeatherForecastScreen({ jurisdiction, state, update, onOceanMaps }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const [coords, setCoords]   = useState(null);
  const [locLabel, setLocLabel] = useState('');
  const [refreshTick, setRefreshTick] = useState(0); // re-fetch on foreground + interval
  const resolvedRef = useRef(false); // resolve the default location only once
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
  const [marine, setMarine]   = useState(null); // { waveFt, periodS, waveDir, sstF, currentKt, currentDir } or null
  const [tide, setTide]       = useState(null); // { stationName, byHour: Map<isoHour, ft> } or null
  const [daily, setDaily]     = useState([]);
  const [hourly, setHourly]   = useState([]);
  const [blocks, setBlocks]   = useState([]); // 6-hour blocks for the 10-day matrix
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [fxTab, setFxTab]     = useState('overview'); // 'overview' | 'hourly' | '7day'
  const [gaugeOn, setGaugeOn] = useState(false);       // drives the 0→score sweep
  const [showLegend, setShowLegend] = useState(false); // fishability score legend
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
    // Resolve the DEFAULT location once — otherwise saving/starring/deleting
    // a spot (which mutates fishingSpots) would yank the view back off a
    // manually-picked location. The spot chips set coords directly after this.
    if (resolvedRef.current) return undefined;
    resolvedRef.current = true;
    let alive = true;
    (async () => {
      // Default to the STARRED fishing spot so the forecast opens on the
      // same "home water" the Home card scores — no location mismatch.
      const starred = (state?.fishingSpots || []).find(s => s.starred);
      if (starred) {
        setCoords({ lat: starred.lat, lon: starred.lon });
        setLocLabel(starred.name);
        setSelectedSpotId(starred.id);
        return;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the forecast fresh: refetch every 15 min while mounted and
  // immediately when the app returns to the foreground.
  useEffect(() => {
    const bump = () => setRefreshTick(t => t + 1);
    const onVis = () => { if (document.visibilityState === 'visible') bump(); };
    const id = setInterval(bump, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => {
    if (!coords) return undefined;
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { lat, lon } = coords;
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
          + `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,pressure_msl,weather_code`
          + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset`
          + `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code`
          + `&forecast_days=10&past_days=1`
          + `&temperature_unit=fahrenheit&wind_speed_unit=kn&timezone=auto`;
        // Marine data lives on a separate Open-Meteo endpoint with water-only
        // coverage (inland points return nulls), so fetch it alongside — not
        // blocking — the main forecast. Heights are meters → feet, SST is
        // °C → °F, current velocity is km/h → knots; periods stay seconds.
        const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
          + `&current=wave_height,wave_period,wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction`
          + `&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,ocean_current_velocity,ocean_current_direction`
          + `&daily=wave_height_max,wave_period_max,wave_direction_dominant`
          + `&forecast_days=10&past_days=1&timezone=auto`;
        // Tides: nearest curated NOAA station (US Gulf/FL), hourly heights
        // for the next 48h. Skipped cleanly when no station is close.
        const station = nearestTideStation(lat, lon);
        let tideUrl = null;
        if (station) {
          const now = new Date();
          const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
          tideUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=ReelIntel`
            + `&begin_date=${ymd}&range=48&datum=MLLW&station=${station.id}&time_zone=lst_ldt&units=english&interval=h&format=json`;
        }
        const [r, marineRes, tideRes] = await Promise.all([
          fetch(url),
          fetch(marineUrl).catch(() => null),
          tideUrl ? fetch(tideUrl).catch(() => null) : Promise.resolve(null),
        ]);
        if (!r.ok) throw new Error(`open-meteo ${r.status}`);
        const j = await r.json();
        if (!alive) return;
        setCurrent(j.current || null);

        // Parse marine, tolerant of a failed/empty response.
        const M_TO_FT = 3.28084, C_TO_F = (c) => c * 9 / 5 + 32, KMH_TO_KT = 0.539957;
        let marineHourly = null, marineDaily = null;
        try {
          const mj = marineRes && marineRes.ok ? await marineRes.json() : null;
          const mc = mj?.current;
          if (mc && mc.wave_height != null) {
            setMarine({
              waveFt: mc.wave_height * M_TO_FT,
              periodS: mc.wave_period,
              waveDir: mc.wave_direction,
              sstF: mc.sea_surface_temperature != null ? C_TO_F(mc.sea_surface_temperature) : null,
              currentKt: mc.ocean_current_velocity != null ? mc.ocean_current_velocity * KMH_TO_KT : null,
              currentDir: mc.ocean_current_direction ?? null,
            });
          } else {
            setMarine(null);
          }
          const mh = mj?.hourly;
          if (mh?.time) {
            marineHourly = new Map();
            mh.time.forEach((iso, i) => {
              marineHourly.set(new Date(iso).getTime(), {
                waveFt: mh.wave_height?.[i] != null ? mh.wave_height[i] * M_TO_FT : null,
                periodS: mh.wave_period?.[i] ?? null,
                waveDir: mh.wave_direction?.[i] ?? null,
                sstF: mh.sea_surface_temperature?.[i] != null ? C_TO_F(mh.sea_surface_temperature[i]) : null,
                currentKt: mh.ocean_current_velocity?.[i] != null ? mh.ocean_current_velocity[i] * KMH_TO_KT : null,
                currentDir: mh.ocean_current_direction?.[i] ?? null,
              });
            });
          }
          const md = mj?.daily;
          if (md?.time) {
            marineDaily = new Map();
            md.time.forEach((date, i) => {
              marineDaily.set(date, {
                waveFtMax: md.wave_height_max?.[i] != null ? md.wave_height_max[i] * M_TO_FT : null,
                periodMaxS: md.wave_period_max?.[i] ?? null,
              });
            });
          }
        } catch { setMarine(null); }

        // Parse tides into an hourly (local-time) lookup.
        try {
          const tj = tideRes && tideRes.ok ? await tideRes.json() : null;
          const preds = tj?.predictions;
          if (station && Array.isArray(preds) && preds.length) {
            const byHour = new Map();
            preds.forEach((p) => {
              const key = p.t.replace(' ', 'T').slice(0, 13); // YYYY-MM-DDTHH
              const v = parseFloat(p.v);
              if (!Number.isNaN(v)) byHour.set(key, v);
            });
            setTide({ stationName: station.name, byHour });
          } else {
            setTide(null);
          }
        } catch { setTide(null); }

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
          sunrise: d.sunrise?.[i],
          sunset: d.sunset?.[i],
          waveFtMax: marineDaily?.get(iso)?.waveFtMax ?? null,
          periodMaxS: marineDaily?.get(iso)?.periodMaxS ?? null,
        }));
        // past_days=1 prepends yesterday to the daily array too. The
        // outlook is forward-looking, so trim it back to today onward —
        // only the HOURLY series wants history.
        const pad2 = (n) => String(n).padStart(2, '0');
        const nowLocal = new Date();
        const todayIso = `${nowLocal.getFullYear()}-${pad2(nowLocal.getMonth() + 1)}-${pad2(nowLocal.getDate())}`;
        setDaily(days.filter(x => x.date >= todayIso));
        // Sun-up/down hours (local ISO hour keys) for the Sun row markers.
        const sunriseHours = new Set((d.sunrise || []).map(s => s?.slice(0, 13)));
        const sunsetHours  = new Set((d.sunset  || []).map(s => s?.slice(0, 13)));
        const moonIllum = moonPhase(new Date()).illumination;
        const h = j.hourly || {};
        const nowMs = Date.now();
        const allHours = (h.time || []).map((iso, i) => {
          const when = new Date(iso).getTime();
          const isoHour = iso.slice(0, 13);
          const wave = marineHourly?.get(when) || null;
          const isDaylight = sunPosition(new Date(when), lat, lon).altitudeDeg > 0;
          return {
            when,
            isoHour,
            isDaylight,
            temp: h.temperature_2m?.[i],
            precipPct: h.precipitation_probability?.[i],
            wind: h.wind_speed_10m?.[i],
            windDir: h.wind_direction_10m?.[i],
            gust: h.wind_gusts_10m?.[i],
            weatherCode: h.weather_code?.[i],
            waveFt: wave?.waveFt ?? null,
            periodS: wave?.periodS ?? null,
            waveDir: wave?.waveDir ?? null,
            sstF: wave?.sstF ?? null,
            currentKt: wave?.currentKt ?? null,
            currentDir: wave?.currentDir ?? null,
            bite: biteIndex(new Date(when), lat, lon, moonIllum),
            sunrise: sunriseHours.has(isoHour),
            sunset: sunsetHours.has(isoHour),
          };
        });
        // Trailing history: a 12-kt wind easing off reads nothing like one
        // building, and the number alone can't tell you which. Keep 3 hours
        // behind on the hourly grid and 6 on the 10-day so the trend into
        // now is visible — that's what past_days=1 above is fetched for.
        const HOURLY_PAST = 3, BLOCK_PAST = 6;
        let nowIdx = allHours.findIndex(x => x.when > nowMs) - 1;
        if (nowIdx < 0) nowIdx = Math.max(0, allHours.length - 1);
        const marked = allHours.map((x, i) => ({ ...x, isPast: i < nowIdx, isNow: i === nowIdx }));
        setHourly(marked.slice(Math.max(0, nowIdx - HOURLY_PAST), nowIdx + 24));
        // 6-hour blocks across the whole 10-day feed for the outlook matrix.
        setBlocks(sixHourBlocks(marked.slice(Math.max(0, nowIdx - BLOCK_PAST))));
      } catch (e) {
        if (!alive) return;
        setError(e?.message || 'Could not load forecast.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [coords, refreshTick]);

  // Sweep the fishability gauge up from zero whenever the data (hence the
  // score) changes or the Overview tab is re-shown.
  useEffect(() => {
    setGaugeOn(false);
    const id = setTimeout(() => setGaugeOn(true), 80);
    return () => clearTimeout(id);
  }, [hourly, fxTab]);

  return (
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px', maxWidth: '100%', overflowX: 'hidden' }}>
      <H1 size={isTablet ? 30 : 22} style={{ marginBottom: 4 }}>Marine Forecast</H1>

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
          {/* ---- Decision-first dashboard: best-window hero + score gauge --- */}
          {(() => {
            const win = bestWindow(hourly);
            // Grade the CURRENT conditions so the hero matches the Home card:
            // same live `current` + marine-current inputs Home scores.
            const nowHour = {
              wind: current.wind_speed_10m,
              gust: current.wind_gusts_10m ?? hourly[0]?.gust,
              waveFt: marine?.waveFt ?? hourly[0]?.waveFt ?? null,
              periodS: marine?.periodS ?? hourly[0]?.periodS ?? null,
              windDir: current.wind_direction_10m,
              bite: hourly[0]?.bite,
            };
            const score = fishabilityHour(nowHour);
            const sColor = fishabilityColor(score);
            const repHour = nowHour;
            const subs = subScores(nowHour);
            const windKt = Math.round(current.wind_speed_10m || 0);
            const windTxt = compassDir(current.wind_direction_10m || 0);
            const gust = hourly[0]?.gust != null ? Math.round(hourly[0].gust) : null;
            const seasFt = repHour?.waveFt ?? marine?.waveFt ?? null;
            const seasDir = marine?.waveDir != null ? compassDir(marine.waveDir) : '';
            const periodS = repHour?.periodS ?? marine?.periodS ?? null;
            // Short period is only a problem when seas are up (steep chop) —
            // a short period on calm water is normal and fine.
            const shortPeriod = periodS != null && periodS < 5 && (seasFt ?? 0) > 2.5;
            // Tide value + trend for the glance card.
            let tideVal = null, tideTrend = '';
            if (tide && hourly.length) {
              const cur = tide.byHour.get(hourly[0].isoHour);
              const later = tide.byHour.get(hourly[Math.min(4, hourly.length - 1)].isoHour);
              if (cur != null) { tideVal = cur; if (later != null) tideTrend = later > cur ? 'Rising' : later < cur ? 'Falling' : 'Slack'; }
            }
            const fmtT = (ms) => { const d = new Date(ms); let hh = d.getHours(); const mm = d.getMinutes(); const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return mm ? `${hh}:${String(mm).padStart(2, '0')} ${ap}` : `${hh} ${ap}`; };
            let dayWord = '', range = '', leaveBy = null;
            if (win) {
              const s = new Date(win.startMs), now = new Date();
              const same = (a, b) => a.toDateString() === b.toDateString();
              const tmw = new Date(now.getTime() + 86400000);
              dayWord = same(s, now) ? 'Today' : same(s, tmw) ? 'Tomorrow' : s.toLocaleDateString(undefined, { weekday: 'long' });
              range = `${fmtT(win.startMs)} – ${fmtT(win.endMs)}`;
              leaveBy = win.startMs - 45 * 60000;
            }
            // Gauge geometry.
            const gSize = isTablet ? 150 : 118, gStroke = isTablet ? 13 : 11;
            const gR = (gSize - gStroke) / 2, gC = 2 * Math.PI * gR;
            const gOff = gaugeOn && score != null ? gC * (1 - score / 100) : gC;

            const barColor = (v) => v == null ? T.cardEdge : v >= 75 ? '#3fa34d' : v >= 60 ? '#d98330' : '#c0392b';
            const GlanceCard = ({ icon, label, big, small, unit, smallColor }) => (
              <div className="kyc-fadeup" style={{
                flex: 1, minWidth: 0, background: `linear-gradient(160deg, ${T.card}, ${T.oceanDeep})`,
                border: `1px solid ${T.cardEdge}`, borderRadius: 20, padding: isTablet ? 16 : 12,
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  {icon}
                  <span style={{ fontSize: isTablet ? 12 : 10, fontWeight: 800, letterSpacing: 1.2, color: T.inkMute }}>{label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: isTablet ? 28 : 22, fontWeight: 900, color: T.ink, lineHeight: 1 }}>{big}</span>
                  {unit && <span style={{ fontSize: isTablet ? 13 : 11, color: T.inkMute, fontWeight: 700 }}>{unit}</span>}
                </div>
                <div style={{ fontSize: isTablet ? 13 : 11, color: smallColor || T.inkSoft, marginTop: 8, fontWeight: 600 }}>{small}</div>
              </div>
            );

            return (
              <>
                {/* Hero — the answer first */}
                <Card className="kyc-fadeup" style={{
                  marginBottom: 14, padding: isTablet ? 24 : 18, borderRadius: 24,
                  background: `linear-gradient(155deg, ${T.card} 0%, ${T.oceanDeep} 100%)`,
                  border: `1px solid ${T.cardEdge}`, boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                    <span style={{ fontSize: isTablet ? 12 : 10, fontWeight: 800, letterSpacing: 1.4, color: T.brass }}>TODAY'S CONDITIONS</span>
                    <span style={{ flexShrink: 0, fontSize: isTablet ? 13 : 11, fontWeight: 900, letterSpacing: 0.6, color: T.oceanDeep, background: sColor, borderRadius: 999, padding: '4px 12px' }}>
                      {score != null ? `${fishabilityGrade(score)} · ${fishabilityLabel(score)}` : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: isTablet ? 16 : 12 }}>
                      <div style={{ flexShrink: 0 }}>{weatherIcon(current.weather_code, isTablet ? 54 : 42, T.warn)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: isTablet ? 44 : 34, fontWeight: 900, color: T.ink, lineHeight: 1 }}>{Math.round(current.temperature_2m)}°</div>
                        <div style={{ fontSize: isTablet ? 15 : 13, color: T.inkSoft, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{weatherLabel(current.weather_code)}</div>
                        {daily[0] && (
                          <div style={{ fontSize: sz(12, 14.5, 17), color: T.inkMute, fontWeight: 700, marginTop: 4 }}>
                            <span style={{ color: T.warn }}>H {Math.round(daily[0].tMax)}°</span>
                            <span style={{ margin: '0 6px' }}>·</span>
                            <span>L {Math.round(daily[0].tMin)}°</span>
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Fishability gauge + jump-to-Why link */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                      <div style={{ position: 'relative', width: gSize, height: gSize }}>
                        <svg width={gSize} height={gSize}>
                          <circle cx={gSize / 2} cy={gSize / 2} r={gR} fill="none" stroke={T.cardEdge} strokeWidth={gStroke} opacity={0.5} />
                          <circle cx={gSize / 2} cy={gSize / 2} r={gR} fill="none" stroke={sColor} strokeWidth={gStroke} strokeLinecap="round"
                            strokeDasharray={gC} strokeDashoffset={gOff}
                            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)' }} />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: isTablet ? 40 : 32, fontWeight: 900, color: T.ink, lineHeight: 1 }}>{score != null ? fishabilityGrade(score) : '—'}</span>
                          <span style={{ fontSize: isTablet ? 10 : 8, fontWeight: 800, letterSpacing: 1.2, color: T.inkMute, marginTop: 2 }}>FISHABILITY</span>
                        </div>
                      </div>
                      <button className="kyc-press" onClick={() => { const el = document.getElementById('why-section'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: T.brass, fontSize: isTablet ? 13 : 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                        Why {score != null ? fishabilityGrade(score) : ''}? <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Condition chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
                      <Waves size={14} color={T.brass} /> {seasFt != null ? `${seasFt.toFixed(1)} ft seas` : 'Seas —'}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 999, padding: sz(7, 9, 11) + 'px ' + sz(13, 16, 20) + 'px', fontSize: sz(12, 14.5, 17), fontWeight: 700, color: T.ink }}>
                      <Wind size={14} color={T.brass} /> {windTxt} {windKt} kt
                    </span>
                    {periodS != null && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 999, padding: '7px 13px', fontSize: isTablet ? 14 : 12, fontWeight: 800,
                        background: shortPeriod ? 'rgba(217,131,48,0.18)' : T.oceanDeep,
                        border: `1px solid ${shortPeriod ? '#d98330' : T.cardEdge}`,
                        color: shortPeriod ? '#e8a75a' : T.ink }}>
                        {shortPeriod ? '⚠︎ ' : ''}{periodS.toFixed(1)} sec period
                      </span>
                    )}
                  </div>
                  {/* Satellite ocean map shortcuts */}
                  {onOceanMaps && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <button onClick={() => onOceanMaps('chl')} className="kyc-press" style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 12, cursor: 'pointer',
                        padding: sz(10, 12, 15) + 'px 0', color: T.ink, fontSize: sz(12, 14, 16.5), fontWeight: 800,
                      }}>
                        <Waves size={16} color="#4fd07a" /> Chlorophyll map
                      </button>
                      <button onClick={() => onOceanMaps('sst')} className="kyc-press" style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                        background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 12, cursor: 'pointer',
                        padding: sz(10, 12, 15) + 'px 0', color: T.ink, fontSize: sz(12, 14, 16.5), fontWeight: 800,
                      }}>
                        <Thermometer size={16} color="#ff9a3d" /> Sea temp map
                      </button>
                    </div>
                  )}
                  {/* Fishability legend toggle + panel */}
                  <button className="kyc-press" onClick={() => setShowLegend(v => !v)} style={{
                    marginTop: 14, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 5, color: T.brass, fontSize: isTablet ? 13 : 12, fontWeight: 800,
                  }}>
                    <Info size={15} /> How the Fishability score works
                  </button>
                  {showLegend && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.cardEdge}` }}>
                      <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkSoft, lineHeight: 1.55, marginBottom: 12 }}>
                        A letter grade (A–F) for how good the fishing should be, weighted for both catching fish
                        and a comfortable ride: <strong style={{ color: T.ink }}>seas</strong>,{' '}
                        <strong style={{ color: T.ink }}>wind</strong>, and{' '}
                        <strong style={{ color: T.ink }}>wave period</strong>, nudged by the{' '}
                        <strong style={{ color: T.ink }}>solunar bite</strong> (sun & moon). Higher is better.
                      </div>
                      {/* Gradient stops + tick positions match the real 0–100
                          fishability axis (FISH_STOPS in forecast-extras). */}
                      <div style={{ height: 12, borderRadius: 999, background: 'linear-gradient(90deg, #c0392b 0%, #c0392b 40%, #d1642b 58%, #d98330 70%, #9bb03a 82%, #4fa64a 90%, #63e08a 97%, #63e08a 100%)' }} />
                      <div style={{ position: 'relative', height: isTablet ? 16 : 14, marginTop: 6, fontSize: isTablet ? 12 : 10, fontWeight: 800, color: T.inkMute }}>
                        <span style={{ position: 'absolute', left: '0%' }}>F</span>
                        <span style={{ position: 'absolute', left: '65%', transform: 'translateX(-50%)' }}>C</span>
                        <span style={{ position: 'absolute', left: '82%', transform: 'translateX(-50%)' }}>B</span>
                        <span style={{ position: 'absolute', right: '0%' }}>A</span>
                      </div>
                      <div style={{ fontSize: isTablet ? 12 : 10, color: T.inkMute, marginTop: 12, lineHeight: 1.5 }}>
                        Fishability is ReelIntel's own estimate — always confirm marine conditions with your
                        local NOAA/NWS forecast before heading out.
                      </div>
                    </div>
                  )}
                </Card>

                {/* Segmented tabs — Overview (24-hour detail) + 10-Day forecast */}
                <div style={{ position: 'relative', display: 'flex', background: T.oceanDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 16, padding: 4, marginBottom: 14 }}>
                  <div style={{ position: 'absolute', top: 4, bottom: 4, width: 'calc((100% - 8px) / 2)', borderRadius: 12, background: T.brass,
                    left: `calc(4px + ${['overview', '7day'].indexOf(fxTab)} * ((100% - 8px) / 2))`,
                    transition: 'left 0.28s cubic-bezier(0.22,1,0.36,1)' }} />
                  {[['overview', 'Overview'], ['7day', '10-Day']].map(([k, lbl]) => (
                    <button key={k} onClick={() => setFxTab(k)} style={{
                      position: 'relative', zIndex: 1, flex: 1, background: 'transparent', border: 'none', cursor: 'pointer',
                      padding: isTablet ? '11px 0' : '9px 0', fontSize: isTablet ? 15 : 13, fontWeight: 800,
                      color: fxTab === k ? T.oceanDeep : T.inkSoft,
                    }}>{lbl}</button>
                  ))}
                </div>

                {fxTab === 'overview' && (
                  <>{/* --overview-- */}
                    {/* Conditions at a glance */}
                    <div style={{ display: 'flex', gap: isTablet ? 12 : 8, marginBottom: 14 }}>
                      <GlanceCard icon={<Wind size={16} color={T.brass} />} label="WIND" big={`${windTxt} ${windKt}`} unit="kt" small={gust != null ? `Gusts to ${gust}` : ''} />
                      <GlanceCard icon={<Waves size={16} color={T.brass} />} label="SEAS" big={seasFt != null ? `${seasFt.toFixed(1)}` : '—'} unit={`ft ${seasDir}`}
                        small={periodS != null ? `${shortPeriod ? 'Short ' : ''}${periodS.toFixed(1)} sec period` : ''} smallColor={shortPeriod ? '#e8a75a' : undefined} />
                      {tideVal != null
                        ? <GlanceCard icon={<Anchor size={16} color={T.brass} />} label="TIDE" big={tideVal.toFixed(1)} unit="ft" small={tideTrend || ''} />
                        : marine?.sstF != null
                          ? <GlanceCard icon={<Thermometer size={16} color={T.brass} />} label="SEA TEMP" big={`${Math.round(marine.sstF)}°`} unit="F" small="Surface" />
                          : <GlanceCard icon={<CloudSun size={16} color={T.brass} />} label="SKY" big={`${Math.round(current.cloud_cover || 0)}%`} unit="cloud" small={weatherLabel(current.weather_code)} />}
                    </div>

                    {/* Next 24 hours — hourly chart + data */}
                    {hourly.length > 0 && (
                      <ForecastMatrix cols={hourly} isTablet={isTablet} tide={tide} mode="hourly" title="Next 24 hours" subtitle={tide ? `Tide: ${tide.stationName}` : null} />
                    )}

                    {/* Why this score — anchored so the hero link can jump here */}
                    <Card id="why-section" className="kyc-fadeup" style={{ marginBottom: 14, padding: isTablet ? 20 : 16, borderRadius: 24, scrollMarginTop: 12 }}>
                      <div style={{ fontSize: isTablet ? 18 : 15, fontWeight: 900, color: T.ink }}>Why {score != null ? fishabilityGrade(score) : '—'}?</div>
                      <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkSoft, margin: '4px 0 14px' }}>
                        Your score is weighted around fishability and ride comfort.
                      </div>
                      <FactorScale label="Wind" value={repHour?.wind} unit="kt" axisMax={33} bands={WIND_BANDS} isTablet={isTablet} />
                      <FactorScale label="Wave height" value={seasFt} unit="ft" axisMax={6} bands={WAVE_BANDS} isTablet={isTablet} />
                      <FactorScale label="Wave period" value={periodS} unit="s" axisMax={12} bands={PERIOD_BANDS} isTablet={isTablet} />
                    </Card>
                  </>
                )}
              </>
            );
          })()}

          {/* 10-day outlook — same ForecastMatrix, 6-hour blocks. */}
          {fxTab === '7day' && blocks.length > 0 && (
            <ForecastMatrix
              cols={blocks}
              isTablet={isTablet}
              tide={tide}
              mode="blocks"
              title="10-day outlook · 6-hour blocks"
            />
          )}

          <div style={{ fontSize: isTablet ? 12 : 11, color: T.inkMute, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
            Data from Open-Meteo. Always confirm marine conditions with your local NOAA/NWS forecast before heading out.
          </div>
        </>
      )}
    </div>
  );
}

/* Local calendar date as YYYY-MM-DD. toISOString() would answer in UTC,
   which flips the day for Gulf-coast evenings. */
function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* TimelineBar — a full-width 10-day fishability colour strip that fits on
   screen at once, with a draggable window that scrolls the detail grid
   below (and follows it when the grid is scrolled). Two-way synced to the
   matrix's horizontal scroll container via `scrollRef`. */
function TimelineBar({ blocks, scrollRef, isTablet, mode = 'blocks' }) {
  const barRef = useRef(null);
  const dragging = useRef(false);
  const [view, setView] = useState({ left: 0, width: 1 });
  const scoreOf = (b) => b.score != null ? b.score : fishabilityHour(b);

  const measure = () => {
    const el = scrollRef.current; if (!el) return;
    const sw = el.scrollWidth || 1;
    setView({ left: el.scrollLeft / sw, width: Math.min(1, el.clientWidth / sw) });
  };
  useEffect(() => {
    const el = scrollRef.current; if (!el) return undefined;
    measure();
    const t = setTimeout(measure, 250);
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gradient = useMemo(() => {
    if (!blocks.length) return T.oceanDeep;
    const n = blocks.length;
    const stops = blocks.map((b, i) => `${fishabilityColor(scoreOf(b))} ${((i / (n - 1)) * 100).toFixed(1)}%`);
    return `linear-gradient(90deg, ${stops.join(',')})`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  const scrollFrom = (clientX) => {
    const bar = barRef.current, el = scrollRef.current; if (!bar || !el) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, frac * el.scrollWidth - el.clientWidth / 2));
    el.scrollLeft = target;
    measure();
  };
  const down = (e) => { dragging.current = true; scrollFrom((e.touches?.[0] ?? e).clientX); };
  useEffect(() => {
    const move = (e) => { if (dragging.current) scrollFrom((e.touches?.[0] ?? e).clientX); };
    const up = () => { dragging.current = false; };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: true }); window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = blocks.length;
  const todayStr = localDateStr(new Date());
  // Marks along the top: day starts for the 10-day view, 6-hourly ticks
  // for the 24-hour view.
  const marks = mode === 'blocks'
    ? blocks.map((b, i) => ({ i, label: b.date === todayStr ? 'Today' : new Date(b.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }), hot: b.date === todayStr }))
        .filter((_, i) => blocks[i].slot === 0)
    : blocks.map((c, i) => ({ c, i })).filter(({ c }) => new Date(c.when).getHours() % 6 === 0)
        .map(({ c, i }) => { const hr = new Date(c.when).getHours(); return { i, label: hr === 0 ? '12a' : hr < 12 ? `${hr}a` : hr === 12 ? '12p' : `${hr - 12}p`, hot: !!c.isNow }; });
  return (
    <div style={{ marginBottom: 12, userSelect: 'none' }}>
      <div style={{ position: 'relative', height: isTablet ? 16 : 14, marginBottom: 4, fontSize: isTablet ? 11 : 9, fontWeight: 800, color: T.inkMute }}>
        {marks.map(({ i, label, hot }) => (
          <span key={i} style={{ position: 'absolute', left: `${(i / (n - 1)) * 100}%`, transform: i === 0 ? 'none' : 'translateX(-50%)', whiteSpace: 'nowrap', color: hot ? T.brass : T.inkMute }}>
            {label}
          </span>
        ))}
      </div>
      <div ref={barRef} onMouseDown={down} onTouchStart={down}
        style={{ position: 'relative', height: isTablet ? 22 : 18, borderRadius: 8, background: gradient, cursor: 'pointer', touchAction: 'none' }}>
        <div style={{ position: 'absolute', top: -2, bottom: -2, left: `${view.left * 100}%`, width: `${view.width * 100}%`, border: '2px solid #fff', borderRadius: 8, boxShadow: '0 0 6px rgba(0,0,0,0.55)', background: 'rgba(255,255,255,0.14)', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

/* ForecastMatrix — one Windy-style grid used by BOTH the hourly chart and
   the 10-day outlook so their rows, colours and styling are identical. The
   only difference is the time axis: `mode='hourly'` renders one column per
   hour; `mode='blocks'` renders one column per 6-hour block with day
   dividers + hourly tick marks. Every column object carries the same field
   names (temp, wind, windDir, gust, waveFt, periodS, waveDir, sstF,
   currentKt, currentDir, precipPct, bite, score, weatherCode, isoHour). */
function ForecastMatrix({ cols, isTablet, tide, mode, title, subtitle }) {
  const scrollRef = useRef(null);
  const RH = isTablet ? 30 : 26;
  const WAVE_H = isTablet ? 46 : 40;
  const BITE_H = isTablet ? 44 : 38;
  const HEAD_H = mode === 'blocks' ? (isTablet ? 32 : 28) : (isTablet ? 24 : 20);
  const ICON_H = isTablet ? 30 : 26;
  const TICK_H = mode === 'blocks' ? 8 : 0;
  const COL_W = mode === 'blocks' ? (isTablet ? 58 : 48) : (isTablet ? 64 : 54);
  const labelFs = isTablet ? 12 : 10;
  const valFs = isTablet ? 13 : 11;
  const arrowSz = isTablet ? 11 : 9;
  const anyWave = cols.some(c => c.waveFt != null);
  const anySST = cols.some(c => c.sstF != null);
  const anyCurrent = cols.some(c => c.currentKt != null);
  const hasTide = !!(tide && cols.some(c => tide.byHour.has(c.isoHour)));

  const Arrow = ({ deg, color }) => (
    <Navigation size={arrowSz} color={color} fill={color} strokeWidth={1} style={{ transform: `rotate(${deg || 0}deg)`, flexShrink: 0 }} />
  );
  const withArrow = (deg, color, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Arrow deg={deg} color={color} />{text}</span>
  );

  const ROWS = [
    // Full-row colour strip (Windy-style) with the letter grade on top.
    { key: 'fish', label: 'Fishability', h: isTablet ? 32 : 28, color: '#06212f',
      bg: c => fishabilityColor(c.score != null ? c.score : fishabilityHour(c)),
      cell: c => <span style={{ fontWeight: 900, fontSize: isTablet ? 14 : 12 }}>{fishabilityGrade(c.score != null ? c.score : fishabilityHour(c))}</span> },
    { key: 'bite', label: 'Bite, %', h: BITE_H, render: c => {
      if (c.bite == null) return <span style={{ fontSize: valFs, color: T.inkMute }}>—</span>;
      const pct = Math.round(c.bite);
      return (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', width: '100%', height: '100%', padding: '4px 4px 5px' }}>
          <div style={{ width: '84%', height: `${Math.max(38, pct)}%`, minHeight: 18, background: actColor(pct), borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06212f', fontWeight: 900, fontSize: isTablet ? 11 : 9 }}>{pct}%</div>
        </div>
      );
    } },
    { key: 'temp', label: 'Temp, °F', h: RH, color: T.ink, bg: c => airColor(c.temp), cell: c => c.temp != null ? `${Math.round(c.temp)}°` : '—' },
    { key: 'rain', label: 'Rain, %', h: RH, color: T.inkSoft, bg: c => rainColor(c.precipPct), cell: c => `${Math.round(c.precipPct || 0)}` },
    { key: 'wind', label: 'Wind, kt', h: RH, color: T.ink, bg: c => windColor(c.wind), cell: c => c.wind != null ? withArrow((c.windDir || 0) + 180, T.ink, Math.round(c.wind)) : '—' },
    { key: 'gust', label: 'Gust, kt', h: RH, color: T.inkSoft, bg: c => windColor(c.gust), cell: c => c.gust != null ? `${Math.round(c.gust)}` : '—' },
    ...(anySST ? [
      { key: 'sst', label: 'Sea, °F', h: RH, color: T.ink, bg: c => sstColor(c.sstF), cell: c => c.sstF != null ? `${Math.round(c.sstF)}°` : '—' },
    ] : []),
    ...(anyWave ? [
      { key: 'wave', label: 'Wave, ft', h: WAVE_H, bg: c => waveColor(c.waveFt), render: (c, i) => {
        if (c.waveFt == null) return <span style={{ fontSize: valFs, color: T.inkMute }}>—</span>;
        // Draw the actual wave profile: crest height rises/falls with wave
        // height, blended into neighbours so it flows across the row.
        const w = COL_W, H = WAVE_H;
        const norm = (v) => v == null ? null : Math.max(0.14, Math.min(1, v / 4)); // 0–4 ft → 0..1
        const cur = norm(c.waveFt);
        const pv = norm(cols[i - 1]?.waveFt);
        const nv = norm(cols[i + 1]?.waveFt);
        const yOf = (f) => Math.round(H - 6 - f * 0.62 * H); // taller wave = higher crest
        const yC = yOf(cur);
        const yL = yOf(((pv ?? cur) + cur) / 2);
        const yR = yOf(((nv ?? cur) + cur) / 2);
        const top = `M0,${yL} Q ${w * 0.25},${(yL + yC) / 2} ${w / 2},${yC} Q ${w * 0.75},${(yC + yR) / 2} ${w},${yR}`;
        return (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${w} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
              <path d={`${top} L ${w},${H} L 0,${H} Z`} fill="rgba(90,200,245,0.32)" />
              <path d={top} fill="none" stroke={T.brass} strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span style={{ position: 'absolute', left: 0, right: 0, bottom: 3, textAlign: 'center', fontSize: valFs, fontWeight: 800, color: T.ink }}>{c.waveFt.toFixed(1)}</span>
          </div>
        );
      } },
      { key: 'per', label: 'Period, s', h: RH, color: T.inkSoft, cell: c => c.periodS != null ? c.periodS.toFixed(1) : '—' },
    ] : []),
    ...(anyCurrent ? [
      { key: 'curr', label: 'Current, kt', h: RH, color: T.ink, bg: c => currColor(c.currentKt), cell: c => c.currentKt != null ? withArrow(c.currentDir || 0, T.ink, c.currentKt.toFixed(1)) : '—' },
    ] : []),
    ...(hasTide ? [
      { key: 'tide', label: 'Tide, ft', h: RH, color: T.brass, cell: c => { const v = tide.byHour.get(c.isoHour); return v != null ? v.toFixed(1) : '—'; } },
    ] : []),
  ];

  const tickBg = `repeating-linear-gradient(90deg, ${T.cardEdge} 0 1px, transparent 1px ${COL_W / 6}px)`;
  // Today from the clock, NOT from cols[0]: the grid now opens with
  // history, so before 6am the first block belongs to yesterday and
  // reading the day label off it would print "Today" on the wrong day.
  const todayStr = mode === 'blocks' ? localDateStr(new Date()) : null;

  // Windy-style read line: one column stays pinned at a fixed spot in the
  // viewport while the data scrolls under it, so your eye holds a single
  // vertical while comparing rows. Columns snap to it so the band always
  // frames a whole column rather than straddling two.
  const FOCUS_LEFT = COL_W * 2;
  const nowIdx = Math.max(0, cols.findIndex(c => c.isNow));
  // Open with NOW under the read line — the history sits to its left,
  // there to be scrolled back into, not to push the present off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, nowIdx * COL_W - FOCUS_LEFT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowIdx, COL_W]);

  // Smooth horizontal gradients (Windy-style): precompute each coloured
  // row's per-column colour, then blend each cell into its neighbours so
  // the row reads as a continuous gradient instead of hard blocks.
  const rowColors = {};
  ROWS.forEach(r => { if (r.bg) rowColors[r.key] = cols.map(c => r.bg(c)); });
  const parseRgba = (s) => {
    if (!s || s === 'transparent') return [0, 0, 0, 0];
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(',').map(Number);
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] == null ? 1 : p[3]];
  };
  const mix = (a, b) => {
    const A = parseRgba(a), B = parseRgba(b);
    return `rgba(${Math.round((A[0] + B[0]) / 2)},${Math.round((A[1] + B[1]) / 2)},${Math.round((A[2] + B[2]) / 2)},${((A[3] + B[3]) / 2).toFixed(3)})`;
  };
  const cellBg = (key, i) => {
    const arr = rowColors[key];
    if (!arr) return 'transparent';
    const cur = arr[i];
    const left = i > 0 ? mix(arr[i - 1], cur) : cur;
    const right = i < arr.length - 1 ? mix(cur, arr[i + 1]) : cur;
    return `linear-gradient(90deg, ${left} 0%, ${cur} 50%, ${right} 100%)`;
  };

  return (
    <Card className="kyc-fadeup" style={{ marginBottom: 14, padding: isTablet ? 18 : 12, borderRadius: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <SectionLabel style={{ margin: 0 }}>{title}</SectionLabel>
        {subtitle && <span style={{ fontSize: isTablet ? 11 : 9, color: T.inkMute }}>{subtitle}</span>}
      </div>
      <TimelineBar blocks={cols} scrollRef={scrollRef} isTablet={isTablet} mode={mode} />
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Fixed label column */}
        <div style={{ flexShrink: 0, background: T.card, paddingRight: 10, borderRight: `1px solid ${T.cardEdge}` }}>
          <div style={{ height: HEAD_H }} />
          <div style={{ height: ICON_H, display: 'flex', alignItems: 'center', fontSize: labelFs, color: T.inkMute, fontWeight: 700 }}>{mode === 'hourly' ? 'Sky' : 'Sky'}</div>
          {TICK_H > 0 && <div style={{ height: TICK_H }} />}
          {ROWS.map(r => (
            <div key={r.key} style={{ height: r.h, display: 'flex', alignItems: 'center', fontSize: labelFs, color: T.inkMute, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.label}</div>
          ))}
        </div>
        <div ref={scrollRef} className="kyc-hscroll" style={{ display: 'flex', overflowX: 'auto', overflowY: 'hidden', flex: 1, minWidth: 0, paddingBottom: 6, scrollSnapType: 'x proximity', scrollPaddingLeft: FOCUS_LEFT }}>
          {/* Zero-width sticky rail — it holds its place in the viewport
              while the columns scroll past, and costs no layout width. */}
          <div style={{ position: 'sticky', left: FOCUS_LEFT, width: 0, zIndex: 3, alignSelf: 'stretch', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, bottom: 6, left: 0, width: COL_W, background: 'rgba(255,255,255,0.10)', borderLeft: '1.5px solid rgba(255,255,255,0.55)', borderRight: '1.5px solid rgba(255,255,255,0.55)', borderRadius: 4, boxShadow: '0 0 8px rgba(0,0,0,0.35)' }} />
          </div>
          {cols.map((c, i) => {
            let timeLabel = '', dayStart = false, dayLbl = '';
            if (mode === 'hourly') {
              const d = new Date(c.when); const hr = d.getHours();
              timeLabel = hr === 0 ? '12a' : hr < 12 ? `${hr}a` : hr === 12 ? '12p' : `${hr - 12}p`;
            } else {
              dayStart = c.slot === 0 || i === 0;
              dayLbl = c.date === todayStr ? 'Today' : new Date(c.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
              timeLabel = c.label;
            }
            return (
              <div key={i} style={{ flex: `0 0 ${COL_W}px`, textAlign: 'center', scrollSnapAlign: 'start', opacity: c.isPast ? 0.5 : 1, borderLeft: mode === 'blocks' && dayStart && i !== 0 ? `1px solid ${T.cardEdge}` : 'none' }}>
                <div style={{ height: HEAD_H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  {mode === 'blocks' && <span style={{ fontSize: labelFs, fontWeight: 800, color: T.brass, minHeight: labelFs + 2 }}>{dayStart ? dayLbl : ''}</span>}
                  <span style={{ fontSize: mode === 'blocks' ? (isTablet ? 11 : 9) : labelFs, fontWeight: 800, color: c.isNow ? T.brass : T.inkMute, letterSpacing: 0.6 }}>{c.isNow && mode === 'hourly' ? 'NOW' : timeLabel}</span>
                </div>
                <div style={{ height: ICON_H, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  {c.isDaylight === false && (c.weatherCode == null || c.weatherCode <= 2)
                    ? <Moon size={isTablet ? 20 : 16} color={T.brass} />
                    : weatherIcon(c.weatherCode, isTablet ? 22 : 18, T.brass)}
                  {mode === 'hourly' && c.sunrise && <Sunrise size={arrowSz + 2} color="#FFC857" />}
                  {mode === 'hourly' && c.sunset && <Sunset size={arrowSz + 2} color="#FF9A3D" />}
                </div>
                {TICK_H > 0 && <div style={{ height: TICK_H, backgroundImage: tickBg }} />}
                {ROWS.map(r => (
                  <div key={r.key} style={{ height: r.h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: valFs, fontWeight: 600, color: r.color || T.ink, background: r.bg ? cellBg(r.key, i) : 'transparent', whiteSpace: 'nowrap' }}>
                    {r.render ? r.render(c, i) : r.cell(c)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* Safe-boating scales for the "Why this grade?" breakdown. Bands are
   research-based (Beaufort wind force + NWS small-craft guidance, and
   sea-state / swell-period seamanship rules of thumb). Each band: the
   upper bound of its range, a colour, and a plain-language name. */
const WIND_BANDS = [ // knots (Beaufort + NWS small-craft advisory ~20–33 kt)
  { max: 6,  color: '#3fa34d', name: 'Calm–light' },
  { max: 10, color: '#7fae3e', name: 'Gentle breeze' },
  { max: 16, color: '#c9b03a', name: 'Moderate breeze' },
  { max: 21, color: '#d98330', name: 'Fresh — small-craft caution' },
  { max: 33, color: '#c0392b', name: 'Strong — small-craft advisory' },
];
const WAVE_BANDS = [ // ft
  { max: 1, color: '#3fa34d', name: 'Calm' },
  { max: 2, color: '#7fae3e', name: 'Smooth' },
  { max: 3, color: '#c9b03a', name: 'Slight chop' },
  { max: 4, color: '#d98330', name: 'Moderate' },
  { max: 6, color: '#c0392b', name: 'Rough' },
];
const PERIOD_BANDS = [ // seconds — longer swell rides smoother
  { max: 3,  color: '#d98330', name: 'Very short chop' },
  { max: 5,  color: '#c9b03a', name: 'Short wind-wave' },
  { max: 8,  color: '#7fae3e', name: 'Moderate swell' },
  { max: 12, color: '#3fa34d', name: 'Long groundswell' },
];

function FactorScale({ label, value, unit, axisMax, bands, isTablet }) {
  const pos = value == null ? null : Math.max(0, Math.min(100, (value / axisMax) * 100));
  let band = null;
  if (value != null) { for (const b of bands) { if (value <= b.max) { band = b; break; } } if (!band) band = bands[bands.length - 1]; }
  const dec = (unit === 'ft' || unit === 's') ? 1 : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: isTablet ? 14 : 12, color: T.inkSoft, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: isTablet ? 13 : 11, color: T.ink, fontWeight: 800, textAlign: 'right' }}>
          {value != null ? `${value.toFixed(dec)} ${unit}` : '—'}{band ? ` · ${band.name}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', height: 14 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
          {bands.map((b, i) => {
            const prev = i === 0 ? 0 : bands[i - 1].max;
            return <div key={i} style={{ width: `${((b.max - prev) / axisMax) * 100}%`, background: b.color }} />;
          })}
        </div>
        {pos != null && (
          <>
            <div style={{ position: 'absolute', left: `${pos}%`, top: -2, bottom: -2, width: 2, background: '#fff', transform: 'translateX(-1px)', boxShadow: '0 0 3px rgba(0,0,0,0.7)' }} />
            <div style={{ position: 'absolute', left: `${pos}%`, top: -7, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #fff' }} />
          </>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: isTablet ? 10 : 9, color: T.inkMute, fontWeight: 700 }}>
        <span>0</span><span>{axisMax} {unit}</span>
      </div>
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
  const p = { size, color, strokeWidth: 1.8 };
  if (code == null) return <CloudSun {...p} />;
  if (code === 0) return <Sun {...p} />;                         // clear
  if (code <= 2) return <CloudSun {...p} />;                     // mainly clear / partly cloudy
  if (code === 3) return <Cloud {...p} />;                       // overcast
  if (code === 45 || code === 48) return <CloudFog {...p} />;    // fog
  if (code >= 51 && code <= 57) return <CloudDrizzle {...p} />;  // drizzle
  if (code >= 71 && code <= 77) return <CloudSnow {...p} />;     // snow
  if (code >= 95) return <CloudLightning {...p} />;              // thunderstorm
  if (code >= 61 && code <= 82) return <CloudRain {...p} />;     // rain / showers
  return <CloudSun {...p} />;
}
