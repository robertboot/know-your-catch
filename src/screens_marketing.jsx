/* reelintel.ai marketing landing page.

   All UI cards, phone frames, dashboards, and chart widgets are
   built as inline React + SVG components — nothing baked to raster.
   Only real file assets:
     public/marketing/hero-bg.svg          (dark ocean + rig)
     public/marketing/app-store-badge.svg  (placeholder — swap for official)
     public/marketing/google-play-badge.svg (placeholder — swap for official)
     public/marketing/qr-code-placeholder.svg (placeholder — swap for real QR)

   Rendered at / when KYC_WEB=true (see main.jsx). iOS bundle is
   unaffected — this module is dead-code eliminated in the iOS build.
   No TestFlight / beta copy anywhere — this is a real launch page. */

import React, { useEffect, useMemo, useState } from 'react';
import { T } from './theme.js';
import { updatePassword, subscribe as subscribeAuth } from './auth.js';
import { client as supabaseClient } from './supabase-client.js';
import AnnouncementBanner from './AnnouncementBanner.jsx';

const M = `${import.meta.env.BASE_URL}marketing/`;
const LOGO_HORIZONTAL = `${import.meta.env.BASE_URL}brand/reelintel-horizontal.png`;
const LOGO_HEADER     = `${import.meta.env.BASE_URL}brand/icon-horz.png`;

const A = {
  // Big raster assets — real launch creative.
  heroBg:       `${M}hero-underwater-bg.png`,
  phoneMockup:  `${M}phone-mockup.png`,
  cardRecent:   `${M}card-recent-catch.png`,
  cardPattern:  `${M}card-top-pattern.png`,
  cardBite:     `${M}card-hot-bite-window.png`,
  insightsDash: `${M}insights-dashboard.png`,
  shareGraphic: `${M}share-relive-graphic.png`,
  // Story-block backgrounds — full-bleed imagery for the "Personal
  // Fishing Intelligence Platform" section between Features and
  // Insights.
  bgIntelligence: `${M}bg-intelligence-map.jpg`,
  bgUnderwater:   `${M}bg-underwater-catch.jpg`,
  bgTrophy:       `${M}bg-trophy-pb.jpg`,
  bgSunset:       `${M}bg-sunset-boat.jpg`,
  // Store badges + QR — still SVG placeholders. Swap for official
  // Apple / Google badges + a real QR pointing at the App Store URL
  // once the listing is live. See file comments in each SVG.
  appStore:   `${M}app-store-badge.svg`,
  googlePlay: `${M}google-play-badge.svg`,
  qrCode:     `${M}qr-code-placeholder.svg`,
};

/* Placeholder URLs — swap once the store listings are live. */
const APP_STORE_URL   = 'https://apps.apple.com/app/reelintel/';
const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.reelintel.app';
const SUPPORT_URL     = 'mailto:robert@reelintel.ai';

const P = {
  bg:        T.bgDeep,
  bgAlt:     '#04182b',
  card:      '#0B2740',
  cardHi:    '#0e2f4e',
  border:    'rgba(15, 94, 133, 0.35)',
  borderHi:  'rgba(25, 212, 242, 0.55)',
  accent:    T.brass,            // #19d4f2
  accentDim: 'rgba(25,212,242,0.15)',
  ink:       T.ink,
  inkSoft:   T.inkSoft,
  inkMute:   T.inkMute,
};

const NAV_ITEMS = [
  { label: 'Features',     href: '#features' },
  { label: 'How It Works', href: '#how'      },
  { label: 'Patterns',     href: '#insights' },
  { label: 'Download',     href: '#download' },
  { label: 'Blog',         href: '#blog'     },
  { label: 'Support',      href: SUPPORT_URL },
];

/* ============================================================
   INLINE SVG ICONS
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

function TrendIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 17 9 11 13 15 21 6"/>
      <polyline points="15 6 21 6 21 12"/>
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

function ShareIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5"/>
      <circle cx="18" cy="6" r="2.5"/>
      <circle cx="18" cy="18" r="2.5"/>
      <line x1="8.5" y1="10.5" x2="15.5" y2="7"/>
      <line x1="8.5" y1="13.5" x2="15.5" y2="17"/>
    </svg>
  );
}

function ClockIcon({ size = 14, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/>
      <polyline points="12 7 12 12 15.5 14"/>
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

function UsersIcon({ size = 22, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3"/>
      <path d="M3 20 c 0 -3 3 -5 6 -5 s 6 2 6 5"/>
      <circle cx="17" cy="9" r="2.5"/>
      <path d="M15 15 c 3 0 6 2 6 5"/>
    </svg>
  );
}

function TextIcon({ size = 18, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6 a 3 3 0 0 1 3 -3 h 12 a 3 3 0 0 1 3 3 v 8 a 3 3 0 0 1 -3 3 h -8 l -5 4 v -4 h -1 a 2 2 0 0 1 -1 -2 z"/>
    </svg>
  );
}

function MailIcon({ size = 18, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <polyline points="3 7 12 13 21 7"/>
    </svg>
  );
}

function DotsIcon({ size = 18, color = P.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>
    </svg>
  );
}

/* ============================================================
   PHONE + IN-APP MAP (used in hero + share section)
   ============================================================ */

