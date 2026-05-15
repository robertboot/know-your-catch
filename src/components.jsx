import React, { useState } from 'react';
import { CheckCircle2, X, Anchor, AlertTriangle } from 'lucide-react';
import { T } from './theme.js';
import { JURISDICTIONS, DISCLAIMER_TEXT } from './data.js';
import { speciesPhoto } from './helpers.js';

/* ============================================================
   STATUS PILL — colorblind-safe via shape + color
   ============================================================ */
export function StatusPill({ status, size = 'normal' }) {
  const m = {
    open:     { label: 'OPEN',        bg: T.openBg,   fg: T.open,      shape: 'circle' },
    closed:   { label: 'CLOSED',      bg: T.closedBg, fg: T.closed,    shape: 'square' },
    upcoming: { label: 'OPENS SOON',  bg: T.warnBg,   fg: T.warn,      shape: 'triangle' },
    caution:  { label: 'VERIFY',      bg: T.warnBg,   fg: T.brassDeep, shape: 'triangle' },
    unknown: { label: 'CHECK SOURCE', bg: T.parchmentDeep, fg: T.inkSoft, shape: 'circle' },
  }[status] || { label: 'CHECK SOURCE', bg: T.parchmentDeep, fg: T.inkSoft, shape: 'circle' };
  const pad = size === 'small' ? '2px 8px' : '4px 10px';
  const fs = size === 'small' ? 10 : 11;
  const shape = m.shape === 'circle'
    ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.fg, display: 'inline-block' }} />
    : m.shape === 'square'
    ? <span style={{ width: 7, height: 7, background: m.fg, display: 'inline-block' }} />
    : <span style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: `7px solid ${m.fg}`, display: 'inline-block' }} />;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: m.bg, color: m.fg, padding: pad, borderRadius: 999, fontSize: fs, fontWeight: 700, letterSpacing: 1, border: `1.5px solid ${m.fg}44` }}>
      {shape}{m.label}
    </span>
  );
}

/* ============================================================
   FISH MARK — stylized field-guide silhouette by category
   ============================================================ */
export function FishMark({ species, size = 56 }) {
  const cat = species?.category || 'reef';
  const palette = {
    snapper: ['#B8423A', '#7A2A22'], grouper: ['#6B5132', '#3D2D17'],
    jacks: ['#7A8A2C', '#4D5818'], mackerel: ['#3B6A8B', '#1F3B4E'],
    tuna: ['#244A66', '#0F2532'], billfish: ['#1B4D6B', '#0B2A3C'],
    trigger: ['#6E6248', '#3D3622'], sharks: ['#5A6772', '#2F3942'],
    cobia: ['#3D4849', '#1E2628'], wahoo: ['#2D5666', '#143240'],
    reef: ['#4E8C5A', '#26512E'],
  };
  const [body, accent] = palette[cat] || palette.reef;
  const isBill = cat === 'billfish';
  const isShark = cat === 'sharks';
  const isLong = cat === 'mackerel' || cat === 'wahoo' || cat === 'cobia';
  const id = `g-${cat}-${species?.id || 'x'}`;
  return (
    <svg width={size} height={size * 0.65} viewBox="0 0 100 65" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={body} />
          <stop offset="100%" stopColor={accent} />
        </linearGradient>
      </defs>
      {isBill && <line x1="0" y1="32" x2="22" y2="32" stroke={accent} strokeWidth="2" strokeLinecap="round" />}
      <path
        d={isLong
          ? 'M 18 32 Q 30 18, 60 22 Q 78 25, 85 32 Q 78 39, 60 42 Q 30 46, 18 32 Z'
          : isShark
          ? 'M 18 32 Q 30 16, 55 20 Q 75 24, 84 32 Q 75 40, 55 44 Q 30 48, 18 32 Z'
          : 'M 22 32 Q 32 12, 58 18 Q 78 22, 84 32 Q 78 42, 58 46 Q 32 52, 22 32 Z'}
        fill={`url(#${id})`} stroke={accent} strokeWidth="1.2"
      />
      <path d={isLong ? 'M 84 32 L 96 22 L 92 32 L 96 42 Z' : 'M 84 32 L 96 20 L 90 32 L 96 44 Z'} fill={accent} />
      {isShark
        ? <path d="M 50 22 L 56 8 L 60 22 Z" fill={accent} />
        : <path d="M 40 20 L 50 10 L 62 14 L 66 20 Z" fill={accent} opacity="0.85" />}
      <path d="M 50 46 L 58 54 L 64 46 Z" fill={accent} opacity="0.7" />
      <circle cx="28" cy="28" r="2.5" fill={T.parchment} />
      <circle cx="28" cy="28" r="1.3" fill={T.ink} />
      <path d="M 34 24 Q 36 32, 34 40" stroke={accent} strokeWidth="0.9" fill="none" />
      {species?.id === 'spanish_mackerel' && <>
        <circle cx="45" cy="35" r="1.4" fill={T.brass} />
        <circle cx="55" cy="29" r="1.4" fill={T.brass} />
        <circle cx="65" cy="37" r="1.4" fill={T.brass} />
      </>}
      {species?.id === 'king_mackerel' && <path d="M 30 31 Q 48 31, 55 38 Q 70 38, 82 33" stroke={accent} strokeWidth="0.7" fill="none" />}
      {species?.id === 'wahoo' && <>
        <line x1="42" y1="22" x2="42" y2="44" stroke={accent} strokeWidth="0.9" opacity="0.6" />
        <line x1="52" y1="22" x2="52" y2="44" stroke={accent} strokeWidth="0.9" opacity="0.6" />
        <line x1="62" y1="22" x2="62" y2="44" stroke={accent} strokeWidth="0.9" opacity="0.6" />
        <line x1="72" y1="22" x2="72" y2="44" stroke={accent} strokeWidth="0.9" opacity="0.6" />
      </>}
    </svg>
  );
}

