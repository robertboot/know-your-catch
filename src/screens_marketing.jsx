/* reelintel.ai marketing landing page.

   Rendered at / on the reelintel.ai web deploy (KYC_WEB=true,
   see main.jsx). Public, no auth gate, no admin link. iOS bundle
   is unaffected — this whole module is dead-code-eliminated when
   KYC_WEB=false.

   Layout mirrors the mockup provided in the build spec:
     1. Nav header
     2. Hero (headline + copy + CTAs + trust badges | phone mockup
        + three floating cards)
     3. Feature cards row (4 equal cards)
     4. Insights section (copy | analytics visuals grid)
     5. Share & Relive section
     6. Download CTA block
     7. Footer

   Responsiveness lives in a single <style> block scoped to
   .rl-* classes at the top of the component — that keeps CSS
   next to the JSX without pulling in a framework. Media queries
   collapse the two-column sections at 900px and stack finer
   details at 640px. */

import React, { useMemo } from 'react';
import {
  ArrowRight, Camera, ShieldCheck, BookOpen, TrendingUp, Share2, Trophy,
  Users, Cloud, Fish, MapPin, Clock, BarChart2, Award,
} from 'lucide-react';
import { T } from './theme.js';

const LOGO_HORIZONTAL = `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`;
const BRAND_LOGO      = `${import.meta.env.BASE_URL}brand/reelintel-brand.png`;

const M = `${import.meta.env.BASE_URL}marketing/`;
const A = {
  heroBg:        `${M}underwater-hero-bg.svg`,
  phoneMockup:   `${M}hero-phone-mockup.svg`,
  recentCatch:   `${M}recent-catch-card.svg`,
  topPattern:    `${M}top-pattern-card.svg`,
  hotBiteWindow: `${M}hot-bite-window-card.svg`,
  shareRelive:   `${M}share-relive-graphic.svg`,
  appStore:      `${M}app-store-badge.svg`,
  googlePlay:    `${M}google-play-badge.svg`,
  qrCode:        `${M}qr-code-placeholder.svg`,
};

/* Placeholder URLs — swap in real store URLs once live. Fine to
   fall back to reelintel.ai when unset so the anchors always click. */
const APP_STORE_URL   = 'https://apps.apple.com/app/reelintel/';   // TODO real ID once approved
const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.reelintel.app'; // TODO real listing
const SUPPORT_URL     = 'mailto:hello@reelintel.ai';

// Style palette pulled from src/theme.js so brand color drift is
// impossible; anything not in T is defined locally.
const PALETTE = {
  bg:         T.bgDeep,
  bgAlt:      '#04182b',
  card:       T.card,
  cardAlt:    '#0f2f4e',
  border:     T.cardEdge,
  borderHi:   'rgba(25, 212, 242, 0.55)',
  accent:     T.brass,          // cyan
  accentDeep: T.brassDeep,
  ink:        T.ink,
  inkSoft:    T.inkSoft,
  inkMute:    T.inkMute,
};

const NAV_ITEMS = [
  { label: 'Features',     href: '#features'   },
  { label: 'How It Works', href: '#how'        },
  { label: 'Patterns',     href: '#insights'   },
  { label: 'Download',     href: '#download'   },
  { label: 'Blog',         href: '#blog'       },
  { label: 'Support',      href: SUPPORT_URL   },
];

const FEATURES = [
  { icon: BookOpen,   title: 'Log Every Catch',
    body: 'Record species, size, depth, location, weather, gear, photos, and notes — all in seconds.' },
  { icon: TrendingUp, title: 'Discover Patterns & Trends',
    body: "See what's biting, where, and when — so you can fish with confidence, not guesswork." },
  { icon: Trophy,     title: 'Personal Bests',
    body: 'Save your PBs, see how you stack up, and celebrate every biggest-yet moment.' },
  { icon: Share2,     title: 'Relive the Trip',
    body: 'Share catches with friends and family, and relive your best days on the water together.' },
];

const TRUST_BADGES = [
  { icon: Cloud,       t1: 'Works Offline',   t2: 'Syncs Everywhere' },
  { icon: ShieldCheck, t1: 'Private & Secure',t2: 'Your Data, Yours' },
  { icon: Users,       t1: 'Built for Anglers',t2: 'By Anglers' },
];

