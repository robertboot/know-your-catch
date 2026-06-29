import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, ChevronRight, AlertTriangle, Plus, Pencil, Trophy, Camera, Trash2, Mail,
  Wrench, Ruler, Star, Share2, Image as ImageIcon, BookOpen, CheckCircle2, X, Brain,
  SlidersHorizontal,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, SPECIES, REGULATIONS, CATEGORIES,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { defaultState, saveState, downscaleImageDataUrl, compactStatePhotos, storageBytes, photoStats } from './storage.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, cleanSeason, seasonState, speciesPhoto,
  sunPosition, moonPhase, buildPBReport, buildCatchReport, pbPhotos, catchPhotos, appleMapsLink,
} from './helpers.js';

/* Render a coordinate value as a tappable Apple Maps link. */
function CoordsLink({ lat, lon }) {
  const href = appleMapsLink(lat, lon);
  const label = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
  if (!href) return <>{label}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ color: T.brass, textDecoration: 'underline', textDecorationThickness: '1px' }}>
      {label}
    </a>
  );
}
import {
  StatusPill, SpeciesImage, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, SpeciesRow, StarButton, ShareReportModal, LightboxModal,
  inputStyle,
} from './components.jsx';
import { getLocation, getPhoto } from './native.js';
import { publishCatch } from './cloudsync.js';
import exifr from 'exifr';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/* ============================================================
   SPECIES DETAIL
   ============================================================ */
export function SpeciesDetailScreen({ id, state, jurisdiction, stale, onLookalike, onAddPB, onFullRegs, onKeep, update }) {
  const s = speciesById(id);
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [noteDraft, setNoteDraft] = useState(state.notes[id] || '');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!s) return <div style={{ padding: 20 }}>Species not found.</div>;
  const photo = speciesPhoto(s.id);
  const reg = jurisdiction ? REGULATIONS[id]?.[jurisdiction.id] : null;
  const fedReg = REGULATIONS[id]?.fed_gulf;
  const showFedColumn = reg && fedReg && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
  const pb = state.pbs[id];

  const saveNote = () => {
    update({ notes: { ...state.notes, [id]: noteDraft.trim() } });
    setShowNoteEdit(false);
  };

  const favorited = (state.favorites || []).includes(id);
  const toggleFav = () => {
    const list = state.favorites || [];
    const next = favorited ? list.filter(x => x !== id) : [...list, id];
    update({ favorites: next });
  };

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <Card style={{ background: T.oceanDeep, color: T.parchment, border: `1.5px solid ${T.brass}`, padding: 18, marginBottom: 14, textAlign: 'center', position: 'relative' }}>
        <button onClick={toggleFav} aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'} style={{
          position: 'absolute', top: 10, right: 10,
          background: 'transparent', border: 'none', padding: 6, cursor: 'pointer',
          color: favorited ? T.brass : T.parchment,
        }}>
          <Star size={24} fill={favorited ? T.brass : 'transparent'} strokeWidth={favorited ? 1.5 : 2} />
        </button>
        {photo ? (
          <>
            <div
              onClick={() => setLightboxOpen(true)}
              role="button"
              tabIndex={0}
              aria-label={`Enlarge ${s.commonName} photo`}
              className="kyc-tappable"
              style={{
                width: '100%', maxWidth: 360, height: 220, margin: '0 auto',
                background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
                borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', position: 'relative',
              }}
            >
              <img src={photo.url} alt={s.commonName} loading="lazy"
                className="kyc-kill-white"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
              <div aria-hidden style={{
                position: 'absolute', bottom: 6, right: 8,
                background: 'rgba(3, 27, 51, 0.7)', color: T.brass,
                fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                padding: '3px 7px', borderRadius: 4,
              }}>TAP TO ENLARGE</div>
            </div>
            {photo.credit && <div style={{ fontSize: 9, color: '#8aa0ac', marginTop: 4 }}>{photo.credit} · {photo.license}</div>}
          </>
        ) : (
          <SpeciesImage species={s} size={100} />
        )}
        <H1 size={24} style={{ color: T.parchment, marginTop: 8 }}>{s.commonName}</H1>
        <div style={{ fontStyle: 'italic', fontSize: 13, color: '#B8C5CD', marginTop: 4 }}>{s.scientific}</div>
        {s.altNames.length > 0 && (
          <div style={{ fontSize: 11, color: T.brass, marginTop: 8, letterSpacing: 0.5 }}>
            ALSO: {s.altNames.join(' · ')}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {s.hms && <span style={{ background: T.warnBg, color: T.brassDeep, padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1, marginRight: 6 }}>HMS PERMIT</span>}
          {s.reefFish && <span style={{ background: T.openBg, color: T.open, padding: '3px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>REEF FISH</span>}
        </div>
        <button onClick={onAddPB} style={{
          marginTop: 14, background: T.brass, color: T.oceanDeep, border: 'none',
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 800,
          letterSpacing: 0.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Trophy size={14} /> {pb ? 'Edit Personal Best' : 'Add Personal Best'}
        </button>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Key identifiers</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 14, lineHeight: 1.6 }}>
          {s.keyIds.map((k, i) => <li key={i}>{k}</li>)}
        </ul>
      </Card>

      {s.lookalikes.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 4 }}>Often confused with</SectionLabel>
          <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10 }}>Tap to compare side-by-side.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {s.lookalikes.map(otherId => {
              const o = speciesById(otherId);
              if (!o) return null;
              return (
                <button key={otherId} onClick={() => onLookalike(otherId)} style={{
                  background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, padding: '10px 12px',
                  borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', width: '100%',
                }}>
                  <SpeciesImage species={o} size={36} />
                  <div style={{ flex: 1, textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: T.ink }}>{o.commonName}</div>
                    <div style={{ fontSize: 11, color: T.inkMute }}>Compare features →</div>
                  </div>
                  <ChevronRight size={18} color={T.brass} />
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <SectionLabel>Regulations</SectionLabel>
          {jurisdiction && <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 600 }}>{jurisdiction.short}</span>}
        </div>
        {!jurisdiction ? (
          <div style={{ fontSize: 13, color: T.inkMute, padding: 8 }}>Set your fishing waters from the home screen to see rules.</div>
        ) : !reg ? (
          <div style={{ fontSize: 13, color: T.inkMute, padding: 8 }}>No regulations on file for this species in this jurisdiction.</div>
        ) : (
          <>
            {stale && (
              <div style={{ background: T.warnBg, border: `1.5px solid ${T.warn}`, padding: '8px 10px', borderRadius: 4, fontSize: 12, color: T.brassDeep, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} /> Data is stale — refresh when online.
              </div>
            )}
            <RegBlock reg={reg} units={state.units} jurisdiction={jurisdiction} fedColumn={showFedColumn ? fedReg : null} />
            <button onClick={onFullRegs} style={{ background: 'transparent', border: 'none', color: T.brass, fontWeight: 600, cursor: 'pointer', fontSize: 13, marginTop: 10, padding: 0 }}>
              View full regulation details →
            </button>
            {seasonState(reg.open).status === 'open' && (
              <button onClick={() => onKeep(s)} style={{
                background: T.brass, color: T.oceanDeep, border: 'none', padding: '10px 14px',
                borderRadius: 4, fontSize: 13, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer',
                width: '100%', marginTop: 12,
              }}>
                I'm planning to keep one — show warnings
              </button>
            )}
          </>
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Habitat & size</SectionLabel>
        <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5, marginBottom: 6 }}>{s.habitat}</div>
        <div style={{ fontSize: 12, color: T.inkMute }}>Typical size: {s.typicalSize}</div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 6 }}>My notes</SectionLabel>
        {!showNoteEdit && state.notes[id] && (
          <div style={{ fontSize: 13, color: T.inkSoft, fontStyle: 'italic', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{state.notes[id]}</div>
        )}
        {!showNoteEdit && !state.notes[id] && (
          <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 8 }}>Personal notes saved on this device.</div>
        )}
        {showNoteEdit ? (
          <>
            <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} placeholder="My favorite spots, gear that works…" style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <PrimaryButton onClick={saveNote} style={{ padding: '8px 12px', fontSize: 13 }}>Save</PrimaryButton>
              <GhostButton onClick={() => { setShowNoteEdit(false); setNoteDraft(state.notes[id] || ''); }} style={{ padding: '8px 12px', fontSize: 13 }}>Cancel</GhostButton>
            </div>
          </>
        ) : (
          <GhostButton onClick={() => setShowNoteEdit(true)} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Pencil size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            {state.notes[id] ? 'Edit note' : 'Add note'}
          </GhostButton>
        )}
      </Card>

      <Card style={{ marginBottom: 14, background: pb ? T.parchmentDeep : T.card, borderColor: pb ? T.brass : T.cardEdge }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <SectionLabel>Personal Best</SectionLabel>
            {pb ? (
              <div style={{ marginTop: 6, fontFamily: 'Georgia, serif', fontSize: 17, color: T.ink, fontWeight: 600 }}>
                {pb.primaryMetric === 'weight' ? formatWeight(pb.weight, state.units) : formatSize(pb.length, state.units)}
                <span style={{ fontSize: 12, color: T.inkMute, marginLeft: 8, fontFamily: 'inherit', fontWeight: 400 }}>
                  · {pb.date}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>No PB recorded yet.</div>
            )}
          </div>
          <button onClick={onAddPB} style={{
            background: T.ocean, color: T.parchment, border: 'none', padding: '8px 12px',
            borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {pb ? <><Pencil size={12} /> Edit</> : <><Plus size={14} /> Save PB</>}
          </button>
        </div>
      </Card>
      {lightboxOpen && photo && (
        <LightboxModal
          photos={[photo.url]}
          alt={s.commonName}
          caption={photo.credit ? `${s.commonName} · ${photo.credit} · ${photo.license}` : s.commonName}
          killWhite
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

function RegBlock({ reg, units, jurisdiction, fedColumn }) {
  const ss = seasonState(reg.open);
  const status = ss.status;
  const ssColor = status === 'open' ? T.open : status === 'closed' ? T.closed : status === 'upcoming' ? T.warn : T.inkSoft;
  const rows = [
    { label: 'Season', val: cleanSeason(reg.open) || '—', fed: fedColumn ? cleanSeason(fedColumn?.open) : null },
    { label: 'Min size', val: formatSize(reg.minSize, units), fed: fedColumn ? formatSize(fedColumn?.minSize, units) : null },
    { label: 'Max size', val: reg.maxSize ? formatSize(reg.maxSize, units) : '—', fed: fedColumn ? (fedColumn?.maxSize ? formatSize(fedColumn?.maxSize, units) : '—') : null },
    { label: 'Bag limit', val: reg.bagLimit ?? '—', fed: fedColumn ? (fedColumn?.bagLimit ?? '—') : null },
    { label: 'Vessel limit', val: reg.vesselLimit ?? '—', fed: fedColumn ? (fedColumn?.vesselLimit ?? '—') : null },
  ];
  return (
    <>
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StatusPill status={status} />
        {ss.reason && !/^(open|closed)$/i.test(ss.reason.trim()) && (
          <span style={{ fontSize: 14, fontWeight: 700, color: ssColor }}>{ss.reason}</span>
        )}
      </div>
      <div style={{ border: `1px solid ${T.cardEdge}`, borderRadius: 4, overflow: 'hidden' }}>
        {fedColumn && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: T.parchmentDeep, borderBottom: `1px solid ${T.cardEdge}`, fontSize: 11, fontWeight: 700, color: T.brassDeep, padding: '6px 10px', letterSpacing: 0.6 }}>
            <span></span>
            <span style={{ textAlign: 'right' }}>{jurisdiction.short}</span>
            <span style={{ textAlign: 'right' }}>FED</span>
          </div>
        )}
        {rows.filter(r => r.val !== '—' || r.fed && r.fed !== '—').map((r, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: fedColumn ? '1fr 1fr 1fr' : '1fr 1fr',
            padding: '8px 10px', fontSize: 13, borderTop: i > 0 ? `1px solid ${T.cardEdge}55` : 'none', gap: 8,
          }}>
            <span style={{ color: T.inkMute, fontWeight: 600 }}>{r.label}</span>
            <span style={{ color: T.ink, textAlign: 'right' }}>{r.val}</span>
            {fedColumn && <span style={{ color: T.ink, textAlign: 'right', fontWeight: r.val !== r.fed ? 700 : 400 }}>{r.fed}</span>}
          </div>
        ))}
      </div>
      {reg.gear && (
        <div style={{ marginTop: 10, padding: 10, background: T.parchmentDeep, borderLeft: `3px solid ${T.brass}`, borderRadius: 4 }}>
          <SectionLabel style={{ marginBottom: 6 }}><Wrench size={11} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Required gear</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: T.inkSoft, lineHeight: 1.55 }}>
            {reg.gear.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
      {reg.hms && (
        <div style={{ marginTop: 10, padding: 10, background: T.warnBg, border: `1.5px solid ${T.warn}`, borderRadius: 4, fontSize: 12, color: T.brassDeep, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} /> <strong>HMS permit required</strong> — federal Atlantic HMS permit must be aboard.
        </div>
      )}
      {reg.sectors && (
        <div style={{ marginTop: 10, padding: 10, background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Sector-specific</SectionLabel>
          {Object.entries(reg.sectors).map(([sector, txt]) => (
            <div key={sector} style={{ fontSize: 12, marginBottom: 4 }}>
              <strong style={{ color: T.ink }}>{sector}:</strong> <span style={{ color: T.inkSoft }}>{txt}</span>
            </div>
          ))}
        </div>
      )}
      {reg.notes && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.inkSoft, fontStyle: 'italic', lineHeight: 1.5 }}>{reg.notes}</div>
      )}
      <div style={{
        marginTop: 12, padding: 10, borderRadius: 4,
        background: reg.verified ? T.openBg : T.parchmentDeep,
        border: `1px solid ${reg.verified ? T.open : T.cardEdge}`,
      }}>
        <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5, marginBottom: 8 }}>
          {reg.verified ? (
            <><strong style={{ color: T.open }}>Verified — official.</strong> Confirmed against the agency for the current season. Rules can still change in-season; the official page is one tap away.</>
          ) : (
            <><strong style={{ color: T.warn }}>Seed data — not official.</strong> Seasons and limits change in-season. Confirm the current rule with the agency before you keep a fish.</>
          )}
        </div>
        {jurisdiction?.regsUrl && (
          <a href={jurisdiction.regsUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, color: T.brass,
            fontWeight: 700, fontSize: 13, textDecoration: 'none',
          }}>
            Open official {jurisdiction.agency} regulations <ChevronRight size={15} />
          </a>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: T.inkMute, display: 'flex', justifyContent: 'space-between' }}>
          <span>Source: {reg.source}</span>
          <span>{reg.verified ? 'Verified' : 'Seed'} {reg.lastUpdated}</span>
        </div>
      </div>
    </>
  );
}

/* ============================================================
   COMPARE
   ============================================================ */