/* Real photo when one is set in the manifest; the FishMark
   illustration otherwise (or if the photo fails to load). */
export function SpeciesImage({ species, size = 56, style }) {
  const [err, setErr] = useState(false);
  const p = species && species.id ? speciesPhoto(species.id) : null;
  if (p && p.url && !err) {
    return <img src={p.url} alt={species.commonName || ''} loading="lazy"
      onError={() => setErr(true)}
      style={{ width: size, height: Math.round(size * 0.7), objectFit: 'cover', borderRadius: 6, display: 'block', ...style }} />;
  }
  return <FishMark species={species} size={size} />;
}

/* ============================================================
   PRIMITIVES
   ============================================================ */
export function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 6, padding: 14,
      boxShadow: '0 1px 0 rgba(124, 86, 24, 0.06)', cursor: onClick ? 'pointer' : 'default', ...style,
    }}>{children}</div>
  );
}
export function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', background: disabled ? '#2A3E4D' : T.brass, color: disabled ? T.inkMute : T.oceanDeep, border: 'none',
      padding: '14px 16px', borderRadius: 6, fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: '0 1px 0 rgba(0,0,0,0.15)', ...style,
    }}>{children}</button>
  );
}
export function GhostButton({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
      padding: '10px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
      ...style,
    }}>{children}</button>
  );
}
export function SectionLabel({ children, style }) {
  return <div style={{ fontSize: 11, letterSpacing: 1.8, textTransform: 'uppercase', color: T.brassDeep, fontWeight: 700, ...style }}>{children}</div>;
}
export function H1({ children, size = 28, style }) {
  return <h1 style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontSize: size, fontWeight: 600, color: T.ink, margin: 0, lineHeight: 1.15, letterSpacing: '-0.01em', ...style }}>{children}</h1>;
}

export function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '6px 0', borderTop: `1px solid ${T.cardEdge}55` }}>
      <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 600, letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontSize: 13, color: T.ink, textAlign: 'right', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  );
}

export const inputStyle = {
  width: '100%', padding: '10px 12px', fontSize: 14, border: `1.5px solid ${T.cardEdge}`,
  borderRadius: 4, background: T.parchmentDeep, color: T.ink, outline: 'none', boxSizing: 'border-box',
};
export function Field({ label, value, onChange, type = 'text', placeholder }) {
  return (
    <div style={{ marginTop: 10 }}>
      <SectionLabel style={{ marginBottom: 6 }}>{label}</SectionLabel>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}
export function PickButton({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: active ? T.brass : T.parchmentDeep, color: active ? T.oceanDeep : T.ink,
      border: `1.5px solid ${active ? T.brass : T.cardEdge}`, padding: '10px 8px', borderRadius: 6,
      fontSize: 13, fontWeight: 600, cursor: 'pointer',
    }}>{children}</button>
  );
}

export const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(8, 38, 53, 0.62)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 20, zIndex: 100,
};
export const modalStyle = {
  background: T.card, borderRadius: 8, padding: 20, width: '100%', maxWidth: 400,
  border: `2px solid ${T.brass}`, boxShadow: '0 10px 40px rgba(0,0,0,0.55)', maxHeight: '85vh', overflowY: 'auto',
};

/* ============================================================
   MODALS
   ============================================================ */

