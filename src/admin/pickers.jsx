/* Shared pickers used by admin AND the mobile Log-a-Catch flow.

   File lives under admin/ for historical reasons — nothing in
   pickers.jsx imports anything admin-only, so it's safe for the
   user bundle to pull in. */
import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Plus } from 'lucide-react';
import { T } from '../theme.js';
import { H1, GhostButton, PrimaryButton, inputStyle } from '../components.jsx';
import { rankSpeciesSearch } from '../helpers.js';

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

/* Species picker with type-to-find search.

   Search ranks matches via helpers.rankSpeciesSearch so behavior
   matches IdentifyScreen: common-name startsWith beats contains
   beats altNames beats scientific. Empty search renders the full
   list unchanged (existing behavior preserved).

   New optional props:
     - onRequestSuggest(searchText) — invoked when the user taps the
       "Add '<search>' as a custom species" CTA that appears when the
       filtered list is empty. Callers who don't want this feature
       can leave it undefined; the CTA won't render.
     - isTablet — when true, autofocuses the search input on open;
       on phone we skip focus so the on-screen keyboard doesn't
       cover the list on first tap. */
export function SpeciesPickerModal({
  speciesOptions,
  currentSpeciesId,
  onPick,
  onCancel,
  title = 'Correct species',
  onRequestSuggest,
  isTablet = false,
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto-focus the search input only on wider viewports — phones
    // pop the on-screen keyboard which covers the list, making the
    // "browse before typing" pattern impossible.
    if (isTablet && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isTablet]);

  const query = q.trim();
  const ranked = query ? rankSpeciesSearch(query, speciesOptions) : null;
  const items = ranked ? ranked.map(r => r.s) : speciesOptions.slice(0, 200);
  const showSuggestCta = !!onRequestSuggest && query.length > 0 && items.length === 0;

  return (
    <ModalShell onCancel={onCancel} title={title}>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search
          size={16} color="#5ecdf2"
          style={{
            position: 'absolute', left: 10, top: '50%',
            transform: 'translateY(-50%)', pointerEvents: 'none',
          }}
        />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search species…"
          value={q}
          onChange={e => setQ(e.target.value)}
          style={{ ...inputStyle, paddingLeft: 32, paddingRight: query ? 32 : 12 }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ('')}
            style={{
              position: 'absolute', right: 6, top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.inkSoft, padding: 4, display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {showSuggestCta && (
        <div style={{
          background: 'rgba(94,205,242,0.08)',
          border: `1px dashed #5ecdf2`,
          borderRadius: 8, padding: 12, marginBottom: 10,
        }}>
          <div style={{ fontSize: 13, color: T.ink, fontWeight: 700, marginBottom: 4 }}>
            Not finding your fish?
          </div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10, lineHeight: 1.4 }}>
            You can add it as a custom species and it's usable right away.
            Robert will review it and merge it into the shared library.
          </div>
          <PrimaryButton
            onClick={() => onRequestSuggest(query)}
            style={{ padding: '8px 12px', fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={14} strokeWidth={3} />
            Add “{query}” as a custom species
          </PrimaryButton>
        </div>
      )}

      <div style={{ display: 'grid', gap: 4, maxHeight: 340, overflowY: 'auto' }}>
        {items.map(s => (
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
              display: 'flex', alignItems: 'baseline', gap: 8,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{s.commonName}</span>
            {s.custom && (
              <span style={{
                fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase',
                color: '#5ecdf2', fontWeight: 800, flexShrink: 0,
              }}>Custom</span>
            )}
            <span style={{ fontSize: 10, color: T.inkMute, fontFamily: 'monospace', flexShrink: 0 }}>{s.id}</span>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

/* Suggest-a-species modal.

   Used from SpeciesPickerModal when the user hits the no-match CTA.
   Compact: common name (prefilled from the search), scientific,
   alt names, notes, and an opt-in to attach the current in-progress
   catch photo. On save invokes onSubmit(payload) — parent handles
   state.customSpecies + best-effort cloud submit. */
export function SpeciesSuggestModal({
  initialCommonName = '',
  hasPhotoAvailable = false,
  onCancel,
  onSubmit,
}) {
  const [commonName, setCommonName] = useState(initialCommonName);
  const [scientific, setScientific] = useState('');
  const [altNames, setAltNames]     = useState('');
  const [notes, setNotes]           = useState('');
  const [includePhoto, setIncludePhoto] = useState(hasPhotoAvailable);
  const [error, setError] = useState('');

  const submit = () => {
    if (!commonName.trim()) { setError('Common name is required.'); return; }
    setError('');
    onSubmit({
      commonName: commonName.trim(),
      scientificName: scientific.trim(),
      altNames: altNames.trim(),
      notes: notes.trim(),
      includePhoto: hasPhotoAvailable && includePhoto,
    });
  };

  return (
    <ModalShell onCancel={onCancel} title="Suggest a species">
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
            Common name
          </div>
          <input
            type="text" value={commonName}
            onChange={e => setCommonName(e.target.value)}
            placeholder="e.g. Big-eye scad"
            style={inputStyle}
            autoFocus
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
            Scientific name <span style={{ color: T.inkMute, fontWeight: 400 }}>(optional but helpful)</span>
          </div>
          <input
            type="text" value={scientific}
            onChange={e => setScientific(e.target.value)}
            placeholder="e.g. Selar crumenophthalmus"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
            Regional or alt names <span style={{ color: T.inkMute, fontWeight: 400 }}>(comma-separated)</span>
          </div>
          <input
            type="text" value={altNames}
            onChange={e => setAltNames(e.target.value)}
            placeholder="e.g. goggle-eye, akule"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: T.inkSoft, marginBottom: 4, fontWeight: 700 }}>
            Where caught <span style={{ color: T.inkMute, fontWeight: 400 }}>(optional)</span>
          </div>
          <input
            type="text" value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Nearshore reef in the Keys"
            style={inputStyle}
          />
        </div>
        {hasPhotoAvailable && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: T.ink, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={includePhoto}
              onChange={e => setIncludePhoto(e.target.checked)}
              style={{ accentColor: '#5ecdf2' }}
            />
            Include the current catch photo with the suggestion
          </label>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 12, color: '#c66' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <PrimaryButton onClick={submit} style={{ padding: '8px 16px', fontSize: 13 }}>
            Add species
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}
