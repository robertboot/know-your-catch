/* AnnouncementBanner — top-of-Home evergreen banner.

   Fetches active announcements on mount, filters out those the
   user has already dismissed (localStorage per device), and
   renders the first surviving row as a dismissible strip. Only one
   at a time so we don't take over Home. */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { T } from './theme.js';
import { subscribe, getLastSession } from './auth.js';
import {
  listActiveAnnouncements, loadDismissedIds, markDismissed,
} from './announcements-store.js';

export default function AnnouncementBanner() {
  const [session, setSession] = useState(getLastSession());
  const [rows, setRows]       = useState([]);
  const [dismissed, setDismissed] = useState(() => loadDismissedIds());

  useEffect(() => subscribe(setSession), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await listActiveAnnouncements(session);
      if (alive && r.ok) setRows(r.rows);
    })();
    return () => { alive = false; };
  }, [session]);

  const visible = rows.find(r => !dismissed.has(r.id));
  if (!visible) return null;

  const dismiss = () => {
    markDismissed(visible.id);
    setDismissed(new Set(dismissed).add(visible.id));
  };

  const openCta = () => {
    if (!visible.cta_url) return;
    window.open(visible.cta_url, '_blank', 'noopener,noreferrer');
  };

  // Absolute-positioned X in the top-right so long titles/bodies
  // wrap under it without shifting horizontally.
  const dismissBtnSize = 22;
  const dismissReserve = visible.dismissible ? dismissBtnSize + 8 : 0;

  return (
    <div
      role="region"
      aria-label="Announcement"
      style={{
        position: 'relative',
        boxSizing: 'border-box', width: '100%',
        marginTop: 12,
        padding: '10px 12px',
        background: 'linear-gradient(90deg, rgba(25, 212, 242, 0.14), rgba(25, 212, 242, 0.06))',
        border: `1px solid ${T.brass}`,
        borderRadius: 10,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, paddingRight: dismissReserve }}>
        <div style={{
          fontSize: 12, fontWeight: 800, color: T.ink, letterSpacing: 0.2,
          wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal',
        }}>
          {visible.title}
        </div>
        <div style={{
          fontSize: 12, color: T.inkSoft, marginTop: 2, lineHeight: 1.35,
          wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal',
        }}>
          {visible.body}
        </div>
      </div>
      {visible.cta_url && (
        <button
          onClick={openCta}
          style={{
            background: T.brass, color: T.oceanDeep, border: 'none',
            padding: '7px 12px', borderRadius: 6,
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0,
            marginTop: 2,
          }}
        >
          {visible.cta_label || 'Open'}
        </button>
      )}
      {visible.dismissible && (
        <button
          onClick={dismiss}
          aria-label="Dismiss announcement"
          style={{
            position: 'absolute', top: 6, right: 6,
            width: dismissBtnSize, height: dismissBtnSize,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.inkSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
