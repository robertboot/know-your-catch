import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CheckCircle2, X, Anchor, AlertTriangle, Star, Search, Share2, Trophy, ImageOff, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { T } from './theme.js';
import { JURISDICTIONS, DISCLAIMER_TEXT, SPECIES, CATEGORIES } from './data.js';
import { speciesPhoto, shareReport, speciesById } from './helpers.js';
import { photoDisplayUrl, photoThumbUrl, photoAsDataUrl } from './photos-store.js';

/* ============================================================
   STATUS PILL — colorblind-safe via shape + color
   ============================================================ */
export function StatusPill({ status, size = 'normal' }) {
  const m = {
    open:     { label: 'OPEN',        bg: T.openBg,   fg: T.open,      shape: 'circle' },
    closed:   { label: 'CLOSED',      bg: T.closedBg, fg: T.closed,    shape: 'square' },
    upcoming: { label: 'OPENS SOON',  bg: T.warnBg,   fg: T.warn,      shape: 'triangle' },
    caution:  { label: 'VERIFY',      bg: T.warnBg,   fg: T.brassDeep, shape: 'triangle' },
    unknown: { label: 'CONFIRM SOURCE', bg: T.parchmentDeep, fg: T.inkSoft, shape: 'circle' },
  }[status] || { label: 'CONFIRM SOURCE', bg: T.parchmentDeep, fg: T.inkSoft, shape: 'circle' };
  const pad = size === 'small' ? '2px 8px' : size === 'large' ? '6px 14px' : '4px 10px';
  const fs = size === 'small' ? 10 : size === 'large' ? 13 : 11;
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
/* Real photo when one is set in the manifest; a neutral "no photo yet"
   placeholder otherwise. Per product direction we no longer render the
   old illustrated FishMark cartoons — NOAA imagery only.

   objectFit:contain + max-width/height 99% keeps the fish whole inside
   the cell. NOAA images with a white background will breathe with a hair
   of whitespace instead of getting cropped to fit the container's
   aspect. */
export function SpeciesImage({ species, size = 56, style }) {
  const [err, setErr] = useState(false);
  const p = species && species.id ? speciesPhoto(species.id) : null;
  const w = size;
  const h = Math.round(size * 0.7);
  if (p && p.url && !err) {
    return <img src={p.url} alt={species?.commonName || ''} loading="lazy"
      onError={() => setErr(true)}
      style={{
        width: w, height: h,
        maxWidth: '99%', maxHeight: '99%',
        objectFit: 'contain',
        borderRadius: 6, display: 'block',
        ...style,
      }} />;
  }
  return (
    <div
      aria-label={species?.commonName ? `${species.commonName} — photo coming soon` : 'Photo coming soon'}
      style={{
        width: w, height: h, maxWidth: '99%', maxHeight: '99%',
        borderRadius: 6, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(160deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
        border: `1px solid ${T.cardEdge}`,
        color: T.inkMute,
        ...style,
      }}
    >
      <ImageOff size={Math.max(14, Math.round(size * 0.32))} strokeWidth={1.6} />
    </div>
  );
}

/* ============================================================
   PRIMITIVES
   ============================================================ */
export function Card({ children, style, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 14, padding: 14,
      boxShadow: '0 0 0 1px rgba(25, 212, 242, 0.04) inset', cursor: onClick ? 'pointer' : 'default', ...style,
    }}>{children}</div>
  );
}
export function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', background: disabled ? '#2A3E4D' : T.brass, color: disabled ? T.inkMute : T.oceanDeep, border: 'none',
      padding: '14px 16px', borderRadius: 10, fontSize: 15, fontWeight: 800, letterSpacing: 0.4,
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: '0 4px 12px rgba(25, 212, 242, 0.18)', ...style,
    }}>{children}</button>
  );
}
export function GhostButton({ children, onClick, style, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: 'transparent',
      color: disabled ? T.inkMute : T.brass,
      border: `1.5px solid ${disabled ? T.cardEdge : T.brass}`,
      padding: '10px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
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

/* DisclaimerModal — onboarding accept OR view-only.
   Onboarding pass onAccept only; Settings pass readOnly + onClose. */
export function DisclaimerModal({ onAccept, readOnly = false, onClose }) {
  const [checked, setChecked] = useState(false);
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ textAlign: 'center', borderBottom: `1px solid ${T.cardEdge}`, paddingBottom: 14, marginBottom: 14 }}>
          <Anchor size={26} color={T.brass} style={{ margin: '0 auto 6px', display: 'block' }} />
          <H1 size={22}>ReelIntel</H1>
          <div style={{ color: T.brassDeep, fontStyle: 'italic', fontSize: 12, marginTop: 4, letterSpacing: 0.5 }}>Fish smarter. Catch more.</div>
        </div>
        <SectionLabel style={{ marginBottom: 8 }}>{readOnly ? 'Disclaimer' : 'Before you start'}</SectionLabel>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: T.inkSoft, margin: '0 0 14px', maxHeight: 260, overflowY: 'auto' }}>{DISCLAIMER_TEXT}</p>
        {readOnly ? (
          <PrimaryButton onClick={onClose}>Close</PrimaryButton>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, background: T.parchmentDeep, borderRadius: 4, cursor: 'pointer', marginBottom: 14 }}>
              <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, accentColor: T.brass }} />
              <span style={{ fontSize: 13, color: T.ink, fontWeight: 600 }}>I understand and accept.</span>
            </label>
            <PrimaryButton disabled={!checked} onClick={onAccept}>Accept & Continue</PrimaryButton>
          </>
        )}
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

