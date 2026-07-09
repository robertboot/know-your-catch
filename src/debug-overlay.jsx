/* Debug overlay — 60px strip at the very top of the app, above
   everything else. Shows the latest dlog line; tap to expand into
   a scrollable full-history view; tap X or the "Copy" button in the
   expanded view. Diagnostic-only; remove once auth is verified. */
import React, { useEffect, useState } from 'react';
import { subscribeDlog, getDlog, clearDlog } from './debug-log.js';

export function DebugOverlay() {
  const [entries, setEntries] = useState(getDlog);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeDlog(() => setEntries(getDlog())), []);

  const latest = entries[entries.length - 1];
  // Collapsed: sits above the notch. Total height = safe-area + ~44px
  // of visible text region (two lines of 11px monospace at 1.4 line-
  // height fit comfortably). Dropping the fixed maxHeight — previous
  // build clipped the text under the notch on iPhones.
  const collapsedBar = {
    position: 'fixed', top: 0, left: 0, right: 0,
    zIndex: 9999,
    background: '#000',
    color: '#00ff88',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 11, lineHeight: 1.4,
    padding: '6px 10px 8px',
    paddingTop: 'calc(env(safe-area-inset-top) + 6px)',
    overflow: 'hidden',
    borderBottom: '1px solid #00ff88',
    cursor: 'pointer', touchAction: 'manipulation',
  };

  const expandedBar = {
    ...collapsedBar,
    minHeight: 'auto', maxHeight: '70vh',
    whiteSpace: 'normal', overflow: 'auto',
  };

  const doCopy = async (e) => {
    e.stopPropagation();
    const text = entries.map(en => `${en.t}  ${en.msg}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* no clipboard on some webviews */ }
  };

  const doClear = (e) => {
    e.stopPropagation();
    clearDlog();
  };

  if (!expanded) {
    return (
      <div style={collapsedBar} onClick={() => setExpanded(true)}>
        <div style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
          ▸ DEBUG {entries.length ? `(${entries.length})` : ''} — tap to expand
        </div>
        <div style={{
          opacity: 0.9,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {latest ? `${latest.t}  ${latest.msg}` : 'waiting for events…'}
        </div>
      </div>
    );
  }

  return (
    <div style={expandedBar}>
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6,
        position: 'sticky', top: 0, background: '#000', paddingBottom: 4,
        borderBottom: '1px dashed #00ff88',
      }}>
        <div style={{ fontWeight: 800, flex: 1 }}>DEBUG ({entries.length})</div>
        <button onClick={doCopy} style={{
          background: 'transparent', border: '1px solid #00ff88', color: '#00ff88',
          padding: '2px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
        }}>{copied ? 'copied' : 'copy'}</button>
        <button onClick={doClear} style={{
          background: 'transparent', border: '1px solid #00ff88', color: '#00ff88',
          padding: '2px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
        }}>clear</button>
        <button onClick={() => setExpanded(false)} style={{
          background: 'transparent', border: '1px solid #00ff88', color: '#00ff88',
          padding: '2px 8px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
        }}>×</button>
      </div>
      {entries.length === 0 && <div style={{ opacity: 0.6 }}>no events yet</div>}
      {entries.map((en, i) => (
        <div key={i} style={{ marginBottom: 2 }}>
          <span style={{ opacity: 0.6 }}>{en.t}</span>{' '}
          <span>{en.msg}</span>
        </div>
      ))}
    </div>
  );
}
