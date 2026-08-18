/* reelintel.ai marketing landing page.

   Structured per the launch copy brief:
     Hero → Fish smarter → Problem bridge → Know the rules & log it →
     Identify it → Everything you need → Data + Free → Coming soon →
     Final CTA → Footer.

   Real launch assets:
     public/marketing/hero-underwater-bg.png    (hero background — DO NOT swap)
     public/marketing/patterns-heatmap.jpg      (wide banner — placeholder OK until real file lands)
     public/marketing/regulations-phone.png     (transparent angled phone — Know the rules)
     public/marketing/review-catch-phone.png    (transparent angled phone — Identify it)
     public/marketing/screenshot-fishid.png     (phone screenshot — placeholder OK)
     public/brand/reelintel-horizontal.png      (footer logo)
     public/brand/icon-horz.png                 (nav logo)

   Placeholder <ImageSlot> shows a dashed-border card with the filename
   + alt text when the file is missing, so layout doesn't break before
   real images are dropped in.

   Rendered at / when KYC_WEB=true (see main.jsx). iOS bundle is
   unaffected — this module is dead-code eliminated in the iOS build. */

import React, { useEffect, useMemo, useState } from 'react';
import { T } from './theme.js';
import { updatePassword, subscribe as subscribeAuth } from './auth.js';
import { client as supabaseClient } from './supabase-client.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';

const M = `${import.meta.env.BASE_URL}marketing/`;
const LOGO_HORIZONTAL = `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`;
const LOGO_HEADER     = `${import.meta.env.BASE_URL}brand/icon-horz.png`;
// Stacked marlin badge + wordmark + tagline — the /testers masthead.
// Transparent + tightly cropped (brand/reelintel-brand.png ships with a
// flat navy background baked in, which reads as a grey box on the page).
const LOGO_BRAND      = `${import.meta.env.BASE_URL}marketing/testers-logo.png`;

const A = {
  heroBg:              `${M}888866A1-EE9A-4408-B410-E19A5141D228.png`,
  patternsHeatmap:     `${M}patterns-heatmap.jpg`,
  regulationsPhone:    `${M}regulations-phone.png`,
  reviewCatchPhone:    `${M}review-catch-phone.png`,
  screenshotFishId:    `${M}screenshot-fishid.png`,
  alertOutOfSeason:    `${M}alert-out-of-season.png`,
  alertInSeason:       `${M}alert-in-season.png`,
  tileCheckRegs:       `${M}tile-check-regs.jpg`,
  tileFishId:          `${M}tile-fish-id.jpg`,
  tileFishQuiz:        `${M}tile-fish-quiz.jpg`,
  tilePatterns:        `${M}tile-patterns.jpg`,
  marineForecast:      `${M}MARINE-FORECAST.png`,
  marineChlorophyll:   `${M}MARINE-CHLOROPHYLL.png`,
  marineSeaTemp:       `${M}MARINE-SEATEMP.png`,
  comingSoonLidar:     `${M}coming-soon-lidar.jpg`,
  ctaMakeEveryTrip:    `${M}cta-make-every-trip-count.jpg`,
  appStoreBadge:       `${M}app-store-badge.svg`,
  googlePlayBadge:     `${M}google-play-badge.svg`,
  aiInsightsGraphic:   `${M}AI-powered.png`,
  shield:              `${M}shield.png`,
};

const APP_STORE_URL = 'https://apps.apple.com/app/reelintel/id6785558103';
// Set this to the Google Play listing once Android is live. While empty,
// Android users fall back to the App Store (nothing dead-ends).
const PLAY_STORE_URL = '';

/* Route generic "get the app" CTAs to the right store for the device.
   iOS + desktop → App Store; Android → Google Play (once PLAY_STORE_URL
   is set, else App Store). Runs client-side; safe if navigator is absent. */
function storeUrl() {
  if (typeof navigator === 'undefined') return APP_STORE_URL;
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua) && PLAY_STORE_URL) return PLAY_STORE_URL;
  return APP_STORE_URL;
}
const CONTACT_URL   = 'mailto:robert@reelintel.ai';
const PRIVACY_URL   = '/privacy';
const TERMS_URL     = '/terms';

const P = {
  bg:        T.bgDeep,
  bgAlt:     '#04182b',
  card:      '#0B2740',
  cardHi:    '#0e2f4e',
  border:    'rgba(15, 94, 133, 0.35)',
  borderHi:  'rgba(25, 212, 242, 0.55)',
  accent:    T.brass,
  accentDim: 'rgba(25,212,242,0.15)',
  ink:       T.ink,
  inkSoft:   T.inkSoft,
  inkMute:   T.inkMute,
};

const NAV_ITEMS = [
  { label: 'Features',     href: '#features'    },
  { label: 'Forecast',     href: '#marine'      },
  { label: 'How it works', href: '#how'         },
  { label: 'About',        href: '#coming'      },
];

/* ============================================================
   INLINE SVG ICONS
   Kept as a small toolkit — new sections pick from this set
   rather than pulling in a heavier icon lib.
   ============================================================ */

function FishIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M2 12 c 3 -5 8 -6 12 -4 c 2 1 4 2 6 3 l 2 1 l -2 1 c -2 1 -4 2 -6 3 c -4 2 -9 1 -12 -4 z" fill={color} opacity="0.85"/>
      <circle cx="18" cy="10" r="0.9" fill="#031B33"/>
      <path d="M2 12 l -1 -3 l 2 0 z M 2 12 l -1 3 l 2 0 z" fill={color} opacity="0.65"/>
      <path d="M14 9 c 1 1 1 5 0 6 z" fill="#031B33" opacity="0.35"/>
    </svg>
  );
}

function TrophyIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4 h 10 v 5 a 5 5 0 0 1 -10 0 z"/>
      <path d="M7 6 H 4 a 3 3 0 0 0 3 5"/>
      <path d="M17 6 h 3 a 3 3 0 0 1 -3 5"/>
      <path d="M10 14 h 4 v 3 h -4 z"/>
      <path d="M8 20 h 8"/>
      <path d="M12 17 v 3"/>
    </svg>
  );
}

function ArrowRight({ size = 16, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="20" y2="12"/>
      <polyline points="14 6 20 12 14 18"/>
    </svg>
  );
}

function CloudIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18 h 10 a 4 4 0 0 0 0 -8 a 5 5 0 0 0 -9 -1 a 4 4 0 0 0 -1 9 z"/>
    </svg>
  );
}

function ShieldIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 l 8 3 v 6 c 0 5 -3 8 -8 9 c -5 -1 -8 -4 -8 -9 v -6 z"/>
      <polyline points="9 12 11.5 14.5 15.5 10"/>
    </svg>
  );
}

function CameraIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8 h 3 l 2 -2 h 8 l 2 2 h 3 v 11 h -18 z"/>
      <circle cx="12" cy="13" r="3.4"/>
    </svg>
  );
}
function MapPinIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22 c 5 -6 8 -9 8 -13 a 8 8 0 0 0 -16 0 c 0 4 3 7 8 13 z"/>
      <circle cx="12" cy="9" r="2.6"/>
    </svg>
  );
}
function ChartIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6"/>
      <polyline points="16 6 21 6 21 11"/>
    </svg>
  );
}
function BrainIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4 a 2.5 2.5 0 0 0 -2.5 2.5 a 2.5 2.5 0 0 0 -1.5 4.3 a 2.5 2.5 0 0 0 1 4.5 a 2.5 2.5 0 0 0 3 3 V 4 z"/>
      <path d="M15 4 a 2.5 2.5 0 0 1 2.5 2.5 a 2.5 2.5 0 0 1 1.5 4.3 a 2.5 2.5 0 0 1 -1 4.5 a 2.5 2.5 0 0 1 -3 3 V 4 z"/>
    </svg>
  );
}
function TargetIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="5"/>
      <circle cx="12" cy="12" r="1.4" fill={color}/>
    </svg>
  );
}
function LockIcon({ size = 20, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2"/>
      <path d="M8 11 V 8 a 4 4 0 0 1 8 0 v 3"/>
    </svg>
  );
}
function DownloadIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4 v 10"/>
      <polyline points="8 11 12 15 16 11"/>
      <path d="M5 18 h 14"/>
    </svg>
  );
}
function ShieldXIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 l 8 3 v 6 c 0 5 -3 8 -8 9 c -5 -1 -8 -4 -8 -9 v -6 z"/>
      <path d="M9.5 9.5 l 5 5 M14.5 9.5 l -5 5"/>
    </svg>
  );
}
function ShieldCheckIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 l 8 3 v 6 c 0 5 -3 8 -8 9 c -5 -1 -8 -4 -8 -9 v -6 z"/>
      <polyline points="9 12 11.5 14.5 15.5 10"/>
    </svg>
  );
}
function CheckIcon({ size = 16, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 12 10 18 20 6"/>
    </svg>
  );
}
function InstagramIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="0.6" fill={color}/>
    </svg>
  );
}
function FacebookIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M13.5 22 v -8 h 2.6 l 0.4 -3 h -3 V 9 c 0 -0.9 0.3 -1.5 1.6 -1.5 H 17 V 4.8 c -0.3 0 -1.3 -0.1 -2.4 -0.1 c -2.4 0 -4 1.4 -4 4.1 V 11 H 8 v 3 h 2.6 v 8 z"/>
    </svg>
  );
}
function YouTubeIcon({ size = 20, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M22 8.2 a 3 3 0 0 0 -2.1 -2.1 C 18 5.5 12 5.5 12 5.5 s -6 0 -7.9 0.6 A 3 3 0 0 0 2 8.2 C 1.5 10 1.5 12 1.5 12 s 0 2 0.5 3.8 a 3 3 0 0 0 2.1 2.1 c 1.9 0.6 7.9 0.6 7.9 0.6 s 6 0 7.9 -0.6 a 3 3 0 0 0 2.1 -2.1 c 0.5 -1.8 0.5 -3.8 0.5 -3.8 s 0 -2 -0.5 -3.8 z M 10 15 V 9 l 5 3 z"/>
    </svg>
  );
}

/* ============================================================
   IMAGE PLACEHOLDER
   Renders an <img> with the exact filename requested. If the file
   doesn't exist yet, swaps in a dashed-border box labelled with
   the intended filename + alt text so the layout stays stable
   until real assets land in public/marketing/.
   ============================================================ */

