/* Auth UI — magic-link email flow surfaces.

   Two pieces:
    - useSession()      — hook for any component that needs the current
                          Supabase session (or null)
    - AccountSection    — the Settings top card. Signed-out shows a
                          "Sign in with email" primary button; signed-in
                          shows email, sync status, Sync now, Sign out.
    - SyncPill          — small ☁/↻/⚠ header pill on non-home routes

   Sign in with Apple was removed in build 19 — it produced
   AuthenticationServices error 1000 on device and the config surface
   was heavier than a magic link. See docs/DEFERRED.md for the future
   swap. */
import React, { useEffect, useState } from 'react';
import { LogIn, Cloud, LogOut, RefreshCcw } from 'lucide-react';
import { T } from './theme.js';
import { Card, PrimaryButton, GhostButton, SectionLabel, SignInModal } from './components.jsx';
import { subscribe, getLastSession, sendMagicLink, signOut } from './auth.js';

/** Small hook: returns the current Supabase session (or null). */
export function useSession() {
  const [session, setSession] = useState(getLastSession());
  useEffect(() => subscribe(setSession), []);
  return session;
}

/** Account card at the top of Settings. Owns the SignInModal open/close.
    Signed-out and signed-in states share the surface — no separate
    "Cloud Sync" card. Auth IS the sync switch. */
export function AccountSection({ session, syncStatus, lastSyncedAt, onForceSync, initialEmail }) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const doSignOut = async () => {
    if (!window.confirm('Sign out? Your local catches stay on this device; sync stops until you sign back in.')) return;
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };
  const lastSyncStr = lastSyncedAt
    ? `${Math.max(1, Math.round((Date.now() - lastSyncedAt) / 60000))} min ago`
    : 'not yet';
  const statusLabel = syncStatus === 'syncing' ? '↻ Syncing' : syncStatus === 'offline' ? '⚠ Offline' : '☁ Synced';
  const statusColor = syncStatus === 'offline' ? T.warn : syncStatus === 'syncing' ? T.brass : T.open;

  return (
    <>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Account</SectionLabel>
        {session ? (
          <>
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 700, wordBreak: 'break-all' }}>
              {session.user?.email || 'Signed in'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: statusColor, marginTop: 4 }}>
              <span>{statusLabel}</span>
              <span style={{ color: T.inkMute }}>· Last sync: {lastSyncStr}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {onForceSync && (
                <GhostButton onClick={onForceSync} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', fontSize: 12 }}>
                  <RefreshCcw size={14} /> Sync now
                </GhostButton>
              )}
              <GhostButton onClick={doSignOut} disabled={signingOut}
                style={{ flex: 1, color: T.closed, borderColor: T.closed, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 12px', fontSize: 12 }}>
                <LogOut size={14} /> Sign out
              </GhostButton>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, color: T.ink, fontWeight: 700, marginBottom: 4 }}>
              Sign in to sync across devices
            </div>
            <p style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.55, margin: '0 0 12px' }}>
              Your log, backed up automatically, on iPhone and iPad.
            </p>
            <PrimaryButton onClick={() => setShowSignIn(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <LogIn size={16} /> Sign in with email
            </PrimaryButton>
          </>
        )}
      </Card>

      {showSignIn && (
        <SignInModal
          initialEmail={initialEmail || ''}
          onClose={() => setShowSignIn(false)}
          onSendLink={sendMagicLink}
        />
      )}
    </>
  );
}

/** Small pill indicating sync status. Shown in the header on non-
    home routes when signed in. */
export function SyncPill({ status, onClick }) {
  const isSyncing = status === 'syncing';
  const isOffline = status === 'offline';
  const label   = isSyncing ? '↻ Syncing' : isOffline ? '⚠ Offline' : '☁ Synced';
  const color   = isOffline ? T.warn : isSyncing ? T.brass : T.inkMute;
  const border  = isOffline ? T.warn : isSyncing ? T.brass : T.cardEdge;
  return (
    <button onClick={onClick} aria-label={`Sync status: ${label}`} style={{
      background: 'transparent', border: `1px solid ${border}`,
      color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
      padding: '3px 8px', borderRadius: 999, cursor: onClick ? 'pointer' : 'default',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>{label}</button>
  );
}

/** Signed-out promo shown at the top of Logbook / PBs, unchanged
    from prior builds — signals cross-device sync without blocking
    the local experience. Kept as a small inline component so screens
    don't need to import SignInModal separately. */
export function SignInPrompt({ context = 'catches', initialEmail }) {
  const [open, setOpen] = useState(false);
  const copy = context === 'pbs'
    ? 'Sign in to sync your personal bests across devices.'
    : 'Sign in to sync your catches across devices.';
  return (
    <>
      <Card style={{ marginBottom: 12, background: 'linear-gradient(135deg, rgba(25,212,242,0.08), transparent)', borderColor: T.brass }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <Cloud size={22} color={T.brass} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{copy}</div>
            <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
              Log on your iPhone. Open the app on iPad. Same catches, same PBs.
            </div>
          </div>
        </div>
        <PrimaryButton onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <LogIn size={16} /> Sign in with email
        </PrimaryButton>
      </Card>
      {open && (
        <SignInModal
          initialEmail={initialEmail || ''}
          onClose={() => setOpen(false)}
          onSendLink={sendMagicLink}
        />
      )}
    </>
  );
}
