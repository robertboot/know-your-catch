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

const A = {
  heroBg:              `${M}hero-underwater-bg.png`,
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
  comingSoonLidar:     `${M}coming-soon-lidar.jpg`,
  ctaMakeEveryTrip:    `${M}cta-make-every-trip-count.jpg`,
};

const APP_STORE_URL = 'https://apps.apple.com/app/reelintel/';
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
  { label: 'Features',     href: '#features'   },
  { label: 'How it works', href: '#how'        },
  { label: 'Free',         href: '#data-free'  },
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
html, body, #root { background: ${P.bg}; }
body { margin: 0; }
.rl-root {
  background: ${P.bg}; color: ${P.ink};
  font-family: -apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.rl-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

/* Nav */
.rl-nav {
  display: flex; align-items: center; gap: 20px;
  padding: 22px 24px; max-width: 1200px; margin: 0 auto;
  position: relative; z-index: 5;
}
.rl-nav-links { display: flex; gap: 26px; flex: 1; justify-content: center; }
.rl-nav-links a {
  color: ${P.inkSoft}; text-decoration: none; font-size: 14px; font-weight: 500;
  transition: color 160ms ease;
}
.rl-nav-links a:hover { color: ${P.accent}; }
@media (max-width: 900px) { .rl-nav-links { display: none; } }

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
  padding: 20px 0 90px;
  min-height: 620px;
}
.rl-hero-bg {
  position: absolute; inset: 0; z-index: 0;
  background: center/cover no-repeat url("${A.heroBg}");
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
  font-size: 60px; font-weight: 900; line-height: 1.03; letter-spacing: -0.9px;
  margin: 14px 0 22px; color: ${P.ink};
}
.rl-h1 span { color: ${P.accent}; }
@media (max-width: 900px) { .rl-h1 { font-size: 44px; } }
@media (max-width: 500px) { .rl-h1 { font-size: 34px; } }

.rl-lead {
  font-size: 18px; line-height: 1.6; color: ${P.inkSoft};
  max-width: 640px; margin: 0 0 30px;
}
@media (max-width: 500px) { .rl-lead { font-size: 16px; } }
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
`;

/* ============================================================
   SECTIONS
   ============================================================ */

function Nav() {
  return (
    <nav className="rl-nav" aria-label="Primary">
      <a href="#top" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 64, width: 'auto', display: 'block' }} />
      </a>
      <div className="rl-nav-links">
        {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
      </div>
      <a className="rl-btn rl-btn-primary" href={APP_STORE_URL} style={{ padding: '10px 16px', fontSize: 13 }}>
        Get the app <ArrowRight size={14} />
      </a>
    </nav>
  );
}

function Hero() {
  return (
    <section className="rl-hero" id="top">
      <div className="rl-hero-bg" />
      <div className="rl-hero-scrim" />
      <div className="rl-container rl-hero-inner">
        <h1 className="rl-h1">
          Know your catch. Keep it legal.<br/><span>Save the memory.</span>
        </h1>
        <p className="rl-lead">
          Snap a photo to identify your fish, see the rules for your waters instantly, and log every catch. Then AI studies your logs to find your patterns — so every trip gets better.
        </p>
        <div className="rl-cta-row">
          <a className="rl-btn rl-btn-primary rl-btn-lg" href={APP_STORE_URL}>
            Log Your Catch <ArrowRight size={16} />
          </a>
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

function EverythingYouNeed() {
  return (
    <section className="rl-section">
      <div className="rl-container">
        <div className="rl-section-head">
          <h2 className="rl-h2">Everything you need for the day.</h2>
        </div>
        <div className="rl-features">
          {FEATURE_TILES.map((t, i) => (
            <div
              key={i}
              className="rl-feature rl-feature-tile"
              style={{ backgroundImage: `url("${t.bg}")` }}
            >
              <div className="rl-feature-icon"><t.icon size={22} /></div>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
            </div>
          ))}
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
            <h3>Free to use, built to stay that way.</h3>
            <p>No subscription. ReelIntel is free because the collective, anonymized picture makes it powerful for every angler. Get in now and fish smarter, on us.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComingSoon() {
  return (
    <section className="rl-section">
      <div className="rl-container rl-section-narrow">
        <div className="rl-coming-badge">COMING SOON</div>
        <h2 className="rl-h2">Measure and weigh your fish from one photo.</h2>
        <p className="rl-lead-2">
          Built-in LiDAR, no tape, no scale. Just snap and know. ReelIntel's AI grows more accurate every day — and it's only the beginning.
        </p>
        <figure className="rl-coming-figure">
          <img
            src={A.comingSoonLidar}
            alt="ReelIntel LiDAR fish measurement — phone scanning a tuna with an AI length and weight estimate."
            loading="lazy"
            decoding="async"
          />
        </figure>
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
        <a className="rl-btn rl-btn-primary rl-btn-lg" href={APP_STORE_URL}>
          Log Your Catch <ArrowRight size={16} />
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="rl-footer">
      <div className="rl-container rl-footer-inner">
        <img src={LOGO_HORIZONTAL} alt="ReelIntel" style={{ height: 40, width: 'auto' }} />
        <div className="rl-footer-links">
          <a href={APP_STORE_URL} target="_blank" rel="noreferrer">App Store</a>
          <a href={PRIVACY_URL}>Privacy</a>
          <a href={TERMS_URL}>Terms</a>
          <a href={CONTACT_URL}>Contact</a>
        </div>
        <div className="rl-footer-legal">
          © {new Date().getFullYear()} ReelIntel, LLC. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

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
      <FishSmarter />
      <ProblemBridge />
      <KnowRules />
      <IdentifyIt />
      <EverythingYouNeed />
      <DataAndFree />
      <ComingSoon />
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
