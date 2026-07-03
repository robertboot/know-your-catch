/* Sign-in UI — an inline prompt shown at the top of Logbook / PBs
   when the user is signed out, plus a dedicated Sign-In button used
   from Settings.

   Signed-out state keeps local-only functionality intact so existing
   testers with catches in localStorage don't lose access. Sync is
   strictly opt-in via signing in. */
import React, { useEffect, useState } from 'react';
import { Cloud, ChevronRight, LogIn } from 'lucide-react';
import { T } from './theme.js';
import { Card, PrimaryButton, GhostButton, SectionLabel } from './components.jsx';
import { signInWithApple, signOut, subscribe, getLastSession } from './auth.js';

/** Small hook: returns the current Supabase session (or null). */
export function useSession() {
  const [session, setSession] = useState(getLastSession());
  useEffect(() => subscribe(setSession), []);
  return session;
}

/** Renders a "Sign in with Apple" button. Uses the Apple system font
    for the wordmark to match Apple's HIG. */
export function AppleSignInButton({ onDone, style }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const click = async () => {
    setBusy(true); setErr('');
    try {
      await signInWithApple();
      onDone && onDone();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={style}>
      <button onClick={click} disabled={busy} style={{
        width: '100%', background: '#000', color: '#fff', border: 'none',
        padding: '12px 16px', borderRadius: 8, fontSize: 15, fontWeight: 600,
        cursor: busy ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: '-apple-system, "SF Pro Text", "SF Pro Icons", "Helvetica Neue", sans-serif',
      }}>
        <span style={{ fontSize: 18, lineHeight: 1, marginTop: -2 }}></span>
        {busy ? 'Signing in…' : 'Sign in with Apple'}
      </button>
      {err && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.closed, lineHeight: 1.4 }}>{err}</div>}
    </div>
  );
}

/** Banner shown at the top of Logbook / PBs when the user is signed
    out. Encourages sign-in to unlock sync without blocking the local
    experience. */
export function SignInPrompt({ context = 'catches' }) {
  const copy = context === 'pbs'
    ? 'Sign in to sync your personal bests across devices.'
    : 'Sign in to sync your catches across devices.';
  return (
    <Card style={{ marginBottom: 12, background: 'linear-gradient(135deg, rgba(25,212,242,0.08), transparent)', borderColor: T.brass }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <Cloud size={22} color={T.brass} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>{copy}</div>
          <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
            Log on your iPhone. Open the app on iPad. Same catches, same PBs. Your data stays yours — we just make it portable.
          </div>
        </div>
      </div>
      <AppleSignInButton />
    </Card>
  );
}

/** Settings card: current session + Sign In / Sign Out. */
export function AccountCloudCard({ session, syncStatus, lastSyncedAt, onForceSync }) {
  const [busy, setBusy] = useState(false);
  const doSignOut = async () => {
    if (!window.confirm('Sign out? Your catches stay on this device but stop syncing until you sign back in.')) return;
    setBusy(true);
    try { await signOut(); } finally { setBusy(false); }
  };
  const lastSyncStr = lastSyncedAt
    ? `${Math.max(1, Math.round((Date.now() - lastSyncedAt) / 60000))} min ago`
    : 'not yet';
  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionLabel style={{ marginBottom: 6 }}>Cloud sync</SectionLabel>
      {session ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: T.ink, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.user?.email || 'Signed in'}
              </div>
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                Status: {syncStatus} · Last sync: {lastSyncStr}
              </div>
            </div>
            <GhostButton onClick={doSignOut} disabled={busy} style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}>
              Sign out
            </GhostButton>
          </div>
          {onForceSync && (
            <GhostButton onClick={onForceSync} style={{ width: '100%', padding: '8px 12px', fontSize: 12 }}>
              Sync now
            </GhostButton>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
            Sign in to sync your catches, personal bests, and photos across devices.
          </p>
          <AppleSignInButton />
        </>
      )}
    </Card>
  );
}

/** Small pill indicating sync status. Shown in the header on non-
    home routes when signed in. Muted when idle/synced, brass while
    syncing, amber when queued/offline. */
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
