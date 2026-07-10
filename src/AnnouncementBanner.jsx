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

  return (
    <div
      role="region"
      aria-label="Announcement"
      style={{
        marginTop: 12, padding: '10px 12px',
        background: 'linear-gradient(90deg, rgba(25, 212, 242, 0.14), rgba(25, 212, 242, 0.06))',
        border: `1px solid ${T.brass}`,
        borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.ink, letterSpacing: 0.2 }}>
          {visible.title}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2, lineHeight: 1.35 }}>
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
            whiteSpace: 'nowrap',
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
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: T.inkSoft, padding: 4, display: 'flex',
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
