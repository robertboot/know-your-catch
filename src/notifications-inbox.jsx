/* Notifications inbox drawer + hook.

   Behaves as the in-app inbox. Combines:
     - Active announcements (from public.announcements)
     - Launch emails sent to me (from public.feature_notifications
       where notified_at is not null)
   Dismissed items — keyed off the same kyc_dismissed_announcements
   localStorage set used by the top-of-Home banner — sink into a
   "Cleared" section below with lighter styling.

   The bell badge is the count of active + not-dismissed items. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Bell, Mail, Megaphone, ShieldAlert } from 'lucide-react';
import { T } from './theme.js';
import { getLastSession, subscribe } from './auth.js';
import { useScreenSize } from './screen-size.js';
import {
  listActiveAnnouncements, listMyLaunchEmails,
  loadDismissedIds, markDismissed, markManyDismissed,
} from './announcements-store.js';
import { listRegulationAlerts } from './regulation-alerts-store.js';
import { speciesById, jurisdictionById } from './helpers.js';

const POLL_INTERVAL_MS = 60_000;

/* Feature-slug → human label for the launch-email row title. */
const FEATURE_LABELS = {
  fish_id: 'Fish ID',
};
function labelForFeature(slug) {
  return FEATURE_LABELS[slug] || slug.replace(/_/g, ' ');
}

/* Shared hook powering both the bell badge and the drawer.
   Fetches on mount + on window focus + on a slow poll so the badge
   ticks up without a full page reload. */
export function useAnnouncementInbox() {
  const [session,      setSession]     = useState(getLastSession());
  const [announcements, setAnnouncements] = useState([]);
  const [launchEmails,  setLaunchEmails]  = useState([]);
  const [regAlerts,     setRegAlerts]     = useState([]);
  const [dismissed,     setDismissedIds]  = useState(() => loadDismissedIds());

  useEffect(() => subscribe(setSession), []);

  const refresh = useCallback(async () => {
    const [ann, mail, reg] = await Promise.all([
      listActiveAnnouncements(session),
      session ? listMyLaunchEmails() : Promise.resolve({ ok: true, rows: [] }),
      session ? listRegulationAlerts() : Promise.resolve({ ok: true, rows: [] }),
    ]);
    if (ann.ok)  setAnnouncements(ann.rows);
    if (mail.ok) setLaunchEmails(mail.rows);
    if (reg.ok)  setRegAlerts(reg.rows);
  }, [session]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [refresh]);

  // Reload dismissed IDs from LS on every refresh — the Home banner
  // may have dismissed a row before the drawer opened.
  useEffect(() => {
    setDismissedIds(loadDismissedIds());
  }, [announcements, launchEmails, regAlerts]);

  const items = useMemo(() => {
    const out = [];
    for (const a of announcements) {
      out.push({
        id: `announcement:${a.id}`,
        dismissKey: a.id,
        kind: 'announcement',
        title: a.title,
        body: a.body,
        stamp: a.created_at,
        source: 'System',
      });
    }
    for (const m of launchEmails) {
      out.push({
        id: `launch:${m.id}`,
        dismissKey: `launch:${m.id}`,
        kind: 'launch',
        title: `${labelForFeature(m.feature)} — you were emailed`,
        body: `We emailed you about the ${labelForFeature(m.feature)} launch.`,
        stamp: m.notified_at,
        source: 'ReelIntel launch',
      });
    }
    for (const a of regAlerts) {
      const sp = speciesById(a.species_id);
      const jur = jurisdictionById(a.jurisdiction);
      const spName = sp?.commonName || a.species_id;
      const jurName = jur?.name || a.jurisdiction;
      out.push({
        id: `reg:${a.id}`,
        dismissKey: `reg:${a.id}`,
        kind: 'reg_alert',
        title: `Regulation update — ${spName}`,
        body: `${jurName}: ${a.summary}`,
        stamp: a.created_at,
        source: 'Regulation change',
      });
    }
    return out.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
  }, [announcements, launchEmails, regAlerts]);

  const active   = items.filter(i => !dismissed.has(i.dismissKey));
  const cleared  = items.filter(i =>  dismissed.has(i.dismissKey));
  const unreadCount = active.length;

  const dismiss = (dismissKey) => {
    markDismissed(dismissKey);
    setDismissedIds(new Set(dismissed).add(dismissKey));
  };

  const dismissAll = () => {
    const keys = active.map(i => i.dismissKey);
    if (keys.length === 0) return;
    markManyDismissed(keys);
    const next = new Set(dismissed);
    for (const k of keys) next.add(k);
    setDismissedIds(next);
  };

  return { unreadCount, active, cleared, refresh, dismiss, dismissAll };
}

/* Modal drawer — full-screen on phone, centered card on wider
   viewports. Renders on top via a fixed overlay + inner card. */