function PhoneFrame({ width = 340, children }) {
  const height = Math.round(width * (740 / 340));
  return (
    <div style={{
      position: 'relative', width, height,
      borderRadius: 46, background: '#0a1a2c',
      border: `1px solid ${P.borderHi}`,
      boxShadow:
        '0 30px 60px rgba(0,0,0,0.55), 0 0 0 2px rgba(0,0,0,0.6), inset 0 0 0 8px #0e1522, inset 0 0 40px rgba(25,212,242,0.05)',
      overflow: 'hidden',
    }}>
      {/* screen */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, bottom: 12,
        borderRadius: 36, background: '#031b33', overflow: 'hidden',
      }}>
        {/* notch */}
        <div style={{
          position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
          width: 96, height: 26, background: '#000', borderRadius: 13, zIndex: 3,
        }} />
        {/* home indicator */}
        <div style={{
          position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
          width: 100, height: 4, background: '#fff', opacity: 0.4, borderRadius: 2, zIndex: 3,
        }} />
        {children}
      </div>
    </div>
  );
}

function AppMap() {
  // Cyan glow location pins over a dark stylised map.
  const pins = [
    { x: 60,  y: 220, r: 22 },
    { x: 130, y: 300, r: 26 },
    { x: 200, y: 240, r: 18 },
    { x: 240, y: 380, r: 22 },
    { x: 90,  y: 430, r: 20 },
  ];
  return (
    <svg viewBox="0 0 300 640" preserveAspectRatio="xMidYMid slice"
         style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <linearGradient id="m-sea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0e3a5a"/>
          <stop offset="1" stopColor="#031b33"/>
        </linearGradient>
        <radialGradient id="m-pin" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0"  stopColor="#19d4f2" stopOpacity="0.85"/>
          <stop offset="1"  stopColor="#19d4f2" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="300" height="640" fill="url(#m-sea)"/>
      {/* grid */}
      <g stroke="#0f5e85" strokeOpacity="0.28">
        {[80, 160, 240, 320, 400, 480, 560].map(y => (
          <line key={y} x1="0" y1={y} x2="300" y2={y}/>
        ))}
        {[60, 120, 180, 240].map(x => (
          <line key={x} x1={x} y1="0" x2={x} y2="640"/>
        ))}
      </g>
      {/* coast */}
      <path d="M0 460 Q 60 430 130 460 T 260 470 T 300 450 L 300 640 L 0 640 Z" fill="#082139" opacity="0.85"/>
      <path d="M0 500 Q 60 480 130 500 T 260 510 T 300 495 L 300 640 L 0 640 Z" fill="#051a2d" opacity="0.9"/>
      {/* pins */}
      {pins.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={p.r + 12} fill="url(#m-pin)"/>
          <circle cx={p.x} cy={p.y} r="7" fill={P.accent}/>
          <circle cx={p.x} cy={p.y} r="3" fill="#fff"/>
        </g>
      ))}
    </svg>
  );
}