function ImageSlot({ src, alt, label, variant, style }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`rl-img-slot rl-img-slot-${variant || 'banner'} ${broken ? 'is-broken' : ''}`}
      style={style}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
      {broken && (
        <div className="rl-img-slot-fallback">
          <div className="rl-img-slot-filename">{label}</div>
          <div className="rl-img-slot-alt">{alt}</div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STYLES
   Reuses the existing `rl-*` design language (buttons, container,
   eyebrow, headings, hero scrim). New rules only add what the
   restructured content needs: image placeholder cards, narrow
   centered sections, split-reverse for the second phone screenshot,
   accent lines, coming-soon badge, two-card grid.
   ============================================================ */

const CSS = `
html, body, #root { background: #020a12; }
body { margin: 0; }
/* Contain the whole marketing site to a standard centered width — no
   edge-to-edge full-bleed. On wide monitors it sits as a centered
   column with dark margins; below the cap it's simply full-width. This
   keeps the hero image at a sane size instead of stretching across an
   ultrawide display. */
.rl-root {
  max-width: 1400px; margin: 0 auto;
  background: ${P.bg}; color: ${P.ink};
  box-shadow: 0 0 70px rgba(0,0,0,0.55);
  font-family: -apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.rl-container { max-width: 1200px; margin: 0 auto; padding: 0 44px; }
@media (max-width: 560px) { .rl-container { padding: 0 22px; } }

/* Nav */
.rl-nav {
  display: flex; align-items: center; gap: 20px;
  padding: 22px 44px; max-width: 1200px; margin: 0 auto;
  position: relative; z-index: 5;
}
@media (max-width: 560px) { .rl-nav { padding: 18px 22px; } }
.rl-nav-links { display: flex; gap: 26px; flex: 1; justify-content: center; }
.rl-nav-links a {
  color: ${P.inkSoft}; text-decoration: none; font-size: 14px; font-weight: 500;
  transition: color 160ms ease;
}
.rl-nav-links a:hover { color: ${P.accent}; }
@media (max-width: 900px) { .rl-nav-links { display: none; } }

/* Mobile hamburger — replaces the header CTA + nav links on small screens */
.rl-nav-toggle { display: none; }
@media (max-width: 900px) {
  .rl-nav .rl-nav-cta { display: none; }  /* beats .rl-btn's inline-flex */
  .rl-nav-toggle {
    display: inline-flex; flex-direction: column; justify-content: center; gap: 5px;
    width: 44px; height: 40px; padding: 8px 10px; margin-left: auto;
    background: transparent; border: none; cursor: pointer;
  }
  .rl-nav-toggle span { display: block; height: 2px; width: 100%; background: ${P.ink}; border-radius: 2px; }
}
.rl-nav-menu {
  position: absolute; top: calc(100% - 4px); right: 22px; z-index: 30;
  background: ${P.card}; border: 1px solid ${P.border}; border-radius: 12px;
  padding: 10px; display: flex; flex-direction: column; gap: 2px; min-width: 210px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.55);
}
.rl-nav-menu a:not(.rl-btn) {
  color: ${P.inkSoft}; text-decoration: none; font-size: 15px; font-weight: 500;
  padding: 11px 12px; border-radius: 8px;
}
.rl-nav-menu a:not(.rl-btn):hover { background: ${P.cardHi}; color: ${P.accent}; }
.rl-nav-menu .rl-btn { margin-top: 8px; justify-content: center; }

/* Buttons */
.rl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px 22px; border-radius: 12px; font-size: 14px; font-weight: 700;
  letter-spacing: 0.5px; text-decoration: none; cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.rl-btn-primary {
  background: ${P.accent}; color: #031B33; border: none;
  box-shadow: 0 10px 30px rgba(25,212,242,0.30);
}
.rl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 40px rgba(25,212,242,0.40); }
.rl-btn-lg {
  padding: 18px 30px; font-size: 15px; letter-spacing: 0.6px;
}

/* Hero — bg image + scrim + centered single-column text.
   The scrim's top+mid opacities are dialled ~10% down from the
   original 0.35 / 0.62 so more of the bg image shows through — text
   still lands over enough dark for legibility since the ocean image
   is already dark on its own. Bottom stop stays fully opaque (fades
   to page bg color) to hide the seam into the next section. */
.rl-hero {
  position: relative; overflow: hidden;
  padding: 12px 0 48px;
  min-height: 0;
}
.rl-hero-bg {
  position: absolute; inset: 0; z-index: 0;
  background-color: ${P.bg};
  /* Full WIDTH, natural proportional height (no skew). The image spans
     the hero's full width and is as tall as its own 2:1 ratio makes it,
     anchored to the top; any area below just fades into the page bg via
     the scrim. */
  background-image: url("${A.heroBg}");
  background-size: 100% auto;
  background-position: center top;
  background-repeat: no-repeat;
}
.rl-hero-scrim {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(180deg, rgba(6,17,31,0.32) 0%, rgba(6,17,31,0.56) 45%, ${P.bg} 100%);
}
.rl-hero-inner {
  position: relative; z-index: 2;
  padding: 60px 0 20px;
  display: flex; flex-direction: column; align-items: center; text-align: center;
}
.rl-hero-inner .rl-h1 { max-width: 900px; }
.rl-hero-inner .rl-lead { max-width: 720px; margin: 0 auto 34px; }
.rl-eyebrow {
  font-size: 12px; font-weight: 800; letter-spacing: 2.5px;
  color: ${P.accent}; text-transform: uppercase;
}
.rl-h1 {
  /* Sized to keep each sentence on ONE line (3 lines total) as the copy
     column narrows on tablet — scales with viewport, capped so it never
     wraps a sentence. */
  font-size: clamp(34px, 4vw, 56px);
  font-weight: 900; line-height: 1.05; letter-spacing: -0.6px;
  margin: 0 0 20px; color: ${P.ink};
}
.rl-h1 span { color: ${P.accent}; }

.rl-lead {
  font-size: 18px; line-height: 1.6; color: ${P.inkSoft};
  max-width: 640px; margin: 0 0 30px;
}
@media (max-width: 500px) { .rl-lead { font-size: 16px; } }
/* Free callout — its own beat under the hero subtext, accent blue + bold. */
.rl-free-line {
  font-size: 17px; font-weight: 800; color: ${P.accent};
  letter-spacing: 0.2px; margin: 0 0 26px;
}
@media (max-width: 500px) { .rl-free-line { font-size: 15px; } }
.rl-cta-row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }

/* Sections */
.rl-section { padding: 90px 0; }
.rl-section-alt { background: ${P.bgAlt}; }
.rl-section-narrow { max-width: 860px; margin: 0 auto; text-align: center; }
.rl-section-head { max-width: 760px; margin: 0 auto 44px; text-align: center; }
.rl-section-head .rl-eyebrow { display: block; margin-bottom: 12px; }
.rl-h2 {
  font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -0.5px;
  color: ${P.ink}; margin: 0 0 18px;
}
@media (max-width: 700px) { .rl-h2 { font-size: 32px; } }
.rl-lead-2 { font-size: 17px; line-height: 1.65; color: ${P.inkSoft}; }
.rl-italic-note {
  font-style: italic; color: ${P.inkMute}; font-size: 14px; line-height: 1.6;
  margin-top: 22px;
}
.rl-accent-line {
  color: ${P.accent}; font-weight: 700; font-size: 15px;
  margin-top: 18px; letter-spacing: 0.2px;
}

/* Split layout — text one side, image the other. Reverse variant
   flips the image to the opposite column for visual rhythm between
   consecutive sections. */
.rl-split { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
@media (max-width: 900px) { .rl-split { grid-template-columns: 1fr; gap: 44px; } }
.rl-split-reverse .rl-split-media { grid-column: 1; grid-row: 1; }
.rl-split-reverse .rl-split-copy  { grid-column: 2; grid-row: 1; }
@media (max-width: 900px) {
  .rl-split-reverse .rl-split-media,
  .rl-split-reverse .rl-split-copy { grid-column: auto; grid-row: auto; }
  /* Mobile: image below copy in both variants — keeps the reading
     order predictable no matter which side the desktop image is on. */
  .rl-split-reverse .rl-split-media { order: 2; }
  .rl-split-reverse .rl-split-copy  { order: 1; }
}

/* Image placeholder — dashed-border box + labelled fallback until
   the real file is uploaded to /public/marketing/. */
.rl-img-slot {
  position: relative; overflow: hidden;
  background: #06182b; border: 2px dashed rgba(25,212,242,0.35);
  border-radius: 20px; display: flex; align-items: center; justify-content: center;
  color: ${P.inkSoft};
}
.rl-img-slot img {
  /* Content images scale down WHOLE — never crop. Detail-dense art
     like the Gulf heat map (with its right-hand species panel) must
     stay fully readable on phones, so height follows the natural
     aspect instead of being forced to fill a fixed box. */
  display: block; width: 100%; height: auto; object-fit: contain;
}
.rl-img-slot.is-broken img { display: none; }
.rl-img-slot-fallback {
  padding: 32px 22px; text-align: center;
}
.rl-img-slot-filename {
  color: ${P.accent}; font-size: 11.5px; font-weight: 800;
  letter-spacing: 1.6px; text-transform: uppercase; margin-bottom: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.rl-img-slot-alt {
  color: ${P.inkMute}; font-size: 13.5px; line-height: 1.55;
  max-width: 340px; margin: 0 auto;
}
/* Wide banner — full content width. No forced aspect-ratio: the
   container hugs the image's natural height so nothing is cropped. */
.rl-img-slot-banner {
  width: 100%; max-width: 100%;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45);
  margin-top: 32px;
}
/* Phone screenshot — capped width, centered, natural height (no crop). */
.rl-img-slot-phone {
  width: 100%; max-width: 300px;
  border-radius: 32px; margin: 0 auto;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45);
}
@media (max-width: 900px) {
  .rl-img-slot-phone { max-width: 260px; }
}

/* Feature tiles — 4-up on desktop, 2-up on tablet, stack on phone.
   Reuses the existing rl-feature card style verbatim. */
.rl-marine-maps { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 720px) { .rl-marine-maps { grid-template-columns: 1fr; } }
.rl-features { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
@media (max-width: 1024px) { .rl-features { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px)  { .rl-features { grid-template-columns: 1fr; } }
.rl-feature {
  background: ${P.card}; border: 1px solid ${P.border};
  border-radius: 20px; padding: 26px 22px; transition: border-color 180ms ease, transform 180ms ease;
}
.rl-feature:hover { border-color: ${P.borderHi}; transform: translateY(-3px); }
.rl-feature-icon {
  width: 46px; height: 46px; border-radius: 12px;
  background: ${P.accentDim}; display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.rl-feature h3 { font-size: 18px; font-weight: 800; color: ${P.ink}; margin: 0 0 8px; }
.rl-feature p  { font-size: 14px; line-height: 1.6; color: ${P.inkSoft}; margin: 0; }

/* Tile variant — full-bleed blueprint art behind the icon + copy,
   with a subtle dark scrim (via ::before) so the existing heading /
   body / icon stay legible. aspect-ratio: 4/5 matches the source
   art so nothing gets cropped to a thin strip at the top. Content
   flex-anchored to the bottom so the top-left icon of the art
   (roughly the top third of the image) stays visible and our own
   icon + text sit in the lower third where the scrim reads darkest.
   overflow:hidden keeps the scrim inside the rounded corners;
   direct children get z-index:1 so they render above the scrim. */
.rl-feature-tile {
  position: relative;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-color: ${P.card};
  overflow: hidden;
  aspect-ratio: 4 / 5;
  display: flex; flex-direction: column; justify-content: flex-end;
  /* Kill the base card's 1px border — the tile art has its own
     frame baked in and doubling looked wrong. Hover border-color
     rule from .rl-feature is a no-op on none. */
  border: none;
}
.rl-feature-tile::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(10, 22, 36, 0.20) 0%,
    rgba(10, 22, 36, 0.45) 55%,
    rgba(10, 22, 36, 0.75) 100%);
  pointer-events: none;
}
.rl-feature-tile > * { position: relative; z-index: 1; }
/* Hide the JSX icon — the tile art already has its own icon baked
   into the top-left. Display:none removes it from layout so the
   heading rises to sit against the bottom padding. */
.rl-feature-tile .rl-feature-icon { display: none; }

/* Phone screenshot — transparent PNG (mockup with rounded corners
   baked in), sits directly on the section background. Capped small on
   desktop so the split feels balanced next to the copy; full width up
   to the cap on mobile after the split collapses to one column. */
.rl-phone-shot {
  display: block; width: 100%; height: auto;
  max-width: 250px; margin: 0 auto;
}

/* Alert-card pair — transparent PNGs sitting directly on the section
   background, 2-up on desktop, stacked on phone. Each image caps at
   440px so they don't balloon on wide viewports. No card / border /
   fill — the images are meant to read as native app screenshots
   floating on the dark scene. */
.rl-alerts {
  display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
  max-width: 940px; margin: 32px auto 0;
  align-items: start;
}
.rl-alerts img {
  display: block; width: 100%; max-width: 440px; height: auto;
  margin: 0 auto;
}
@media (max-width: 720px) {
  .rl-alerts { grid-template-columns: 1fr; gap: 18px; }
}

/* Two-card row for Data + Free — same card treatment as tiles but
   two per row on desktop, stack on phone. */
.rl-two-card { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 720px) { .rl-two-card { grid-template-columns: 1fr; } }
.rl-two-card .rl-feature { padding: 30px 26px; }
.rl-two-card .rl-feature h3 { font-size: 20px; }
.rl-two-card .rl-feature p  { font-size: 15px; }

/* Coming soon — badge above centered copy. */
.rl-coming-badge {
  display: inline-block; padding: 6px 14px; border-radius: 999px;
  background: ${P.accentDim}; color: ${P.accent};
  font-size: 11px; font-weight: 800; letter-spacing: 2px;
  border: 1px solid ${P.borderHi}; margin-bottom: 18px;
}
/* LiDAR banner frame — 1.5px dashed accent, ~14px radius, 8px inner
   padding so the dashed line reads as a frame around (not touching)
   the image. Image itself is responsive width, natural height. */
.rl-coming-figure {
  display: block;
  margin: 32px auto 0;
  max-width: 860px; width: 100%;
  padding: 8px;
  border: 1.5px dashed ${P.accent};
  border-radius: 14px;
  box-sizing: border-box;
}
.rl-coming-figure img {
  display: block; width: 100%; height: auto;
  border-radius: 8px;
}

/* Final CTA — full-bleed background image behind centered text.
   Section itself carries the cover image; a linear-gradient scrim
   via ::before sits between the image and the content for legibility
   (photo center is already darkened, so scrim stays moderate).
   Content sits above via z-index. Vertical padding bumped to ~90px
   so it reads as a hero CTA rather than a tight banner. */
.rl-final-cta {
  position: relative; overflow: hidden;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-color: ${P.bgAlt};
  padding: 90px 0;
}
.rl-final-cta::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(8, 16, 26, 0.50) 0%,
    rgba(8, 16, 26, 0.68) 100%);
  pointer-events: none;
}
.rl-final-cta-inner {
  position: relative; z-index: 1;
  text-align: center;
}
.rl-final-cta-inner .rl-h2 {
  margin-bottom: 12px;
  color: #ffffff;
}
.rl-final-cta-inner .rl-lead-2 {
  max-width: 620px; margin: 0 auto 26px;
  color: rgba(255, 255, 255, 0.88);
}

/* Footer */
.rl-footer { padding: 40px 0 60px; border-top: 1px solid ${P.border}; }
.rl-footer-inner {
  display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap;
}
.rl-footer-links { display: flex; gap: 22px; flex-wrap: wrap; }
.rl-footer-links a { color: ${P.inkSoft}; font-size: 13px; text-decoration: none; }
.rl-footer-links a:hover { color: ${P.accent}; }
.rl-footer-legal { font-size: 12px; color: ${P.inkMute}; }
.rl-footer-social { display: flex; gap: 12px; align-items: center; }
.rl-footer-social a {
  width: 38px; height: 38px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${P.card}; border: 1px solid ${P.border}; color: ${P.inkSoft};
  transition: color 160ms ease, border-color 160ms ease;
}
.rl-footer-social a:hover { color: ${P.accent}; border-color: ${P.borderHi}; }

/* ============================================================
   REBUILD — mockup-faithful sections
   ============================================================ */

/* Nav tagline under the wordmark */
.rl-brand { display: inline-flex; flex-direction: column; line-height: 1; }
.rl-brand-tag {
  font-size: 10px; font-weight: 800; letter-spacing: 3px; color: ${P.accent};
  text-transform: uppercase; margin-top: 3px; padding-left: 2px;
}

/* Hero split — copy left, phones right */
.rl-hero-grid {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: 1.12fr 0.88fr; gap: 36px; align-items: start;
  /* top/bottom only — leave the horizontal padding from .rl-container
     intact. A left/right shorthand here would zero the side gutters and
     make the headline sit flush to the edge. Extra top padding drops the
     content a touch so more of the hero background shows above it. */
  padding-top: 48px; padding-bottom: 20px;
}
.rl-hero-grid .rl-h1 { margin-top: 0; }
.rl-hero-copy { max-width: 560px; }
.rl-hero-copy .rl-lead { margin-bottom: 20px; }
.rl-hero-free {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
  color: ${P.accent}; margin: 6px 0 18px; padding: 10px 0;
}
/* Primary CTA sits between the free line and the store badges, with a
   little breathing room so the badges drop slightly lower. */
.rl-hero-cta { margin: 0 0 32px; }
/* Store badges stay side by side on every width — never stack. Shrink
   the badge height on small phones so both fit on one line. */
.rl-store-row { display: flex; gap: 12px; flex-wrap: nowrap; align-items: center; }
.rl-store-row img { height: 52px; width: auto; display: block; }
@media (max-width: 560px) { .rl-store-row img { height: 44px; } }
@media (max-width: 380px) { .rl-store-row { gap: 8px; } .rl-store-row img { height: 38px; } }
.rl-hero-phones {
  position: relative; display: flex; align-items: flex-start; justify-content: center;
  min-height: 560px;
}
.rl-hero-phones img { position: absolute; top: 0; height: auto; filter: drop-shadow(0 26px 50px rgba(0,0,0,0.55)); }
/* Smaller + spread further apart so more of each screen is visible. */
.rl-hero-phone-front { width: 50%; z-index: 2; transform: translateX(-44%) rotate(-5deg); }
.rl-hero-phone-back  { width: 46%; z-index: 1; transform: translateX(48%) rotate(7deg); opacity: 0.96; }
@media (max-width: 900px) {
  .rl-hero-grid { grid-template-columns: 1fr; text-align: center; }
  .rl-hero-copy { max-width: 100%; margin: 0 auto; }
  .rl-hero-copy .rl-lead { margin-left: auto; margin-right: auto; }
  .rl-store-row, .rl-hero-free { justify-content: center; }
  /* Stacked layout: phones flow in normal document order BELOW the
     copy/badges — no absolute positioning, so they can never overlap
     the store buttons. Slight negative margins keep the overlapped look. */
  .rl-hero-phones { min-height: 0; margin-top: 30px; align-items: flex-end; }
  .rl-hero-phones img { position: static; filter: drop-shadow(0 16px 34px rgba(0,0,0,0.5)); }
  .rl-hero-phone-front { width: 46%; transform: rotate(-4deg); margin-right: -5%; z-index: 2; }
  .rl-hero-phone-back  { width: 42%; transform: rotate(5deg); margin-left: -5%; z-index: 1; }
}

/* Feature row — 5 icon+text columns with hairline dividers */
.rl-feat5 {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 0;
  margin-top: 40px;
}
.rl-feat5-col {
  padding: 0 22px; text-align: center;
  border-left: 1px solid ${P.border};
}
.rl-feat5-col:first-child { border-left: none; }
.rl-feat5-ico {
  width: 54px; height: 54px; border-radius: 14px; margin: 0 auto 14px;
  background: ${P.accentDim}; display: inline-flex; align-items: center; justify-content: center;
}
.rl-feat5-col h4 {
  font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
  color: ${P.accent}; margin: 0 0 8px;
}
.rl-feat5-col p { font-size: 13.5px; line-height: 1.55; color: ${P.inkSoft}; margin: 0; }
@media (max-width: 900px) {
  .rl-feat5 { grid-template-columns: repeat(2, 1fr); gap: 34px 0; }
  .rl-feat5-col { border-left: none; }
  .rl-feat5-col:nth-child(even) { border-left: 1px solid ${P.border}; }
}
@media (max-width: 520px) {
  .rl-feat5 { grid-template-columns: 1fr; }
  .rl-feat5-col:nth-child(even) { border-left: none; }
}

/* Patterns dashboard — copy left, composite right */
.rl-dash { display: grid; grid-template-columns: 0.85fr 1.4fr; gap: 44px; align-items: center; }
@media (max-width: 1000px) { .rl-dash { grid-template-columns: 1fr; gap: 34px; } }
.rl-check-list { list-style: none; padding: 0; margin: 22px 0 0; }
.rl-check-list li {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; color: ${P.inkSoft}; padding: 7px 0;
}
.rl-dash-grid {
  display: grid; grid-template-columns: 1fr 1.1fr 1fr; gap: 14px; align-items: start;
}
@media (max-width: 760px) { .rl-dash-grid { grid-template-columns: 1fr 1fr; } .rl-dash-phone-cell { grid-column: 1 / -1; order: -1; } }
.rl-dash-col { display: flex; flex-direction: column; gap: 14px; }
.rl-mini {
  background: ${P.card}; border: 1px solid ${P.border}; border-radius: 14px; padding: 16px;
}
.rl-mini-label {
  font-size: 10.5px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase;
  color: ${P.accent}; margin-bottom: 12px;
}
.rl-rank { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; color: ${P.ink}; }
.rl-rank-n {
  width: 20px; height: 20px; border-radius: 6px; background: ${P.accentDim}; color: ${P.accent};
  display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; flex-shrink: 0;
}
.rl-rank-name { flex: 1; }
.rl-rank-val { color: ${P.inkMute}; font-weight: 700; }
.rl-link { color: ${P.accent}; font-size: 12px; font-weight: 700; margin-top: 12px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
.rl-time-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
.rl-time-row .rl-sun { color: #f2c14e; }
.rl-time-day { font-size: 12px; color: ${P.inkMute}; }
.rl-time-val { font-size: 14px; color: ${P.ink}; font-weight: 700; }
.rl-stat-big { font-size: 40px; font-weight: 900; color: ${P.accent}; line-height: 1; }
.rl-stat-pos { color: #2ecc71; font-weight: 800; font-size: 14px; }
.rl-pb-row { display: flex; align-items: center; gap: 12px; }
.rl-pb-thumb {
  width: 54px; height: 40px; border-radius: 8px; flex-shrink: 0;
  background: ${P.cardHi}; border: 1px solid ${P.border};
  display: flex; align-items: center; justify-content: center;
}
/* Phone frame for the heat-map screenshot */
.rl-dash-phone-cell { display: flex; justify-content: center; }
.rl-phone-frame {
  width: 100%; max-width: 240px; aspect-ratio: 9 / 19; border-radius: 30px;
  border: 8px solid #0a1a2b; background: #06182b; overflow: hidden;
  box-shadow: 0 26px 60px rgba(0,0,0,0.5); position: relative;
}
.rl-phone-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* Your-data-your-rules privacy section */
.rl-priv-top {
  display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 40px; align-items: center; margin-bottom: 40px;
}
@media (max-width: 900px) { .rl-priv-top { grid-template-columns: 1fr; text-align: center; } }
.rl-priv-copy .rl-h2 span { color: ${P.accent}; }
@media (max-width: 900px) {
  .rl-priv-copy .rl-eyebrow-line { justify-content: center; }
  .rl-priv-copy .rl-lead-2 { margin-left: auto; margin-right: auto; max-width: 580px; }
}
.rl-priv-shield { display: flex; justify-content: center; }
.rl-priv-shield img { width: 100%; max-width: 420px; height: auto; display: block; }
@media (max-width: 900px) { .rl-priv-shield { display: none; } }

.rl-priv-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 22px; }
@media (max-width: 1000px) { .rl-priv-cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px)  { .rl-priv-cards { grid-template-columns: 1fr; } }
.rl-priv-card {
  background: ${P.card}; border: 1px solid ${P.border}; border-radius: 16px;
  padding: 24px 18px; text-align: center;
}
.rl-priv-card-ico {
  width: 56px; height: 56px; border-radius: 50%; margin: 0 auto 16px;
  background: ${P.accentDim}; border: 1px solid ${P.borderHi};
  display: inline-flex; align-items: center; justify-content: center;
}
.rl-priv-card h4 { font-size: 16px; font-weight: 800; color: ${P.ink}; margin: 0 0 10px; line-height: 1.25; }
.rl-priv-card p { font-size: 13.5px; line-height: 1.55; color: ${P.inkSoft}; margin: 0; }

.rl-priv-banner {
  display: flex; align-items: center; gap: 16px;
  background: ${P.card}; border: 1px solid ${P.border}; border-radius: 16px; padding: 18px 24px;
}
.rl-priv-banner-ico {
  width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
  background: ${P.accentDim}; border: 1px solid ${P.borderHi};
  display: inline-flex; align-items: center; justify-content: center;
}
.rl-priv-banner-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.rl-priv-banner-text strong { font-size: 18px; font-weight: 800; color: ${P.ink}; }
.rl-priv-banner-text span { font-size: 15px; color: ${P.accent}; }
.rl-priv-banner-logo { height: 34px; width: auto; flex-shrink: 0; }
@media (max-width: 640px) {
  .rl-priv-banner { flex-direction: column; text-align: center; gap: 12px; }
}

/* AI-learns-your-waters section — copy left, supplied graphic right */
.rl-ai-grid {
  display: grid; grid-template-columns: 1fr 1.05fr; gap: 48px; align-items: center;
}
@media (max-width: 900px) { .rl-ai-grid { grid-template-columns: 1fr; gap: 32px; } }
.rl-eyebrow-line { display: inline-flex; align-items: center; gap: 14px; }
.rl-eyebrow-line::after {
  content: ''; width: 54px; height: 1px;
  background: linear-gradient(90deg, ${P.borderHi}, transparent);
}
.rl-ai-copy .rl-h2 span { color: ${P.accent}; }
.rl-ai-feat { display: flex; gap: 16px; align-items: flex-start; margin-top: 22px; }
.rl-ai-feat-ico {
  width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid ${P.borderHi}; background: ${P.accentDim};
  display: inline-flex; align-items: center; justify-content: center;
}
.rl-ai-feat h4 {
  font-size: 14px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
  color: ${P.accent}; margin: 4px 0 6px;
}
.rl-ai-feat p { font-size: 14px; line-height: 1.55; color: ${P.inkSoft}; margin: 0; }
.rl-ai-privacy {
  display: flex; align-items: center; gap: 14px; margin-top: 30px;
  padding: 15px 22px; border: 1px solid ${P.border}; border-radius: 999px;
  background: rgba(25,212,242,0.05);
}
.rl-ai-privacy-title {
  font-size: 12.5px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: ${P.accent};
}
.rl-ai-privacy-body { font-size: 13px; color: ${P.inkSoft}; margin-top: 2px; }
.rl-ai-media {
  border: 1.5px dashed ${P.borderHi}; border-radius: 16px; padding: 12px;
}
.rl-ai-media img { display: block; width: 100%; height: auto; border-radius: 8px; }
@media (max-width: 900px) { .rl-ai-media { max-width: 520px; margin: 0 auto; } }

/* Coming-soon measurement diagram */
.rl-measure { display: grid; grid-template-columns: 1.2fr 1fr; gap: 44px; align-items: center; }
@media (max-width: 900px) { .rl-measure { grid-template-columns: 1fr; gap: 30px; } }
/* Image first in DOM but stacks BELOW the copy on mobile for reading order. */
@media (max-width: 900px) { .rl-measure .rl-measure-fig { order: 2; } }
.rl-measure-fig {
  position: relative; border: 1.5px dashed ${P.borderHi}; border-radius: 16px;
  background: transparent; padding: 12px;
}
.rl-measure-fig img { width: 100%; height: auto; display: block; }
.rl-measure-top, .rl-measure-bottom {
  text-align: center; color: ${P.accent}; font-weight: 800; font-size: 15px; letter-spacing: 0.4px;
}
.rl-measure-top { margin-bottom: 8px; }
.rl-measure-bottom {
  margin-top: 8px; display: inline-block; padding: 5px 14px; border-radius: 999px;
  border: 1px solid ${P.borderHi}; background: ${P.accentDim};
  position: relative; left: 50%; transform: translateX(-50%);
}
`;

/* ============================================================
   SECTIONS
   ============================================================ */

function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <nav className="rl-nav" aria-label="Primary">
      <a href="#top" className="rl-brand" aria-label="ReelIntel — home">
        <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 52, width: 'auto', display: 'block' }} />
      </a>
      <div className="rl-nav-links">
        {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
      </div>
      <a className="rl-btn rl-btn-primary rl-nav-cta" href={storeUrl()} style={{ padding: '11px 20px', fontSize: 13 }}>
        Get the app
      </a>
      <button
        className="rl-nav-toggle"
        aria-label="Menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(o => !o)}
      >
        <span/><span/><span/>
      </button>
      {menuOpen && (
        <div className="rl-nav-menu">
          {NAV_ITEMS.map(n => (
            <a key={n.label} href={n.href} onClick={() => setMenuOpen(false)}>{n.label}</a>
          ))}
          <a className="rl-btn rl-btn-primary" href={storeUrl()} onClick={() => setMenuOpen(false)}>Get the app</a>
        </div>
      )}
    </nav>
  );
}