export function DisclaimerModal({ onAccept }) {
  const [checked, setChecked] = useState(false);
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ textAlign: 'center', borderBottom: `1px solid ${T.cardEdge}`, paddingBottom: 14, marginBottom: 14 }}>
          <Anchor size={26} color={T.brass} style={{ margin: '0 auto 6px', display: 'block' }} />
          <H1 size={22}>Know Your Catch</H1>
          <div style={{ color: T.brassDeep, fontStyle: 'italic', fontSize: 12, marginTop: 4, letterSpacing: 0.5 }}>Identify it. Know the rules. Stay legal.</div>
        </div>
        <SectionLabel style={{ marginBottom: 8 }}>Before you start</SectionLabel>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: T.inkSoft, margin: '0 0 14px', maxHeight: 200, overflowY: 'auto' }}>{DISCLAIMER_TEXT}</p>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: T.parchmentDeep, borderRadius: 4, cursor: 'pointer', marginBottom: 14 }}>
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: T.brass }} />
          <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>I understand and accept.</span>
        </label>
        <PrimaryButton disabled={!checked} onClick={onAccept}>Accept & Continue</PrimaryButton>
      </div>
    </div>
  );
}

export function JurisdictionPickerModal({ current, onPick, onClose, canCancel, onShowBoundary }) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <H1 size={20}>Select fishing waters</H1>
          {canCancel && <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.inkMute, padding: 4 }}><X size={20} /></button>}
        </div>
        <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5 }}>
          Pick the waters you'll be fishing in. You can change this anytime.
          {' '}<button onClick={onShowBoundary} style={{ background: 'transparent', border: 'none', color: T.brass, fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13, textDecoration: 'underline' }}>
            What's the boundary?
          </button>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {JURISDICTIONS.map(j => (
            <button key={j.id} onClick={() => onPick(j.id)} style={{
              background: current === j.id ? T.parchmentDeep : T.card,
              border: `1.5px solid ${current === j.id ? T.brass : T.cardEdge}`,
              borderRadius: 6, padding: 12, cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{j.name}</div>
                <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{j.agency}</div>
              </div>
              {current === j.id && <CheckCircle2 size={18} color={T.brass} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InfoModal({ title, children, onClose }) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <H1 size={20}>{title}</H1>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.inkMute, padding: 4 }}><X size={20} /></button>
        </div>
        <div style={{ fontSize: 14, color: T.inkSoft }}>{children}</div>
        <PrimaryButton onClick={onClose} style={{ marginTop: 16 }}>Got it</PrimaryButton>
      </div>
    </div>
  );
}

export function KeepConfirmModal({ species, onClose }) {
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ background: T.warnBg, border: `2px solid ${T.warn}`, padding: 14, borderRadius: 6, marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <AlertTriangle size={22} color={T.warn} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 700, color: T.brassDeep, fontSize: 14, marginBottom: 4 }}>Before you keep this fish</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, color: T.inkSoft }}>
              Regulations change frequently. Verify current rules with the appropriate agency before harvesting. The publisher accepts no liability for citations or fines.
            </div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginBottom: 12 }}>
          You are responsible for: confirming the species, checking the current season, measuring length correctly (fork vs. total), counting against bag and vessel limits, and carrying required gear.
        </div>
        <PrimaryButton onClick={onClose}>I've verified — close</PrimaryButton>
      </div>
    </div>
  );
}

/* ============================================================
   SHARED SPECIES ROW (used by category, search, list screens)
   ============================================================ */
export function SpeciesRow({ species, onClick }) {
  return (
    <Card onClick={onClick} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
      <div style={{ flexShrink: 0 }}><FishMark species={species} size={50} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 600, color: T.ink }}>{species.commonName}</div>
        <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{species.scientific}</div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.3 }}>{species.keyIds[0]}</div>
      </div>
    </Card>
  );
}

/* ============================================================
   BIG HOME-STYLE BUTTON
   ============================================================ */
export function BigButton({ icon, title, subtitle, onClick, accent = T.brass }) {
  return (
    <button onClick={onClick} style={{
      background: T.card, border: `1.5px solid ${T.cardEdge}`, borderLeft: `4px solid ${accent}`, borderRadius: 4,
      padding: '16px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
      width: '100%', textAlign: 'left',
      boxShadow: '0 1px 0 rgba(124, 86, 24, 0.06)',
    }}>
      <div style={{ background: T.parchmentDeep, color: T.brass, padding: 10, borderRadius: 4, flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600, color: T.ink }}>{title}</div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>{subtitle}</div>
      </div>
    </button>
  );
}