export function CompareScreen({ aId, bId, onPick }) {
  const a = speciesById(aId), b = speciesById(bId);
  const cmp = getComparison(aId, bId);
  if (!a || !b) return <div style={{ padding: 20 }}>Not found.</div>;
  const features = cmp ? (cmp.reversed ? cmp.features.map(f => ({ feature: f.feature, a: f.b, b: f.a })) : cmp.features) : [];
  return (
    <div style={{ padding: '16px 12px' }}>
      <SectionLabel style={{ marginBottom: 6 }}>Side-by-side</SectionLabel>
      <H1 size={20} style={{ marginBottom: 12 }}>Compare</H1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <Card style={{ textAlign: 'center', padding: 10 }}>
          <SpeciesImage species={a} size={64} />
          <div style={{ marginTop: 6, fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{a.commonName}</div>
        </Card>
        <Card style={{ textAlign: 'center', padding: 10 }}>
          <SpeciesImage species={b} size={64} />
          <div style={{ marginTop: 6, fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{b.commonName}</div>
        </Card>
      </div>
      {features.length > 0 ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {features.map((f, i) => (
            <div key={i} style={{ borderTop: i > 0 ? `1px solid ${T.cardEdge}` : 'none', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: T.brassDeep, fontWeight: 700, marginBottom: 6 }}>{f.feature}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.4 }}>{f.a}</div>
                <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.4 }}>{f.b}</div>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Card><div style={{ fontSize: 13, color: T.inkMute, textAlign: 'center' }}>No structured comparison yet. Use Key identifiers on each species page.</div></Card>
      )}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: T.brassDeep, textAlign: 'center', fontWeight: 600 }}>WHICH ONE IS YOUR FISH?</div>
        <PrimaryButton onClick={() => onPick(aId)}>It's a {a.commonName}</PrimaryButton>
        <PrimaryButton onClick={() => onPick(bId)} style={{ background: T.brassDeep }}>It's a {b.commonName}</PrimaryButton>
      </div>
    </div>
  );
}

/* ============================================================
   REGULATIONS LIST + DETAIL
   ============================================================ */