function Hero() {
  return (
    <section className="rl-hero" id="top">
      <div className="rl-hero-bg" />
      <div className="rl-hero-scrim" />
      <div className="rl-container rl-hero-grid">
        <div className="rl-hero-copy">
          <h1 className="rl-h1">
            Know your catch.<br/><span>Keep it legal.</span><br/>Save the memory.
          </h1>
          <p className="rl-lead">
            Snap a photo to identify your fish, see the rules for your waters instantly, and log every catch. Then AI studies your logs to find your patterns — so every trip gets better.
          </p>
          <p className="rl-hero-free"><CheckIcon size={16} /> 100% free. No in-app purchases.</p>
          <div className="rl-hero-cta">
            <a className="rl-btn rl-btn-primary rl-btn-lg" href={storeUrl()}>
              Download App <ArrowRight size={16} />
            </a>
          </div>
          <div className="rl-store-row">
            <a href={APP_STORE_URL} aria-label="Download on the App Store">
              <img src={A.appStoreBadge} alt="Download on the App Store" />
            </a>
            <a href={PLAY_STORE_URL || APP_STORE_URL} aria-label="Get it on Google Play">
              <img src={A.googlePlayBadge} alt="Get it on Google Play" />
            </a>
          </div>
        </div>
        <div className="rl-hero-phones" aria-hidden="true">
          <img className="rl-hero-phone-back" src={A.regulationsPhone} alt="" loading="eager" />
          <img className="rl-hero-phone-front" src={A.reviewCatchPhone} alt="" loading="eager" />
        </div>
      </div>
    </section>
  );
}