function PhoneApp() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* map fills the frame */}
      <AppMap />
      {/* app header overlay */}
      <div style={{
        position: 'absolute', top: 44, left: 16, right: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          background: 'rgba(3,27,51,0.55)', border: `1px solid ${P.borderHi}`,
          padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
          fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: P.accent,
        }}>YOUR MAP</div>
        <div style={{
          background: 'rgba(3,27,51,0.55)', border: `1px solid ${P.border}`,
          padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
          fontSize: 11, color: P.inkSoft, fontWeight: 600,
        }}>Last 30 days</div>
      </div>

      {/* bottom action card */}
      <div style={{
        position: 'absolute', left: 16, right: 16, bottom: 78,
        background: 'rgba(11,39,64,0.85)', border: `1px solid ${P.borderHi}`,
        borderRadius: 16, padding: '14px 14px',
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: P.accent }}>NINE-MILE REEF</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: P.ink, marginTop: 3 }}>Red Snapper · 5 pins</div>
        <div style={{ fontSize: 11, color: P.inkMute, marginTop: 2 }}>Peak bite window: 6:12 – 7:48 AM</div>
      </div>

      {/* bottom tab bar */}
      <div style={{
        position: 'absolute', left: 16, right: 16, bottom: 20,
        background: 'rgba(11,39,64,0.9)', border: `1px solid ${P.border}`,
        borderRadius: 20, padding: '10px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backdropFilter: 'blur(10px)',
      }}>
        {['Map', 'Log', 'Discover', 'Profile'].map((t, i) => (
          <div key={t} style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            color: i === 0 ? P.accent : P.inkMute,
          }}>{t}</div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   FLOATING CARDS
   ============================================================ */

function FloatingCard({ children, style }) {
  return (
    <div style={{
      background: 'rgba(11,39,64,0.82)', border: `1px solid ${P.borderHi}`,
      borderRadius: 16, padding: '14px 16px',
      backdropFilter: 'blur(14px)',
      boxShadow: '0 24px 40px rgba(0,0,0,0.45)',
      color: P.ink,
      ...style,
    }}>
      {children}
    </div>
  );
}

function RecentCatchCard() {
  return (
    <FloatingCard style={{ width: 240 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: P.accentDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FishIcon size={22} />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: P.accent }}>RECENT CATCH</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: P.ink }}>Gulf Snapper</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: P.inkSoft, lineHeight: 1.6 }}>
        <div><strong style={{ color: P.ink }}>23 in · 6.2 lb</strong></div>
        <div>Depth 82 ft · Water 78°F</div>
        <div style={{ color: P.inkMute }}>Jun 24, 2026</div>
      </div>
    </FloatingCard>
  );
}

function TopPatternCard() {
  return (
    <FloatingCard style={{ width: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: P.accent }}>TOP PATTERN</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
        <FishIcon size={20} />
        <div style={{ fontSize: 16, fontWeight: 800, color: P.ink }}>Red Snapper</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
        <div>
          <div style={{ color: P.inkMute, letterSpacing: 0.8 }}>BEST MONTH</div>
          <div style={{ color: P.ink, fontWeight: 700, fontSize: 13, marginTop: 1 }}>June</div>
        </div>
        <div>
          <div style={{ color: P.inkMute, letterSpacing: 0.8 }}>BEST DEPTH</div>
          <div style={{ color: P.ink, fontWeight: 700, fontSize: 13, marginTop: 1 }}>30 – 120 ft</div>
        </div>
        <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
          <div style={{ color: P.inkMute, letterSpacing: 0.8 }}>TOP LOCATION</div>
          <div style={{ color: P.ink, fontWeight: 700, fontSize: 13, marginTop: 1 }}>Destin East · Nine-Mile Reef</div>
        </div>
      </div>
    </FloatingCard>
  );
}

function HotBiteWindowCard() {
  const heights = [0.35, 0.55, 0.75, 1.0, 0.9, 0.65, 0.5, 0.4, 0.32, 0.42, 0.58, 0.72, 0.5];
  return (
    <FloatingCard style={{ width: 280 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: P.accent }}>HOT BITE WINDOW</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: P.ink, marginTop: 3 }}>6:00 – 9:00 AM</div>
      <div style={{ fontSize: 11, color: P.inkMute, marginTop: 1 }}>Morning peak · last 42 catches</div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 4, height: 48, marginTop: 10,
      }}>
        {heights.map((h, i) => (
          <div key={i} style={{
            flex: 1,
            height: `${Math.round(h * 100)}%`,
            background: `linear-gradient(180deg, ${P.accent}, rgba(25,212,242,0.25))`,
            borderRadius: 3,
            opacity: 0.35 + h * 0.65,
          }} />
        ))}
      </div>
    </FloatingCard>
  );
}

/* ============================================================
   INSIGHTS WIDGETS
   ============================================================ */