export default function NotificationsDrawer({ open, onClose }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const { active, cleared, dismiss, dismissAll } = useAnnouncementInbox();
  if (!open) return null;

  const drawerMaxWidth  = isTablet ? 620 : 640;
  const headerPad       = isTablet ? '18px 22px' : '14px 16px';
  const headerTitleSize = isTablet ? 19 : 15;
  const bellSize        = isTablet ? 22 : 18;
  const dismissAllPad   = isTablet ? '8px 14px' : '6px 10px';
  const dismissAllSize  = isTablet ? 14 : 12;
  const closeIcon       = isTablet ? 24 : 20;
  const bodyPad         = isTablet ? 16 : 12;
  const rowGap          = isTablet ? 10 : 8;
  const clearedGap      = isTablet ? 8 : 6;
  const emptySize       = isTablet ? 15 : 13;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: isTablet ? 'center' : 'flex-end',
        justifyContent: 'center', padding: isTablet ? 24 : 0,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.card,
          border: isTablet ? `1px solid ${T.cardEdge}` : undefined,
          borderTop: isTablet ? undefined : `1px solid ${T.cardEdge}`,
          borderRadius: isTablet ? 16 : undefined,
          borderTopLeftRadius: isTablet ? 16 : 14,
          borderTopRightRadius: isTablet ? 16 : 14,
          width: '100%', maxWidth: drawerMaxWidth,
          maxHeight: isTablet ? '80vh' : '80vh',
          display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: headerPad, borderBottom: `1px solid ${T.cardEdge}`,
          flexShrink: 0,
        }}>
          <Bell size={bellSize} color={T.brass} />
          <div style={{ flex: 1, fontSize: headerTitleSize, fontWeight: 800, color: T.ink }}>
            Notifications
          </div>
          {active.length > 0 && (
            <button
              onClick={dismissAll}
              style={{
                background: 'transparent', border: `1px solid ${T.cardEdge}`,
                color: T.inkSoft, borderRadius: 6,
                padding: dismissAllPad, fontSize: dismissAllSize, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Dismiss all
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close notifications"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.inkSoft, padding: 4, display: 'flex',
            }}
          >
            <X size={closeIcon} />
          </button>
        </div>

        <div style={{ padding: bodyPad, overflowY: 'auto' }}>
          {active.length === 0 && cleared.length === 0 && (
            <div style={{
              textAlign: 'center', color: T.inkMute, fontSize: emptySize,
              padding: '30px 20px', lineHeight: 1.5,
            }}>
              No new notifications — you'll see feature launches and regs updates here.
            </div>
          )}

          {active.length > 0 && (
            <div style={{ display: 'grid', gap: rowGap, marginBottom: 12 }}>
              {active.map(item => (
                <InboxRow key={item.id} item={item} onDismiss={() => dismiss(item.dismissKey)} isTablet={isTablet} />
              ))}
            </div>
          )}

          {cleared.length > 0 && (
            <>
              <div style={{
                fontSize: isTablet ? 12 : 10, fontWeight: 800, color: T.inkMute,
                letterSpacing: 1, textTransform: 'uppercase',
                marginBottom: 6, padding: '0 4px',
              }}>
                Cleared
              </div>
              <div style={{ display: 'grid', gap: clearedGap }}>
                {cleared.map(item => (
                  <InboxRow key={item.id} item={item} cleared isTablet={isTablet} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InboxRow({ item, onDismiss, cleared, isTablet = false }) {
  const Icon =
    item.kind === 'launch'    ? Mail
  : item.kind === 'reg_alert' ? ShieldAlert
  :                             Megaphone;
  const stampDisplay = item.stamp
    ? new Date(item.stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: isTablet ? 14 : 10,
      padding: isTablet ? '14px 16px' : '10px 12px',
      background: cleared ? 'transparent' : T.parchmentDeep,
      border: `1px solid ${cleared ? 'transparent' : T.cardEdge}`,
      borderRadius: 8,
      opacity: cleared ? 0.55 : 1,
      boxSizing: 'border-box',
    }}>
      <Icon size={isTablet ? 20 : 16} color={cleared ? T.inkMute : T.brass} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: isTablet ? 16 : 13, fontWeight: 700, color: T.ink,
          wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {item.title}
        </div>
        <div style={{
          fontSize: isTablet ? 14 : 12, color: T.inkSoft, marginTop: isTablet ? 4 : 2,
          lineHeight: 1.4,
          wordBreak: 'break-word', overflowWrap: 'anywhere',
        }}>
          {item.body}
        </div>
        <div style={{ fontSize: isTablet ? 12 : 10, color: T.inkMute, marginTop: isTablet ? 6 : 4 }}>
          {item.source}{stampDisplay ? ` · ${stampDisplay}` : ''}
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.inkSoft, padding: isTablet ? 8 : 4, display: 'flex', flexShrink: 0,
          }}
        >
          <X size={isTablet ? 18 : 14} />
        </button>
      )}
    </div>
  );
}