function FishSmarter() {
  return (
    <section className="rl-section" id="features">
      <div className="rl-container rl-section-narrow">
        <span className="rl-eyebrow">Fish smarter</span>
        <h2 className="rl-h2" style={{ marginTop: 12 }}>Your logs. Your patterns. Your spots stay yours.</h2>
        <p className="rl-lead-2">
          Every catch you log builds a private picture of what works for you — the tides, conditions, and times of day that actually produce. AI studies your own history and tells you when to go and what to target.
        </p>
        <p className="rl-lead-2">
          Want more? Opt in to community intel and unlock heat map zones showing where fish are being caught across the Gulf. It's off by default, and you can turn it off anytime.
        </p>
        <p className="rl-italic-note">
          Zones, never spots. Your exact fishing spots are never shared, never shown to another angler, and never appear on anyone's map. Export your data anytime.
        </p>
        <ImageSlot
          variant="banner"
          src={A.patternsHeatmap}
          alt="Heat-map view of catch density across the Gulf, with hot windows for the target species highlighted."
          label="patterns-heatmap.jpg"
        />
      </div>
    </section>
  );
}

function ProblemBridge() {
  return (
    <section className="rl-section rl-section-alt">
      <div className="rl-container rl-section-narrow">
        <h2 className="rl-h2">And when you hook the unexpected, ReelIntel has your back.</h2>
        <p className="rl-lead-2">
          You don't fish for a living. So when you land something you don't recognize, you might not know what it is — or the rules. A wrong call can cost you a fine, or worse. That's the moment ReelIntel was built for.
        </p>
        <div className="rl-alerts">
          <img
            src={A.alertOutOfSeason}
            alt="Out of season alert — species is currently out of season in your selected waters"
            loading="lazy"
            decoding="async"
          />
          <img
            src={A.alertInSeason}
            alt="In season alert — species is in season, with minimum legal length shown"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}

function KnowRules() {
  return (
    <section className="rl-section" id="how">
      <div className="rl-container rl-split">
        <div className="rl-split-copy">
          <span className="rl-eyebrow">Know the rules &amp; log it</span>
          <h2 className="rl-h2" style={{ marginTop: 12 }}>Know the rules. Keep it legal. Save the moment.</h2>
          <p className="rl-lead-2">
            The instant you know the species, ReelIntel shows the regulations for your waters — season, size, and bag limits — so you make the keep-or-release call with confidence. Then save it: kept or released, measurements, up to 3 photos, Personal Bests, and one-tap share to brag on your buddies.
          </p>
          <p className="rl-italic-note">
            Rules are stored on the app and refresh every time you open with a connection — current as of your last connection.
          </p>
        </div>
        <div className="rl-split-media">
          <img
            className="rl-phone-shot"
            src={A.regulationsPhone}
            alt="ReelIntel species regulations page — Queen Snapper, seasons, size and bag limits, required gear."
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}

function IdentifyIt() {
  return (
    <section className="rl-section rl-section-alt">
      <div className="rl-container rl-split rl-split-reverse">
        <div className="rl-split-media">
          <img
            className="rl-phone-shot"
            src={A.reviewCatchPhone}
            alt="ReelIntel Review catch screen — Mahi-Mahi confirmed, in season, ready to log."
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="rl-split-copy">
          <span className="rl-eyebrow">Identify it</span>
          <h2 className="rl-h2" style={{ marginTop: 12 }}>Instantly know what's on your line — and if it's legal to keep.</h2>
          <p className="rl-lead-2">
            Snap a photo and ReelIntel's AI names the species on the spot — with no signal, miles offshore, where other fish ID apps go dark. Hooked something you don't recognize? You've got an answer in seconds.
          </p>
          <p className="rl-accent-line">Other fish ID apps need internet. ReelIntel doesn't.</p>
          <p className="rl-italic-note">
            A growing beta that gets sharper every trip — always confirm your catch.
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURE_TILES = [
  {
    icon: CloudIcon,
    title: 'Conditions that matter',
    body: 'Weather, wind, and surf for your fishing spots — know when to go and what to expect.',
    bg: A.tilePatterns,
  },
  {
    icon: ShieldIcon,
    title: 'Alerts that keep you sharp',
    body: 'Regulation changes on your starred species, plus reminders for the best times to fish.',
    bg: A.tileFishId,
  },
  {
    icon: TrophyIcon,
    title: 'Fish ID Quiz',
    body: 'Test your skills on species, seasons, and limits. We made it a game — challenge your buddies.',
    bg: A.tileFishQuiz,
  },
  {
    icon: FishIcon,
    title: 'Research any fish',
    body: 'Look up regulations and species anytime, in season or out.',
    bg: A.tileCheckRegs,
  },
];

const PRIVACY_CARDS = [
  { icon: LockIcon,        title: 'Private by Default',      body: 'Every catch, waypoint, and note stays in your private log.' },
  { icon: BrainIcon,       title: 'AI Learns Your History',  body: "Your patterns become smarter with every trip—not someone else's." },
  { icon: CloudIcon,       title: 'Secure Cloud Sync',       body: 'Your data is encrypted and backed up so you can access it anywhere.' },
  { icon: DownloadIcon,    title: 'Export Anytime',          body: 'Download your catches, photos, and logs whenever you want.' },
  { icon: ShieldXIcon,     title: 'We Never Sell Your Spots', body: 'If you opt in, we use anonymous trends to improve insights—your exact locations stay private.' },
];

function YourDataYourRules() {
  return (
    <section className="rl-section" id="features" style={{ paddingTop: 36 }}>
      <div className="rl-container">
        {/* Top row — shield left, copy right (alternates with adjacent sections) */}
        <div className="rl-priv-top">
          <div className="rl-priv-shield" aria-hidden="true">
            <img src={A.shield} alt="" loading="lazy" decoding="async" />
          </div>
          <div className="rl-priv-copy">
            <span className="rl-eyebrow rl-eyebrow-line"><LockIcon size={16} /> Your data is yours</span>
            <h2 className="rl-h2" style={{ marginTop: 14 }}>Your data.<br/><span>Your memories.</span><br/>Export anytime.</h2>
            <p className="rl-lead-2">
              Everything you log belongs to you. ReelIntel learns from your catches to build your personal fishing intelligence — but your exact fishing locations are never shared with anyone.
            </p>
          </div>
        </div>

        {/* 5 privacy cards */}
        <div className="rl-priv-cards">
          {PRIVACY_CARDS.map((c) => (
            <div className="rl-priv-card" key={c.title}>
              <div className="rl-priv-card-ico"><c.icon size={26} /></div>
              <h4>{c.title}</h4>
              <p>{c.body}</p>
            </div>
          ))}
        </div>

        {/* Bottom reassurance banner */}
        <div className="rl-priv-banner">
          <div className="rl-priv-banner-ico"><ShieldCheckIcon size={26} /></div>
          <div className="rl-priv-banner-text">
            <strong>Fish smarter with confidence.</strong>
            <span>Your memories belong to you. Your data always goes where you go.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const AI_FEATURES = [
  { icon: BrainIcon,  title: 'Learns from you',              body: 'The more you log, the smarter it gets. Our AI adapts to your locations, targets, and preferences.' },
  { icon: ChartIcon,  title: 'Finds what works',            body: 'Uncover trends in species, size, time, tide, lures, and more — so you can fish with confidence.' },
  { icon: MapPinIcon, title: 'Personalized insights',       body: 'Get custom recommendations for your next trip based on proven patterns from your own data.' },
  { icon: TargetIcon, title: 'Better trips. More memories.', body: 'Less guessing. More catching. The best pattern is the one you build.' },
];

function AiLearnsWaters() {
  return (
    <section className="rl-section rl-section-alt" id="how">
      <div className="rl-container">
        <div className="rl-ai-grid">
          {/* Left column */}
          <div className="rl-ai-copy">
            <span className="rl-eyebrow rl-eyebrow-line">Powered by AI</span>
            <h2 className="rl-h2" style={{ marginTop: 14 }}>AI that learns<br/><span>your waters.</span></h2>
            <p className="rl-lead-2" style={{ marginBottom: 18 }}>
              ReelIntel's AI engine analyzes every catch you log to discover patterns unique to you — from hotspots and seasons to bite times and techniques that work.
            </p>
            <a href="#deepblue" style={{
              color: '#19D4F2', fontWeight: 700, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 26,
            }}>
              Instant photo ID is powered by DeepBlue — see how it works <ArrowRight size={15} />
            </a>
            {AI_FEATURES.map((f) => (
              <div className="rl-ai-feat" key={f.title}>
                <div className="rl-ai-feat-ico"><f.icon size={22} /></div>
                <div>
                  <h4>{f.title}</h4>
                  <p>{f.body}</p>
                </div>
              </div>
            ))}
            <div className="rl-ai-privacy">
              <LockIcon size={20} />
              <div>
                <div className="rl-ai-privacy-title">100% Private &amp; Secure</div>
                <div className="rl-ai-privacy-body">Your data stays yours. Always.</div>
              </div>
            </div>
          </div>

          {/* Right column — supplied graphic */}
          <div className="rl-ai-media">
            <img
              src={A.aiInsightsGraphic}
              alt="ReelIntel AI Insights — top pattern, hotspot confidence, best bite window, seasonal success, catch trend, top locations, and most effective lures."
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function DataAndFree() {
  return (
    <section className="rl-section rl-section-alt" id="data-free">
      <div className="rl-container">
        <div className="rl-two-card">
          <div className="rl-feature">
            <h3>Your data is yours to take.</h3>
            <p>Export it anytime and use it however you want — bring it to other tools, keep your own records. We keep your personal information secure.</p>
          </div>
          <div className="rl-feature">
            <h3>100% free. No in-app purchases necessary.</h3>
            <p>No subscription, no paywall, no upsells. ReelIntel is free because the collective, anonymized picture makes it powerful for every angler. Get in now and fish smarter, on us.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComingSoon() {
  return (
    <section className="rl-section" id="coming">
      <div className="rl-container">
        <div className="rl-measure">
          <div className="rl-measure-fig">
            <img
              src={A.comingSoonLidar}
              alt="LiDAR fish measurement — length and weight estimated from one photo."
              loading="lazy"
              decoding="async"
            />
          </div>
          <div>
            <div className="rl-coming-badge">COMING SOON</div>
            <h2 className="rl-h2" style={{ marginTop: 14 }}>Measure and weigh<br/>your fish from one photo.</h2>
            <p className="rl-lead-2">
              Built-in LiDAR, no tape, no scale. Just snap and know. ReelIntel's AI grows more accurate every day — and it's only the beginning.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DeepBlue() {
  return (
    <section className="rl-section rl-section-alt" id="deepblue">
      <div className="rl-container">
        <span className="rl-eyebrow rl-eyebrow-line">The engine inside</span>
        <h2 className="rl-h2" style={{ marginTop: 14 }}>
          Meet <span style={{ color: '#19D4F2' }}>DeepBlue</span>.
        </h2>
        <p className="rl-lead-2" style={{ maxWidth: 780, marginBottom: 30 }}>
          DeepBlue is ReelIntel's proprietary fish-identification model — trained on
          hundreds of thousands of real fish photos to deliver the most accurate
          on-device fish ID available. It runs right on your phone, so the moment you
          snap a photo you get an instant, private identification — no signal required.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
        }}>
          <div className="rl-feature">
            <h3>Hundreds of thousands of photos</h3>
            <p>Trained on a massive, ever-growing library of real catches — and it keeps learning from every angler who logs one.</p>
          </div>
          <div className="rl-feature">
            <h3>Runs on your device</h3>
            <p>Identification happens on your phone, not a server. It works offline, and your photos stay private to you.</p>
          </div>
          <div className="rl-feature">
            <h3>Built for these waters</h3>
            <p>Purpose-built for the species you actually catch across the Gulf Coast and Florida Atlantic — not a generic classifier.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section
      className="rl-final-cta"
      style={{ backgroundImage: `url("${A.ctaMakeEveryTrip}")` }}
    >
      <div className="rl-container rl-final-cta-inner">
        <h2 className="rl-h2">Make every trip count.</h2>
        <p className="rl-lead-2">Know your catch. Keep it legal. Fish smarter.</p>
        <a className="rl-btn rl-btn-primary rl-btn-lg" href={storeUrl()}>
          Download App <ArrowRight size={16} />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="rl-footer">
      <div className="rl-container rl-footer-inner">
        <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 60, width: 'auto', display: 'block' }} />
        <div className="rl-footer-links">
          {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
          <a href={PRIVACY_URL}>Privacy</a>
          <a href={TERMS_URL}>Terms</a>
        </div>
        <div className="rl-footer-social">
          <a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram"><InstagramIcon /></a>
          <a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook"><FacebookIcon /></a>
          <a href="https://youtube.com" target="_blank" rel="noreferrer" aria-label="YouTube"><YouTubeIcon /></a>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

function MarineIntel() {
  const cards = [
    { icon: TargetIcon, title: 'Fishability grade', body: 'An A–F grade for right now, every hour, and 10 days out — weighted for wind, seas, and swell period and tuned to safe-boating limits.' },
    { icon: CloudIcon,  title: 'Wind, waves & tide', body: 'Wind and gusts in knots, wave height and period, sea temp, currents, and NOAA tide predictions for your starred spot.' },
    { icon: MapPinIcon, title: 'Chlorophyll maps', body: 'Find the color: satellite phytoplankton imagery reveals the green-water breaks where bait and gamefish stack up.' },
    { icon: ChartIcon,  title: 'Sea-temp breaks', body: 'Satellite sea-surface temperature shows the edges and weed lines that concentrate pelagics — free NOAA/NASA data.' },
  ];
  return (
    <section className="rl-section rl-section-alt" id="marine">
      <div className="rl-container rl-section-narrow">
        <span className="rl-eyebrow">New · Gulf &amp; Florida Atlantic</span>
        <h2 className="rl-h2" style={{ marginTop: 12 }}>Know before you go.</h2>
        <p className="rl-lead-2">
          Marine forecasts and satellite ocean maps built for our waters — so you fish the right window, in the right water. No paid subscription, no separate app.
        </p>
      </div>
      {/* Showcase gallery — forecast banner + the two satellite maps */}
      <div className="rl-container" style={{ marginTop: 40 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <ImageSlot
            variant="banner"
            src={A.marineForecast}
            label="MARINE-FORECAST.png"
            alt="ReelIntel 10-day fishability outlook in 6-hour blocks — letter grade, bite %, wind, waves, tide."
          />
          <div className="rl-marine-maps">
            <ImageSlot
              variant="banner"
              src={A.marineChlorophyll}
              label="MARINE-CHLOROPHYLL.png"
              alt="Satellite chlorophyll map of the Gulf and Florida — the green-water breaks where bait and gamefish stack up."
            />
            <ImageSlot
              variant="banner"
              src={A.marineSeaTemp}
              label="MARINE-SEATEMP.png"
              alt="Satellite sea-surface temperature map of the Gulf and Florida — temperature breaks that concentrate pelagics."
            />
          </div>
        </div>
      </div>
      <div className="rl-container" style={{ marginTop: 40 }}>
        <div className="rl-features">
          {cards.map((c) => (
            <div className="rl-feature" key={c.title}>
              <div className="rl-feature-icon"><c.icon size={22} /></div>
              <h3>{c.title}</h3>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MarketingLanding() {
  const cssRef = useMemo(() => CSS, []);
  return (
    <div className="rl-root">
      <style>{cssRef}</style>
      <Nav />
      {/* Announcement strip sits directly under the nav so news
          reaches signed-out marketing visitors too. */}
      <div style={{
        maxWidth: 1120, margin: '0 auto', padding: '0 20px', boxSizing: 'border-box',
      }}>
        <AnnouncementBanner />
      </div>
      <Hero />
      <MarineIntel />
      <YourDataYourRules />
      <AiLearnsWaters />
      <ComingSoon />
      <DeepBlue />
      <FinalCTA />
      <Footer />
    </div>
  );
}

/* ============================================================
   /reset-password — web-only page
   ============================================================
   Landed on by password-reset emails from Supabase. The link URL
   includes a recovery access token in the fragment. Supabase's
   detectSessionInUrl:true (set in supabase-client.js) auto-parses
   it and lands a temporary "recovery" session — sufficient to
   call updateUser({ password }). Once updated, the user goes back
   to the app and signs in with the new password. */
export function ResetPasswordPage() {
  const [password, setPassword]     = useState('');
  const [confirm, setConfirm]       = useState('');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState('');
  const [ready, setReady]           = useState(false); // recovery session confirmed
  const [linkError, setLinkError]   = useState('');    // fatal: link is bad
  const [done, setDone]             = useState(false);

  // Exchange the recovery link for a session BEFORE letting the user
  // submit. Supabase JS v2 defaults to the PKCE flow, so the reset
  // link looks like:
  //   https://reelintel.ai/reset-password?code=<uuid>
  // We must call exchangeCodeForSession explicitly; detectSessionInUrl
  // alone doesn't complete the exchange fast enough and users hit
  // AUTH_SESSION_MISSING when submitting.
  //
  // Fallback: older implicit-flow links use a URL fragment like
  //   #access_token=...&type=recovery
  // The client's detectSessionInUrl:true handles those. If neither
  // form is present, the link is invalid and we surface it as a
  // fatal error rather than let the user type into a dead form.
  useEffect(() => {
    let cancelled = false;
    const c = supabaseClient();
    if (!c) { setLinkError('Supabase is not configured on this deploy.'); return; }

    const url  = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const err  = url.searchParams.get('error') || url.searchParams.get('error_description');
    const hasImplicit = window.location.hash.includes('access_token');

    if (err) { setLinkError(err); return; }

    // Set up the session subscription first so both flows can land it.
    const off = subscribeAuth((sess) => {
      if (cancelled) return;
      if (sess) setReady(true);
    });

    if (code) {
      // PKCE flow — exchange code for session.
      c.auth.exchangeCodeForSession(window.location.href).then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLinkError(error.message || 'This reset link is invalid or has expired. Request a new one.');
          return;
        }
        if (data?.session) setReady(true);
        // Clean the code out of the URL so a refresh doesn't retry.
        window.history.replaceState({}, '', url.pathname);
      });
    } else if (!hasImplicit) {
      // No code + no fragment → nothing to exchange. Bad link.
      setLinkError('This page must be opened from a password-reset email link. Request one from the app’s Sign in → Forgot password screen.');
    }

    return () => { cancelled = true; off(); };
  }, []);

  const submit = async () => {
    setError('');
    if (!ready) { setError('Recovery session is not ready yet. Give it a moment and try again.'); return; }
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm)             { setError('Passwords do not match.'); return; }
    setBusy(true);
    const res = await updatePassword({ password });
    setBusy(false);
    if (!res.ok) { setError(res.error || 'Could not update password.'); return; }
    setDone(true);
  };

  const wrap = {
    minHeight: '100vh', background: T.bgDeep, color: T.parchment,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    fontFamily: '-apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif',
  };
  const card = {
    background: '#0B2740', border: `1px solid ${'rgba(15, 94, 133, 0.35)'}`,
    borderRadius: 16, padding: '28px 24px', maxWidth: 420, width: '100%',
  };
  const input = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    background: '#0e2f4e', border: `1px solid ${'rgba(15, 94, 133, 0.35)'}`,
    color: T.ink, fontSize: 15, marginTop: 4, boxSizing: 'border-box',
  };
  const label = { fontSize: 11, letterSpacing: 1.4, color: T.brass, fontWeight: 800, marginTop: 14, display: 'block' };
  const btn = {
    marginTop: 18, width: '100%', padding: '12px 16px', borderRadius: 10,
    background: T.brass, color: '#031B33', border: 'none', fontWeight: 800,
    fontSize: 14, cursor: 'pointer', letterSpacing: 0.5,
  };

  return (
    <div style={wrap}>
      <div style={card}>
        {done ? (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>Password updated</h1>
            <p style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
              You can now open the ReelIntel app and sign in with your new password.
            </p>
            <a href="/" style={{ ...btn, display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: 20 }}>
              Go to home
            </a>
          </>
        ) : linkError ? (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>Reset link problem</h1>
            <p style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
              {linkError}
            </p>
            <a href="/" style={{ ...btn, display: 'inline-block', textAlign: 'center', textDecoration: 'none', marginTop: 20 }}>
              Go to home
            </a>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Set a new password</h1>
            <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, margin: 0 }}>
              Enter a new password below. After saving, sign in from the ReelIntel app.
            </p>
            {!ready && (
              <div style={{ fontSize: 12, color: T.inkMute, marginTop: 12 }}>Loading recovery session…</div>
            )}

            <label style={label}>NEW PASSWORD</label>
            <input type="password" value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   placeholder="At least 8 characters"
                   autoComplete="new-password" style={input} disabled={!ready} />
            <label style={label}>CONFIRM PASSWORD</label>
            <input type="password" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                   autoComplete="new-password" style={input} disabled={!ready} />
            {error && (
              <div role="alert" style={{ marginTop: 12, fontSize: 12, color: '#FF4D4D', lineHeight: 1.45 }}>
                {error}
              </div>
            )}
            <button onClick={submit} disabled={busy || !ready} style={{ ...btn, opacity: (busy || !ready) ? 0.5 : 1, cursor: (busy || !ready) ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Updating…' : ready ? 'Update password' : 'Waiting for recovery session…'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   /testers — private early-access recruiting page
   ============================================================
   NOT the public marketing homepage. This URL is texted directly to
   ~25 anglers the founder knows personally, so it is unlisted (no nav
   or footer link) and served with X-Robots-Tag: noindex (vercel.json).

   It reuses the site's design system wholesale — the `rl-*` classes,
   the P palette, the button and card language — and adds only what the
   tester flow needs. iOS only: ReelIntel has no Android build, so there
   is deliberately no Play badge or "available on both stores" copy.

   The phone is composed in markup rather than shipped as a flat export:
   it stays sharp on every display, costs no image bytes on a page that
   is opened over cellular from a text message, and the screen content
   can be edited in code instead of re-cut in a design tool.  */

/* Every download CTA on the page points here. */
const TESTER_APP_URL = APP_STORE_URL;

/* Tester spots. SPOTS_TOTAL is the promise in the copy; the claimed
   count is read from the backend when the tester_feedback table exists
   (one completed submission = one claimed spot) and falls back to this
   constant otherwise — so the page is correct before any backend work
   and self-maintaining after it. */
const TESTER_SPOTS_TOTAL = 25;
const TESTER_SPOTS_CLAIMED_FALLBACK = 0;

function AppleIcon({ size = 19, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.8-2.2c.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.9zM14.2 5.3c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z" />
    </svg>
  );
}

const TESTERS_CSS = `
/* ---- shell ---- */
.rl-tt-nav {
  display: flex; align-items: center; gap: 14px;
  padding: 18px 44px; max-width: 1200px; margin: 0 auto;
  position: sticky; top: 0; z-index: 40;
  background: rgba(6,17,31,0.82); backdrop-filter: blur(14px);
  border-bottom: 1px solid ${P.border};
}
@media (max-width: 560px) { .rl-tt-nav { padding: 12px 18px; gap: 10px; } }
.rl-tt-nav-sp { flex: 1; }
.rl-tt-back {
  color: ${P.inkSoft}; text-decoration: none; font-size: 13.5px; font-weight: 600;
  white-space: nowrap; transition: color 160ms ease;
}
.rl-tt-back:hover { color: ${P.accent}; }
@media (max-width: 460px) { .rl-tt-back { display: none; } }
.rl-tt-navcta { padding: 10px 18px; font-size: 13px; white-space: nowrap; }

/* ---- hero ---- */
.rl-tt-hero { position: relative; overflow: hidden; padding: 34px 0 20px; }
.rl-tt-hero-art {
  position: absolute; right: -6%; top: -4%; width: min(720px, 58%);
  opacity: 0.13; pointer-events: none; z-index: 0; filter: saturate(1.1);
}
.rl-tt-rings {
  position: absolute; left: 50%; top: 46%; width: 1100px; height: 1100px;
  transform: translate(-50%,-50%); pointer-events: none; z-index: 0; opacity: 0.5;
}
.rl-tt-hero-grid { position: relative; z-index: 1; }
.rl-tt-hero-copy {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  max-width: 860px; margin: 0 auto;
}
.rl-tt-hero-copy > .rl-tt-logo  { order: 1; }
.rl-tt-hero-copy > .rl-tt-h1    { order: 2; }
.rl-tt-hero-copy > .rl-tt-sub   { order: 3; }
.rl-tt-hero-copy > .rl-tt-caps  { order: 4; }
.rl-tt-hero-copy > .rl-tt-hero-cta { order: 5; }
@media (max-width: 700px) {
  /* CTA before the capability list — it must land in the first screen. */
  .rl-tt-hero-copy > .rl-tt-hero-cta { order: 4; margin-bottom: 26px; }
  .rl-tt-hero-copy > .rl-tt-caps     { order: 5; margin-bottom: 0; }
  .rl-tt-logo { width: 220px; margin-bottom: 16px; }
  .rl-tt-h1   { margin-bottom: 14px; }
  .rl-tt-sub  { font-size: 15.5px; margin-bottom: 22px; }
  .rl-tt-hero { padding-top: 22px; }
}
.rl-tt-logo { width: min(360px, 78%); height: auto; display: block; margin-bottom: 24px; }
.rl-tt-h1 {
  font-size: clamp(36px, 5.6vw, 64px); line-height: 0.98; margin: 0 0 18px;
  font-weight: 900; letter-spacing: -1px; text-transform: uppercase;
}
.rl-tt-h1 .accent { color: ${P.accent}; }
.rl-tt-sub { color: ${P.inkSoft}; font-size: 17px; line-height: 1.62; margin: 0 0 30px; max-width: 640px; }
.rl-tt-caps {
  display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 26px 24px;
  margin: 4px 0 0; padding: 26px 0 0; list-style: none; width: 100%;
  border-top: 1px solid ${P.border}; text-align: left;
}
@media (max-width: 860px) { .rl-tt-caps { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 22px; } }
@media (max-width: 420px) { .rl-tt-caps { grid-template-columns: 1fr; gap: 18px; } }
.rl-tt-cap-t {
  font-size: 12.5px; font-weight: 800; color: ${P.ink}; text-transform: uppercase;
  letter-spacing: 0.8px; display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
}
.rl-tt-cap-d { font-size: 13.5px; color: ${P.inkMute}; line-height: 1.5; margin: 0; }
.rl-tt-note { font-size: 13px; color: ${P.inkMute}; margin: 12px 0 0; }
.rl-tt-note .accent { color: ${P.accent}; }

/* Big Apple-style CTA — used in several sections */
.rl-tt-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 11px;
  background: ${P.accent}; color: #031B33; border: none; cursor: pointer;
  padding: 17px 30px; border-radius: 14px; font-size: 15.5px; font-weight: 800;
  letter-spacing: 0.3px; text-decoration: none;
  box-shadow: 0 14px 38px rgba(25,212,242,0.32);
  transition: transform 140ms ease, box-shadow 140ms ease;
}
.rl-tt-cta:hover { transform: translateY(-2px); box-shadow: 0 18px 46px rgba(25,212,242,0.44); }
.rl-tt-cta-ghost {
  background: transparent; color: ${P.accent}; border: 1.5px solid ${P.accent};
  box-shadow: none;
}
.rl-tt-cta-ghost:hover { background: rgba(25,212,242,0.08); box-shadow: none; }
@media (max-width: 560px) { .rl-tt-cta { width: 100%; box-sizing: border-box; padding: 17px 18px; font-size: 15px; } }
/* Keep the label on ONE line on a phone — a wrapped label orphans the
   Apple glyph on the far left and reads as a layout bug. */
@media (max-width: 440px) { .rl-tt-cta-long { display: none; } }

/* ---- generic section furniture ---- */
.rl-tt-sec { padding: 62px 0; scroll-margin-top: 84px; }
.rl-tt-sec-alt { background: ${P.bgAlt}; }
@media (max-width: 640px) { .rl-tt-sec { padding: 46px 0; } }
.rl-tt-h2 {
  font-size: clamp(26px, 3.9vw, 42px); font-weight: 900; text-transform: uppercase;
  letter-spacing: -0.5px; line-height: 1.04; margin: 0 0 12px;
}
.rl-tt-h2 .accent { color: ${P.accent}; }
.rl-tt-lead { color: ${P.inkSoft}; font-size: 16px; line-height: 1.62; margin: 0 0 32px; max-width: 660px; }

/* ---- shirt ---- */
.rl-tt-shirt {
  display: grid; grid-template-columns: minmax(0,1.12fr) minmax(0,0.88fr);
  gap: 40px; align-items: center;
  background: ${P.card}; border: 1px solid ${P.border}; border-radius: 22px; padding: 34px;
}
@media (max-width: 860px) { .rl-tt-shirt { grid-template-columns: 1fr; gap: 24px; padding: 26px 22px; text-align: center; justify-items: center; } }
/* Photo: fill the column. Drawing: stays small — scaling line art up
   just makes it look like a placeholder, which it is. */
.rl-tt-shirt-img {
  width: 100%; border-radius: 16px; display: block;
  border: 1px solid ${P.border};
}
.rl-tt-shirt-svg { width: 100%; max-width: 240px; height: auto; display: block; margin: 0 auto; }
.rl-tt-prog-wrap { max-width: 420px; margin-top: 22px; }
@media (max-width: 760px) { .rl-tt-prog-wrap { margin-left: auto; margin-right: auto; } }
.rl-tt-prog-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.rl-tt-prog-n { font-size: 15px; font-weight: 900; color: ${P.ink}; }
.rl-tt-prog-n .accent { color: ${P.accent}; }
.rl-tt-prog-l { font-size: 11.5px; letter-spacing: 1px; text-transform: uppercase; color: ${P.inkMute}; font-weight: 700; }
.rl-tt-prog-track { height: 9px; border-radius: 999px; background: rgba(255,255,255,0.07); overflow: hidden; }
.rl-tt-prog-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, ${P.accent}, ${T.warn});
  box-shadow: 0 0 16px rgba(25,212,242,0.5);
  transition: width 600ms ease;
}
.rl-tt-fine { font-size: 12.5px; color: ${P.inkMute}; margin: 12px 0 0; }

/* ---- feedback form ---- */
.rl-tt-form { display: grid; gap: 16px; max-width: 760px; margin: 0 auto; }
.rl-tt-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 620px) { .rl-tt-row2 { grid-template-columns: 1fr; } }
.rl-tt-field { display: grid; gap: 7px; text-align: left; }
.rl-tt-field label { font-size: 12px; font-weight: 800; letter-spacing: 0.8px; text-transform: uppercase; color: ${P.inkSoft}; }
.rl-tt-field input, .rl-tt-field textarea {
  background: ${P.bgAlt}; border: 1px solid ${P.border}; border-radius: 12px;
  padding: 13px 15px; color: ${P.ink}; font-size: 15px; font-family: inherit;
  width: 100%; box-sizing: border-box; transition: border-color 140ms ease;
}
.rl-tt-field input:focus, .rl-tt-field textarea:focus { outline: none; border-color: ${P.accent}; }
.rl-tt-field textarea { min-height: 88px; resize: vertical; line-height: 1.55; }
.rl-tt-field input[type=file] { padding: 11px 13px; font-size: 13px; color: ${P.inkMute}; }
.rl-tt-err { color: ${T.warn}; font-size: 13.5px; margin: 0; }
.rl-tt-done {
  border: 1px solid ${P.borderHi}; border-radius: 18px; padding: 34px 30px; text-align: center;
  background: linear-gradient(140deg, rgba(25,212,242,0.10), ${P.card} 60%);
}
.rl-tt-done h3 { font-size: 22px; font-weight: 900; margin: 0 0 8px; color: ${P.ink}; }
.rl-tt-done p { color: ${P.inkSoft}; margin: 0; font-size: 15px; }

/* ---- final cta ---- */
.rl-tt-final { position: relative; overflow: hidden; padding: 92px 0; text-align: center; }
@media (max-width: 640px) { .rl-tt-final { padding: 64px 0; } }
.rl-tt-final-bg { position: absolute; inset: 0; background-size: cover; background-position: center; z-index: 0; }
.rl-tt-final-scrim {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(180deg, ${P.bg} 0%, rgba(6,17,31,0.72) 34%, rgba(6,17,31,0.86) 100%);
}
.rl-tt-final-in { position: relative; z-index: 2; }
.rl-tt-quiet {
  margin: 30px auto 0; max-width: 620px; font-size: 13.5px; line-height: 1.6;
  color: ${P.inkSoft}; border-top: 1px solid ${P.border}; padding-top: 22px;
}
.rl-tt-quiet strong { color: ${P.accent}; font-weight: 800; }
.rl-tt-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap;
  padding: 26px 0 40px; border-top: 1px solid ${P.border}; margin-top: 10px;
}
.rl-tt-foot a { color: ${P.inkMute}; text-decoration: none; font-size: 13px; }
.rl-tt-foot a:hover { color: ${P.accent}; }
`;

/* Four capabilities under the hero headline. */
const TESTER_CAPS = [
  { Icon: CameraIcon, t: 'Identify fish',      d: 'Snap a photo and get an instant species ID.' },
  { Icon: ShieldIcon, t: 'Check the rules',    d: 'See size, season and bag limits for your waters.' },
  { Icon: FishIcon,   t: 'Log your catches',   d: 'Save your catches, photos, conditions and memories.' },
  { Icon: ChartIcon,  t: 'Build your patterns',d: 'Let ReelIntel learn from your fishing history and help uncover what works.' },
];


/* Drawn tee, so the reward section works before a product shot exists.
   Drop a photo at public/marketing/tester-tshirt.png and it takes over. */
function TeeGraphic() {
  return (
    <svg className="rl-tt-shirt-svg" viewBox="0 0 256 256" role="img" aria-label="ReelIntel t-shirt">
      <defs>
        <linearGradient id="tee" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#12293f" /><stop offset="1" stopColor="#0a1c2e" />
        </linearGradient>
      </defs>
      <path d="M96 18 L40 44 L18 96 L62 112 L62 240 L194 240 L194 112 L238 96 L216 44 L160 18 Q128 48 96 18 Z"
            fill="url(#tee)" stroke="rgba(25,212,242,0.42)" strokeWidth="2" strokeLinejoin="round" />
      <path d="M96 18 Q128 48 160 18" fill="none" stroke="rgba(25,212,242,0.42)" strokeWidth="2" />
      <image href={LOGO_BRAND} x="76" y="92" width="104" height="104" preserveAspectRatio="xMidYMid meet" />
    </svg>
  );
}


/* Tester feedback. Writes to the `tester_feedback` table when it exists
   (see supabase/tester-feedback-schema.sql) and otherwise falls back to
   opening a pre-filled email — the founder never loses a response
   because a migration hasn't been run yet. */
const FEEDBACK_FIELDS = [
  { k: 'tested',    label: 'What did you test?',                  ph: 'Fish ID, regulations, logging, maps…' },
  { k: 'worked',    label: 'What worked?',                        ph: 'What felt good or useful?' },
  { k: 'confusing', label: 'What was confusing?',                 ph: 'Where did you have to stop and think?' },
  { k: 'broke',     label: 'Did anything break?',                 ph: 'Crashes, errors, things that never loaded…' },
  { k: 'wish',      label: 'What feature do you wish existed?',   ph: 'The thing that would make you use it every trip.' },
];

function TesterFeedback() {
  const [form, setForm] = useState({ name: '', email: '', tested: '', worked: '', confusing: '', broke: '', wish: '' });
  const [shot, setShot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mailtoFallback = () => {
    const body = [
      `Name: ${form.name}`, `Email: ${form.email}`, '',
      ...FEEDBACK_FIELDS.map(f => `${f.label}\n${form[f.k] || '—'}\n`),
      shot ? '(Screenshot: please attach it to this email.)' : '',
    ].join('\n');
    window.location.href =
      `mailto:robert@reelintel.ai?subject=${encodeURIComponent('ReelIntel tester feedback — ' + (form.name || 'anonymous'))}` +
      `&body=${encodeURIComponent(body)}`;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email, please — so I know who found it.'); return; }
    setBusy(true); setError('');
    try {
      const c = supabaseClient();
      if (!c) throw new Error('no client');
      let screenshot_path = null;
      if (shot) {
        // Best-effort: a missing bucket must not cost us the written feedback.
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${shot.name}`;
        const up = await c.storage.from('tester-feedback').upload(path, shot, { upsert: false });
        if (!up.error) screenshot_path = path;
      }
      const { error: insErr } = await c.from('tester_feedback').insert({
        name: form.name, email: form.email, tested: form.tested, worked: form.worked,
        confusing: form.confusing, broke: form.broke, wish: form.wish, screenshot_path,
      });
      if (insErr) throw insErr;
      setDone(true);
    } catch {
      // Table/bucket not provisioned (or offline) — hand it to email instead.
      mailtoFallback();
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rl-tt-done">
        <h3>Thanks. This is exactly what I need to make ReelIntel better.</h3>
        <p>I read every one of these. If I have a follow-up question, I’ll reach out.</p>
      </div>
    );
  }

  return (
    <form className="rl-tt-form" onSubmit={submit}>
      <div className="rl-tt-row2">
        <div className="rl-tt-field">
          <label htmlFor="tf-name">Name</label>
          <input id="tf-name" value={form.name} onChange={set('name')} autoComplete="name" required />
        </div>
        <div className="rl-tt-field">
          <label htmlFor="tf-email">Email</label>
          <input id="tf-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </div>
      </div>
      {FEEDBACK_FIELDS.map(f => (
        <div className="rl-tt-field" key={f.k}>
          <label htmlFor={`tf-${f.k}`}>{f.label}</label>
          <textarea id={`tf-${f.k}`} value={form[f.k]} onChange={set(f.k)} placeholder={f.ph} />
        </div>
      ))}
      <div className="rl-tt-field">
        <label htmlFor="tf-shot">Screenshot (optional)</label>
        <input id="tf-shot" type="file" accept="image/*" onChange={(e) => setShot(e.target.files?.[0] || null)} />
      </div>
      {error && <p className="rl-tt-err">{error}</p>}
      <div>
        <button type="submit" className="rl-tt-cta" disabled={busy}>
          {busy ? 'Sending…' : 'Submit feedback'}
        </button>
      </div>
    </form>
  );
}

export function TestersPage() {
  const cssRef = useMemo(() => CSS, []);
  const [claimed, setClaimed] = useState(TESTER_SPOTS_CLAIMED_FALLBACK);

  // Claimed spots = completed feedback submissions. Silently keeps the
  // fallback if the table isn't provisioned yet.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = supabaseClient();
        if (!c) return;
        // RPC, not a select: RLS keeps responses admin-only, so anon
        // cannot count rows directly. tester_feedback_count() exposes
        // just the number.
        const { data, error } = await c.rpc('tester_feedback_count');
        if (!alive || error || typeof data !== 'number') return;
        setClaimed(Math.min(data, TESTER_SPOTS_TOTAL));
      } catch { /* keep the fallback */ }
    })();
    return () => { alive = false; };
  }, []);

  const pct = Math.round((claimed / TESTER_SPOTS_TOTAL) * 100);
  // Photo source chain: jpg (correct for a photograph) -> png -> the
  // drawn tee. Saves a naming mistake from silently showing line art.
  const SHIRT_SRCS = [`${M}tester-tshirt.jpg`, `${M}tester-tshirt.png`];
  const [shirtIdx, setShirtIdx] = useState(0);

  return (
    <div className="rl-root">
      <style>{cssRef}</style>
      <style>{TESTERS_CSS}</style>

      {/* Minimal nav — this is a private page, not the marketing site. */}
      <nav className="rl-tt-nav" aria-label="Tester">
        <a href="/" className="rl-brand" aria-label="ReelIntel">
          <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 38, width: 'auto', display: 'block' }} />
        </a>
        <span className="rl-tt-nav-sp" />
        <a className="rl-tt-back" href="/">Back to ReelIntel</a>
        <a className="rl-btn rl-btn-primary rl-tt-navcta" href={TESTER_APP_URL} target="_blank" rel="noreferrer">
          Download App
        </a>
      </nav>

      {/* ---------- HERO ---------- */}
      <header className="rl-tt-hero">
        <img className="rl-tt-hero-art" src={`${M}testers-marlin.png`} alt="" aria-hidden="true" />
        <svg className="rl-tt-rings" viewBox="0 0 900 900" aria-hidden="true" focusable="false">
          {[190, 280, 370, 440].map((r, i) => (
            <circle key={r} cx="450" cy="450" r={r} fill="none"
                    stroke="rgba(25,212,242,0.16)" strokeWidth="1"
                    strokeDasharray={i % 2 ? '3 9' : undefined} />
          ))}
        </svg>
        <div className="rl-container rl-tt-hero-grid">
          <div className="rl-tt-hero-copy">
            <img className="rl-tt-logo" src={LOGO_BRAND}
                 alt="ReelIntel — identify, check rules, log catch, find better spots" />
            <h1 className="rl-tt-h1">
              Help build the best<br />
              <span className="accent">fishing app</span><br />on the water.
            </h1>
            <p className="rl-tt-sub">
              ReelIntel is live on the App Store, but we’re not marketing it heavily yet.
              I’m looking for 25 anglers to put it through real-world testing, log some
              catches, and help me make it better before the public launch.
            </p>

            <ul className="rl-tt-caps">
              {TESTER_CAPS.map(({ Icon, t, d }) => (
                <li key={t}>
                  <div className="rl-tt-cap-t"><Icon size={17} /> {t}</div>
                  <p className="rl-tt-cap-d">{d}</p>
                </li>
              ))}
            </ul>

            <div className="rl-tt-hero-cta">
              <a className="rl-tt-cta" href={TESTER_APP_URL} target="_blank" rel="noreferrer">
                <AppleIcon />
                <span>Download<span className="rl-tt-cta-long">&nbsp;ReelIntel</span>&nbsp;on the App Store&nbsp;→</span>
              </a>
              <p className="rl-tt-note"><span className="accent">Free to use.</span> No in-app purchase required.</p>
            </div>
          </div>
        </div>
      </header>


      {/* ---------- SHIRT ---------- */}
      <section className="rl-tt-sec">
        <div className="rl-container">
          <div className="rl-tt-shirt">
            {shirtIdx >= SHIRT_SRCS.length ? <TeeGraphic /> : (
              <img className="rl-tt-shirt-img" src={SHIRT_SRCS[shirtIdx]}
                   alt="ReelIntel t-shirt — front and back"
                   onError={() => setShirtIdx(i => i + 1)} loading="lazy" />
            )}
            <div>
              <h2 className="rl-tt-h2">First 25 testers get a<br /><span className="accent">free ReelIntel t‑shirt.</span></h2>
              <p className="rl-tt-lead" style={{ marginBottom: 0 }}>
                Complete the tester checklist and send us your feedback. If you’re one of
                the first 25 to finish, we’ll send you a ReelIntel shirt as a thank-you.
              </p>
              <div className="rl-tt-prog-wrap">
                <div className="rl-tt-prog-top">
                  <span className="rl-tt-prog-n"><span className="accent">{claimed}</span> / {TESTER_SPOTS_TOTAL}</span>
                  <span className="rl-tt-prog-l">Spots claimed</span>
                </div>
                <div className="rl-tt-prog-track" role="progressbar" aria-valuenow={claimed}
                     aria-valuemin={0} aria-valuemax={TESTER_SPOTS_TOTAL}
                     aria-label="Tester spots claimed">
                  <div className="rl-tt-prog-fill" style={{ width: `${Math.max(pct, 2)}%` }} />
                </div>
                <p className="rl-tt-fine">Limited to the first 25 completed tester submissions.</p>
              </div>
            </div>
          </div>
        </div>
      </section>




      {/* ---------- FEEDBACK ---------- */}
      <section className="rl-tt-sec rl-tt-sec-alt" id="feedback">
        <div className="rl-container" style={{ textAlign: 'center' }}>
          <h2 className="rl-tt-h2">Tell me what you’d change.</h2>
          <p className="rl-tt-lead" style={{ margin: '0 auto 32px' }}>
            The more specific, the better — but half-finished thoughts are still worth
            sending. Every one of these shapes what ReelIntel becomes.
          </p>
          <TesterFeedback />
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="rl-tt-final">
        <div className="rl-tt-final-bg" style={{ backgroundImage: `url(${M}testers-cta-bg.jpg)` }} />
        <div className="rl-tt-final-scrim" />
        <div className="rl-container rl-tt-final-in">
          <h2 className="rl-tt-h2" style={{ marginBottom: 14 }}>Ready to take it out?</h2>
          <p className="rl-tt-lead" style={{ margin: '0 auto 30px' }}>
            Download ReelIntel, create your account, and start fishing with it.
          </p>
          <a className="rl-tt-cta" href={TESTER_APP_URL} target="_blank" rel="noreferrer">
            <AppleIcon /> Download on the App Store →
          </a>
          <p className="rl-tt-note" style={{ marginTop: 16 }}>
            Then come back here and <a href="#feedback" style={{ color: P.accent }}>tell me what you found</a>.
          </p>
          <p className="rl-tt-quiet">
            You’re getting this before anyone else — <strong>please keep it off social media
            for now.</strong> Share it with someone who’d genuinely help test it, and
            that’s it.
          </p>
        </div>
      </section>

      <div className="rl-container rl-tt-foot">
        <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 34, width: 'auto', display: 'block' }} />
        <span style={{ color: P.inkMute, fontSize: 13 }}>Thank you for helping build the future of fishing.</span>
        <a href={PRIVACY_URL}>Privacy Policy</a>
      </div>
    </div>
  );
}