export function RegulationsListScreen({ state, jurisdiction, update, onPick }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('type'); // 'type' | 'name' | 'status'
  const favSet = useMemo(() => new Set(state?.favorites || []), [state?.favorites]);
  const toggleFav = (id) => {
    if (!update) return;
    const next = new Set(favSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ favorites: Array.from(next) });
  };
  const rows = useMemo(() => {
    const lower = q.toLowerCase().trim();
    const list = SPECIES
      .filter(s => !lower || s.commonName.toLowerCase().includes(lower) || s.altNames.some(a => a.toLowerCase().includes(lower)))
      .map(s => {
        const reg = jurisdiction ? REGULATIONS[s.id]?.[jurisdiction.id] : null;
        return { s, reg, status: reg ? seasonState(reg.open).status : 'unknown' };
      });
    // Sort: by-type groups by family (CATEGORIES order, alpha within);
    // by-status floats what you can keep right now to the top; by-name is A–Z.
    const statusRank = { unknown: 0, closed: 1, upcoming: 2, open: 3 };
    const catOrder = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i]));
    list.sort((a, b) => {
      if (sort === 'status') return (statusRank[a.status] - statusRank[b.status]) || a.s.commonName.localeCompare(b.s.commonName);
      if (sort === 'type')   return ((catOrder[a.s.category] ?? 99) - (catOrder[b.s.category] ?? 99)) || a.s.commonName.localeCompare(b.s.commonName);
      return a.s.commonName.localeCompare(b.s.commonName);
    });
    return list;
  }, [q, sort, jurisdiction]);

  const favRows = rows.filter(r => favSet.has(r.s.id));
  const otherRows = rows.filter(r => !favSet.has(r.s.id));

  const catName = (id) => (CATEGORIES.find(c => c.id === id) || { name: 'Other' }).name;

  const segBtn = (state, set, key, label) => (
    <button onClick={() => set(key)} style={{
      flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
      background: state === key ? T.brass : T.parchmentDeep,
      color: state === key ? T.oceanDeep : T.inkSoft,
      border: `1.5px solid ${state === key ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>Regulations</H1>
      {jurisdiction && <div style={{ fontSize: 13, color: T.brassDeep, fontWeight: 600, marginBottom: 12 }}>{jurisdiction.name}</div>}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search species…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sort</span>
        {segBtn(sort, setSort, 'type', 'Type')}
        {segBtn(sort, setSort, 'name', 'A–Z')}
        {segBtn(sort, setSort, 'status', 'Status')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        {favRows.length > 0 && (
          <>
            <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Star size={12} fill={T.brass} color={T.brass} /> Your fish
            </div>
            {favRows.map(({ s, reg, status }) => (
              <RegRow key={'fav-' + s.id} s={s} reg={reg} status={status} state={state}
                      favorited={true} onToggleFav={() => toggleFav(s.id)} onPick={onPick} />
            ))}
          </>
        )}
        {(() => {
          const out = []; let lastCat = null;
          for (const { s, reg, status } of otherRows) {
            if (sort === 'type' && s.category !== lastCat) {
              lastCat = s.category;
              out.push(
                <div key={'h-' + s.category} style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px' }}>
                  {catName(s.category)}
                </div>
              );
            }
            out.push((
              <RegRow key={s.id} s={s} reg={reg} status={status} state={state}
                      favorited={false} onToggleFav={() => toggleFav(s.id)} onPick={onPick} />
            ));
          }
          return out;
        })()}
      </div>
    </div>
  );
}

function RegRow({ s, reg, status, state, favorited, onToggleFav, onPick }) {
  return (
    <Card onClick={() => onPick(s.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 10 }}>
      <SpeciesImage species={s} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
        <div style={{ fontSize: 11, color: T.inkMute }}>
          {reg ? `Min ${formatSize(reg.minSize, state.units)} · Bag ${reg.bagLimit ?? '—'}` : 'No data'}
        </div>
      </div>
      <StatusPill status={status} size="small" />
      <StarButton favorited={favorited} onToggle={onToggleFav} size={18} />
    </Card>
  );
}

/* ============================================================
   MEASURE — how to measure + size limits & possession
   ============================================================ */
export function MeasureScreen({ state, jurisdiction, onChangeJurisdiction, onPick }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lower = q.toLowerCase().trim();
    return SPECIES
      .filter(s => !lower || s.commonName.toLowerCase().includes(lower) || s.altNames.some(a => a.toLowerCase().includes(lower)))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [q]);

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>Measure Fish</H1>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: T.brassDeep, fontWeight: 600 }}>
          {jurisdiction ? jurisdiction.name : 'No waters selected'}
        </div>
        <button onClick={onChangeJurisdiction} style={{
          background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
          padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 800,
          letterSpacing: 1, cursor: 'pointer', textTransform: 'uppercase',
        }}>Change</button>
      </div>

      {/* How to measure */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Ruler size={18} color={T.brass} />
          <SectionLabel>How to measure</SectionLabel>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Total length</div>
            <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
              Tip of the closed mouth to the tip of the tail, with the tail squeezed together for the longest measurement.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>Fork length</div>
            <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
              Tip of the mouth to the center of the fork in the tail. Used for many pelagics.
            </div>
          </div>
          <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5, borderTop: `1px solid ${T.cardEdge}`, paddingTop: 8 }}>
            Lay the fish flat on a measuring device, mouth closed. Which length is regulated
            varies by species — always confirm on the species' rule below.
          </div>
        </div>
      </Card>

      <SectionLabel style={{ color: T.inkSoft, margin: '0 2px 8px' }}>Size limits &amp; possession</SectionLabel>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search species…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(s => {
          const reg = jurisdiction ? REGULATIONS[s.id]?.[jurisdiction.id] : null;
          return (
            <Card key={s.id} onClick={() => onPick(s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10 }}>
              <SpeciesImage species={s} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                  {reg
                    ? `Min ${formatSize(reg.minSize, state.units)}`
                      + (reg.maxSize ? ` · Max ${formatSize(reg.maxSize, state.units)}` : '')
                      + ` · Bag ${reg.bagLimit ?? '—'}`
                      + (reg.vesselLimit != null ? ` · Vessel ${reg.vesselLimit}` : '')
                    : 'No size data for these waters'}
                </div>
              </div>
              <ChevronRight size={16} color={T.brass} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   REGULATION ALERTS — your-starred-first, additional, confirm-source.
   ============================================================ */
export function RegulationAlertsScreen({ state, jurisdiction, onPick }) {
  const buckets = useMemo(() => {
    const favSet = new Set(state?.favorites || []);
    if (!jurisdiction) return { yourClosed: [], otherClosed: [], yourUnknown: [], otherUnknown: [], favSet };
    const yourClosed = [], otherClosed = [], yourUnknown = [], otherUnknown = [];
    for (const s of SPECIES) {
      const reg = REGULATIONS[s.id]?.[jurisdiction.id];
      const status = reg ? seasonState(reg.open).status : 'unknown';
      const isFav = favSet.has(s.id);
      const row = { s, reg };
      if (status === 'closed') (isFav ? yourClosed : otherClosed).push(row);
      else if (status === 'unknown') (isFav ? yourUnknown : otherUnknown).push(row);
    }
    [yourClosed, otherClosed, yourUnknown, otherUnknown].forEach(list =>
      list.sort((a, b) => a.s.commonName.localeCompare(b.s.commonName))
    );
    return { yourClosed, otherClosed, yourUnknown, otherUnknown, favSet };
  }, [jurisdiction, state?.favorites]);

  const hasAnyFavorites = buckets.favSet.size > 0;
  const totalClosed = buckets.yourClosed.length + buckets.otherClosed.length;
  const totalUnknown = buckets.yourUnknown.length + buckets.otherUnknown.length;

  const renderRow = ({ s, reg }, opts = {}) => (
    <Card key={s.id} onClick={() => onPick(s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, borderColor: opts.accentBorder || T.cardEdge }}>
      <SpeciesImage species={s} size={opts.imgSize || 38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</span>
          {buckets.favSet.has(s.id) && <Star size={12} fill={T.brass} color={T.brass} />}
        </div>
        {opts.showSeason && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{cleanSeason(reg?.open) || 'Season closed'}</div>}
      </div>
      <StatusPill status={opts.status} size="small" />
      <ChevronRight size={14} color={T.brass} />
    </Card>
  );

  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>Regulation Alerts</H1>
      {jurisdiction && <div style={{ fontSize: 13, color: T.brassDeep, fontWeight: 600, marginBottom: 14 }}>{jurisdiction.name}</div>}

      {/* PRIORITY: Your starred fish that are closed right now. */}
      {hasAnyFavorites && (
        buckets.yourClosed.length > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 10px' }}>
              <Star size={14} fill={T.brass} color={T.brass} />
              <SectionLabel style={{ color: T.closed }}>Your fish — closed ({buckets.yourClosed.length})</SectionLabel>
            </div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 12, lineHeight: 1.5, padding: '8px 10px', background: T.closedBg, borderRadius: 6, border: `1px solid ${T.closed}55` }}>
              The species you star are closed in {jurisdiction ? jurisdiction.name : 'these waters'} right now. Do not retain.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {buckets.yourClosed.map(row => renderRow(row, { status: 'closed', accentBorder: T.closed, showSeason: true, imgSize: 40 }))}
            </div>
          </>
        ) : totalClosed > 0 ? (
          <Card style={{ marginBottom: 22, padding: 14, borderColor: T.open, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <CheckCircle2 size={24} color={T.open} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>None of your starred fish are closed</div>
              <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>
                See "Additional closures" below for {totalClosed} other species closed in these waters.
              </div>
            </div>
          </Card>
        ) : null
      )}

      {/* No favourites at all + no closures: show the existing all-clear card. */}
      {totalClosed === 0 && (
        <Card style={{ marginBottom: 22, padding: 16, textAlign: 'center', borderColor: T.open }}>
          <CheckCircle2 size={32} color={T.open} style={{ display: 'block', margin: '0 auto 8px' }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 4 }}>No active closures</div>
          <div style={{ fontSize: 12, color: T.inkSoft }}>
            All species with available rules are open in {jurisdiction ? jurisdiction.name : 'these waters'}.
          </div>
        </Card>
      )}

      {/* ADDITIONAL: Other closed species the angler hasn't starred. */}
      {buckets.otherClosed.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 10px' }}>
            <AlertTriangle size={14} color={T.closed} />
            <SectionLabel style={{ color: T.inkSoft }}>
              {hasAnyFavorites ? 'Additional closures' : 'Closed in these waters'} ({buckets.otherClosed.length})
            </SectionLabel>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
            {buckets.otherClosed.map(row => renderRow(row, { status: 'closed', showSeason: true }))}
          </div>
        </>
      )}

      {/* CONFIRM SOURCE: your-starred first, then the rest. */}
      {totalUnknown > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 10px' }}>
            <AlertTriangle size={14} color={T.warn} />
            <SectionLabel style={{ color: T.warn }}>Confirm source ({totalUnknown})</SectionLabel>
          </div>
          <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 12, lineHeight: 1.5, padding: '8px 10px', background: T.warnBg, borderRadius: 6, border: `1px solid ${T.warn}55` }}>
            Flagged <strong>Confirm Source</strong> because we don't yet have verified status data for them in {jurisdiction ? jurisdiction.name : 'these waters'}. Check the official source before keeping any.
          </div>
          {buckets.yourUnknown.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 8px' }}>
                <Star size={12} fill={T.brass} color={T.brass} />
                <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: T.brass, fontWeight: 800 }}>Your fish</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {buckets.yourUnknown.map(row => renderRow(row, { status: 'unknown', accentBorder: T.warn }))}
              </div>
            </>
          )}
          {buckets.otherUnknown.length > 0 && (
            <>
              {buckets.yourUnknown.length > 0 && (
                <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: T.inkMute, fontWeight: 800, display: 'block', margin: '4px 2px 8px' }}>All other species</span>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {buckets.otherUnknown.map(row => renderRow(row, { status: 'unknown' }))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function RegulationDetailScreen({ id, state, jurisdiction, stale, onSpecies, onAddPB }) {
  const s = speciesById(id);
  if (!s) return <div style={{ padding: 20 }}>Not found.</div>;
  const reg = jurisdiction ? REGULATIONS[id]?.[jurisdiction.id] : null;
  const fedReg = REGULATIONS[id]?.fed_gulf;
  const showFedColumn = reg && fedReg && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
  const pb = state.pbs?.[id];
  return (
    <div style={{ padding: '16px 16px' }}>
      <Card style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }} onClick={onSpecies}>
        <SpeciesImage species={s} size={56} />
        <div style={{ flex: 1 }}>
          <H1 size={20}>{s.commonName}</H1>
          <div style={{ fontStyle: 'italic', fontSize: 12, color: T.inkMute }}>{s.scientific}</div>
          <div style={{ fontSize: 11, color: T.brass, marginTop: 4, fontWeight: 600 }}>View species details →</div>
        </div>
      </Card>
      {onAddPB && (
        <button onClick={(e) => { e.stopPropagation(); onAddPB(); }} style={{
          width: '100%', marginBottom: 12, background: T.brass, color: T.oceanDeep, border: 'none',
          padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Trophy size={14} /> {pb ? 'Edit Personal Best' : 'Add Personal Best'}
        </button>
      )}
      {!jurisdiction ? (
        <Card><div style={{ color: T.inkMute, fontSize: 13 }}>Select your fishing waters first.</div></Card>
      ) : !reg ? (
        <Card><div style={{ color: T.inkMute, fontSize: 13 }}>No regulation data on file for this species in {jurisdiction.name}.</div></Card>
      ) : (
        <Card>
          <SectionLabel style={{ marginBottom: 8 }}>{jurisdiction.name}</SectionLabel>
          {stale && (
            <div style={{ background: T.warnBg, border: `1.5px solid ${T.warn}`, padding: 10, borderRadius: 4, fontSize: 12, color: T.brassDeep, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} /> Data is more than 7 days old. Refresh when online.
            </div>
          )}
          <RegBlock reg={reg} units={state.units} jurisdiction={jurisdiction} fedColumn={showFedColumn ? fedReg : null} />
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   SPECIES LIST
   ============================================================ */
export function SpeciesListScreen({ state, jurisdiction, update, onPick }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('type'); // 'type' | 'name' | 'status'
  const favSet = useMemo(() => new Set(state?.favorites || []), [state?.favorites]);
  const toggleFav = (id) => {
    if (!update) return;
    const next = new Set(favSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ favorites: Array.from(next) });
  };
  const catOrder = useMemo(() => Object.fromEntries(CATEGORIES.map((c, i) => [c.id, i])), []);
  const catName = (id) => (CATEGORIES.find(c => c.id === id) || { name: 'Other' }).name;

  const rows = useMemo(() => {
    const statusRank = { unknown: 0, closed: 1, upcoming: 2, open: 3 };
    const list = SPECIES.map(s => {
      const reg = jurisdiction ? REGULATIONS[s.id]?.[jurisdiction.id] : null;
      const status = reg ? seasonState(reg.open).status : 'unknown';
      return { s, reg, status };
    });
    list.sort((a, b) => {
      if (sort === 'status') return (statusRank[a.status] - statusRank[b.status]) || a.s.commonName.localeCompare(b.s.commonName);
      if (sort === 'type')   return ((catOrder[a.s.category] ?? 99) - (catOrder[b.s.category] ?? 99)) || a.s.commonName.localeCompare(b.s.commonName);
      return a.s.commonName.localeCompare(b.s.commonName);
    });
    return list;
  }, [sort, catOrder, jurisdiction]);

  const filtered = useMemo(() => {
    const lower = q.toLowerCase().trim();
    if (!lower) return rows;
    return rows.filter(r => r.s.commonName.toLowerCase().includes(lower)
      || r.s.altNames.some(a => a.toLowerCase().includes(lower))
      || r.s.scientific.toLowerCase().includes(lower));
  }, [q, rows]);

  const favRows = filtered.filter(r => favSet.has(r.s.id));
  const otherRows = filtered.filter(r => !favSet.has(r.s.id));

  const segBtn = (key, label) => (
    <button onClick={() => setSort(key)} style={{
      flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
      fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
      background: sort === key ? T.brass : T.parchmentDeep,
      color: sort === key ? T.oceanDeep : T.inkSoft,
      border: `1.5px solid ${sort === key ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  const statusLabel = { unknown: 'Confirm Source', closed: 'Closed', upcoming: 'Opens soon', open: 'Open now' };

  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 12 }}>All species</H1>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sort</span>
        {segBtn('type', 'Type')}
        {segBtn('name', 'A–Z')}
        {segBtn('status', 'Status')}
      </div>

      {favRows.length > 0 && (
        <>
          <div style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Star size={12} fill={T.brass} color={T.brass} /> Your fish
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
            {favRows.map(({ s }) => <SpeciesRow key={'fav-' + s.id} species={s} onClick={() => onPick(s.id)} favorited={true} onToggleFavorite={() => toggleFav(s.id)} />)}
          </div>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(() => {
          const out = []; let lastGroup = null;
          for (const { s, status } of otherRows) {
            if (sort === 'type') {
              if (s.category !== lastGroup) {
                lastGroup = s.category;
                out.push(
                  <div key={'h-' + s.category} style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px' }}>
                    {catName(s.category)}
                  </div>
                );
              }
            } else if (sort === 'status') {
              if (status !== lastGroup) {
                lastGroup = status;
                out.push(
                  <div key={'h-' + status} style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px' }}>
                    {statusLabel[status]}
                  </div>
                );
              }
            }
            out.push(<SpeciesRow key={s.id} species={s} onClick={() => onPick(s.id)} favorited={false} onToggleFavorite={() => toggleFav(s.id)} />);
          }
          return out;
        })()}
      </div>
    </div>
  );
}

/* ============================================================
   PBs
   ============================================================ */
export function PBsScreen({ state, onView, onLogCatch, onViewCatches }) {
  const recorded = Object.keys(state.pbs || {});
  const hasCatches = (state.catchLog || []).length > 0;
  const [lightbox, setLightbox] = useState(null); // { photos, index, caption } or null

  // Persistent action buttons. Always available so an angler can jump
  // straight to the Logbook to promote an already-logged catch, or
  // start a fresh catch entry, regardless of how many PBs they have.
  const actions = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <PrimaryButton onClick={onLogCatch}>
        <Camera size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
        Log a fish
      </PrimaryButton>
      <GhostButton onClick={onViewCatches}>
        <BookOpen size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
        {hasCatches ? 'Promote a catch from the Logbook' : 'Open the Logbook'}
      </GhostButton>
    </div>
  );

  return (
    <div style={{ padding: '16px 16px' }}>
      <div style={{ marginBottom: 14 }}>
        <H1 size={22}>Personal Bests</H1>
        <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 4 }}>Your records, by species.</div>
      </div>

      {recorded.length === 0 ? (
        <Card style={{ padding: 18, textAlign: 'center' }}>
          <Trophy size={36} color={T.brass} style={{ display: 'block', margin: '0 auto 10px' }} />
          <div style={{ fontWeight: 800, color: T.ink, fontSize: 15, marginBottom: 6 }}>
            No personal bests recorded
          </div>
          <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>
            Personal bests come from your logged catches. Log a new fish, or
            promote one you've already logged in the Logbook.
          </div>
          {actions}
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {recorded.map(id => {
              const s = speciesById(id); const pb = state.pbs[id];
              if (!s) return null;
              const photos = pbPhotos(pb);
              return (
                <Card key={id} onClick={() => onView(id)} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: T.parchmentDeep, borderColor: T.brass }}>
                  {/* Photo strip — all PB photos in a horizontal scroll;
                      each tappable to enlarge with the full set. */}
                  {photos.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Trophy size={20} color={T.brass} />
                      <SpeciesImage species={s} size={56} />
                    </div>
                  ) : (
                    <div
                      className="kyc-hscroll"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'flex', gap: 6,
                        overflowX: 'auto', overflowY: 'hidden',
                        margin: '0 -10px', padding: '0 10px 4px',
                        scrollSnapType: 'x proximity',
                      }}
                    >
                      {photos.map((p, i) => (
                        <button
                          key={i}
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightbox({ photos, index: i, caption: s.commonName });
                          }}
                          aria-label={`Enlarge ${s.commonName} photo ${i + 1}`}
                          className="kyc-tappable"
                          style={{
                            flex: '0 0 96px', width: 96, height: 96,
                            padding: 0, border: `1px solid ${T.brass}`, borderRadius: 6,
                            background: T.parchmentDeep, overflow: 'hidden', cursor: 'zoom-in',
                            scrollSnapAlign: 'start',
                          }}
                        >
                          <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Trophy size={18} color={T.brass} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                        {pb.primaryMetric === 'weight' ? formatWeight(pb.weight, state.units) : formatSize(pb.length, state.units)} · {pb.date}
                      </div>
                    </div>
                    <ChevronRight size={16} color={T.brass} />
                  </div>
                </Card>
              );
            })}
          </div>
          <SectionLabel style={{ marginBottom: 8 }}>Add another PB</SectionLabel>
          {actions}
        </>
      )}

      {lightbox && (
        <LightboxModal
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

export function PBDetailScreen({ speciesId, state, update, onEdit, onBack }) {
  const s = speciesById(speciesId); const pb = state.pbs[speciesId];
  const [shareOpen, setShareOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(null); // tapped index or null
  if (!s || !pb) return <div style={{ padding: 20 }}>No PB.</div>;
  const remove = () => {
    if (!window.confirm('Delete this personal best and all its history?')) return;
    const next = { ...state.pbs }; delete next[speciesId];
    update({ pbs: next });
    onBack();
  };
  const primary = pb.primaryMetric === 'weight'
    ? { val: formatWeight(pb.weight, state.units), label: 'Weight' }
    : { val: formatSize(pb.length, state.units), label: 'Length' };
  const secondary = pb.primaryMetric === 'weight'
    ? { val: formatSize(pb.length, state.units), label: 'Length' }
    : { val: formatWeight(pb.weight, state.units), label: 'Weight' };
  const photos = pbPhotos(pb);
  const reportText = buildPBReport({ anglerName: state.anglerName, species: s, pb, units: state.units });
  const speciesFallbackPhoto = speciesPhoto(s.id);
  const reportPhotoUrl = photos[0] || (speciesFallbackPhoto ? speciesFallbackPhoto.url : null);
  const meta = [
    { label: 'Date', value: pb.date },
    pb.jurisdiction && { label: 'Waters', value: jurisdictionById(pb.jurisdiction)?.name || pb.jurisdiction },
    pb.location && { label: 'Location', value: pb.location },
    (pb.lat != null && pb.lon != null) && { label: 'Coords', value: `${pb.lat.toFixed(5)}°, ${pb.lon.toFixed(5)}°` },
    pb.gearBait && { label: 'Gear / bait', value: pb.gearBait },
  ].filter(Boolean);
  return (
    <div style={{ padding: '16px 16px' }}>
      <Card style={{ background: T.oceanDeep, color: T.parchment, border: `1.5px solid ${T.brass}`, textAlign: 'center', padding: 18, marginBottom: 12 }}>
        <Trophy size={24} color={T.brass} style={{ margin: '0 auto 6px', display: 'block' }} />
        <H1 size={20} style={{ color: T.parchment }}>{s.commonName}</H1>
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(244, 227, 193, 0.1)', borderRadius: 4 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, color: T.brass, fontWeight: 700, textTransform: 'uppercase' }}>{primary.label}</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 600, color: T.parchment, marginTop: 4 }}>{primary.val}</div>
          <div style={{ fontSize: 12, color: '#B8C5CD', marginTop: 4 }}>{secondary.label}: {secondary.val}</div>
        </div>
      </Card>
      {photos.length > 0 && (
        photos.length === 1 ? (
          <Card onClick={() => setLightboxIdx(0)} className="kyc-tappable" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <img src={photos[0]} alt={s.commonName} style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover' }} />
          </Card>
        ) : (
          <div className="kyc-hscroll" style={{
            display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
            margin: '0 -16px 12px', padding: '0 16px 4px',
            scrollSnapType: 'x proximity',
          }}>
            {photos.map((p, i) => (
              <div key={i} onClick={() => setLightboxIdx(i)} className="kyc-tappable" style={{ flex: '0 0 78%', borderRadius: 8, overflow: 'hidden', scrollSnapAlign: 'start', border: `1px solid ${T.cardEdge}`, cursor: 'zoom-in' }}>
                <img src={p} alt={`${s.commonName} ${i + 1}`} style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        )
      )}
      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Details</SectionLabel>
        <DetailRow label="Date" value={pb.date} />
        {pb.jurisdiction && <DetailRow label="Waters" value={jurisdictionById(pb.jurisdiction)?.name || pb.jurisdiction} />}
        {pb.location && <DetailRow label="Location" value={pb.location} />}
        {(pb.lat != null && pb.lon != null) && <DetailRow label="Coords" value={<CoordsLink lat={pb.lat} lon={pb.lon} />} />}
        {pb.gearBait && <DetailRow label="Gear / bait" value={pb.gearBait} />}
        {pb.notes && <DetailRow label="Notes" value={pb.notes} />}
      </Card>
      {pb.history && pb.history.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 8 }}>Previous bests ({pb.history.length})</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pb.history.slice().reverse().map((h, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: i < pb.history.length - 1 ? `1px solid ${T.cardEdge}55` : 'none' }}>
                <span style={{ color: T.inkSoft }}>
                  {h.primaryMetric === 'weight' ? formatWeight(h.weight, state.units) : formatSize(h.length, state.units)}
                </span>
                <span style={{ color: T.inkMute, fontSize: 11 }}>{h.date} — beaten {h.beatenOn}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton onClick={onEdit} style={{ flex: 1 }}><Pencil size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Edit</PrimaryButton>
        <GhostButton onClick={() => setShareOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Share2 size={14} /> Share
        </GhostButton>
        <GhostButton onClick={remove} style={{ color: T.closed, borderColor: T.closed, padding: '14px 14px' }}><Trash2 size={16} /></GhostButton>
      </div>

      <ShareReportModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Personal Best"
        anglerName={state.anglerName}
        species={s}
        photoUrl={reportPhotoUrl}
        photoDataUrl={photos[0]}
        primary={{ label: primary.label, value: primary.val }}
        secondary={{ label: secondary.label, value: secondary.val }}
        meta={meta}
        notes={pb.notes}
        reportText={reportText}
        reportTitle={`${(state.anglerName || 'My').trim() || 'My'} ${s.commonName} PB`}
      />
      {lightboxIdx != null && photos.length > 0 && (
        <LightboxModal
          photos={photos}
          initialIndex={lightboxIdx}
          caption={s.commonName}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

export function PBEntryScreen({ speciesId, edit, state, jurisdiction, update, onDone }) {
  const s = speciesById(speciesId);
  const existing = state.pbs[speciesId];
  const [length, setLength] = useState(existing?.length ?? '');
  const [weight, setWeight] = useState(existing?.weight ?? '');
  const [primaryMetric, setPrimaryMetric] = useState(existing?.primaryMetric || 'weight');
  const [date, setDate] = useState(existing?.date || new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState(existing?.location || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [gearBait, setGearBait] = useState(existing?.gearBait || '');
  const [jurId, setJurId] = useState(existing?.jurisdiction || jurisdiction?.id || '');
  const [photos, setPhotos] = useState(() => pbPhotos(existing));
  const [lat, setLat] = useState(existing?.lat ?? null);
  const [lon, setLon] = useState(existing?.lon ?? null);
  const [locFromPhoto, setLocFromPhoto] = useState(false);
  const fileRef = React.useRef(null);
  if (!s) return <div style={{ padding: 20 }}>Species not found.</div>;

  const lenNum = parseFloat(length); const wtNum = parseFloat(weight);
  const beats = existing && ((primaryMetric === 'weight' && wtNum > (existing.weight || 0)) || (primaryMetric === 'length' && lenNum > (existing.length || 0)));
  const canSave = (lenNum > 0 || wtNum > 0);

  const handleAddPhoto = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file
    if (files.length === 0 || photos.length >= 3) return;
    const slotsLeft = 3 - photos.length;
    const batch = files.slice(0, slotsLeft);
    // 1) Downscale + read each file into the slots in order — full-res
    //    iPhone photos as data URLs blow Safari's 5MB localStorage cap.
    Promise.all(batch.map(f => downscaleImageDataUrl(f)))
      .then((dataUrls) => {
        setPhotos(p => [...p, ...dataUrls].slice(0, 3));
      });
    const f = batch[0];
    // 2) Try to pull GPS from EXIF. Auto-fill only if we don't already
    //    have coords (don't clobber a manual entry).
    if (lat == null || lon == null) {
      exifr.gps(f).then((g) => {
        if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
          setLat(g.latitude);
          setLon(g.longitude);
          setLocFromPhoto(true);
          // Backfill the text location field if the user hasn't typed one.
          if (!location.trim()) {
            setLocation(`${g.latitude.toFixed(5)}°, ${g.longitude.toFixed(5)}°`);
          }
        }
      }).catch(() => { /* no EXIF / non-jpeg / corrupt — silent */ });
    }
  };
  const removePhotoAt = (i) => setPhotos(p => p.filter((_, idx) => idx !== i));
  const clearLocation = () => {
    setLat(null); setLon(null); setLocFromPhoto(false);
  };

  const save = () => {
    const entry = {
      length: lenNum > 0 ? lenNum : null, weight: wtNum > 0 ? wtNum : null,
      primaryMetric, date, location: location.trim(), notes: notes.trim(),
      gearBait: gearBait.trim(), jurisdiction: jurId,
      lat: lat != null ? lat : null,
      lon: lon != null ? lon : null,
      photos: photos.slice(0, 3),
      // Mirror the first photo into the legacy `photo` field so existing
      // surfaces that still read `pb.photo` keep working until they're
      // migrated to `pbPhotos()`.
      photo: photos[0] || null,
    };
    let history = existing?.history || [];
    if (existing && beats) {
      history = [...history, {
        length: existing.length, weight: existing.weight,
        primaryMetric: existing.primaryMetric, date: existing.date,
        beatenOn: new Date().toISOString().slice(0, 10),
      }];
    }
    update({ pbs: { ...state.pbs, [speciesId]: { ...entry, history } } });
    onDone();
  };

  return (
    <div style={{ padding: '16px 16px' }}>
      <Card style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <SpeciesImage species={s} size={50} />
        <div>
          <H1 size={18}>{s.commonName}</H1>
          <div style={{ fontSize: 12, color: T.inkMute }}>{edit ? 'Update PB' : 'New personal best'}</div>
        </div>
      </Card>

      {existing && beats && (
        <Card style={{ background: T.openBg, border: `1.5px solid ${T.open}`, marginBottom: 12 }}>
          <div style={{ color: T.open, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={16} /> New record! Beats previous {existing.primaryMetric === 'weight' ? formatWeight(existing.weight, state.units) : formatSize(existing.length, state.units)}
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Measurements</SectionLabel>
        <Field label={`Length (${state.units === 'metric' ? 'cm' : 'in'})`} value={length} onChange={setLength} type="number" placeholder="e.g. 28" />
        <Field label={`Weight (${state.units === 'metric' ? 'kg' : 'lb'})`} value={weight} onChange={setWeight} type="number" placeholder="e.g. 12.5" />
        <div style={{ marginTop: 12 }}>
          <SectionLabel style={{ marginBottom: 6 }}>This is the PB by:</SectionLabel>
          <div style={{ display: 'flex', gap: 8 }}>
            <PickButton active={primaryMetric === 'weight'} onClick={() => setPrimaryMetric('weight')}>Weight</PickButton>
            <PickButton active={primaryMetric === 'length'} onClick={() => setPrimaryMetric('length')}>Length</PickButton>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 10 }}>Details</SectionLabel>
        <Field label="Date" value={date} onChange={setDate} type="date" />
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Waters</SectionLabel>
          <select value={jurId} onChange={e => setJurId(e.target.value)} style={inputStyle}>
            <option value="">— Select —</option>
            {JURISDICTIONS.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
        <Field label="Location (optional)" value={location} onChange={setLocation} placeholder="e.g. 30 mi south of Dauphin Island" />
        {(lat != null && lon != null) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: -4, marginBottom: 6, fontSize: 11, color: T.brass }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              📍 {lat.toFixed(5)}°, {lon.toFixed(5)}°{locFromPhoto && <span style={{ color: T.inkMute, marginLeft: 4 }}>— from photo</span>}
            </span>
            <button onClick={clearLocation} style={{ background: 'transparent', border: 'none', color: T.inkMute, fontSize: 11, cursor: 'pointer', padding: 2 }}>Clear coords</button>
          </div>
        )}
        <Field label="Gear / bait (optional)" value={gearBait} onChange={setGearBait} placeholder="e.g. live cigar minnow, 80 ft" />
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Notes</SectionLabel>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional notes" />
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel>Photos</SectionLabel>
          <span style={{ fontSize: 11, color: T.inkMute }}>{photos.length} / 3</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[0, 1, 2].map(i => {
            const p = photos[i];
            if (p) {
              return (
                <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
                  <img src={p} alt={`PB photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => removePhotoAt(i)} aria-label="Remove photo" style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(3, 27, 51, 0.85)', color: T.parchment,
                    border: `1px solid ${T.cardEdge}`, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            }
            const isNext = i === photos.length;
            return (
              <button
                key={i}
                onClick={isNext ? () => fileRef.current?.click() : undefined}
                disabled={!isNext}
                aria-label={isNext ? 'Add photo' : 'Empty photo slot'}
                style={{
                  aspectRatio: '1 / 1', borderRadius: 8,
                  border: `1.5px dashed ${isNext ? T.brass : T.cardEdge}`,
                  background: 'transparent', cursor: isNext ? 'pointer' : 'default',
                  color: isNext ? T.brass : T.inkMute,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 4, opacity: isNext ? 1 : 0.5,
                }}
              >
                <Camera size={20} />
                <span style={{ fontSize: 10.5, letterSpacing: 0.8, fontWeight: 700 }}>
                  {isNext ? 'ADD' : ''}
                </span>
              </button>
            );
          })}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleAddPhoto} style={{ display: 'none' }} />
      </Card>

      <PrimaryButton onClick={save} disabled={!canSave}>
        <Trophy size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
        {existing && beats ? 'Save new record' : existing ? 'Update' : 'Save PB'}
      </PrimaryButton>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
export function SettingsScreen({ state, jurisdiction, update, onChangeJurisdiction, onShowDisclaimer, onEditFavorites, onEditAccount }) {
  const setUnits = (u) => update({ units: u });
  // Storage diagnostic — useful when the angler reports "edits aren't
  // saving". Re-reads on every interaction so the meter stays current.
  const [storage, setStorage] = useState({ bytes: storageBytes(), wrote: null, error: null });
  const refreshStorage = () => setStorage(s => ({ ...s, bytes: storageBytes() }));
  const testSave = () => {
    const res = saveState(state);
    setStorage({ bytes: storageBytes(), wrote: res.ok ? Date.now() : null, error: res.ok ? null : res.code });
  };
  const [compacting, setCompacting] = useState(false);
  const runCompact = async () => {
    setCompacting(true);
    try {
      const before = storageBytes();
      const compacted = await compactStatePhotos(state);
      const res = saveState(compacted);
      if (res.ok) {
        update({ ...compacted }); // refresh React state with shrunk photos
        setStorage({ bytes: storageBytes(), wrote: Date.now(), error: null });
        window.alert(`Compacted. ${(before / 1024).toFixed(0)} KB → ${(storageBytes() / 1024).toFixed(0)} KB.`);
      } else {
        setStorage(s => ({ ...s, error: res.code }));
        window.alert("Couldn't save the compacted state. Try deleting some catches first.");
      }
    } finally {
      setCompacting(false);
    }
  };
  const clearAll = () => {
    if (window.confirm('Clear all PBs, notes, and settings? This cannot be undone.')) {
      saveState(defaultState);
      window.location.reload();
    }
  };

  const exportData = () => {
    const payload = {
      schema: 'kyc-backup/v1',
      exportedAt: new Date().toISOString(),
      units: state.units,
      jurisdiction: state.jurisdiction,
      catchLog: state.catchLog || [],
      pbs: state.pbs || {},
      notes: state.notes || {},
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reelintel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const payload = JSON.parse(String(r.result));
          if (payload.schema !== 'kyc-backup/v1') { window.alert('Not a ReelIntel backup file.'); return; }
          const ncatches = (payload.catchLog || []).length;
          const npbs = Object.keys(payload.pbs || {}).length;
          if (!window.confirm(`Restore ${ncatches} catch${ncatches === 1 ? '' : 'es'} and ${npbs} personal best${npbs === 1 ? '' : 's'}?\n\nYour current data will be replaced.`)) return;
          update({
            catchLog: Array.isArray(payload.catchLog) ? payload.catchLog : [],
            pbs: payload.pbs || {},
            notes: payload.notes || {},
            units: payload.units || state.units,
            jurisdiction: payload.jurisdiction || state.jurisdiction,
          });
          window.alert('Restored.');
        } catch (e) {
          window.alert('Could not read backup file.');
        }
      };
      r.readAsText(f);
    };
    input.click();
  };

  const nCatches = (state.catchLog || []).length;
  const nPBs = Object.keys(state.pbs || {}).length;
  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Settings</H1>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Angler profile</SectionLabel>
        <div style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}>
          {state.anglerName || <span style={{ color: T.inkMute, fontWeight: 500 }}>No name set</span>}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2, wordBreak: 'break-all' }}>
          {state.anglerEmail || <span style={{ color: T.inkMute }}>No email set</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: T.inkMute, lineHeight: 1.45, flex: 1, paddingRight: 10 }}>
            Name appears on your shared catch and Personal Best report cards. Email is the future magic-link login when cloud sync goes live.
          </div>
          <GhostButton onClick={onEditAccount} style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}>Edit</GhostButton>
        </div>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Fishing waters</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{jurisdiction?.name || 'Not set'}</div>
          <GhostButton onClick={onChangeJurisdiction} style={{ padding: '6px 12px', fontSize: 12 }}>Change</GhostButton>
        </div>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Your fish</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>
            {(state.favorites || []).length} starred
          </div>
          <GhostButton onClick={onEditFavorites} style={{ padding: '6px 12px', fontSize: 12 }}>Edit</GhostButton>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, lineHeight: 1.45 }}>
          Starred species pin to the top of every species and regulation list.
        </div>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Units</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <PickButton active={state.units === 'imperial'} onClick={() => setUnits('imperial')}>Inches / Pounds</PickButton>
          <PickButton active={state.units === 'metric'} onClick={() => setUnits('metric')}>Centimeters / Kilograms</PickButton>
        </div>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Data</SectionLabel>
        <DetailRow label="Version" value={DATA_VERSION} />
        <DetailRow label="Built" value={DATA_BUILD_DATE} />
        <DetailRow label="Last sync" value={state.syncMeta?.lastSyncDate || '—'} />
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Your fishing data</SectionLabel>
        <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10 }}>
          {nCatches} catch{nCatches === 1 ? '' : 'es'} logged · {nPBs} personal best{nPBs === 1 ? '' : 's'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton onClick={exportData} style={{ flex: 1 }}>Export backup</GhostButton>
          <GhostButton onClick={importData} style={{ flex: 1 }}>Restore backup</GhostButton>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
          Backup is a single JSON file with catches (photos included), personal bests, notes, and settings. Save it to Files / iCloud Drive so you don't lose your log if you reset the app or change phones.
        </div>
      </Card>

      {/* Storage diagnostic — surfaces what's actually on disk + a
          manual compact when in-browser localStorage is near full. */}
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Storage</SectionLabel>
        {(() => {
          const kb = storage.bytes / 1024;
          const cap = 5 * 1024; // Safari iOS localStorage cap ≈ 5MB
          const pct = Math.min(100, (kb / cap) * 100);
          const barColor = pct > 90 ? T.closed : pct > 70 ? T.warn : T.open;
          const stats = photoStats(state);
          const photoKb = stats.bytes / 1024;
          const avgKb = stats.count > 0 ? photoKb / stats.count : 0;
          return (
            <>
              <div style={{ fontSize: 13, color: T.ink, fontWeight: 700 }}>
                {kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(2)} MB`} used
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 500, marginLeft: 6 }}>
                  of ~{(cap / 1024).toFixed(0)} MB browser cap
                </span>
              </div>
              <div style={{ height: 6, background: T.parchmentDeep, borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: barColor }} />
              </div>
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span>{stats.count} photo{stats.count === 1 ? '' : 's'}</span>
                <span>{photoKb < 1024 ? `${photoKb.toFixed(0)} KB` : `${(photoKb / 1024).toFixed(2)} MB`}{stats.count > 0 ? ` · avg ${avgKb.toFixed(0)} KB` : ''}</span>
              </div>
              {storage.wrote && (
                <div style={{ fontSize: 11, color: T.open, marginTop: 6 }}>
                  Last test write succeeded {new Date(storage.wrote).toLocaleTimeString()}.
                </div>
              )}
              {storage.error && (
                <div style={{ fontSize: 11, color: T.closed, marginTop: 6 }}>
                  Test write failed ({storage.error}). Compact or delete some catches.
                </div>
              )}
            </>
          );
        })()}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <GhostButton onClick={testSave} style={{ flex: 1, fontSize: 12, padding: '8px' }}>Test save</GhostButton>
          <GhostButton onClick={runCompact} disabled={compacting} style={{ flex: 2, fontSize: 12, padding: '8px' }}>
            {compacting ? 'Compacting…' : 'Compact photos'}
          </GhostButton>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
          Compact re-downscales every photo on file to ~1600px at 0.82 JPEG quality. Idempotent — no-op for photos already at that size. The native iOS build will move photos to filesystem storage and remove this constraint entirely.
        </div>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Report or contact</SectionLabel>
        <a href="mailto:corrections@reelintel.example?subject=Regulation%20correction" style={{ color: T.brass, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mail size={16} /> Email a regulation correction
        </a>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Legal</SectionLabel>
        <button onClick={onShowDisclaimer} style={{ background: 'transparent', border: 'none', color: T.brass, fontWeight: 600, fontSize: 14, cursor: 'pointer', padding: 0 }}>
          Re-read disclaimer
        </button>
      </Card>
      <Card>
        <SectionLabel style={{ marginBottom: 8 }}>Reset</SectionLabel>
        <button onClick={clearAll} style={{ background: 'transparent', border: `1.5px solid ${T.closed}`, color: T.closed, fontSize: 13, fontWeight: 600, padding: '8px 12px', borderRadius: 4, cursor: 'pointer' }}>
          Clear all local data
        </button>
      </Card>
    </div>
  );
}

/* ============================================================
   CATCH LOG — personal "what & where" dataset
   ============================================================ */

function compassDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

/* ============================================================
   LOCATION PICKER — map-based pin drop, dark theme, draggable.
   ============================================================ */
export function LocationPickerModal({ initialLat, initialLon, onSave, onClose }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  // Gulf of America centre by default, zoomed in if we already have coords.
  const startLat = Number.isFinite(initialLat) ? initialLat : 27.0;
  const startLon = Number.isFinite(initialLon) ? initialLon : -88.0;
  const startZoom = Number.isFinite(initialLat) ? 11 : 6;
  const [coords, setCoords] = useState({ lat: startLat, lon: startLon });
  const [placed, setPlaced] = useState(Number.isFinite(initialLat));

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
      .setView([startLat, startLon], startZoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);

    const setPin = (lat, lng) => {
      if (!markerRef.current) {
        markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
        markerRef.current.on('dragend', (e) => {
          const ll = e.target.getLatLng();
          setCoords({ lat: ll.lat, lon: ll.lng });
        });
      } else {
        markerRef.current.setLatLng([lat, lng]);
      }
      setCoords({ lat, lon: lng });
      setPlaced(true);
    };

    if (placed) setPin(startLat, startLon);
    map.on('click', (e) => setPin(e.latlng.lat, e.latlng.lng));

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => onSave({ lat: coords.lat, lon: coords.lon });

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, background: T.bgDeep, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', background: T.oceanDeep, borderBottom: `1px solid ${T.cardEdge}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <H1 size={17} style={{ marginBottom: 2 }}>Pin catch location</H1>
          <div style={{ fontSize: 11, color: T.inkSoft }}>
            Tap the map to drop a pin, or drag an existing one. Pinch to zoom.
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{
          width: 36, height: 36, borderRadius: '50%', background: 'transparent',
          border: `1px solid ${T.cardEdge}`, color: T.parchment, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}><X size={20} /></button>
      </div>
      {/* Map */}
      <div ref={containerRef} style={{ flex: 1, background: '#061320' }} />
      {/* Footer */}
      <div style={{ padding: '12px 14px', background: T.oceanDeep, borderTop: `1px solid ${T.cardEdge}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: T.brass, fontWeight: 800, letterSpacing: 1.4 }}>COORDS</span>
          {placed ? (
            <span style={{ fontSize: 13, color: T.ink, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {coords.lat.toFixed(5)}°, {coords.lon.toFixed(5)}°
            </span>
          ) : (
            <span style={{ fontSize: 12, color: T.inkMute, fontStyle: 'italic' }}>Tap the map to place a pin</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton onClick={onClose} style={{ flex: 1 }}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!placed} style={{ flex: 2 }}>Save pin</PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// EXIF dates come in three shapes:
//  - a real Date (when exifr's reviveValues kicked in)
//  - "YYYY:MM:DD HH:MM:SS" — the literal EXIF format, with colons in
//    the date part that JavaScript's Date() can't parse natively
//  - an ISO-ish string that Date() *can* parse
// Returns a valid Date or null.
function parseExifDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== 'string') return null;
  const exif = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (exif) {
    const d = new Date(+exif[1], +exif[2] - 1, +exif[3], +exif[4], +exif[5], +exif[6]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function moonGroup(phase) {
  if (phase == null) return null;
  if (phase < 0.03 || phase >= 0.97) return 'new';
  if (phase < 0.47) return 'waxing';
  if (phase < 0.53) return 'full';
  return 'waning';
}
function timeOfDay(sunAlt, dateIso) {
  if (sunAlt == null) return null;
  if (sunAlt > 6) return 'day';
  if (sunAlt < -6) return 'night';
  const h = new Date(dateIso || Date.now()).getUTCHours();
  return h < 12 ? 'dawn' : 'dusk';
}

export function CatchLogScreen({ state, onNew, onView, onViewPB }) {
  const [view, setView] = useState('list'); // 'list' | 'map'
  // Each list-style filter holds an array of selected values — empty
  // means "no filter on this dimension". pbOnly is a boolean toggle.
  const [filters, setFilters] = useState({ speciesIds: [], moonPhases: [], timesOfDay: [], pbOnly: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (filters.speciesIds.length > 0 ? 1 : 0) +
    (filters.moonPhases.length > 0 ? 1 : 0) +
    (filters.timesOfDay.length > 0 ? 1 : 0) +
    (filters.pbOnly ? 1 : 0);
  const clearFilters = () => setFilters({ speciesIds: [], moonPhases: [], timesOfDay: [], pbOnly: false });
  const toggleInGroup = (group, val) =>
    setFilters(f => ({ ...f, [group]: f[group].includes(val) ? f[group].filter(v => v !== val) : [...f[group], val] }));
  const clearGroup = (group) => setFilters(f => ({ ...f, [group]: [] }));
  const items = (state.catchLog || []).slice().sort((a, b) => (b.dateIso || '').localeCompare(a.dateIso || ''));

  // Set of catch ids that are currently the active PB for some species
  // — fed to the list row so each catch can show a trophy badge in
  // line rather than getting its own section at the top.
  const pbCatchIds = useMemo(() => {
    const ids = new Set();
    for (const pb of Object.values(state.pbs || {})) {
      if (pb && pb.catchId) ids.add(pb.catchId);
    }
    return ids;
  }, [state.pbs]);

  const filtered = useMemo(() => items.filter(c => {
    if (filters.speciesIds.length > 0 && !filters.speciesIds.includes(c.speciesId)) return false;
    if (filters.moonPhases.length > 0 && !filters.moonPhases.includes(moonGroup(c.moonPhase))) return false;
    if (filters.timesOfDay.length > 0 && !filters.timesOfDay.includes(timeOfDay(c.sunAlt, c.dateIso))) return false;
    if (filters.pbOnly && !pbCatchIds.has(c.id)) return false;
    return true;
  }), [items, filters, pbCatchIds]);

  const speciesInLog = useMemo(() => {
    const ids = new Set(items.map(c => c.speciesId).filter(Boolean));
    return Array.from(ids).map(id => speciesById(id)).filter(Boolean).sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [items]);

  // "All" / "Any" chip at the start of a row clears that group.
  const allChip = (group, label = 'All') => {
    const active = filters[group].length === 0;
    return (
      <button onClick={() => clearGroup(group)} style={{
        background: active ? T.brass : T.parchmentDeep, color: active ? T.oceanDeep : T.inkSoft,
        border: `1.5px solid ${active ? T.brass : T.cardEdge}`, padding: '5px 10px', borderRadius: 999,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
      }}>{label}</button>
    );
  };
  // Individual value chip — toggles membership in the group's list.
  const chip = (key, group, label) => {
    const active = filters[group].includes(key);
    return (
      <button onClick={() => toggleInGroup(group, key)} style={{
        background: active ? T.brass : T.parchmentDeep, color: active ? T.oceanDeep : T.inkSoft,
        border: `1.5px solid ${active ? T.brass : T.cardEdge}`, padding: '5px 10px', borderRadius: 999,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
      }}>{label}</button>
    );
  };
  // PB filter is a boolean — own two-chip row.
  const pbAllActive = !filters.pbOnly;
  const pbOnlyActive = filters.pbOnly;
  const pbChip = (active, label, onClick) => (
    <button onClick={onClick} style={{
      background: active ? T.brass : T.parchmentDeep, color: active ? T.oceanDeep : T.inkSoft,
      border: `1.5px solid ${active ? T.brass : T.cardEdge}`, padding: '5px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>{label}</button>
  );

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <H1 size={22}>Catch Log</H1>
        <button onClick={onNew} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: 0.5, cursor: 'pointer' }}>
          <Plus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> NEW
        </button>
      </div>

      {items.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 18, color: T.inkSoft }}>
            <Camera size={36} color={T.brass} style={{ display: 'block', margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 700, color: T.ink, marginBottom: 6 }}>
              {pbList.length > 0 ? 'No catches logged yet' : 'Nothing logged yet'}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b>NEW</b> after you land one. The app records the photo, GPS, time of day, sun &amp; moon, and (when online) weather — building your personal where-and-what dataset.</div>
          </div>
        </Card>
      ) : (
        <>
          {/* List / Map toggle + Filter toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setView('list')} style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: view === 'list' ? T.brass : T.parchmentDeep, color: view === 'list' ? T.oceanDeep : T.inkSoft, border: `1.5px solid ${view === 'list' ? T.brass : T.cardEdge}` }}>List</button>
            <button onClick={() => setView('map')} style={{ flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: view === 'map' ? T.brass : T.parchmentDeep, color: view === 'map' ? T.oceanDeep : T.inkSoft, border: `1.5px solid ${view === 'map' ? T.brass : T.cardEdge}` }}>Map</button>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
              aria-expanded={filtersOpen}
              style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
                background: (filtersOpen || activeFilterCount > 0) ? T.brass : T.parchmentDeep,
                color: (filtersOpen || activeFilterCount > 0) ? T.oceanDeep : T.inkSoft,
                border: `1.5px solid ${(filtersOpen || activeFilterCount > 0) ? T.brass : T.cardEdge}`,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <SlidersHorizontal size={14} />
              {activeFilterCount > 0 && (
                <span style={{
                  background: T.oceanDeep, color: T.brass,
                  fontSize: 10, fontWeight: 800,
                  minWidth: 16, height: 16, borderRadius: 8,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px',
                }}>{activeFilterCount}</span>
              )}
            </button>
          </div>

          {/* Collapsible filters */}
          {filtersOpen && (
            <div style={{
              background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
              borderRadius: 8, padding: 10, marginBottom: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <SectionLabel>Filters · tap to multi-select</SectionLabel>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters} style={{
                    background: 'transparent', border: 'none', color: T.brass,
                    fontSize: 11, fontWeight: 800, letterSpacing: 0.6, cursor: 'pointer', padding: 0,
                  }}>Clear all</button>
                )}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Species</span>
                {allChip('speciesIds', 'All')}
                {speciesInLog.map(s => chip(s.id, 'speciesIds', s.commonName))}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Moon</span>
                {allChip('moonPhases', 'Any')}
                {chip('new', 'moonPhases', 'New')}
                {chip('waxing', 'moonPhases', 'Waxing')}
                {chip('full', 'moonPhases', 'Full')}
                {chip('waning', 'moonPhases', 'Waning')}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Time</span>
                {allChip('timesOfDay', 'Any')}
                {chip('dawn', 'timesOfDay', 'Dawn')}
                {chip('day', 'timesOfDay', 'Day')}
                {chip('dusk', 'timesOfDay', 'Dusk')}
                {chip('night', 'timesOfDay', 'Night')}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                <span style={{ fontSize: 10, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>PB</span>
                {pbChip(pbAllActive, 'All catches', () => setFilters(f => ({ ...f, pbOnly: false })))}
                {pbChip(pbOnlyActive, <><Trophy size={11} /> Only PBs</>, () => setFilters(f => ({ ...f, pbOnly: true })))}
              </div>
            </div>
          )}

          {view === 'list'
            ? <CatchListView items={filtered} onView={onView} pbCatchIds={pbCatchIds} />
            : <CatchMapView items={filtered} onView={onView} />}
        </>
      )}
    </div>
  );
}

function CatchListView({ items, onView, pbCatchIds }) {
  const [lightbox, setLightbox] = useState(null); // { photos, index, caption } or null
  const isPB = (id) => pbCatchIds && pbCatchIds.has(id);
  if (items.length === 0) return <Card><div style={{ textAlign: 'center', padding: 18, color: T.inkSoft, fontSize: 13 }}>No catches match these filters.</div></Card>;
  // Stop the row-level onClick (which navigates to the catch detail)
  // when the angler taps an individual photo thumbnail to enlarge it.
  const stop = (e) => { e.stopPropagation(); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(c => {
        const s = speciesById(c.speciesId);
        const when = new Date(c.dateIso);
        const cPhotos = catchPhotos(c);
        const speciesName = s ? s.commonName : (c.speciesId || 'Unknown');
        return (
          <Card key={c.id} onClick={() => onView && onView(c.id)} style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Photo strip — full width, horizontal scroll for multi-photo
                catches, single thumb for one, camera placeholder for zero. */}
            {cPhotos.length === 0 ? (
              <div style={{ width: 84, height: 84, background: T.parchmentDeep, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}>
                <Camera size={26} color={T.inkMute} />
              </div>
            ) : (
              <div
                className="kyc-hscroll"
                onClick={stop}
                style={{
                  display: 'flex', gap: 6,
                  overflowX: 'auto', overflowY: 'hidden',
                  margin: '0 -10px', padding: '0 10px 4px',
                  scrollSnapType: 'x proximity',
                }}
              >
                {cPhotos.map((p, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setLightbox({ photos: cPhotos, index: i, caption: speciesName }); }}
                    aria-label={`Enlarge ${speciesName} photo ${i + 1}`}
                    className="kyc-tappable"
                    style={{
                      flex: '0 0 96px', width: 96, height: 96,
                      padding: 0, border: `1px solid ${T.cardEdge}`, borderRadius: 6,
                      background: T.parchmentDeep, overflow: 'hidden', cursor: 'zoom-in',
                      scrollSnapAlign: 'start',
                    }}
                  >
                    <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            )}

            {/* Content row */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 700, color: T.ink }}>{speciesName}</span>
                {isPB(c.id) && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: T.parchmentDeep, color: T.brass,
                    border: `1px solid ${T.brass}`,
                    fontSize: 9, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    <Trophy size={10} /> PB
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>{when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              {c.lat != null && c.lon != null && <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{c.lat.toFixed(4)}°, {c.lon.toFixed(4)}°</div>}
              <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>
                {c.length ? `${c.length} in · ` : ''}
                {c.sunAlt != null ? `Sun ${c.sunAlt.toFixed(0)}° ${compassDir(c.sunAz || 0)} · ` : ''}
                {c.moonIllum != null ? `${c.moonName || 'Moon'} ${Math.round(c.moonIllum * 100)}%` : ''}
              </div>
              {c.weather && (
                <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 2 }}>
                  {c.weather.tempF != null ? `${Math.round(c.weather.tempF)}°F · ` : ''}
                  {c.weather.windMph != null ? `Wind ${compassDir(c.weather.windDir || 0)} ${Math.round(c.weather.windMph)} mph · ` : ''}
                  {c.weather.cloudPct != null ? `${Math.round(c.weather.cloudPct)}% cloud` : ''}
                </div>
              )}
            </div>
          </Card>
        );
      })}
      {lightbox && (
        <LightboxModal
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          alt={lightbox.caption}
          caption={lightbox.caption}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function CatchMapView({ items, onView }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);

  // Init map once on mount.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([26.5, -88], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &middot; &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markersRef.current = null; };
  }, []);

  // Redraw markers when items change.
  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;
    markersRef.current.clearLayers();
    const located = items.filter(c => c.lat != null && c.lon != null);
    for (const c of located) {
      const s = speciesById(c.speciesId);
      const icon = c.photo
        ? L.divIcon({ html: `<img class="kyc-pin-img" src="${c.photo}">`, className: '', iconSize: [28, 28], iconAnchor: [14, 14] })
        : L.divIcon({ html: `<div class="kyc-pin"></div>`, className: '', iconSize: [16, 16], iconAnchor: [8, 8] });
      const when = new Date(c.dateIso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const m = L.marker([c.lat, c.lon], { icon }).addTo(markersRef.current);
      const popup = `<b style="font-size:13px">${(s && s.commonName) || 'Unknown'}</b><br><span style="color:#A7BECB">${when}</span>${c.length ? `<br>${c.length} in` : ''}${c.moonName ? `<br>${c.moonName} ${Math.round((c.moonIllum||0)*100)}%` : ''}<br><a href="#" style="color:#34C2D6">View</a>`;
      m.bindPopup(popup);
      if (onView) m.on('popupopen', e => {
        const a = e.popup.getElement().querySelector('a');
        if (a) a.onclick = ev => { ev.preventDefault(); onView(c.id); };
      });
    }
    if (located.length === 1) mapRef.current.setView([located[0].lat, located[0].lon], 9);
    else if (located.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(located.map(c => [c.lat, c.lon])), { padding: [40, 40], maxZoom: 11 });
    }
  }, [items, onView]);

  const located = items.filter(c => c.lat != null && c.lon != null).length;
  return (
    <div>
      <div ref={containerRef} style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }} />
      <div style={{ fontSize: 11, color: T.inkMute, marginTop: 6, textAlign: 'center' }}>
        {located} of {items.length} catch{items.length === 1 ? '' : 'es'} have GPS · pins are tappable
      </div>
    </div>
  );
}

export function CatchDetailScreen({ id, state, update, onEdit, onBack }) {
  const c = (state.catchLog || []).find(x => x.id === id);
  const [confirming, setConfirming] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  if (!c) return <div style={{ padding: 20, color: T.inkSoft }}>Catch not found.</div>;
  const s = speciesById(c.speciesId);
  const when = new Date(c.dateIso);
  const currentPB = c.speciesId ? state.pbs?.[c.speciesId] : null;
  const isAlreadyPB = !!currentPB && currentPB.catchId === c.id;
  const remove = () => {
    update({ catchLog: (state.catchLog || []).filter(x => x.id !== c.id) });
    onBack();
  };
  // Promote this catch to the species' Personal Best in-place. Used
  // when auto-promotion on save didn't apply (e.g. measurements added
  // later) or the angler wants to override the existing PB explicitly.
  const promoteToPB = () => {
    if (!c.speciesId) return;
    if (currentPB && !isAlreadyPB) {
      const beats = (c.weight != null && c.weight > (currentPB.weight || 0))
                 || (c.length != null && c.length > (currentPB.length || 0));
      if (!beats && !window.confirm(
        `${s ? s.commonName : 'This species'} already has a Personal Best on file. Replace it with this catch?`
      )) return;
    }
    const primaryMetric = c.weight != null && (currentPB?.primaryMetric !== 'length' || c.length == null)
      ? 'weight'
      : (c.length != null ? 'length' : (currentPB?.primaryMetric || 'weight'));
    let history = currentPB?.history || [];
    if (currentPB && !isAlreadyPB) {
      history = [...history, {
        length: currentPB.length, weight: currentPB.weight,
        primaryMetric: currentPB.primaryMetric, date: currentPB.date,
        catchId: currentPB.catchId, beatenOn: new Date().toISOString().slice(0, 10),
      }];
    }
    update({
      pbs: {
        ...(state.pbs || {}),
        [c.speciesId]: {
          length: c.length, weight: c.weight,
          primaryMetric, date: (c.dateIso || '').slice(0, 10),
          location: (c.lat != null && c.lon != null) ? `${c.lat.toFixed(5)}°, ${c.lon.toFixed(5)}°` : (currentPB?.location || ''),
          lat: c.lat, lon: c.lon,
          notes: c.notes || '',
          gearBait: currentPB?.gearBait || '',
          jurisdiction: c.jurisdiction,
          photos: catchPhotos(c),
          photo: catchPhotos(c)[0] || null, // legacy mirror
          catchId: c.id,
          history,
        },
      },
    });
  };
  const cPhotos = catchPhotos(c);
  return (
    <div style={{ padding: '16px 16px 24px' }}>
      {cPhotos.length === 0
        ? <div style={{ width: '100%', height: 160, background: T.parchmentDeep, borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Camera size={36} color={T.inkMute} /></div>
        : cPhotos.length === 1
          ? <img src={cPhotos[0]} alt="" onClick={() => setLightboxIdx(0)} className="kyc-tappable" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 8, display: 'block', marginBottom: 14, cursor: 'zoom-in' }} />
          : <div className="kyc-hscroll" style={{
              display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
              margin: '0 -16px 14px', padding: '0 16px 4px',
              scrollSnapType: 'x proximity',
            }}>
              {cPhotos.map((p, i) => (
                <div key={i} onClick={() => setLightboxIdx(i)} className="kyc-tappable" style={{ flex: '0 0 78%', borderRadius: 8, overflow: 'hidden', scrollSnapAlign: 'start', border: `1px solid ${T.cardEdge}`, cursor: 'zoom-in' }}>
                  <img src={p} alt={`${s ? s.commonName : 'Catch'} ${i + 1}`} style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </div>}

      <H1 size={22}>{s ? s.commonName : (c.speciesId || 'Unknown')}</H1>
      {s && <div style={{ fontStyle: 'italic', fontSize: 13, color: T.inkSoft, marginBottom: 12 }}>{s.scientific}</div>}

      {s && (
        isAlreadyPB ? (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              width: '100%', background: T.parchmentDeep, color: T.brass,
              border: `1.5px solid ${T.brass}`,
              padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <Trophy size={14} /> This catch is your Personal Best
            </div>
            <button
              onClick={() => {
                if (!window.confirm(`Remove ${s.commonName} Personal Best status from this catch? The catch will stay in your log.`)) return;
                const nextPbs = { ...(state.pbs || {}) };
                delete nextPbs[c.speciesId];
                update({ pbs: nextPbs });
              }}
              style={{
                background: 'transparent', color: T.inkMute,
                border: `1px solid ${T.cardEdge}`,
                padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', alignSelf: 'center',
              }}
            >Remove PB status</button>
          </div>
        ) : (
          <button onClick={promoteToPB} style={{
            width: '100%', marginBottom: 14, background: T.brass, color: T.oceanDeep, border: 'none',
            padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Trophy size={14} /> {currentPB ? 'Make this my Personal Best' : 'Mark as Personal Best'}
          </button>
        )
      )}

      <Card style={{ marginBottom: 12 }}>
        <DetailRow label="When" value={when.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })} />
        {c.lat != null && c.lon != null && <DetailRow label="Where" value={<CoordsLink lat={c.lat} lon={c.lon} />} />}
        {c.length != null && <DetailRow label="Length" value={`${c.length} ${state.units === 'metric' ? 'cm' : 'in'}`} />}
        {c.weight != null && <DetailRow label="Weight" value={`${c.weight} ${state.units === 'metric' ? 'kg' : 'lb'}`} />}
        {c.jurisdiction && <DetailRow label="Waters" value={(jurisdictionById(c.jurisdiction) || { name: c.jurisdiction }).name} />}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Conditions when caught</SectionLabel>
        {c.sunAlt != null && <DetailRow label="Sun" value={`${c.sunAlt.toFixed(1)}° altitude · ${compassDir(c.sunAz || 0)} (${(c.sunAz||0).toFixed(0)}°)`} />}
        {c.moonName && <DetailRow label="Moon" value={`${c.moonName} · ${Math.round((c.moonIllum||0)*100)}% illum`} />}
        {c.weather ? (
          <>
            {c.weather.tempF != null && <DetailRow label="Temp" value={`${Math.round(c.weather.tempF)}°F`} />}
            {c.weather.windMph != null && <DetailRow label="Wind" value={`${compassDir(c.weather.windDir || 0)} ${Math.round(c.weather.windMph)} mph`} />}
            {c.weather.cloudPct != null && <DetailRow label="Clouds" value={`${Math.round(c.weather.cloudPct)}%`} />}
            {c.weather.pressureMb != null && <DetailRow label="Pressure" value={`${Math.round(c.weather.pressureMb)} mb`} />}
          </>
        ) : (
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6 }}>Weather wasn't captured (offline at the time).</div>
        )}
      </Card>

      {c.notes && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Notes</SectionLabel>
          <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.notes}</div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <GhostButton onClick={() => setShareOpen(true)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Share2 size={14} /> Share
        </GhostButton>
        <GhostButton onClick={onEdit} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Pencil size={14} /> Edit
        </GhostButton>
        <button onClick={confirming ? remove : () => setConfirming(true)} style={{
          flex: 1, background: confirming ? T.closed : 'transparent',
          color: confirming ? '#fff' : T.closed,
          border: `1.5px solid ${T.closed}`, padding: '10px 14px', borderRadius: 6,
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Trash2 size={14} /> {confirming ? 'Confirm' : 'Delete'}
        </button>
      </div>

      {(() => {
        const speciesFallback = s ? speciesPhoto(s.id) : null;
        const reportPhotoUrl = cPhotos[0] || (speciesFallback ? speciesFallback.url : null);
        const measurements = [];
        if (c.weight != null) measurements.push(`${c.weight} ${state.units === 'metric' ? 'kg' : 'lb'}`);
        if (c.length != null) measurements.push(`${c.length} ${state.units === 'metric' ? 'cm' : 'in'}`);
        const primary = measurements[0]
          ? { label: c.weight != null ? 'Weight' : 'Length', value: measurements[0] }
          : { label: 'Logged', value: '—' };
        const secondary = measurements[1]
          ? { label: c.weight != null && c.length != null ? 'Length' : '—', value: measurements[1] }
          : null;
        const meta = [
          { label: 'Date', value: when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) },
          c.jurisdiction && { label: 'Waters', value: (jurisdictionById(c.jurisdiction) || { name: c.jurisdiction }).name },
          (c.lat != null && c.lon != null) && { label: 'Location', value: `${c.lat.toFixed(5)}°, ${c.lon.toFixed(5)}°` },
        ].filter(Boolean);
        const conditions = [];
        if (c.sunAlt != null) conditions.push({ label: 'Sun', value: `${c.sunAlt.toFixed(0)}° ${compassDir(c.sunAz || 0)}` });
        if (c.moonName) conditions.push({ label: 'Moon', value: `${c.moonName} · ${Math.round((c.moonIllum || 0) * 100)}%` });
        if (c.weather?.tempF != null) conditions.push({ label: 'Temp', value: `${Math.round(c.weather.tempF)}°F` });
        if (c.weather?.windMph != null) conditions.push({ label: 'Wind', value: `${compassDir(c.weather.windDir || 0)} ${Math.round(c.weather.windMph)} mph` });
        if (c.weather?.cloudPct != null) conditions.push({ label: 'Clouds', value: `${Math.round(c.weather.cloudPct)}%` });
        if (c.weather?.pressureMb != null) conditions.push({ label: 'Pressure', value: `${Math.round(c.weather.pressureMb)} mb` });
        return (
          <ShareReportModal
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            title="Catch Report"
            anglerName={state.anglerName}
            species={s}
            photoUrl={reportPhotoUrl}
            photoDataUrl={cPhotos[0]}
            primary={primary}
            secondary={secondary}
            meta={meta}
            conditions={conditions}
            notes={c.notes}
            reportText={buildCatchReport({ anglerName: state.anglerName, species: s, c, units: state.units })}
            reportTitle={`${(state.anglerName || 'My').trim() || 'My'} ${s ? s.commonName : 'catch'}`}
          />
        );
      })()}
      {lightboxIdx != null && cPhotos.length > 0 && (
        <LightboxModal
          photos={cPhotos}
          initialIndex={lightboxIdx}
          alt={s ? s.commonName : 'Catch'}
          caption={s ? s.commonName : 'Catch'}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </div>
  );
}

export function CatchEntryScreen({ state, jurisdiction, update, onDone, onCancel, editingId, preselectSpeciesId }) {
  const existing = editingId ? (state.catchLog || []).find(c => c.id === editingId) : null;
  const isEdit = !!existing;
  const [speciesId, setSpeciesId] = useState(existing?.speciesId || preselectSpeciesId || '');
  const [length, setLength] = useState(existing?.length != null ? String(existing.length) : '');
  const [weight, setWeight] = useState(existing?.weight != null ? String(existing.weight) : '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [photos, setPhotos] = useState(() => catchPhotos(existing));
  const [loc, setLoc] = useState(
    existing && existing.lat != null
      ? { lat: existing.lat, lon: existing.lon, error: null, loading: false }
      : { lat: null, lon: null, error: null, loading: true }
  );
  const [weather, setWeather] = useState(existing?.weather || null);
  const [wxStatus, setWxStatus] = useState(existing?.weather ? 'ok' : 'idle');
  // `when` is the catch's authoritative timestamp. Defaults to right
  // now, but can be set from Photo #1's EXIF DateTimeOriginal so an
  // uploaded photo from yesterday produces a yesterday-dated catch.
  const [when, setWhen] = useState(() => existing ? new Date(existing.dateIso) : new Date());
  // Tracks where the catch location & time came from so we can show
  // the angler what's driving them (and what to edit if it's wrong).
  const [metaSource, setMetaSource] = useState(null); // 'photo' | 'device' | 'manual' | null
  // Tracks what EXIF was actually found on the first uploaded photo so
  // the UI can tell the angler if their photo had no metadata.
  const [photoExifStatus, setPhotoExifStatus] = useState(null); // 'gps+time' | 'gps' | 'time' | 'none' | null
  // Manual edit inputs.
  const [editingLoc, setEditingLoc] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [editingWhen, setEditingWhen] = useState(false);
  const [whenInput, setWhenInput] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Whether this catch should be / remain this species' Personal Best.
  // Defaults to whatever the PB currently is on disk; the angler can
  // toggle it. Replaces the old auto-promote-on-save behaviour.
  const [isPB, setIsPB] = useState(() => {
    if (!existing?.speciesId) return false;
    const pb = state?.pbs?.[existing.speciesId];
    return !!(pb && pb.catchId === existing.id);
  });

  // Native iOS via Capacitor when wrapped; web geolocation otherwise.
  // Longer timeout handles offshore cold-start (no A-GPS assist).
  const fetchGps = () => {
    setLoc(l => ({ ...l, loading: true, error: null }));
    getLocation({ enableHighAccuracy: true, timeout: 60000, maximumAge: 60000 })
      .then(({ lat, lon }) => setLoc({ lat, lon, error: null, loading: false }))
      .catch(err => setLoc({ lat: null, lon: null, error: err.message || 'GPS denied', loading: false }));
  };
  useEffect(() => { if (!isEdit) fetchGps(); }, []);

  // Weather fetch once we have coords (best effort; offline = skipped).
  // In edit mode we keep the original weather unless the user re-fetches GPS.
  useEffect(() => {
    if (loc.lat == null || loc.lon == null) return;
    if (isEdit && weather) return;
    setWxStatus('loading');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl&temperature_unit=fahrenheit&wind_speed_unit=mph`;
    fetch(url).then(r => r.ok ? r.json() : Promise.reject()).then(j => {
      const c = j.current || {};
      setWeather({
        tempF: c.temperature_2m, windMph: c.wind_speed_10m, windDir: c.wind_direction_10m,
        cloudPct: c.cloud_cover, precipMm: c.precipitation, pressureMb: c.pressure_msl,
      });
      setWxStatus('ok');
    }).catch(() => setWxStatus('offline'));
  }, [loc.lat, loc.lon]);

  const sun = loc.lat != null && loc.lon != null ? sunPosition(when, loc.lat, loc.lon) : null;
  const moon = moonPhase(when);

  const cameraRef = React.useRef(null);
  const uploadRef = React.useRef(null);
  const [photoSource, setPhotoSource] = useState(null); // 'camera' | 'upload' | null

  // Only Photo #1 drives the catch's location & time. Photos #2 and
  // #3 are just additional shots — they don't change anything.
  const handleCameraPick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || photos.length >= 3) return;
    const isFirst = photos.length === 0;
    // Downscale before storing — full-res iPhone photos blow the
    // localStorage cap after one catch.
    const dataUrl = await downscaleImageDataUrl(f);
    setPhotos(p => [...p, dataUrl].slice(0, 3));
    setPhotoSource('camera');
    if (isFirst) {
      fetchGps();          // re-acquire current device GPS
      setWhen(new Date()); // catch time = the moment we took the photo
      setMetaSource('device');
    }
  };

  const handleUploadPick = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0 || photos.length >= 3) return;
    const slotsLeft = 3 - photos.length;
    const batch = files.slice(0, slotsLeft);
    // Was the catch empty before this batch? If so, the first file in
    // the batch becomes Photo 1 and drives the location + time.
    const wasEmpty = photos.length === 0;
    // Downscale each before storing — full-res iPhone photos as
    // data URLs blow Safari's localStorage cap after one catch.
    Promise.all(batch.map(f => downscaleImageDataUrl(f)))
      .then((dataUrls) => {
        setPhotos(p => [...p, ...dataUrls].slice(0, 3));
        setPhotoSource('upload');
      });
    if (!wasEmpty) return; // additional shots — don't touch location/time
    const f = batch[0];
    // Force the parser to include GPS + the main EXIF date tags and to
    // translate them. Some photos return DateTimeOriginal as a string
    // like "2024:03:15 12:30:45" (EXIF uses colons in the date part,
    // which JS's Date constructor can't parse), so we handle both Date
    // and string forms explicitly.
    exifr.parse(f, {
      tiff: true, exif: true, gps: true,
      translateValues: true, reviveValues: true, sanitize: true, mergeOutput: true,
      pick: ['latitude', 'longitude', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
             'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal'],
    }).then((meta) => {
      const gotGps = !!(meta && Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude));
      const parsed = parseExifDate(meta?.DateTimeOriginal)
        || parseExifDate(meta?.CreateDate)
        || parseExifDate(meta?.ModifyDate);
      if (gotGps) setLoc({ lat: meta.latitude, lon: meta.longitude, error: null, loading: false });
      if (parsed) setWhen(parsed);
      if (gotGps || parsed) setMetaSource('photo');
      setPhotoExifStatus(
        gotGps && parsed ? 'gps+time' :
        gotGps ? 'gps' :
        parsed ? 'time' :
        'none'
      );
    }).catch(() => setPhotoExifStatus('none'));
  };

  const removePhotoAt = (i) => {
    setPhotos(p => p.filter((_, idx) => idx !== i));
    // If we removed the first photo, the source tag no longer reflects
    // what's on screen — clear it so the angler isn't misled.
    if (i === 0) {
      setPhotoExifStatus(null);
      if (metaSource === 'photo') setMetaSource(null);
    }
  };
  // Manually overrides the photo-derived location with a fresh device GPS.
  const useDeviceGps = () => {
    fetchGps();
    setMetaSource('device');
  };

  const startEditLoc = () => {
    setLatInput(loc.lat != null ? String(loc.lat) : '');
    setLonInput(loc.lon != null ? String(loc.lon) : '');
    setEditingLoc(true);
  };
  const saveEditLoc = () => {
    const la = parseFloat(latInput);
    const lo = parseFloat(lonInput);
    if (Number.isFinite(la) && la >= -90 && la <= 90 &&
        Number.isFinite(lo) && lo >= -180 && lo <= 180) {
      setLoc({ lat: la, lon: lo, error: null, loading: false });
      setMetaSource('manual');
    }
    setEditingLoc(false);
  };

  const startEditWhen = () => {
    const pad = (n) => String(n).padStart(2, '0');
    const d = when;
    setWhenInput(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setEditingWhen(true);
  };
  const saveEditWhen = () => {
    const d = new Date(whenInput);
    if (!isNaN(d.getTime())) {
      setWhen(d);
      setMetaSource('manual');
    }
    setEditingWhen(false);
  };

  const canSave = !!speciesId;
  const save = () => {
    const entry = {
      id: existing ? existing.id : 'c_' + Date.now(),
      speciesId,
      dateIso: when.toISOString(),
      lat: loc.lat, lon: loc.lon,
      length: length ? +length : null,
      weight: weight ? +weight : null,
      notes: notes.trim() || null,
      photos: photos.slice(0, 3),
      // Legacy single `photo` mirror so unmigrated read paths keep working.
      photo: photos[0] || null,
      sunAlt: sun ? sun.altitudeDeg : null,
      sunAz: sun ? sun.azimuthDeg : null,
      moonPhase: moon.phase, moonIllum: moon.illumination, moonName: moon.name,
      weather: weather || null,
      jurisdiction: jurisdiction ? jurisdiction.id : (existing?.jurisdiction || null),
    };

    const nextCatchLog = existing
      ? (state.catchLog || []).map(c => c.id === existing.id ? entry : c)
      : [entry, ...(state.catchLog || [])];

    // PB is now fully under the angler's control via the isPB checkbox.
    // - Checked: this catch becomes / stays the species' PB.
    // - Unchecked: if it was the PB, the PB record is removed.
    const patch = { catchLog: nextCatchLog };
    if (entry.speciesId) {
      const currentPB = state.pbs?.[entry.speciesId];
      const isCurrentPB = currentPB && currentPB.catchId === entry.id;
      if (isPB) {
        // Build / replace the PB record from this catch's data.
        const primaryMetric = entry.weight != null
          ? 'weight'
          : (entry.length != null ? 'length' : (currentPB?.primaryMetric || 'weight'));
        let history = currentPB?.history || [];
        // Demote the previous PB into history if we're displacing it.
        if (currentPB && currentPB.catchId !== entry.id) {
          history = [...history, {
            length: currentPB.length, weight: currentPB.weight,
            primaryMetric: currentPB.primaryMetric, date: currentPB.date,
            catchId: currentPB.catchId, beatenOn: new Date().toISOString().slice(0, 10),
          }];
        }
        patch.pbs = {
          ...(state.pbs || {}),
          [entry.speciesId]: {
            length: entry.length, weight: entry.weight,
            primaryMetric, date: when.toISOString().slice(0, 10),
            location: (entry.lat != null && entry.lon != null) ? `${entry.lat.toFixed(5)}°, ${entry.lon.toFixed(5)}°` : (currentPB?.location || ''),
            lat: entry.lat, lon: entry.lon,
            notes: entry.notes || '',
            gearBait: currentPB?.gearBait || '',
            jurisdiction: entry.jurisdiction,
            photos: entry.photos.slice(0, 3),
            photo: entry.photos[0] || null, // legacy mirror
            catchId: entry.id,
            history,
          },
        };
      } else if (isCurrentPB) {
        // Un-check: this catch used to be the PB; drop the PB record.
        const nextPbs = { ...(state.pbs || {}) };
        delete nextPbs[entry.speciesId];
        patch.pbs = nextPbs;
      }
    }

    update(patch);
    // Best-effort research publish — no-op if cloud not configured or
    // the angler hasn't opted in. Local log is canonical regardless.
    publishCatch(entry, state.research).catch(() => {});
    onDone();
  };

  const speciesSorted = useMemo(() => SPECIES.slice().sort((a, b) => a.commonName.localeCompare(b.commonName)), []);

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>{isEdit ? 'Edit catch' : 'Log a catch'}</H1>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel>Photos</SectionLabel>
          <span style={{ fontSize: 11, color: T.inkMute }}>{photos.length} / 3</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {[0, 1, 2].map(i => {
            const p = photos[i];
            if (p) {
              return (
                <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: i === 0 ? `1.5px solid ${T.brass}` : `1px solid ${T.cardEdge}` }}>
                  <img src={p} alt={`Catch photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {i === 0 && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(25, 212, 242, 0.92)', color: T.oceanDeep,
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textAlign: 'center',
                      padding: '3px 4px',
                    }}>
                      LOCATION + TIME
                    </div>
                  )}
                  <button onClick={() => removePhotoAt(i)} aria-label="Remove photo" style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'rgba(3, 27, 51, 0.85)', color: T.parchment,
                    border: `1px solid ${T.cardEdge}`, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                  }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            }
            const isNext = i === photos.length;
            return (
              <button
                key={i}
                type="button"
                onClick={isNext ? () => uploadRef.current?.click() : undefined}
                disabled={!isNext}
                aria-label={isNext ? 'Add photo' : 'Empty photo slot'}
                style={{
                  aspectRatio: '1 / 1', borderRadius: 8,
                  border: `1.5px dashed ${isNext ? T.brass : T.cardEdge}`,
                  background: 'transparent',
                  color: isNext ? T.brass : T.inkMute,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  opacity: isNext ? 1 : 0.5,
                  cursor: isNext ? 'pointer' : 'default',
                  padding: 0, gap: 4,
                }}
              >
                <Camera size={22} />
                {isNext && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8 }}>ADD</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginBottom: 10, lineHeight: 1.45, padding: '6px 8px', background: T.parchmentDeep, borderRadius: 6 }}>
          <strong style={{ color: T.brass }}>Photo 1</strong> sets the catch's location &amp; time. If Photo 1 was taken away from the catch spot (e.g. at the dock), edit the location and time below.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => cameraRef.current?.click()} disabled={photos.length >= 3} style={{
            flex: 1, background: photos.length >= 3 ? '#2A3E4D' : T.brass,
            color: photos.length >= 3 ? T.inkMute : T.oceanDeep, border: 'none',
            padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 800,
            letterSpacing: 0.4, cursor: photos.length >= 3 ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Camera size={16} /> Take photo
          </button>
          <button onClick={() => uploadRef.current?.click()} disabled={photos.length >= 3} style={{
            flex: 1, background: 'transparent',
            color: photos.length >= 3 ? T.inkMute : T.brass,
            border: `1.5px solid ${photos.length >= 3 ? T.cardEdge : T.brass}`,
            padding: '10px 12px', borderRadius: 8, fontSize: 13, fontWeight: 800,
            letterSpacing: 0.4, cursor: photos.length >= 3 ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <ImageIcon size={16} /> Upload photo
          </button>
        </div>
        <div style={{ fontSize: 11, color: T.inkMute, marginTop: 8, lineHeight: 1.45 }}>
          {photos.length >= 3
            ? 'Maximum of 3 photos. Remove one to add a different photo.'
            : photoSource === 'upload'
              ? 'Location read from the most recently uploaded photo.'
              : photoSource === 'camera'
                ? 'Location set from your current GPS.'
                : 'Take a photo to use your current location, or upload an existing photo to use the location from the file.'}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleCameraPick} style={{ display: 'none' }} />
        <input ref={uploadRef} type="file" accept="image/*" multiple onChange={handleUploadPick} style={{ display: 'none' }} />
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Species</SectionLabel>
        <select value={speciesId} onChange={e => setSpeciesId(e.target.value)} style={{ ...inputStyle, padding: '10px 12px' }}>
          <option value="">— pick a species —</option>
          {speciesSorted.map(s => <option key={s.id} value={s.id}>{s.commonName}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Field label={`Length (${state.units === 'metric' ? 'cm' : 'in'})`} value={length} onChange={setLength} type="number" placeholder="—" />
          <Field label={`Weight (${state.units === 'metric' ? 'kg' : 'lb'})`} value={weight} onChange={setWeight} type="number" placeholder="—" />
        </div>
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Notes</SectionLabel>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Lure, depth, bite, anything memorable…" style={{ ...inputStyle, resize: 'vertical' }} />
        </div>

        {/* Personal Best toggle */}
        {(() => {
          if (!speciesId) return null;
          const sName = speciesById(speciesId)?.commonName || 'this species';
          const otherPB = state.pbs?.[speciesId];
          const otherPBIsThisCatch = otherPB && existing && otherPB.catchId === existing.id;
          const wouldReplace = isPB && otherPB && !otherPBIsThisCatch;
          return (
            <label style={{
              marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: 10, borderRadius: 6,
              background: isPB ? T.parchmentDeep : 'transparent',
              border: `1px solid ${isPB ? T.brass : T.cardEdge}`,
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={isPB}
                onChange={(e) => setIsPB(e.target.checked)}
                style={{ marginTop: 2, width: 18, height: 18, accentColor: T.brass, cursor: 'pointer' }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: T.ink }}>
                  <Trophy size={14} color={T.brass} /> Personal Best for {sName}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: T.inkMute, marginTop: 4, lineHeight: 1.4 }}>
                  {wouldReplace
                    ? `Saving will replace the current PB (${otherPB.primaryMetric === 'weight' ? formatWeight(otherPB.weight, state.units) : formatSize(otherPB.length, state.units)} on ${otherPB.date}) and move it to history.`
                    : isPB && otherPBIsThisCatch
                      ? 'This catch is currently your PB. Uncheck to remove the PB designation; the catch stays in your log.'
                      : !isPB && otherPBIsThisCatch
                        ? 'Unchecked — saving will remove this catch from being your PB.'
                        : !isPB && otherPB
                          ? `Existing PB on file: ${otherPB.primaryMetric === 'weight' ? formatWeight(otherPB.weight, state.units) : formatSize(otherPB.length, state.units)} (${otherPB.date}).`
                          : 'Off by default — check this to mark the catch as your PB.'}
                </span>
              </span>
            </label>
          );
        })()}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Auto-captured</SectionLabel>
        {photoExifStatus === 'none' && (
          <div style={{ fontSize: 11, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had no location or time metadata — set them manually below or use device GPS.
          </div>
        )}
        {photoExifStatus === 'gps' && (
          <div style={{ fontSize: 11, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had location but no time — set the time manually below if needed.
          </div>
        )}
        {photoExifStatus === 'time' && (
          <div style={{ fontSize: 11, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had time but no location — use device GPS or enter coordinates manually.
          </div>
        )}
        <DetailRow label="Time" value={
          editingWhen ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input type="datetime-local" value={whenInput} onChange={e => setWhenInput(e.target.value)} style={{ padding: '4px 6px', fontSize: 12, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <button onClick={saveEditWhen} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingWhen(false)} style={{ background: 'transparent', color: T.inkMute, border: `1px solid ${T.cardEdge}`, padding: '3px 6px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
            </span>
          ) : (
            <span>
              {when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              {metaSource === 'photo' && <span style={{ color: T.brass, fontSize: 11, marginLeft: 6 }}>· from Photo 1</span>}
              {metaSource === 'manual' && <span style={{ color: T.brass, fontSize: 11, marginLeft: 6 }}>· manual</span>}
              <button onClick={startEditWhen} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, marginLeft: 6, cursor: 'pointer' }}>Edit</button>
            </span>
          )
        } />
        <DetailRow label="Location" value={
          editingLoc ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input type="number" step="any" value={latInput} onChange={e => setLatInput(e.target.value)} placeholder="Lat" style={{ width: 80, padding: '4px 6px', fontSize: 12, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <input type="number" step="any" value={lonInput} onChange={e => setLonInput(e.target.value)} placeholder="Lon" style={{ width: 90, padding: '4px 6px', fontSize: 12, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <button onClick={saveEditLoc} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingLoc(false)} style={{ background: 'transparent', color: T.inkMute, border: `1px solid ${T.cardEdge}`, padding: '3px 6px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>Cancel</button>
            </span>
          ) : loc.loading ? (
            <span>Acquiring GPS… <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Enter manually</button></span>
          ) : loc.error ? (
            <span>Unavailable — {loc.error}. <button onClick={fetchGps} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Retry</button> <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Enter manually</button></span>
          ) : (loc.lat == null || loc.lon == null) ? (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
              <span style={{ color: T.inkMute }}>Not set —</span>
              <button onClick={() => setPickerOpen(true)} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Pin on map</button>
              <button onClick={useDeviceGps} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Use device GPS</button>
              <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Enter manually</button>
            </span>
          ) : (
            <span>
              {loc.lat.toFixed(5)}°, {loc.lon.toFixed(5)}°
              {metaSource === 'photo' && <span style={{ color: T.brass, fontSize: 11, marginLeft: 6 }}>· from Photo 1</span>}
              {metaSource === 'manual' && <span style={{ color: T.brass, fontSize: 11, marginLeft: 6 }}>· manual</span>}
              {metaSource === 'pin' && <span style={{ color: T.brass, fontSize: 11, marginLeft: 6 }}>· pinned</span>}
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={() => setPickerOpen(true)} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Pin on map</button>
                <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Edit</button>
                <button onClick={useDeviceGps} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Device GPS</button>
              </div>
            </span>
          )
        } />
        {sun && <DetailRow label="Sun" value={`${sun.altitudeDeg.toFixed(1)}° altitude · ${compassDir(sun.azimuthDeg)} (${sun.azimuthDeg.toFixed(0)}°)`} />}
        <DetailRow label="Moon" value={`${moon.name} · ${Math.round(moon.illumination * 100)}% illum`} />
        <DetailRow label="Weather" value={
          wxStatus === 'loading' ? 'Fetching…'
          : wxStatus === 'offline' ? 'Offline — skipped'
          : weather ? `${Math.round(weather.tempF)}°F · ${Math.round(weather.windMph)} mph ${compassDir(weather.windDir || 0)} · ${Math.round(weather.cloudPct)}% cloud`
          : 'Waiting for GPS…'
        } />
      </Card>

      <div style={{ display: 'flex', gap: 8 }}>
        <GhostButton onClick={onCancel} style={{ flex: 1 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={!canSave} style={{ flex: 2 }}>{isEdit ? 'Save changes' : 'Save catch'}</PrimaryButton>
      </div>

      {pickerOpen && (
        <LocationPickerModal
          initialLat={loc.lat}
          initialLon={loc.lon}
          onClose={() => setPickerOpen(false)}
          onSave={({ lat, lon }) => {
            setLoc({ lat, lon, error: null, loading: false });
            setMetaSource('pin');
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   QUIZ — Fish ID + regulation knowledge flashcards
   ============================================================ */

const _shuffle = (arr) => arr.slice().sort(() => Math.random() - 0.5);

// Species-ID question: a photo, pick the species. Distractors are
// pulled from the same category first so the question actually tests
// telling lookalikes apart instead of "tuna or shark".
function pickSpeciesQuestion(prevSpeciesId = null) {
  const candidates = SPECIES.filter(s => {
    const p = speciesPhoto(s.id);
    return p && p.url && s.id !== prevSpeciesId;
  });
  if (candidates.length < 4) return null;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const pool = candidates.filter(s => s.id !== correct.id);
  const sameCat = pool.filter(s => s.category === correct.category);
  const distractors = [..._shuffle(sameCat).slice(0, 2), ..._shuffle(pool.filter(s => s.category !== correct.category))].slice(0, 3);
  for (const s of _shuffle(pool)) {
    if (distractors.length >= 3) break;
    if (!distractors.some(d => d.id === s.id)) distractors.push(s);
  }
  return {
    type: 'species',
    species: correct,
    prompt: 'What species is this?',
    options: _shuffle([correct, ...distractors]).map(s => ({
      key: s.id, label: s.commonName, isCorrect: s.id === correct.id,
    })),
  };
}

const _BAG_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 10, 15, 20];

function pickBagLimitQuestion(jurisdiction, prevSpeciesId = null) {
  const candidates = SPECIES.filter(s => {
    if (s.id === prevSpeciesId) return false;
    const reg = REGULATIONS[s.id]?.[jurisdiction.id];
    return reg && reg.bagLimit != null;
  });
  if (candidates.length === 0) return null;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const limit = REGULATIONS[correct.id][jurisdiction.id].bagLimit;
  const distractors = _shuffle(_BAG_OPTIONS.filter(n => n !== limit)).slice(0, 3);
  const opts = _shuffle([limit, ...distractors]).map(n => ({
    key: 'bag-' + n, label: n === 0 ? '0 (no take)' : `${n} per angler`, isCorrect: n === limit,
  }));
  return {
    type: 'bag', species: correct,
    prompt: <>What's the daily bag limit for <strong>{correct.commonName}</strong> in {jurisdiction.short}?</>,
    options: opts,
  };
}

function pickSizeLimitQuestion(jurisdiction, units, prevSpeciesId = null) {
  const candidates = SPECIES.filter(s => {
    if (s.id === prevSpeciesId) return false;
    const reg = REGULATIONS[s.id]?.[jurisdiction.id];
    return reg && reg.minSize != null;
  });
  if (candidates.length === 0) return null;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const size = REGULATIONS[correct.id][jurisdiction.id].minSize;
  const pool = [size - 6, size - 4, size - 2, size + 2, size + 4, size + 6, 12, 14, 16, 18, 20, 24, 28];
  const distractors = _shuffle([...new Set(pool)].filter(n => n !== size && n > 0)).slice(0, 3);
  const opts = _shuffle([size, ...distractors]).map(n => ({
    key: 'size-' + n, label: formatSize(n, units), isCorrect: n === size,
  }));
  return {
    type: 'size', species: correct,
    prompt: <>What's the minimum size for <strong>{correct.commonName}</strong> in {jurisdiction.short}?</>,
    options: opts,
  };
}

function pickQuizQuestion(state, jurisdiction, prevSpeciesId = null) {
  // Without a jurisdiction set we can't ask reg questions — fall back
  // to species ID only.
  if (!jurisdiction) return pickSpeciesQuestion(prevSpeciesId);
  const types = ['species', 'bag', 'size'];
  const pick = types[Math.floor(Math.random() * types.length)];
  const q = pick === 'bag' ? pickBagLimitQuestion(jurisdiction, prevSpeciesId)
          : pick === 'size' ? pickSizeLimitQuestion(jurisdiction, state.units, prevSpeciesId)
          : pickSpeciesQuestion(prevSpeciesId);
  // If a reg-question pool is empty for the chosen jurisdiction,
  // fall back to species so the angler always gets something.
  return q || pickSpeciesQuestion(prevSpeciesId);
}

export function QuizScreen({ state, jurisdiction, onPickSpecies, onBack }) {
  const [question, setQuestion] = useState(() => pickQuizQuestion(state, jurisdiction));
  const [selectedKey, setSelectedKey] = useState(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [streak, setStreak] = useState(0);

  const next = () => {
    setSelectedKey(null);
    setQuestion(pickQuizQuestion(state, jurisdiction, question?.species?.id));
  };

  const pick = (opt) => {
    if (selectedKey) return;
    setSelectedKey(opt.key);
    setScore(({ right, total }) => ({ right: right + (opt.isCorrect ? 1 : 0), total: total + 1 }));
    setStreak(prev => opt.isCorrect ? prev + 1 : 0);
  };

  if (!question) {
    return (
      <div style={{ padding: 20, color: T.inkSoft }}>
        Quiz needs at least 4 species with photos on file. Check back once more photos are uploaded.
      </div>
    );
  }

  const sp = question.species;
  const photo = speciesPhoto(sp.id);
  const selectedOpt = question.options.find(o => o.key === selectedKey);
  const correctOpt = question.options.find(o => o.isCorrect);
  const isCorrect = !!selectedOpt?.isCorrect;
  const reg = jurisdiction ? REGULATIONS[sp.id]?.[jurisdiction.id] : null;
  const status = reg ? seasonState(reg.open).status : 'unknown';

  const typeLabel = {
    species: 'Spot the species from the photo.',
    bag: 'Recall the daily bag limit for this species in your waters.',
    size: 'Recall the minimum legal size for this species in your waters.',
  }[question.type];

  // For bag / size questions we show the species photo + name in the
  // prompt (so the angler knows what fish they're answering about).
  // For the species-ID question we hide the name until they answer.
  const revealSpeciesName = question.type !== 'species';

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <H1 size={22}>Fish ID Quiz</H1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: T.inkSoft }}>
          <span>{score.right} / {score.total}</span>
          {streak >= 2 && <span style={{ color: T.brass, fontWeight: 800 }}>{streak} streak</span>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 14 }}>
        {typeLabel}
      </div>

      {/* Photo */}
      <div style={{
        background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
        borderRadius: 14, border: `1px solid ${T.cardEdge}`,
        height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginBottom: revealSpeciesName ? 6 : 14,
        position: 'relative',
      }}>
        {photo?.url
          ? <img src={photo.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          : <SpeciesImage species={sp} size={200} style={{ height: 200 }} />}
      </div>
      {revealSpeciesName && (
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: T.ink, marginBottom: 14, textAlign: 'center' }}>
          {sp.commonName}
        </div>
      )}

      {/* Prompt */}
      <div style={{ fontSize: 13, color: T.inkSoft, margin: '0 2px 10px', lineHeight: 1.5 }}>
        {question.prompt}
      </div>

      {/* Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.options.map(opt => {
          const isPicked = selectedKey === opt.key;
          let bg = T.card, border = T.cardEdge, color = T.ink, iconNode = null;
          if (selectedKey) {
            if (opt.isCorrect) { bg = T.openBg; border = T.open; color = T.open; iconNode = <CheckCircle2 size={18} color={T.open} />; }
            else if (isPicked) { bg = T.closedBg; border = T.closed; color = T.closed; iconNode = <X size={18} color={T.closed} />; }
            else { color = T.inkMute; }
          }
          return (
            <button key={opt.key} onClick={() => pick(opt)} disabled={!!selectedKey} style={{
              background: bg, border: `1.5px solid ${border}`, borderRadius: 10,
              padding: '12px 14px', cursor: selectedKey ? 'default' : 'pointer',
              textAlign: 'left', color, fontSize: 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>{opt.label}</span>
              {iconNode}
            </button>
          );
        })}
      </div>

      {/* Result + species review */}
      {selectedKey && (
        <Card style={{ marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: isCorrect ? T.open : T.closed, marginBottom: 10 }}>
            {isCorrect
              ? '✓ Correct!'
              : question.type === 'species'
                ? `✗ It's a ${sp.commonName}`
                : `✗ The answer is ${correctOpt?.label}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <SpeciesImage species={sp} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: T.ink }}>
                {sp.commonName}
              </div>
              <div style={{ fontStyle: 'italic', fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                {sp.scientific}
              </div>
              {sp.altNames?.length > 0 && (
                <div style={{ fontSize: 11, color: T.brass, marginTop: 4, letterSpacing: 0.5 }}>
                  also: {sp.altNames.join(' · ')}
                </div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
            {sp.habitat}
          </div>

          <SectionLabel style={{ marginBottom: 6 }}>Key IDs</SectionLabel>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: T.inkSoft, fontSize: 13, lineHeight: 1.55 }}>
            {sp.keyIds.slice(0, 4).map((k, i) => <li key={i}>{k}</li>)}
          </ul>

          {jurisdiction && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <SectionLabel>Regulations — {jurisdiction.short}</SectionLabel>
                <StatusPill status={status} size="small" />
              </div>
              {reg ? (
                <>
                  <DetailRow label="Season" value={cleanSeason(reg.open) || 'Check source'} />
                  {reg.minSize != null && <DetailRow label="Min size" value={formatSize(reg.minSize, state.units)} />}
                  {reg.maxSize != null && <DetailRow label="Max size" value={formatSize(reg.maxSize, state.units)} />}
                  {reg.bagLimit != null && <DetailRow label="Bag limit" value={reg.bagLimit} />}
                  {reg.notes && <DetailRow label="Notes" value={reg.notes} />}
                </>
              ) : (
                <div style={{ fontSize: 12, color: T.inkMute, padding: 8 }}>
                  No regulations on file for this species in {jurisdiction.name}.
                </div>
              )}
            </>
          )}

          {onPickSpecies && (
            <button onClick={() => onPickSpecies(sp.id)} style={{
              marginTop: 12, background: 'transparent', color: T.brass,
              border: 'none', padding: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              Full species page <ChevronRight size={12} />
            </button>
          )}
        </Card>
      )}

      {selectedKey && (
        <PrimaryButton onClick={next} style={{ marginTop: 14 }}>
          Next question
          <ChevronRight size={16} style={{ display: 'inline', marginLeft: 6, verticalAlign: 'middle' }} />
        </PrimaryButton>
      )}
    </div>
  );
}