function DonutChart() {
  const segments = [
    { color: '#19d4f2', pct: 34, label: 'Red Snapper' },
    { color: '#5ecdf2', pct: 22, label: 'King Mackerel' },
    { color: '#33e0ac', pct: 16, label: 'Mahi' },
    { color: '#ffc857', pct: 12, label: 'Gag Grouper' },
    { color: '#8ca8c9', pct: 16, label: 'Other' },
  ];
  const size = 100, r = 40, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#0e2f4e" strokeWidth="16"/>
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
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12 }}>
        {segments.slice(0, 4).map((s, i) => (
          <li key={i} style={{ color: P.inkSoft, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            <span style={{ color: P.ink, fontWeight: 700 }}>{s.label}</span>
            <span style={{ color: P.inkMute, marginLeft: 4 }}>{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BestTimesList() {
  const times = [
    { window: '6:12 – 7:48 AM',      tag: 'Peak'    },
    { window: '11:04 AM – 12:20 PM', tag: 'Mid'     },
    { window: '5:50 – 7:12 PM',      tag: 'Evening' },
  ];
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {times.map((t, i) => (
        <li key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 0', borderBottom: i < times.length - 1 ? `1px solid ${P.border}` : 'none',
          color: P.ink, fontSize: 13, fontWeight: 600,
        }}>
          <ClockIcon size={14} />
          <span>{t.window}</span>
          <span style={{ color: P.inkMute, marginLeft: 'auto', fontSize: 11, fontWeight: 500 }}>{t.tag}</span>
        </li>
      ))}
    </ul>
  );
}

function CatchHeatmap() {
  // Radial-gradient blobs over a dark rect — cyan hot, red hotter.
  return (
    <svg viewBox="0 0 200 120" style={{ width: '100%', height: 120, display: 'block', borderRadius: 10 }}>
      <defs>
        <radialGradient id="hot1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff6262" stopOpacity="0.75"/>
          <stop offset="1" stopColor="#ff6262" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="hot2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#19d4f2" stopOpacity="0.7"/>
          <stop offset="1" stopColor="#19d4f2" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="hot3" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5ecdf2" stopOpacity="0.55"/>
          <stop offset="1" stopColor="#5ecdf2" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="200" height="120" fill="#031b33"/>
      {/* subtle coast */}
      <path d="M0 90 Q 40 78 90 88 T 200 90 L 200 120 L 0 120 Z" fill="#08283f" opacity="0.9"/>
      {/* grid */}
      <g stroke="#0f5e85" strokeOpacity="0.15">
        <line x1="0" y1="30" x2="200" y2="30"/>
        <line x1="0" y1="60" x2="200" y2="60"/>
        <line x1="50" y1="0" x2="50" y2="120"/>
        <line x1="100" y1="0" x2="100" y2="120"/>
        <line x1="150" y1="0" x2="150" y2="120"/>
      </g>
      {/* blobs */}
      <ellipse cx="140" cy="45" rx="40" ry="30" fill="url(#hot1)"/>
      <ellipse cx="60"  cy="60" rx="35" ry="26" fill="url(#hot2)"/>
      <ellipse cx="105" cy="80" rx="30" ry="22" fill="url(#hot3)"/>
      {/* pin markers */}
      <circle cx="140" cy="45" r="3" fill={P.accent}/>
      <circle cx="60"  cy="60" r="3" fill={P.accent}/>
      <circle cx="105" cy="80" r="3" fill={P.accent}/>
    </svg>
  );
}

function SeasonalBars() {
  const heights = [22, 30, 46, 62, 74, 90, 85, 78, 62, 44, 30, 24];
  const months  = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 90 }}>
        {heights.map((h, i) => (
          <div key={i} style={{
            flex: 1, height: `${h}%`,
            background: `linear-gradient(180deg, ${P.accent}, rgba(25,212,242,0.15))`,
            borderRadius: '4px 4px 0 0',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 6, fontSize: 10, color: P.inkMute }}>
        {months.map((m, i) => <span key={i} style={{ flex: 1, textAlign: 'center' }}>{m}</span>)}
      </div>
    </>
  );
}

function PersonalBestMini() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12, background: P.accentDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <TrophyIcon size={24} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.4, color: P.inkMute, fontWeight: 700 }}>PERSONAL BEST</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: P.ink }}>Red Snapper · 11.4 lb</div>
        <div style={{ fontSize: 12, color: P.inkMute }}>29.5 in · Nine-Mile Reef · Jun 24</div>
      </div>
    </div>
  );
}