/* --------- CSS block: media queries, hover, tokens ---------- */
const CSS = `
:root {
  --rl-bg:        ${PALETTE.bg};
  --rl-card:      ${PALETTE.card};
  --rl-border:    ${PALETTE.border};
  --rl-borderHi:  ${PALETTE.borderHi};
  --rl-accent:    ${PALETTE.accent};
  --rl-ink:       ${PALETTE.ink};
  --rl-inkSoft:   ${PALETTE.inkSoft};
  --rl-inkMute:   ${PALETTE.inkMute};
}
html, body, #root { background: var(--rl-bg); }
body { margin: 0; }
.rl-root {
  background: var(--rl-bg); color: var(--rl-ink);
  font-family: -apple-system, "SF Pro Text", system-ui, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.rl-container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

/* Nav */
.rl-nav {
  display: flex; align-items: center; gap: 20px;
  padding: 20px 24px; max-width: 1200px; margin: 0 auto;
}
.rl-nav-links { display: flex; gap: 22px; flex: 1; justify-content: center; }
.rl-nav-links a {
  color: var(--rl-inkSoft); text-decoration: none; font-size: 14px; font-weight: 500;
  transition: color 160ms ease;
}
.rl-nav-links a:hover { color: var(--rl-accent); }
@media (max-width: 900px) { .rl-nav-links { display: none; } }

/* Buttons */
.rl-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 14px 22px; border-radius: 12px; font-size: 14px; font-weight: 700;
  letter-spacing: 0.6px; text-decoration: none; cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
}
.rl-btn-primary {
  background: var(--rl-accent); color: #031B33; border: none;
  box-shadow: 0 10px 30px rgba(25,212,242,0.28);
}
.rl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 40px rgba(25,212,242,0.38); }
.rl-btn-ghost {
  background: transparent; color: var(--rl-accent);
  border: 1.5px solid var(--rl-accent);
}
.rl-btn-ghost:hover { background: rgba(25,212,242,0.08); transform: translateY(-1px); }

/* Hero */
.rl-hero { position: relative; overflow: hidden; padding: 40px 0 90px; }
.rl-hero-bg {
  position: absolute; inset: 0; background: center/cover no-repeat;
  background-image: url("${A.heroBg}"); z-index: 0;
}
.rl-hero-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(6,17,31,0.15) 0%, rgba(6,17,31,0.5) 40%, var(--rl-bg) 100%);
  z-index: 1;
}
.rl-hero-inner {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: 1.05fr 1fr; gap: 60px; align-items: center;
  padding-top: 40px;
}
@media (max-width: 1024px) { .rl-hero-inner { grid-template-columns: 1fr; gap: 48px; } }

.rl-eyebrow {
  font-size: 12px; font-weight: 800; letter-spacing: 2.5px;
  color: var(--rl-accent); text-transform: uppercase;
}
.rl-h1 {
  font-size: 60px; font-weight: 900; line-height: 1.02; letter-spacing: -0.9px;
  margin: 14px 0 22px; color: var(--rl-ink);
}
.rl-h1 span { color: var(--rl-accent); }
@media (max-width: 900px) { .rl-h1 { font-size: 44px; } }
@media (max-width: 500px) { .rl-h1 { font-size: 36px; } }

.rl-lead {
  font-size: 17px; line-height: 1.6; color: var(--rl-inkSoft);
  max-width: 560px; margin: 0 0 30px;
}
.rl-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 34px; }

/* Trust badges */
.rl-trust-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; max-width: 560px;
}
@media (max-width: 620px) { .rl-trust-row { grid-template-columns: 1fr; } }
.rl-trust {
  display: flex; align-items: flex-start; gap: 10px;
}
.rl-trust-lines strong { color: var(--rl-ink); font-size: 13px; font-weight: 700; display: block; }
.rl-trust-lines span   { color: var(--rl-inkMute); font-size: 12px; }

/* Hero visual */
.rl-visual { position: relative; min-height: 620px; }
@media (max-width: 1024px) { .rl-visual { min-height: 560px; } }
@media (max-width: 500px)  { .rl-visual { min-height: 480px; } }
.rl-phone {
  position: absolute; left: 50%; top: 0; transform: translateX(-50%);
  width: min(90%, 360px); filter: drop-shadow(0 40px 60px rgba(0,0,0,0.5));
}
.rl-float { position: absolute; }
.rl-float-recent  { top: 60px;   left: -30px; width: 260px; }
.rl-float-pattern { top: 300px;  right: -30px; width: 260px; }
.rl-float-bite    { bottom: 30px; left: 40px;   width: 270px; }
@media (max-width: 1024px) {
  .rl-float-recent  { left: 0;   top: 40px; }
  .rl-float-pattern { right: 0;  top: 260px; }
  .rl-float-bite    { left: 0;   bottom: 0; }
}
@media (max-width: 640px) {
  .rl-float-recent  { display: none; }
  .rl-float-pattern { display: none; }
  .rl-float-bite    { display: none; }
}

/* Section */
.rl-section { padding: 90px 0; }
.rl-section-alt { background: ${PALETTE.bgAlt}; }
.rl-section-head {
  text-align: center; max-width: 720px; margin: 0 auto 60px;
}
.rl-section-head .rl-eyebrow { display: block; margin-bottom: 12px; }
.rl-h2 {
  font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -0.5px;
  color: var(--rl-ink); margin: 0 0 18px;
}
@media (max-width: 700px) { .rl-h2 { font-size: 32px; } }
.rl-lead-2 { font-size: 16px; line-height: 1.65; color: var(--rl-inkSoft); }

/* Feature cards row */
.rl-features {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;
}
@media (max-width: 1024px) { .rl-features { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px)  { .rl-features { grid-template-columns: 1fr; } }
.rl-feature {
  background: var(--rl-card); border: 1px solid var(--rl-border);
  border-radius: 20px; padding: 26px 22px; transition: border-color 180ms ease, transform 180ms ease;
}
.rl-feature:hover { border-color: var(--rl-borderHi); transform: translateY(-3px); }
.rl-feature-icon {
  width: 46px; height: 46px; border-radius: 12px;
  background: rgba(25,212,242,0.12); display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 16px;
}
.rl-feature h3 { font-size: 18px; font-weight: 800; color: var(--rl-ink); margin: 0 0 8px; }
.rl-feature p  { font-size: 14px; line-height: 1.6; color: var(--rl-inkSoft); margin: 0; }

/* Insights split */
.rl-split {
  display: grid; grid-template-columns: 1fr 1.15fr; gap: 60px; align-items: center;
}
@media (max-width: 1024px) { .rl-split { grid-template-columns: 1fr; gap: 48px; } }
.rl-insight-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
}
@media (max-width: 560px) { .rl-insight-grid { grid-template-columns: 1fr; } }
.rl-insight {
  background: var(--rl-card); border: 1px solid var(--rl-border);
  border-radius: 18px; padding: 22px;
}
.rl-insight-title { font-size: 11px; font-weight: 800; letter-spacing: 1.6px; color: var(--rl-accent); }
.rl-insight-main  { font-size: 22px; font-weight: 800; color: var(--rl-ink); margin: 6px 0 4px; }
.rl-insight-sub   { font-size: 13px; color: var(--rl-inkMute); }

/* Donut */
.rl-donut { display: flex; align-items: center; gap: 14px; }
.rl-donut svg { flex-shrink: 0; }
.rl-donut ul { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.rl-donut li { color: var(--rl-inkSoft); display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.rl-donut li strong { color: var(--rl-ink); font-weight: 800; }
.rl-donut li span { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

/* Bars */
.rl-bars { display: flex; align-items: flex-end; gap: 6px; height: 90px; }
.rl-bars div {
  flex: 1; background: linear-gradient(180deg, var(--rl-accent), rgba(25,212,242,0.15));
  border-radius: 4px 4px 0 0;
}
.rl-bar-labels { display: flex; gap: 6px; margin-top: 6px; font-size: 10px; color: var(--rl-inkMute); }
.rl-bar-labels span { flex: 1; text-align: center; }

/* Heat map */
.rl-heat { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.rl-heat div { aspect-ratio: 1; border-radius: 3px; background: rgba(25,212,242,0.08); }

/* Times list */
.rl-times li {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 0; border-bottom: 1px solid var(--rl-border);
  color: var(--rl-ink); font-size: 13px; font-weight: 600;
}
.rl-times li:last-child { border-bottom: none; }
.rl-times li span { color: var(--rl-inkMute); font-weight: 400; margin-left: auto; font-size: 12px; }

/* Share split */
.rl-share { display: grid; grid-template-columns: 1.15fr 1fr; gap: 60px; align-items: center; }
@media (max-width: 1024px) { .rl-share { grid-template-columns: 1fr; } }
.rl-share-img { max-width: 100%; height: auto; display: block; }

/* Download CTA block */
.rl-cta-block {
  text-align: center; padding: 70px 30px; border-radius: 30px;
  background: radial-gradient(circle at 50% -20%, rgba(25,212,242,0.22), transparent 55%), var(--rl-card);
  border: 1px solid var(--rl-borderHi);
}
.rl-store-row { display: flex; gap: 14px; justify-content: center; align-items: center; flex-wrap: wrap; margin-top: 26px; }
.rl-store-row img { display: block; height: 56px; }
.rl-qr {
  width: 100px; height: 100px; border-radius: 12px; background: #fff; padding: 6px;
  display: flex; align-items: center; justify-content: center;
}
.rl-qr img { height: 100%; width: 100%; }

/* Footer */
.rl-footer { padding: 40px 0 60px; border-top: 1px solid var(--rl-border); }
.rl-footer-inner {
  display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap;
}
.rl-footer-links { display: flex; gap: 22px; flex-wrap: wrap; }
.rl-footer-links a { color: var(--rl-inkMute); font-size: 13px; text-decoration: none; }
.rl-footer-links a:hover { color: var(--rl-accent); }
.rl-footer-legal { font-size: 12px; color: var(--rl-inkMute); }
`;

