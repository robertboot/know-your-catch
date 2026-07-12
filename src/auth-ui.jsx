/* Auth UI — magic-link email flow surfaces.

   Three pieces:
    - useSession()      — hook returning the current Supabase session
                          (or null). Backs the live-subscription safety
                          net in AccountSection so the render can never
                          latch onto a stale prop.
    - AccountSection    — the Settings top card. Signed-in ONLY — email,
                          sync status, Sync now, Sign out. There is no
                          signed-out branch because the app-wide session
                          gate in App.jsx guarantees callers are signed
                          in before Settings can render.
    - SyncPill          — small ☁/↻/⚠ header pill on non-home routes

   Sign in with Apple was removed in build 19 — AuthenticationServices
   error 1000 on device and heavier config surface than magic link.
   See docs/DEFERRED.md. */
import React, { useEffect, useState } from 'react';
import { LogOut, RefreshCcw } from 'lucide-react';
import { T } from './theme.js';
import { Card, GhostButton, SectionLabel } from './components.jsx';
import { subscribe, getLastSession, signOut } from './auth.js';

/** Small hook: returns the current Supabase session (or null). */
export function useSession() {
  const [session, setSession] = useState(getLastSession());
  useEffect(() => subscribe(setSession), []);
  return session;
}

/** Account card at the top of Settings. Assumes an active session —
    Settings is unreachable without one. Renders email + sync status +
    Sync now + Sign out. Subscribes directly to the auth store as a
    safety net so a stale `session` prop can't hold a stale render. */
export function AccountSection({ session: sessionFromProp, syncStatus, lastSyncedAt, onForceSync }) {
  // Live-subscribe as belt-and-suspenders against a stale prop.
  // subscribe() fires with the current session immediately then again
  // on every state change, so this is always fresh.
  const liveSession = useSession();
  const session = liveSession || sessionFromProp;

  const [signingOut, setSigningOut] = useState(false);
  const doSignOut = async () => {
    if (!window.confirm('Sign out? Your local catches stay on this device; sync stops until you sign back in. You’ll need to sign in again to use the app.')) return;
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };
  const lastSyncStr = lastSyncedAt
    ? `${Math.max(1, Math.round((Date.now() - lastSyncedAt) / 60000))} min ago`
    : 'not yet';
  const statusLabel = syncStatus === 'syncing' ? '↻ Syncing' : syncStatus === 'offline' ? '⚠ Offline' : '☁ Synced';
  const statusColor = syncStatus === 'offline' ? T.warn : syncStatus === 'syncing' ? T.brass : T.open;

  // Defensive fallback. The app-wide session guard in App.jsx should
  // make this unreachable — if it fires, we surface it loudly rather
  // than silently showing a stale "Sign in" affordance.
  if (!session) {
    console.warn('[AccountSection] rendered without a session — App.jsx session gate should have shown the splash instead');
    return null;
  }

  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionLabel style={{ marginBottom: 8 }}>Account</SectionLabel>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 2 }}>Signed in as</div>
      <div style={{ fontSize: 15, color: T.ink, fontWeight: 700, wordBreak: 'break-all' }}>
        {session.user?.email || 'Signed in'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: statusColor, marginTop: 6 }}>
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
    </Card>
  );
}

/** Small pill indicating sync status. Shown in the header on non-
    home routes. Signed-in users get real 'syncing / offline / synced'
    status; signed-out users get an honest 'Not signed in' affordance
    that opens the sign-in modal on tap. Never imply cloud backup
    that isn't actually happening. */
export function SyncPill({ status, onClick }) {
  const isSignedOut = status === 'signed_out';
  const isSyncing   = status === 'syncing';
  const isOffline   = status === 'offline';
  const label = isSignedOut
    ? 'Not signed in'
    : isSyncing ? '↻ Syncing'
    : isOffline ? '⚠ Offline'
    : '☁ Synced';
  const color   = isSignedOut ? T.brass : isOffline ? T.warn  : isSyncing ? T.brass : T.inkMute;
  const border  = isSignedOut ? T.brass : isOffline ? T.warn  : isSyncing ? T.brass : T.cardEdge;
  return (
    <button
      onClick={onClick}
      aria-label={isSignedOut ? 'Sign in to back up + sync' : `Sync status: ${label}`}
      title={isSignedOut ? 'Saved on this device only. Tap to sign in.' : undefined}
      style={{
        background: 'transparent', border: `1px solid ${border}`,
        color, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
        padding: '3px 8px', borderRadius: 999, cursor: onClick ? 'pointer' : 'default',
        display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
    >{label}</button>
  );
}