function InsightTile({ title, children, wide }) {
  return (
    <div style={{
      background: P.card, border: `1px solid ${P.border}`, borderRadius: 18,
      padding: 20, gridColumn: wide ? '1 / -1' : 'auto',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: P.accent, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

/* ============================================================
   SHARE + RELIVE
   ============================================================ */

function SharedCatchPhone() {
  // Compact phone frame showing a shared catch card (text-thread style).
  return (
    <PhoneFrame width={240}>
      <div style={{ padding: '46px 14px 14px', height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: P.inkMute, textAlign: 'center' }}>Dave · Family group</div>
        {/* incoming bubble */}
        <div style={{
          alignSelf: 'flex-start', maxWidth: '80%',
          background: '#0e2f4e', color: P.ink, padding: '8px 12px',
          borderRadius: '14px 14px 14px 4px', fontSize: 12,
        }}>Nice catch! What a day!</div>
        {/* catch card bubble */}
        <div style={{
          alignSelf: 'flex-end', width: '92%',
          background: '#0B2740', border: `1px solid ${P.borderHi}`,
          borderRadius: '14px 14px 4px 14px', padding: 10, color: P.ink,
        }}>
          <div style={{
            height: 76, borderRadius: 8,
            background: 'linear-gradient(135deg, #0a2a44 0%, #08283f 60%, #06263f 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FishIcon size={44} color={P.accent} />
          </div>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: P.accent, marginTop: 8 }}>YOUR CATCH</div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Gulf Snapper</div>
          <div style={{ fontSize: 11, color: P.inkSoft }}>24 in · 6.1 lb</div>
          <div style={{ fontSize: 10, color: P.inkMute, marginTop: 2 }}>Nine-Mile Reef · today</div>
        </div>
        <div style={{
          alignSelf: 'flex-start', maxWidth: '76%',
          background: '#0e2f4e', color: P.ink, padding: '8px 12px',
          borderRadius: '14px 14px 14px 4px', fontSize: 12,
        }}>Send me the spot 👀</div>
      </div>
    </PhoneFrame>
  );
}

/* ============================================================
   RESPONSIVE CSS (media queries — inline styles can't do these)
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
.rl-btn-ghost {
  background: transparent; color: ${P.accent};
  border: 1.5px solid ${P.accent};
}
.rl-btn-ghost:hover { background: rgba(25,212,242,0.08); transform: translateY(-1px); }

/* Hero */
.rl-hero {
  position: relative; overflow: hidden;
  padding: 30px 0 100px;
  min-height: 640px;
}
.rl-hero-bg {
  position: absolute; inset: 0; z-index: 0;
  background: center/cover no-repeat url("${A.heroBg}");
}
.rl-hero-scrim {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(180deg, rgba(6,17,31,0.25) 0%, rgba(6,17,31,0.55) 40%, ${P.bg} 100%);
}
.rl-hero-inner {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: 1.05fr 1fr; gap: 60px; align-items: center;
  padding-top: 40px;
}
@media (max-width: 1024px) { .rl-hero-inner { grid-template-columns: 1fr; gap: 40px; } }

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
@media (max-width: 500px) { .rl-h1 { font-size: 36px; } }

.rl-lead {
  font-size: 17px; line-height: 1.6; color: ${P.inkSoft};
  max-width: 560px; margin: 0 0 30px;
}
.rl-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 34px; }

/* Trust badges */
.rl-trust-row {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; max-width: 560px;
}
@media (max-width: 620px) { .rl-trust-row { grid-template-columns: 1fr; } }
.rl-trust { display: flex; align-items: flex-start; gap: 10px; }
.rl-trust strong { color: ${P.ink}; font-size: 13px; font-weight: 700; display: block; }
.rl-trust span   { color: ${P.inkMute}; font-size: 12px; }

/* Hero visual — raster phone mockup + floating card images */
.rl-visual { position: relative; min-height: 640px; display: flex; align-items: center; justify-content: center; }
.rl-phone-slot { position: relative; width: 440px; max-width: 100%; display: flex; justify-content: center; }
.rl-phone-img {
  width: 400px; max-width: 100%; height: auto; display: block;
  filter: drop-shadow(0 30px 60px rgba(0,0,0,0.55));
}
.rl-floaters { position: absolute; inset: 0; pointer-events: none; }
.rl-floaters > img {
  position: absolute; pointer-events: auto; display: block;
  height: auto; max-width: none;
  filter: drop-shadow(0 22px 36px rgba(0,0,0,0.45));
}
.rl-float-recent  { top: 20px;   left: -70px; width: 260px; }
.rl-float-pattern { top: 260px;  right: -90px; width: 280px; }
.rl-float-bite    { bottom: 20px; left: 20px;  width: 240px; }

@media (max-width: 1024px) {
  .rl-visual { min-height: unset; padding: 20px 0 60px; }
  .rl-phone-slot { width: 100%; }
  .rl-floaters {
    position: static; display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 12px; margin-top: 24px; padding: 0 4px;
  }
  .rl-floaters > img {
    position: static !important; width: 100% !important;
    top: auto; left: auto; right: auto; bottom: auto;
  }
}
@media (max-width: 720px) { .rl-floaters { grid-template-columns: 1fr; } }

/* Insights dashboard image — replaces the 5-tile grid */
.rl-insight-dash img {
  width: 100%; height: auto; display: block; border-radius: 20px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.45);
}

/* Share graphic — center column. Larger than the natural column
   fit: let it span up to ~140% of its column so it visually dominates
   the section. Above 1024px the three columns are 1fr each; a 1.4×
   share graphic reads as the section's hero. */
.rl-share-img {
  width: 100%;
  max-width: 520px; height: auto; display: block; margin: 0 auto;
  filter: drop-shadow(0 22px 40px rgba(0,0,0,0.5));
}
@media (min-width: 1025px) {
  .rl-share-img { max-width: 620px; transform: scale(1.05); }
}

/* Section */
.rl-section { padding: 90px 0; }
.rl-section-alt { background: ${P.bgAlt}; }
.rl-section-head { max-width: 720px; margin: 0 auto 56px; text-align: center; }
.rl-section-head .rl-eyebrow { display: block; margin-bottom: 12px; }
.rl-h2 {
  font-size: 42px; font-weight: 900; line-height: 1.08; letter-spacing: -0.5px;
  color: ${P.ink}; margin: 0 0 18px;
}
@media (max-width: 700px) { .rl-h2 { font-size: 32px; } }
.rl-lead-2 { font-size: 16px; line-height: 1.65; color: ${P.inkSoft}; }

/* Feature cards row */
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

/* Insights split */
.rl-split { display: grid; grid-template-columns: 1fr 1.15fr; gap: 60px; align-items: center; }
@media (max-width: 1024px) { .rl-split { grid-template-columns: 1fr; gap: 48px; } }
.rl-insight-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 560px) { .rl-insight-grid { grid-template-columns: 1fr; } }

/* Share split */
.rl-share { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 40px; align-items: center; }
@media (max-width: 1024px) { .rl-share { grid-template-columns: 1fr; text-align: center; } }
@media (max-width: 1024px) { .rl-share > * { justify-self: center; } }

/* Download CTA */
.rl-cta-block {
  text-align: center; padding: 70px 30px; border-radius: 30px;
  background:
    radial-gradient(circle at 50% -20%, rgba(25,212,242,0.22), transparent 55%),
    ${P.card};
  border: 1px solid ${P.borderHi};
}
.rl-store-row { display: flex; gap: 14px; justify-content: center; align-items: center; flex-wrap: wrap; margin-top: 26px; }
.rl-store-row img { display: block; height: 58px; }
.rl-qr {
  width: 92px; height: 92px; border-radius: 12px; background: #fff; padding: 6px;
  display: flex; align-items: center; justify-content: center;
}
.rl-qr img { height: 100%; width: 100%; }

/* Footer */
.rl-footer { padding: 40px 0 60px; border-top: 1px solid ${P.border}; }
.rl-footer-inner {
  display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap;
}
.rl-footer-links { display: flex; gap: 22px; flex-wrap: wrap; }
.rl-footer-links a { color: ${P.inkMute}; font-size: 13px; text-decoration: none; }
.rl-footer-links a:hover { color: ${P.accent}; }
.rl-footer-legal { font-size: 12px; color: ${P.inkMute}; }

/* Personal Fishing Intelligence Platform — full-width story blocks.
   Backgrounds are <img>s absolutely positioned so loading="lazy"
   works (CSS background-image would eager-fetch on every visit). */
.rl-story-section { padding: 30px 0 90px; background: ${P.bg}; }
/* Single row of 4 columns on desktop. Narrow blocks so scrim is a
   uniform vertical fade (light top → dark bottom) with copy anchored
   at the bottom. */
.rl-story-list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}
.rl-story {
  position: relative; overflow: hidden;
  border-radius: 18px; border: 1px solid ${P.border};
  height: 340px;
}
.rl-story-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%; object-fit: cover; display: block;
  z-index: 0;
}
.rl-story-scrim {
  position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(180deg,
    rgba(3,10,25,0.45) 0%,
    rgba(3,10,25,0.72) 55%,
    rgba(3,10,25,0.86) 100%);
}
.rl-story-inner {
  position: relative; z-index: 2;
  height: 100%; display: flex; align-items: flex-end;
  padding: 20px 20px;
}
.rl-story-copy { max-width: 100%; }
.rl-story-copy h2 {
  font-size: 18px; font-weight: 900; line-height: 1.2; letter-spacing: -0.2px;
  color: ${P.ink}; margin: 6px 0 6px;
}
.rl-story-copy p {
  font-size: 12.5px; line-height: 1.5; color: ${P.inkSoft}; margin: 0;
}