/* ---------- Sub-components ---------- */

function TrustItem({ icon: Icon, t1, t2 }) {
  return (
    <div className="rl-trust">
      <div style={{ color: PALETTE.accent, marginTop: 2 }}>
        <Icon size={22} strokeWidth={2} />
      </div>
      <div className="rl-trust-lines">
        <strong>{t1}</strong>
        <span>{t2}</span>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, body }) {
  return (
    <div className="rl-feature">
      <div className="rl-feature-icon">
        <Icon size={22} color={PALETTE.accent} strokeWidth={2} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function DonutInsight() {
  // Static donut — visual only. Segments matter proportionally.
  const segments = [
    { color: '#19d4f2', pct: 34, label: 'Red Snapper' },
    { color: '#5ecdf2', pct: 22, label: 'King Mackerel' },
    { color: '#33e0ac', pct: 16, label: 'Mahi' },
    { color: '#ffc857', pct: 12, label: 'Gag Grouper' },
    { color: '#8ca8c9', pct: 16, label: 'Other' },
  ];
  const size = 96, r = 40, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="rl-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#0f2f4e" strokeWidth="16"/>
        {segments.map((s, i) => {
          const off  = -c * (acc / 100);
          const dash = c * (s.pct / 100);
          const el = (
            <circle key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={s.color} strokeWidth="16"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={off}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          acc += s.pct;
          return el;
        })}
      </svg>
      <ul>
        {segments.slice(0, 4).map((s, i) => (
          <li key={i}>
            <span style={{ background: s.color }} />
            <strong>{s.label}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BarsInsight() {
  // Monthly bars — 12 months.
  const heights = [22, 30, 46, 62, 74, 90, 85, 78, 62, 44, 30, 24];
  return (
    <>
      <div className="rl-bars">
        {heights.map((h, i) => <div key={i} style={{ height: `${h}%` }} />)}
      </div>
      <div className="rl-bar-labels">
        {['J','F','M','A','M','J','J','A','S','O','N','D'].map((m, i) => <span key={i}>{m}</span>)}
      </div>
    </>
  );
}

function HeatInsight() {
  // 8x5 = 40 cells. Simulated intensity clusters for a "hot spot" look.
  const cells = useMemo(() => Array.from({ length: 40 }, (_, i) => {
    const row = Math.floor(i / 8), col = i % 8;
    // gaussian-ish blob around row 2, col 5
    const d = Math.sqrt((row - 2) ** 2 + (col - 5) ** 2);
    const v = Math.max(0, 0.9 - d * 0.22);
    return v;
  }), []);
  return (
    <div className="rl-heat">
      {cells.map((v, i) => (
        <div key={i} style={{ background: `rgba(25,212,242,${0.08 + v * 0.7})` }} />
      ))}
    </div>
  );
}

function TimesInsight() {
  const times = [
    { window: '6:12 – 7:48 AM', tag: 'Peak'  },
    { window: '11:04 AM – 12:20 PM', tag: 'Mid'   },
    { window: '5:50 – 7:12 PM', tag: 'Evening' },
  ];
  return (
    <ul className="rl-times" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {times.map((t, i) => (
        <li key={i}>
          <Clock size={14} color={PALETTE.accent} />
          {t.window} <span>{t.tag}</span>
        </li>
      ))}
    </ul>
  );
}

function PBInsight() {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Award size={20} color={PALETTE.accent} />
        <div style={{ fontSize: 12, letterSpacing: 1.4, color: PALETTE.inkMute, fontWeight: 700 }}>PERSONAL BEST</div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: PALETTE.ink }}>Red Snapper</div>
      <div style={{ fontSize: 15, color: PALETTE.inkSoft, marginTop: 2 }}>
        29.5 in · <strong style={{ color: PALETTE.ink }}>11.4 lb</strong>
      </div>
      <div style={{ fontSize: 12, color: PALETTE.inkMute, marginTop: 6 }}>Nine-Mile Reef · Jun 24, 2026</div>
    </>
  );
}

/* ---------- Sections ---------- */

function Nav() {
  return (
    <nav className="rl-nav" aria-label="Primary">
      <a href="#top" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <img src={LOGO_HORIZONTAL} alt="ReelIntel" style={{ height: 32, width: 'auto', display: 'block' }} />
      </a>
      <div className="rl-nav-links">
        {NAV_ITEMS.map(n => (
          <a key={n.label} href={n.href}>{n.label}</a>
        ))}
      </div>
      <a className="rl-btn rl-btn-primary" href="#download" style={{ padding: '10px 16px', fontSize: 13 }}>
        Download the App <ArrowRight size={14} />
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
        <div>
          <div className="rl-eyebrow">Built for Anglers</div>
          <h1 className="rl-h1">
            Turn your catches into<br/>
            <span>patterns, trends,</span> and<br/>
            smarter fishing days.
          </h1>
          <p className="rl-lead">
            Log every catch, discover powerful patterns, save your Personal Bests,
            and share your most memorable catches with friends and family so you
            can relive every great trip.
          </p>
          <div className="rl-cta-row">
            <a className="rl-btn rl-btn-primary" href="#download">
              Download the App <ArrowRight size={16} />
            </a>
            <a className="rl-btn rl-btn-ghost" href="#how">
              See How It Works
            </a>
          </div>
          <div className="rl-trust-row">
            {TRUST_BADGES.map((b, i) => <TrustItem key={i} {...b} />)}
          </div>
        </div>
        <div className="rl-visual" aria-hidden="true">
          <img className="rl-phone" src={A.phoneMockup} alt="" />
          <img className="rl-float rl-float-recent"  src={A.recentCatch}   alt="" />
          <img className="rl-float rl-float-pattern" src={A.topPattern}    alt="" />
          <img className="rl-float rl-float-bite"    src={A.hotBiteWindow} alt="" />
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="rl-section" id="features">
      <div className="rl-container">
        <div className="rl-section-head">
          <span className="rl-eyebrow">Everything you need on the water</span>
          <h2 className="rl-h2">A personal fishing intelligence platform.</h2>
          <p className="rl-lead-2">
            Log catches, spot patterns, save your bests, and share every unforgettable moment —
            all in one app built to keep you on the bite.
          </p>
        </div>
        <div className="rl-features">
          {FEATURES.map((f, i) => <FeatureCard key={i} {...f} />)}
        </div>
      </div>
    </section>
  );
}

function Insights() {
  return (
    <section className="rl-section rl-section-alt" id="insights">
      <div className="rl-container rl-split">
        <div>
          <div className="rl-eyebrow">Your Catches. Your Insights.</div>
          <h2 className="rl-h2" style={{ marginTop: 12 }}>
            Smarter insights from your catches.
          </h2>
          <p className="rl-lead-2">
            Real data from your fishing helps you go back more prepared, catch more often,
            and make every trip count. Every log adds signal — species, seasons, depths,
            weather, time of day — and ReelIntel turns it into a fishing map only you have.
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
            <a className="rl-btn rl-btn-primary" href="#download">
              Get ReelIntel <ArrowRight size={16} />
            </a>
            <a className="rl-btn rl-btn-ghost" href="#how">Learn more</a>
          </div>
        </div>
        <div className="rl-insight-grid">
          <div className="rl-insight">
            <div className="rl-insight-title">SPECIES BREAKDOWN</div>
            <div style={{ marginTop: 12 }}><DonutInsight /></div>
          </div>
          <div className="rl-insight">
            <div className="rl-insight-title">BEST TIMES</div>
            <div style={{ marginTop: 8 }}><TimesInsight /></div>
          </div>
          <div className="rl-insight">
            <div className="rl-insight-title">YOUR CATCH MAP</div>
            <div style={{ marginTop: 12 }}><HeatInsight /></div>
          </div>
          <div className="rl-insight">
            <div className="rl-insight-title">SEASONAL SUCCESS</div>
            <div style={{ marginTop: 12 }}><BarsInsight /></div>
          </div>
          <div className="rl-insight" style={{ gridColumn: '1 / -1' }}>
            <PBInsight />
          </div>
        </div>
      </div>
    </section>
  );
}

function ShareRelive() {
  return (
    <section className="rl-section" id="share">
      <div className="rl-container rl-share">
        <img className="rl-share-img" src={A.shareRelive} alt="" aria-hidden="true" />
        <div>
          <div className="rl-eyebrow">Share &amp; Relive</div>
          <h2 className="rl-h2" style={{ marginTop: 12 }}>Share &amp; Relive with Friends.</h2>
          <p className="rl-lead-2">
            Send catches by text or email. Relive the laughs, the big ones, and every
            unforgettable moment together — the whole day, in one tap.
          </p>
          <ul style={{ listStyle: 'none', margin: '24px 0 0', padding: 0, display: 'grid', gap: 12 }}>
            {[
              ['Text a catch', 'Share the photo, species, size, and location — instantly.'],
              ['Email a report',  'A polished catch card with weather, gear, and notes.'],
              ['Family archive',  'Every kid, every buddy trip — all in one shared album.'],
            ].map(([t, s], i) => (
              <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: 'rgba(25,212,242,0.14)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: PALETTE.accent,
                }}>
                  <Share2 size={16} />
                </div>
                <div>
                  <div style={{ color: PALETTE.ink, fontWeight: 700 }}>{t}</div>
                  <div style={{ color: PALETTE.inkSoft, fontSize: 13.5, marginTop: 2 }}>{s}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function DownloadCTA() {
  return (
    <section className="rl-section" id="download">
      <div className="rl-container">
        <div className="rl-cta-block">
          <div className="rl-eyebrow" style={{ display: 'block', marginBottom: 12 }}>Get ReelIntel</div>
          <h2 className="rl-h2" style={{ marginBottom: 12 }}>
            Start building your smarter<br/>fishing map today.
          </h2>
          <p className="rl-lead-2" style={{ maxWidth: 620, margin: '0 auto' }}>
            Download ReelIntel and start logging catches, discovering patterns, and catching more fish.
          </p>
          <div className="rl-store-row">
            <a href={APP_STORE_URL} target="_blank" rel="noreferrer" aria-label="Download on the App Store">
              <img src={A.appStore} alt="Download on the App Store" />
            </a>
            <a href={GOOGLE_PLAY_URL} target="_blank" rel="noreferrer" aria-label="Get it on Google Play">
              <img src={A.googlePlay} alt="Get it on Google Play" />
            </a>
            <div className="rl-qr" aria-label="Scan QR code to download">
              <img src={A.qrCode} alt="" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="rl-footer">
      <div className="rl-container rl-footer-inner">
        <img src={LOGO_HORIZONTAL} alt="ReelIntel" style={{ height: 28, width: 'auto' }} />
        <div className="rl-footer-links">
          {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
        </div>
        <div className="rl-footer-legal">
          © {new Date().getFullYear()} ReelIntel, LLC. All rights reserved.
          {' · '}<a href="/privacy" style={{ color: PALETTE.inkMute }}>Privacy Policy</a>
          {' · '}<a href="/terms"   style={{ color: PALETTE.inkMute }}>Terms of Use</a>
        </div>
      </div>
    </footer>
  );
}

/* ---------- Root ---------- */

export function MarketingLanding() {
  return (
    <div className="rl-root">
      <style>{CSS}</style>
      <Nav />
      <Hero />
      <Features />
      <Insights />
      <ShareRelive />
      <DownloadCTA />
      <Footer />
    </div>
  );
}
