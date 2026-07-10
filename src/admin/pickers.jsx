/* Shared admin pickers.

   Extracted from TrainingTab so TestImagePanel can reuse the same
   species picker + modal shell — the "correct or confirm" flow on
   the Test Image page needs to open the same picker the Training
   review UI uses. */
import React, { useState } from 'react';
import { T } from '../theme.js';
import { H1, GhostButton, inputStyle } from '../components.jsx';

export function ModalShell({ onCancel, title, children }) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(3, 27, 51, 0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: T.card, border: `1px solid ${T.cardEdge}`,
        borderRadius: 12, padding: 18, maxWidth: 460, width: '100%',
      }}>
        <H1 size={18} style={{ marginBottom: 12 }}>{title}</H1>
        {children}
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </div>
    </div>
  );
}

export function SpeciesPickerModal({
  speciesOptions,
  currentSpeciesId,
  onPick,
  onCancel,
  title = 'Correct species',
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? speciesOptions.filter(s => {
        const lower = q.toLowerCase();
        return s.commonName.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower);
      })
    : speciesOptions.slice(0, 40);

  return (
    <ModalShell onCancel={onCancel} title={title}>
      <input
        type="search" placeholder="Search species…" autoFocus
        value={q} onChange={e => setQ(e.target.value)}
        style={{ ...inputStyle, marginBottom: 10 }}
      />
      <div style={{ display: 'grid', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
        {filtered.map(s => (
          <button
            key={s.id}
            disabled={s.id === currentSpeciesId}
            onClick={() => onPick(s.id)}
            style={{
              background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
              color: s.id === currentSpeciesId ? T.inkMute : T.ink,
              padding: '8px 10px', borderRadius: 6,
              fontSize: 13, textAlign: 'left', cursor: s.id === currentSpeciesId ? 'not-allowed' : 'pointer',
              opacity: s.id === currentSpeciesId ? 0.5 : 1,
            }}
          >
            <span>{s.commonName}</span>
            <span style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace', marginLeft: 8 }}>{s.id}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}