@media (max-width: 1024px) {
  /* Tablet — fall back to 2 columns so blocks aren't too skinny. */
  .rl-story-list { grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .rl-story { height: 260px; }
  .rl-story-inner { padding: 22px 22px; }
  .rl-story-copy h2 { font-size: 20px; }
  .rl-story-copy p { font-size: 13px; }
}
@media (max-width: 640px) {
  /* Phone — single column stack. */
  .rl-story-list { grid-template-columns: 1fr; gap: 12px; }
  .rl-story { height: 200px; border-radius: 16px; }
  .rl-story-inner { padding: 18px 20px; }
  .rl-story-copy h2 { font-size: 18px; }
  .rl-story-copy p { font-size: 13px; line-height: 1.5; }
}
`;

/* ============================================================
   SECTIONS
   ============================================================ */

function TrustItem({ icon: Icon, t1, t2 }) {
  return (
    <div className="rl-trust">
      <div style={{ color: P.accent, marginTop: 2 }}><Icon size={22} /></div>
      <div>
        <strong>{t1}</strong>
        <span>{t2}</span>
      </div>
    </div>
  );
}

const TRUST_BADGES = [
  { icon: CloudIcon,  t1: 'Works Offline',    t2: 'Syncs Everywhere' },
  { icon: ShieldIcon, t1: 'Private & Secure', t2: 'Your Data, Yours' },
  { icon: UsersIcon,  t1: 'Built for Anglers',t2: 'By Anglers' },
];

function Nav() {
  return (
    <nav className="rl-nav" aria-label="Primary">
      <a href="#top" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <img src={LOGO_HEADER} alt="ReelIntel" style={{ height: 64, width: 'auto', display: 'block' }} />
      </a>
      <div className="rl-nav-links">
        {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
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
          <div className="rl-eyebrow">Built by Anglers</div>
          <h1 className="rl-h1">
            <span>Fish smarter.</span><br/>
            Remember every trip.
          </h1>
          <p className="rl-lead">
            Log catches, discover patterns, save Personal Bests, and share your best moments with friends.
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

        <div className="rl-visual">
          <div className="rl-phone-slot">
            <img
              src={A.phoneMockup}
              alt=""
              aria-hidden="true"
              className="rl-phone-img"
              loading="eager"
              decoding="async"
            />
            <div className="rl-floaters">
              <img className="rl-float-recent"  src={A.cardRecent}  alt="" aria-hidden="true" loading="lazy" />
              <img className="rl-float-pattern" src={A.cardPattern} alt="" aria-hidden="true" loading="lazy" />
              <img className="rl-float-bite"    src={A.cardBite}    alt="" aria-hidden="true" loading="lazy" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Four full-width story blocks — sits between Hero and Insights.
   Renders lazy-loaded background <img>s (not CSS background-image) so
   Lighthouse counts them for LCP correctly and image budgets track. */
const STORY_BLOCKS = [
  {
    img:     'bgIntelligence',
    alt:     'Fishing intelligence mapped across the Gulf',
    eyebrow: 'Intelligence',
    h2:      'Fishing intelligence, mapped to you.',
    body:    'Every catch adds another data point. See the patterns behind your best days — species, spots, depths, seasons — mapped across the Gulf.',
  },
  {
    img:     'bgUnderwater',
    alt:     'Underwater view of a snapper being caught',
    eyebrow: 'Every detail, captured',
    h2:      'Every catch, in context.',
    body:    'Species, size, depth, location, weather, moon, sun — captured automatically the moment you log a fish. Nothing to type, nothing to remember.',
  },
  {
    img:     'bgTrophy',
    alt:     'Angler holding a personal-best trophy fish',
    eyebrow: 'Personal Bests',
    h2:      'Celebrate your biggest moments.',
    body:    'Every species tracks your top catch. Compare against your own best — or share it with friends who might chase yours.',
  },
  {
    img:     'bgSunset',
    alt:     'Fishing boat at sunset',
    eyebrow: 'Every trip, remembered',
    h2:      'Relive every great day on the water.',
    body:    'Your photos, your spots, your conditions — the full story of every trip, saved forever. Look back, learn, and plan the next one.',
  },
];

function IntelligencePlatform() {
  return (
    <section className="rl-section rl-story-section" id="features">
      <div className="rl-container">
        <div className="rl-section-head">
          <span className="rl-eyebrow">Everything you need on the water</span>
          <h2 className="rl-h2">A personal fishing intelligence platform.</h2>
          <p className="rl-lead-2">
            Log catches, spot patterns, save your bests, and share every unforgettable moment —
            all in one app built to keep you on the bite.
          </p>
        </div>
        <div className="rl-story-list">
          {STORY_BLOCKS.map((b, i) => (
            <article key={i} className="rl-story">
              <img
                className="rl-story-img"
                src={A[b.img]}
                alt={b.alt}
                loading="lazy"
                decoding="async"
              />
              <div className="rl-story-scrim" aria-hidden="true" />
              <div className="rl-story-inner">
                <div className="rl-story-copy">
                  <span className="rl-eyebrow">{b.eyebrow}</span>
                  <h2>{b.h2}</h2>
                  <p>{b.body}</p>
                </div>
              </div>
            </article>
          ))}
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
        <div className="rl-insight-dash">
          <img
            src={A.insightsDash}
            alt="Species breakdown, best times, catch map, seasonal success, and personal bests dashboard."
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}

function ShareRelive() {
  return (
    <section className="rl-section" id="share">
      <div className="rl-container">
        <div className="rl-section-head">
          <span className="rl-eyebrow">Share &amp; Relive</span>
          <h2 className="rl-h2">Share &amp; Relive with Friends.</h2>
          <p className="rl-lead-2">
            Send catches by text or email. Relive the laughs, the big ones, and every
            unforgettable moment together — the whole day, in one tap.
          </p>
        </div>

        <div className="rl-share">
          <div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14, textAlign: 'left' }}>
              {[
                ['Text a catch',    'Share the photo, species, size, and location — instantly.'],
                ['Email a report',  'A polished catch card with weather, gear, and notes.'],
                ['Family archive',  'Every kid, every buddy trip — all in one shared album.'],
              ].map(([t, s], i) => (
                <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: P.accentDim,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ShareIcon size={18} />
                  </div>
                  <div>
                    <div style={{ color: P.ink, fontWeight: 700 }}>{t}</div>
                    <div style={{ color: P.inkSoft, fontSize: 13.5, marginTop: 2 }}>{s}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={A.shareGraphic}
              alt=""
              aria-hidden="true"
              className="rl-share-img"
              loading="lazy"
              decoding="async"
            />
          </div>

          <div>
            <div style={{ color: P.inkMute, fontSize: 12, letterSpacing: 1.4, fontWeight: 700, marginBottom: 12 }}>
              SHARE IN SECONDS VIA
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
              {[
                [TextIcon, 'Text'],
                [MailIcon, 'Email'],
                [DotsIcon, 'More'],
              ].map(([Icon, label], i) => (
                <div key={i} style={{
                  background: P.card, border: `1px solid ${P.border}`,
                  borderRadius: 12, padding: '12px 14px', flex: 1, minWidth: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                  <Icon size={18} />
                  <div style={{ fontSize: 11, color: P.inkSoft, fontWeight: 700 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              <a href={APP_STORE_URL} target="_blank" rel="noreferrer" aria-label="Download on the App Store">
                <img src={A.appStore} alt="Download on the App Store" style={{ height: 50, display: 'block' }} />
              </a>
              <a href={GOOGLE_PLAY_URL} target="_blank" rel="noreferrer" aria-label="Get it on Google Play">
                <img src={A.googlePlay} alt="Get it on Google Play" style={{ height: 50, display: 'block' }} />
              </a>
              <div className="rl-qr" style={{ width: 82, height: 82 }}>
                <img src={A.qrCode} alt="" />
              </div>
            </div>
          </div>
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
            <div className="rl-qr">
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
        <img src={LOGO_HORIZONTAL} alt="ReelIntel" style={{ height: 40, width: 'auto' }} />
        <div className="rl-footer-links">
          {NAV_ITEMS.map(n => <a key={n.label} href={n.href}>{n.label}</a>)}
        </div>
        <div className="rl-footer-legal">
          © {new Date().getFullYear()} ReelIntel, LLC. All rights reserved.
          {' · '}<a href="/privacy" style={{ color: P.inkMute }}>Privacy Policy</a>
          {' · '}<a href="/terms"   style={{ color: P.inkMute }}>Terms of Use</a>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   ROOT
   ============================================================ */

export function MarketingLanding() {
  // useMemo — small perf, but the CSS string never changes.
  const cssRef = useMemo(() => CSS, []);
  return (
    <div className="rl-root">
      <style>{cssRef}</style>
      <Nav />
      {/* Announcement strip sits directly under the nav so news
          reaches signed-out marketing visitors too. Wrapped in a
          max-width container to match the marketing layout. */}
      <div style={{
        maxWidth: 1120, margin: '0 auto', padding: '0 20px', boxSizing: 'border-box',
      }}>
        <AnnouncementBanner />
      </div>
      <Hero />
      <IntelligencePlatform />
      <Insights />
      <ShareRelive />
      <DownloadCTA />
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