/* ============================================================
   IDENTIFICATION CONFIRM CARD

   Sits between the analyzing screen and catch_entry so the angler
   can accept or correct the AI's pick before it becomes a catch.
   Full-screen dark overlay — the card is the whole surface. Auto-
   advances after 3s at confidence >= 60% (6s tier removed —
   user preference for < 60% is explicit-only). Any interaction
   (touch, focus, hover) pauses the timer permanently.
   ============================================================ */
export function IdentificationConfirmCard({ imageDataUrl, aiIdentifiedSpeciesId, aiConfidence, onConfirm, onCorrect }) {
  const species = aiIdentifiedSpeciesId ? speciesById(aiIdentifiedSpeciesId) : null;
  const pct = aiConfidence != null ? Math.round(aiConfidence * 100) : null;

  // Tier: green >= 80, amber 60–79, red < 60. Colors from theme.
  const tier = pct == null ? 'unknown' : pct >= 80 ? 'high' : pct >= 60 ? 'mid' : 'low';
  const tierColor = tier === 'high' ? T.open : tier === 'mid' ? T.warn : T.closed;
  const tierBg    = tier === 'high' ? T.openBg : tier === 'mid' ? T.warnBg : T.closedBg;
  const tierLabel = tier === 'high' ? 'High confidence' : tier === 'mid' ? 'Likely' : 'Uncertain';

  // Auto-advance only when confidence is high enough — a bad ID
  // silently becoming a wrong catch is worse than one extra tap.
  const AUTO_MS = 3000;
  const autoAdvance = tier === 'high' || tier === 'mid';

  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const doneRef = useRef(false);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!autoAdvance) return;
    startRef.current = performance.now();
    const tick = (now) => {
      if (doneRef.current || paused) return;
      const elapsed = now - startRef.current;
      const p = Math.min(1, elapsed / AUTO_MS);
      setProgress(p);
      if (p >= 1) {
        doneRef.current = true;
        onConfirm && onConfirm();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [autoAdvance, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseTimer = () => setPaused(true);

  const confirm = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onConfirm && onConfirm();
  };
  const correct = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCorrect && onCorrect();
  };

  return (
    <div
      onTouchStart={pauseTimer} onMouseDown={pauseTimer} onScroll={pauseTimer}
      style={{
        position: 'fixed', inset: 0, background: T.bgDeep, color: T.ink,
        display: 'flex', flexDirection: 'column',
        zIndex: 100, padding: '16px 16px 24px',
        overflowY: 'auto',
        paddingTop: 'calc(env(safe-area-inset-top) + 16px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
      }}
    >
      {/* Auto-advance progress bar. Only rendered when the timer is
          actually running so no-auto-advance tiers don't imply one. */}
      {autoAdvance && (
        <div style={{
          height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 999,
          overflow: 'hidden', marginBottom: 14,
        }}>
          <div style={{
            width: `${Math.round(progress * 100)}%`, height: '100%',
            background: tierColor, transition: paused ? 'none' : 'width 60ms linear',
          }} />
        </div>
      )}

      {/* Photo the angler just captured */}
      {imageDataUrl && (
        <div style={{
          width: '100%', maxHeight: 220, marginBottom: 14,
          borderRadius: 12, overflow: 'hidden',
          background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
          border: `1px solid ${T.cardEdge}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={imageDataUrl} alt="Your catch"
            style={{ width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }} />
        </div>
      )}

      {/* AI-identified chip */}
      <div style={{
        alignSelf: 'flex-start',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: T.parchmentDeep, border: `1px solid ${T.brass}`,
        color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 0.8,
        padding: '4px 10px', borderRadius: 999, marginBottom: 10,
      }}>
        <Sparkles size={12} strokeWidth={2.4} /> AI IDENTIFIED
      </div>

      {/* Species — the identification target */}
      {species ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <SpeciesImage species={species} size={80} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700, color: T.ink, lineHeight: 1.15 }}>
              {species.commonName}
            </div>
            <div style={{ fontSize: 14, color: T.inkSoft, fontStyle: 'italic', marginTop: 2 }}>
              {species.scientific}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: T.inkSoft, marginBottom: 14 }}>
          No confident match — pick a species manually.
        </div>
      )}

      {/* Confidence pill */}
      {pct != null && (
        <div style={{
          alignSelf: 'flex-start',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: tierBg, border: `1px solid ${tierColor}`, color: tierColor,
          fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
          padding: '5px 12px', borderRadius: 999, marginBottom: 18,
        }}>
          {tierLabel} · {pct}%
        </div>
      )}

      {tier === 'low' && (
        <div style={{ fontSize: 12, color: T.warn, marginBottom: 14, lineHeight: 1.5 }}>
          Low confidence — please verify.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
        <PrimaryButton onClick={confirm}>
          Confirm & log this catch
        </PrimaryButton>
        <GhostButton onClick={correct} style={{ width: '100%' }}>
          Not this fish → pick species
        </GhostButton>
      </div>
    </div>
  );
}

/* ============================================================
   SIGN IN MODAL — magic-link email flow.
   Two states: enter-email, then check-your-email with a resend
   button that runs a 60s cooldown so we can't spam Supabase's OTP
   endpoint.
   ============================================================ */
/* Email + password auth modal. Four modes:
     signin  — email/password → onSignIn
     signup  — email/password/confirm → onSignUp
     forgot  — email → onResetPassword → advances to 'sent'
     sent    — post-reset "check your email" panel

   Kept the export name SignInModal for callsite stability. */
export function SignInModal({
  initialEmail = '',
  initialMode = 'signin',
  onClose,
  onSignIn,
  onSignUp,
  onResetPassword,
}) {
  const [mode, setMode] = useState(initialMode);           // signin | signup | forgot | sent
  const [postSignup, setPostSignup] = useState(false);     // needs-confirmation panel after signUp

  const [email, setEmail] = useState(initialEmail || '');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const validate = () => {
    const errs = {};
    const trimmed = (email || '').trim();
    if (!trimmed || !trimmed.includes('@')) errs.email = 'Enter a valid email.';
    if (mode !== 'forgot') {
      if (!password || password.length < 8) errs.password = 'At least 8 characters.';
    }
    if (mode === 'signup') {
      if (password !== confirmPw) errs.confirmPw = 'Passwords do not match.';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async () => {
    if (busy) return;
    if (!validate()) return;
    setBusy(true); setError('');
    try {
      if (mode === 'signin') {
        const res = await onSignIn({ email, password });
        if (!res?.ok) { setError(res?.error || 'Sign-in failed.'); setBusy(false); return; }
        // Session lands via subscribe → App session-gate closes the modal.
        setBusy(false);
        onClose?.();
      } else if (mode === 'signup') {
        const res = await onSignUp({ email, password });
        if (!res?.ok) { setError(res?.error || 'Sign-up failed.'); setBusy(false); return; }
        setBusy(false);
        if (res.needsConfirmation) setPostSignup(true);
        else onClose?.();
      } else if (mode === 'forgot') {
        const res = await onResetPassword({ email });
        setBusy(false);
        if (!res?.ok) { setError(res?.error || 'Could not send reset link.'); return; }
        setMode('sent');
      }
    } catch (e) {
      setBusy(false);
      setError(e?.message || String(e));
    }
  };

  const switchMode = (next) => {
    setError(''); setFieldErrors({}); setMode(next);
  };

  const title =
    mode === 'signin' ? 'Sign in' :
    mode === 'signup' ? (postSignup ? 'Check your email' : 'Create account') :
    mode === 'forgot' ? 'Reset password' :
    /* sent */          'Check your email';

  const inputWithErr = (err) => ({
    ...inputStyle,
    borderColor: err ? T.closed : (inputStyle.border || undefined),
  });

  return (
    // z-index 300 — must render above the splash screen (zIndex 200).
    <div style={{ ...overlayStyle, zIndex: 300 }}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <H1 size={20}>{title}</H1>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.inkMute, padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* post-signup: confirmation-required panel */}
        {postSignup && (
          <>
            <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, margin: '0 0 8px' }}>
              We sent a confirmation email to <strong style={{ color: T.ink }}>{email}</strong>.
              Open it on any device and tap the link to activate your account.
            </p>
            <p style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.55, margin: '0 0 16px' }}>
              After confirming, come back here and sign in with your email and password.
            </p>
            <PrimaryButton onClick={onClose}>Close</PrimaryButton>
          </>
        )}

        {/* reset-sent panel */}
        {!postSignup && mode === 'sent' && (
          <>
            <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, margin: '0 0 8px' }}>
              We sent a reset link to <strong style={{ color: T.ink }}>{email}</strong>.
            </p>
            <p style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.55, margin: '0 0 16px' }}>
              Open it on any device — Safari on your phone works — set a new password, then come back here to sign in.
            </p>
            <PrimaryButton onClick={onClose}>Close</PrimaryButton>
          </>
        )}

        {/* signin / signup / forgot form */}
        {!postSignup && mode !== 'sent' && (
          <>
            <SectionLabel style={{ marginBottom: 6 }}>Email</SectionLabel>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="you@example.com"
              autoComplete="email"
              style={inputWithErr(fieldErrors.email)}
            />
            {fieldErrors.email && <div style={{ fontSize: 11, color: T.closed, marginTop: 4 }}>{fieldErrors.email}</div>}

            {mode !== 'forgot' && (
              <>
                <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Password</SectionLabel>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  style={inputWithErr(fieldErrors.password)}
                />
                {fieldErrors.password && <div style={{ fontSize: 11, color: T.closed, marginTop: 4 }}>{fieldErrors.password}</div>}
              </>
            )}

            {mode === 'signup' && (
              <>
                <SectionLabel style={{ marginTop: 12, marginBottom: 6 }}>Confirm password</SectionLabel>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                  autoComplete="new-password"
                  style={inputWithErr(fieldErrors.confirmPw)}
                />
                {fieldErrors.confirmPw && <div style={{ fontSize: 11, color: T.closed, marginTop: 4 }}>{fieldErrors.confirmPw}</div>}
              </>
            )}

            <div style={{ marginTop: 16 }}>
              <PrimaryButton onClick={submit} disabled={busy}>
                {busy ? 'Working…'
                  : mode === 'signin' ? 'Sign in'
                  : mode === 'signup' ? 'Create account'
                  : /* forgot */        'Send reset link'}
              </PrimaryButton>
            </div>

            {/* mode-switch links */}
            <div style={{ marginTop: 14, display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              {mode === 'signin' && (
                <>
                  <button onClick={() => switchMode('forgot')} style={linkBtnStyle}>Forgot password?</button>
                  <button onClick={() => switchMode('signup')} style={linkBtnStyle}>Create account</button>
                </>
              )}
              {mode === 'signup' && (
                <button onClick={() => switchMode('signin')} style={linkBtnStyle}>Have an account? Sign in</button>
              )}
              {mode === 'forgot' && (
                <button onClick={() => switchMode('signin')} style={linkBtnStyle}>Back to sign in</button>
              )}
            </div>
          </>
        )}

        {error && (
          <div role="alert" style={{ marginTop: 12, fontSize: 12, color: T.closed, lineHeight: 1.45 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const linkBtnStyle = {
  background: 'transparent', border: 'none', color: T.brass,
  fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 2px',
  textDecoration: 'underline',
};

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
   SHARE REPORT — visual quick-report card for a PB or a catch
   ============================================================ */
export function ShareReportModal({
  open, onClose,
  title, // header chip above the species name, e.g. "Personal Best" or "Catch Report"
  anglerName,
  species,
  photoUrl,           // string or null
  primary,            // { label, value } main metric
  secondary,          // { label, value } supporting metric, optional
  meta = [],          // [{ label, value }] — date, waters, etc.
  conditions = [],    // [{ label, value }] — sun, moon, weather
  notes,
  reportText,
  reportTitle,
  photoEntry,         // photo entry { thumb, src, path? } or legacy string; null if no photo
}) {
  const [status, setStatus] = useState(null);
  if (!open) return null;
  const displayName = (anglerName || '').trim() || 'Angler';
  const handleShare = async () => {
    setStatus('working');
    // Resolve the photo's bytes lazily — on native this reads the JPEG
    // off disk; on web it's a no-op (already a data URL).
    const photoDataUrl = photoEntry ? await photoAsDataUrl(photoEntry) : null;
    const r = await shareReport({ title: reportTitle || title, text: reportText, photoDataUrl });
    setStatus(r);
  };
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, padding: 0, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 8px' }}>
          <H1 size={18}>Share report</H1>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.inkMute, padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 16px 12px' }}>
          {/* The card — designed to look good as a screenshot */}
          <div style={{
            background: T.oceanDeep, color: T.parchment,
            border: `1.5px solid ${T.brass}`, borderRadius: 12,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 16px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: T.brass, fontWeight: 800, textTransform: 'uppercase' }}>
                {displayName}
              </div>
              <div style={{ fontSize: 10, letterSpacing: 1.5, color: '#B8C5CD', fontWeight: 600, marginTop: 2 }}>
                {title}
              </div>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, marginTop: 6, color: T.parchment, lineHeight: 1.2 }}>
                {species ? species.commonName : 'Unknown species'}
              </div>
              {species?.scientific && (
                <div style={{ fontStyle: 'italic', fontSize: 12, color: '#B8C5CD', marginTop: 2 }}>{species.scientific}</div>
              )}
            </div>

            {photoUrl && (
              <img src={photoUrl} alt="" style={{ width: '100%', display: 'block', maxHeight: 260, objectFit: 'cover' }} />
            )}

            <div style={{ padding: 14 }}>
              <div style={{ background: 'rgba(244, 227, 193, 0.1)', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 10, letterSpacing: 1.6, color: T.brass, fontWeight: 800, textTransform: 'uppercase' }}>
                  {primary?.label}
                </div>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 700, color: T.parchment, marginTop: 4, lineHeight: 1 }}>
                  {primary?.value || '—'}
                </div>
                {secondary?.value && (
                  <div style={{ fontSize: 12, color: '#B8C5CD', marginTop: 6 }}>
                    {secondary.label}: {secondary.value}
                  </div>
                )}
              </div>

              {meta.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {meta.map((m, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                      <span style={{ color: '#B8C5CD' }}>{m.label}</span>
                      <span style={{ color: T.parchment, fontWeight: 600, textAlign: 'right', maxWidth: '65%' }}>{m.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {conditions.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(244, 227, 193, 0.18)' }}>
                  <div style={{ fontSize: 10, letterSpacing: 1.5, color: T.brass, fontWeight: 800, textTransform: 'uppercase', marginBottom: 6 }}>
                    Conditions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {conditions.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
                        <span style={{ color: '#B8C5CD' }}>{c.label}</span>
                        <span style={{ color: T.parchment, fontWeight: 600, textAlign: 'right', maxWidth: '65%' }}>{c.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {notes && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(244, 227, 193, 0.18)', fontSize: 12, color: '#D8E0E4', lineHeight: 1.5, whiteSpace: 'pre-wrap', fontStyle: 'italic' }}>
                  "{notes}"
                </div>
              )}

              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(244, 227, 193, 0.18)', textAlign: 'center', fontSize: 10, letterSpacing: 1.8, color: T.brass, fontWeight: 800 }}>
                REELINTEL
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 10, lineHeight: 1.5, textAlign: 'center' }}>
            Tip: long-press the card to screenshot, or tap Share to send the summary{photoEntry ? ' with the photo' : ''}.
          </div>
        </div>

        <div style={{ padding: '10px 16px 14px', borderTop: `1px solid ${T.cardEdge}` }}>
          {status === 'copied' && (
            <div style={{ fontSize: 12, color: T.brassDeep, marginBottom: 8, textAlign: 'center' }}>
              Copied to clipboard — paste anywhere.
            </div>
          )}
          {status === 'failed' && (
            <div style={{ fontSize: 12, color: T.closed, marginBottom: 8, textAlign: 'center' }}>
              Couldn't share or copy. Take a screenshot instead.
            </div>
          )}
          <PrimaryButton onClick={handleShare}>
            <Share2 size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            {status === 'working' ? 'Working…' : 'Share…'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   LIGHTBOX — tap a species photo to enlarge full-screen, with
   prev/next navigation when multiple photos are passed in.
   Backward-compat: accepts `src` (single) or `photos` (array).
   ============================================================ */
export function LightboxModal({ src, photos, initialIndex = 0, alt, caption, onClose }) {
  const list = Array.isArray(photos) && photos.length > 0 ? photos : (src ? [src] : []);
  const [idx, setIdx] = useState(Math.max(0, Math.min(initialIndex, list.length - 1)));
  const total = list.length;
  const hasMany = total > 1;
  const prev = () => setIdx(i => (i - 1 + total) % total);
  const next = () => setIdx(i => (i + 1) % total);

  // Primary + fallback URL for the current slide. Same pattern as
  // PhotoImg in screens2.jsx: capacitor:// file URLs baked at save
  // time can go stale between installs; the inline thumb never does.
  const current = list[idx];
  const primary = photoDisplayUrl(current) || current;
  const [imgSrc, setImgSrc] = useState(primary);
  const fellBackRef = useRef(false);
  useEffect(() => {
    setImgSrc(primary);
    fellBackRef.current = false;
  }, [primary]);
  const onImgError = () => {
    if (fellBackRef.current) return;
    fellBackRef.current = true;
    const thumb = photoThumbUrl(current);
    if (thumb && thumb !== imgSrc) setImgSrc(thumb);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
      else if (hasMany && e.key === 'ArrowLeft') prev();
      else if (hasMany && e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, hasMany, total]);

  /* Pinch-to-zoom + pan handler.
     - One touch: swipe-to-navigate when scale === 1, pan when scale > 1.
     - Two touches: pinch — scale relative to initial distance, keep the
       midpoint of the two fingers anchored (feels natural on iOS).
     - Double-tap: toggle between 1× and 2.5× centered on tap point.
     - Slide index change resets zoom + translation. */
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  useEffect(() => { setScale(1); setTx(0); setTy(0); }, [idx]);

  const pointersRef = useRef(new Map()); // id → { x, y }
  const gestureRef  = useRef(null);      // { startDist, startScale, startTx, startTy, midX, midY }
  const swipeRef    = useRef(null);      // { x, y, t }
  const lastTapRef  = useRef(0);

  const onPointerDown = (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      // Double-tap detect + swipe seed
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        // Double-tap → toggle zoom
        setScale(s => s > 1 ? 1 : 2.5);
        setTx(0); setTy(0);
        lastTapRef.current = 0;
      } else {
        lastTapRef.current = now;
      }
      swipeRef.current = { x: e.clientX, y: e.clientY, t: Date.now(), startTx: tx, startTy: ty };
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      gestureRef.current = {
        startDist: Math.hypot(dx, dy),
        startScale: scale,
        startTx: tx, startTy: ty,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
    }
  };
  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && gestureRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y;
      const dist = Math.hypot(dx, dy);
      const g = gestureRef.current;
      const nextScale = Math.max(1, Math.min(4, g.startScale * (dist / g.startDist)));
      setScale(nextScale);
      // Anchor pan so the midpoint stays visually stable during the pinch.
      const nowMidX = (pts[0].x + pts[1].x) / 2;
      const nowMidY = (pts[0].y + pts[1].y) / 2;
      setTx(g.startTx + (nowMidX - g.midX));
      setTy(g.startTy + (nowMidY - g.midY));
    } else if (pointersRef.current.size === 1 && scale > 1 && swipeRef.current) {
      // Pan while zoomed.
      setTx(swipeRef.current.startTx + (e.clientX - swipeRef.current.x));
      setTy(swipeRef.current.startTy + (e.clientY - swipeRef.current.y));
    }
  };
  const onPointerUp = (e) => {
    const start = swipeRef.current;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    // Only run swipe-nav when NOT zoomed and this was a single-finger flick.
    if (pointersRef.current.size === 0 && scale === 1 && start && hasMany) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const dt = Date.now() - start.t;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && dt < 600) {
        if (dx > 0) prev(); else next();
      }
      swipeRef.current = null;
    }
  };
  const onPointerCancel = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
  };

  if (list.length === 0) return null;

  return (
    <div
      onClick={onClose}
      className="kyc-lightbox-enter"
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Enlarged photo'}
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
        background: 'rgba(3, 27, 51, 0.95)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, cursor: 'zoom-out',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <img
        src={imgSrc}
        alt={alt || ''}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onError={onImgError}
        draggable={false}
        style={{
          maxWidth: '100%',
          maxHeight: (caption || hasMany) ? '78vh' : '90vh',
          objectFit: 'contain', display: 'block',
          borderRadius: 8,
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transformOrigin: 'center center',
          transition: pointersRef.current.size === 0 ? 'transform 160ms ease' : 'none',
          touchAction: 'none',
          WebkitUserSelect: 'none', userSelect: 'none',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
      />

      {hasMany && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Previous photo"
            style={{
              position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)',
              width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(3, 27, 51, 0.75)', border: `1px solid ${T.cardEdge}`,
              color: T.parchment, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          ><ChevronLeft size={26} /></button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Next photo"
            style={{
              position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)',
              width: 44, height: 44, borderRadius: '50%',
              background: 'rgba(3, 27, 51, 0.75)', border: `1px solid ${T.cardEdge}`,
              color: T.parchment, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            }}
          ><ChevronRight size={26} /></button>
        </>
      )}

      {(caption || hasMany) && (
        <div style={{
          position: 'absolute', bottom: 20, left: 20, right: 20,
          textAlign: 'center', color: T.parchment,
          fontSize: 12, lineHeight: 1.4,
          textShadow: '0 1px 4px rgba(0,0,0,0.8)',
        }}>
          {hasMany && <span style={{ color: T.brass, fontWeight: 800, marginRight: 8 }}>{idx + 1} of {total}</span>}
          {caption && <span style={{ fontStyle: 'italic' }}>{caption}</span>}
        </div>
      )}

      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          // Sit fully below the status bar / Dynamic Island. env()
          // resolves to the safe-area inset on iOS + iPadOS WebViews
          // and falls back to 16 on browsers that don't expose it.
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'calc(env(safe-area-inset-right, 0px) + 16px)',
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(3, 27, 51, 0.85)', border: `1px solid ${T.cardEdge}`,
          color: T.parchment, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
          zIndex: 2,
        }}
      >
        <X size={24} />
      </button>
    </div>
  );
}

/* ============================================================
   ACCOUNT SETUP — name + email collected during onboarding
   ============================================================ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountSetupModal({ initialName = '', initialEmail = '', onSave, allowDismiss = false, onDismiss }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [touched, setTouched] = useState(false);
  const nameOk = name.trim().length >= 2;
  const emailOk = EMAIL_RE.test(email.trim());
  const canSave = nameOk && emailOk;
  const submit = () => {
    setTouched(true);
    if (!canSave) return;
    onSave({ name: name.trim(), email: email.trim() });
  };
  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <Anchor size={26} color={T.brass} style={{ margin: '0 auto 6px', display: 'block' }} />
          <H1 size={20}>Set up your angler profile</H1>
        </div>
        <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5, textAlign: 'center' }}>
          We use this to attach your catches and Personal Bests to you, and to keep you in the loop on ReelIntel updates. Your email stays private.
        </p>

        <SectionLabel style={{ marginBottom: 6 }}>Your name</SectionLabel>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Captain Bob"
          style={{ ...inputStyle, background: T.card, marginBottom: 4 }}
        />
        {touched && !nameOk && (
          <div style={{ fontSize: 11, color: T.closed, marginBottom: 8 }}>Name is required (at least 2 characters).</div>
        )}

        <SectionLabel style={{ marginTop: 10, marginBottom: 6 }}>Email</SectionLabel>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ ...inputStyle, background: T.card, marginBottom: 4 }}
        />
        {touched && !emailOk && (
          <div style={{ fontSize: 11, color: T.closed, marginBottom: 8 }}>Enter a valid email address.</div>
        )}

        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 10, lineHeight: 1.45 }}>
          Stored on this device for now. When ReelIntel cloud sync goes live, this email becomes the magic-link login for your account — no password to remember.
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {allowDismiss && (
            <GhostButton onClick={onDismiss} style={{ flex: 1 }}>Cancel</GhostButton>
          )}
          <PrimaryButton onClick={submit} disabled={!canSave} style={{ flex: allowDismiss ? 2 : 1 }}>
            Save &amp; continue
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STAR / FAVORITE TOGGLE
   ============================================================ */
export function StarButton({ favorited, onToggle, size = 22, ariaLabel }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-label={ariaLabel || (favorited ? 'Remove from favorites' : 'Add to favorites')}
      style={{
        background: 'transparent', border: 'none', padding: 4, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: favorited ? T.brass : T.inkMute,
      }}
    >
      <Star size={size} fill={favorited ? T.brass : 'transparent'} strokeWidth={favorited ? 1.5 : 2} />
    </button>
  );
}

/* ============================================================
   SHARED SPECIES ROW (used by category, search, list screens)
   ============================================================ */
export function SpeciesRow({ species, onClick, favorited, onToggleFavorite }) {
  return (
    <Card onClick={onClick} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12 }}>
      <div style={{ flexShrink: 0 }}><SpeciesImage species={species} size={50} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 600, color: T.ink }}>{species.commonName}</div>
        <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{species.scientific}</div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.3 }}>{species.keyIds[0]}</div>
      </div>
      {onToggleFavorite && (
        <StarButton favorited={!!favorited} onToggle={onToggleFavorite} />
      )}
    </Card>
  );
}

/* ============================================================
   FAVORITE PICKER — onboarding step + revisitable from Settings
   ============================================================ */
export function FavoritePickerModal({ favorites, onDone, onSkip, allowSkip = true, title = 'Star your common catches' }) {
  const [picked, setPicked] = useState(() => new Set(favorites || []));
  const [q, setQ] = useState('');
  const toggle = (id) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const filteredByCategory = useMemo(() => {
    const lower = q.toLowerCase().trim();
    const matches = SPECIES.filter(s => (s.active !== false) && (!lower
      || s.commonName.toLowerCase().includes(lower)
      || s.altNames.some(a => a.toLowerCase().includes(lower))));
    const buckets = new Map();
    for (const s of matches) {
      if (!buckets.has(s.category)) buckets.set(s.category, []);
      buckets.get(s.category).push(s);
    }
    return CATEGORIES
      .filter(c => buckets.has(c.id))
      .map(c => ({ cat: c, list: buckets.get(c.id).sort((a, b) => a.commonName.localeCompare(b.commonName)) }));
  }, [q]);
  return (
    <div style={overlayStyle}>
      <div style={{ ...modalStyle, maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <H1 size={20}>{title}</H1>
          <div style={{ fontSize: 11, color: T.brass, fontWeight: 700, letterSpacing: 1 }}>{picked.size} STARRED</div>
        </div>
        <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 12px', lineHeight: 1.5 }}>
          Tap the species you target most. They'll pin to the top of every list so they're one tap away.
        </p>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
        </div>
        <div style={{ overflowY: 'auto', flex: 1, paddingRight: 2, marginBottom: 12 }}>
          {filteredByCategory.length === 0 && (
            <div style={{ fontSize: 13, color: T.inkMute, padding: 12, textAlign: 'center' }}>No matches.</div>
          )}
          {filteredByCategory.map(({ cat, list }) => (
            <div key={cat.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '6px 4px 4px' }}>
                {cat.name}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.map(s => {
                  const on = picked.has(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggle(s.id)} style={{
                      background: on ? T.parchmentDeep : T.card,
                      border: `1.5px solid ${on ? T.brass : T.cardEdge}`,
                      borderRadius: 6, padding: '8px 10px', cursor: 'pointer', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <SpeciesImage species={s} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, fontFamily: 'Georgia, serif' }}>{s.commonName}</div>
                        <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{s.scientific}</div>
                      </div>
                      <Star size={20} fill={on ? T.brass : 'transparent'} color={on ? T.brass : T.inkMute} strokeWidth={on ? 1.5 : 2} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {allowSkip && (
            <button onClick={onSkip} style={{
              flex: 1, background: 'transparent', color: T.inkSoft,
              border: `1.5px solid ${T.cardEdge}`, padding: '12px', borderRadius: 6,
              fontSize: 13, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer',
            }}>Skip for now</button>
          )}
          <PrimaryButton style={{ flex: 1 }} onClick={() => onDone(Array.from(picked))}>
            {picked.size === 0 ? 'Done' : `Save ${picked.size} favorite${picked.size === 1 ? '' : 's'}`}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   BIG HOME-STYLE BUTTON
   ============================================================ */
export function BigButton({ icon, title, subtitle, onClick, accent = T.brass, isTablet = false }) {
  return (
    <button onClick={onClick} style={{
      background: T.card, border: `1.5px solid ${T.cardEdge}`, borderLeft: `4px solid ${accent}`, borderRadius: 4,
      padding: isTablet ? '22px 20px' : '16px 14px',
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: isTablet ? 18 : 14,
      width: '100%', textAlign: 'left',
      boxShadow: '0 1px 0 rgba(124, 86, 24, 0.06)',
    }}>
      <div style={{
        background: T.parchmentDeep, color: T.brass,
        padding: isTablet ? 14 : 10, borderRadius: 4, flexShrink: 0,
      }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 22 : 17, fontWeight: 600, color: T.ink }}>{title}</div>
        <div style={{ fontSize: isTablet ? 15 : 12, color: T.inkMute, marginTop: isTablet ? 4 : 2 }}>{subtitle}</div>
      </div>
    </button>
  );
}
