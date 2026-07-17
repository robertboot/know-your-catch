import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search, ChevronRight, AlertTriangle, Plus, Pencil, Trophy, Camera, Trash2, Mail,
  Wrench, Ruler, Star, Share2, Image as ImageIcon, BookOpen, CheckCircle2, X, Brain,
  SlidersHorizontal, Sparkles, ShieldCheck, ShieldAlert, ShieldQuestion,
  MapPin as MapPinIcon, Crop as CropIcon, Calendar as CalendarIcon, Fish as FishIcon,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, SPECIES,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { saveState } from './storage.js';
import {
  savePhoto, deletePhoto, photoThumbUrl, photoDisplayUrl, photoAsDataUrl,
} from './photos-store.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, cleanSeason, seasonState, speciesPhoto,
  sunPosition, moonPhase, buildPBReport, buildCatchReport, pbPhotos, catchPhotos, appleMapsLink,
  shareReport, fetchWeatherForTime, PROHIBITED_RE,
} from './helpers.js';

/* <img> wrapper that falls back to the inline thumb data URL when
   the primary display URL (usually a capacitor:// file URL) fails
   to load. On iOS the local file path baked into `p.src` at save
   time can go stale between installs — the thumb is always inline
   and never breaks. */
// PhotoImg is now shared — imported below from components.jsx so the
// PB Spotlight and this screen use one resolver + one fallback path.

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
  DetailRow, Field, PickButton, SpeciesRow, StarButton, LightboxModal,
  PhotoImg, CropStep,
  inputStyle,
} from './components.jsx';
import { AccountSection } from './auth-ui.jsx';
import { getMyPreferences, optOutOfFeatureEmails } from './preferences-store.js';
import { useScreenSize } from './screen-size.js';
import { getLocation, getPhoto, isNative } from './native.js';
import { SpeciesPickerModal, SpeciesSuggestModal } from './admin/pickers.jsx';
import { newClientSpeciesId, submitSuggestion } from './species-suggestions-store.js';
import { identifyPhoto } from './identifyPhoto.js';
import { getCategories, categoryById, subscribe as subscribeCategories } from './categories-store.js';
import { regulationFor, regulationAge } from './regulations-store.js';
import exifr from 'exifr';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/* ============================================================
   SPECIES DETAIL
   ============================================================ */
export function SpeciesDetailScreen({ id, state, jurisdiction, stale, onLookalike, onAddPB, onFullRegs, onKeep, update }) {
  const { size, type } = useScreenSize();
  const s = speciesById(id);
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [noteDraft, setNoteDraft] = useState(state.notes[id] || '');
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (!s) return <div style={{ padding: 20 }}>Species not found.</div>;
  const photo = speciesPhoto(s.id);
  const heroMaxWidth = size === 'phone' ? 360 : size === 'tablet' ? 480 : 560;
  const heroHeight   = size === 'phone' ? 220 : size === 'tablet' ? 300 : 340;
  const fallbackSize = size === 'phone' ? 100 : 200;
  const reg = jurisdiction ? regulationFor(id, jurisdiction.id).regulation : null;
  const fedReg = regulationFor(id, 'fed_gulf').regulation;
  // No comparison column when the state view is ALREADY showing the
  // federal rules via fallback — it would compare federal to itself.
  const showFedColumn = reg && fedReg && !reg._fromFed
    && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
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
                width: '100%', maxWidth: heroMaxWidth, height: heroHeight, margin: '0 auto',
                background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
                borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', position: 'relative',
              }}
            >
              <img src={photo.url} alt={s.commonName} loading="lazy"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
              <div aria-hidden style={{
                position: 'absolute', bottom: 6, right: 8,
                background: 'rgba(3, 27, 51, 0.7)', color: T.brass,
                fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
                padding: '3px 7px', borderRadius: 4,
              }}>TAP TO ENLARGE</div>
            </div>
            {photo.credit && <div style={{ fontSize: 10, color: '#8aa0ac', marginTop: 4 }}>{photo.credit} · {photo.license}</div>}
          </>
        ) : (
          <SpeciesImage species={s} size={fallbackSize} />
        )}
        <H1 size={type.h1} style={{ color: T.parchment, marginTop: 8 }}>{s.commonName}</H1>
        <div style={{ fontStyle: 'italic', fontSize: 15, color: '#B8C5CD', marginTop: 4 }}>{s.scientific}</div>
        {s.altNames.length > 0 && (
          <div style={{ fontSize: 12, color: T.brass, marginTop: 8, letterSpacing: 0.5 }}>
            ALSO: {s.altNames.join(' · ')}
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          {s.hms && <span style={{ background: T.warnBg, color: T.brassDeep, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 1, marginRight: 6 }}>HMS PERMIT</span>}
          {s.reefFish && <span style={{ background: T.openBg, color: T.open, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>REEF FISH</span>}
        </div>
        {pb ? (
          <div style={{
            marginTop: 14,
            background: T.parchmentDeep,
            border: `1.5px solid ${T.brass}`,
            borderRadius: 10,
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
            textAlign: 'left',
          }}>
            <Trophy size={26} color={T.brass} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: T.brass }}>YOUR PERSONAL BEST</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: T.parchment, marginTop: 2 }}>
                {pb.weight != null && `${pb.weight} ${state.units === 'metric' ? 'kg' : 'lb'}`}
                {pb.weight != null && pb.length != null && ' · '}
                {pb.length != null && `${pb.length} ${state.units === 'metric' ? 'cm' : 'in'}`}
                {pb.weight == null && pb.length == null && '—'}
              </div>
              <div style={{ fontSize: 12, color: '#B8C5CD', marginTop: 2 }}>
                {pb.date || (pb.dateIso || '').slice(0, 10) || 'Date unknown'}
                {pb.location ? ` · ${pb.location}` : ''}
              </div>
            </div>
            <button onClick={onAddPB} style={{
              background: 'transparent', color: T.brass,
              border: `1px solid ${T.brass}`,
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 800, letterSpacing: 0.6,
              cursor: 'pointer', flexShrink: 0,
            }}>
              <Pencil size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
              EDIT
            </button>
          </div>
        ) : (
          <button onClick={onAddPB} style={{
            marginTop: 14, background: T.brass, color: T.oceanDeep, border: 'none',
            padding: '10px 16px', borderRadius: 8, fontSize: 15, fontWeight: 800,
            letterSpacing: 0.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Trophy size={14} /> Add Personal Best
          </button>
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Key identifiers</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 16, lineHeight: 1.6 }}>
          {s.keyIds.map((k, i) => <li key={i}>{k}</li>)}
        </ul>
      </Card>

      {s.lookalikes.length > 0 && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 4 }}>Often confused with</SectionLabel>
          <div style={{ fontSize: 14, color: T.inkMute, marginBottom: 10 }}>Tap to view species details.</div>
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
                    <div style={{ fontWeight: 600, fontSize: 16, color: T.ink }}>{o.commonName}</div>
                    <div style={{ fontSize: 12, color: T.inkMute, fontStyle: 'italic' }}>{o.scientific}</div>
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
          {jurisdiction && <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 600 }}>{jurisdiction.short}</span>}
        </div>
        {!jurisdiction ? (
          <div style={{ fontSize: 15, color: T.inkMute, padding: 8 }}>Set your fishing waters from the home screen to see rules.</div>
        ) : !reg ? (
          <div style={{ fontSize: 15, color: T.inkMute, padding: 8 }}>No regulations on file for this species in this jurisdiction.</div>
        ) : (
          <>
            {stale && (
              <div style={{ background: T.warnBg, border: `1.5px solid ${T.warn}`, padding: '8px 10px', borderRadius: 4, fontSize: 14, color: T.brassDeep, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} /> Data is stale — refresh when online.
              </div>
            )}
            <RegBlock reg={reg} units={state.units} jurisdiction={jurisdiction} fedColumn={showFedColumn ? fedReg : null} />
            <button onClick={onFullRegs} style={{ background: 'transparent', border: 'none', color: T.brass, fontWeight: 600, cursor: 'pointer', fontSize: 15, marginTop: 10, padding: 0 }}>
              View full regulation details →
            </button>
            {seasonState(reg.open).status === 'open' && (
              <button onClick={() => onKeep(s)} style={{
                background: T.brass, color: T.oceanDeep, border: 'none', padding: '10px 14px',
                borderRadius: 4, fontSize: 15, fontWeight: 700, letterSpacing: 0.5, cursor: 'pointer',
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
        {s.habitat && (
          <div style={{ fontSize: 16, color: T.inkSoft, lineHeight: 1.5, marginBottom: 6 }}>{s.habitat}</div>
        )}
        {s.typicalSize && (
          <div style={{ fontSize: 14, color: T.inkMute }}>Typical size: {s.typicalSize}</div>
        )}
        {(s.typicalLengthIn || s.typicalWeightLb || s.worldRecordLb) && (
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>
            {s.typicalLengthIn && <>Length: {s.typicalLengthIn} in</>}
            {s.typicalLengthIn && s.typicalWeightLb && <> · </>}
            {s.typicalWeightLb && <>Weight: {s.typicalWeightLb} lb</>}
            {(s.typicalLengthIn || s.typicalWeightLb) && s.worldRecordLb && <> · </>}
            {s.worldRecordLb && <>World record: {s.worldRecordLb} lb</>}
          </div>
        )}
        {s.geoRange && (
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>Range: {s.geoRange}</div>
        )}
        {s.edibility && (
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4, textTransform: 'capitalize' }}>
            Edibility: {s.edibility}
          </div>
        )}
        {s.seasonality && (
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4, fontStyle: 'italic' }}>
            {s.seasonality}
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 6 }}>My notes</SectionLabel>
        {!showNoteEdit && state.notes[id] && (
          <div style={{ fontSize: 15, color: T.inkSoft, fontStyle: 'italic', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{state.notes[id]}</div>
        )}
        {!showNoteEdit && !state.notes[id] && (
          <div style={{ fontSize: 14, color: T.inkMute, marginBottom: 8 }}>Personal notes saved on this device.</div>
        )}
        {showNoteEdit ? (
          <>
            <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={3} placeholder="My favorite spots, gear that works…" style={{ ...inputStyle, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <PrimaryButton onClick={saveNote} style={{ padding: '8px 12px', fontSize: 15 }}>Save</PrimaryButton>
              <GhostButton onClick={() => { setShowNoteEdit(false); setNoteDraft(state.notes[id] || ''); }} style={{ padding: '8px 12px', fontSize: 15 }}>Cancel</GhostButton>
            </div>
          </>
        ) : (
          <GhostButton onClick={() => setShowNoteEdit(true)} style={{ padding: '8px 12px', fontSize: 15 }}>
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
              <div style={{ marginTop: 6, fontFamily: 'Georgia, serif', fontSize: 19, color: T.ink, fontWeight: 600 }}>
                {pb.primaryMetric === 'weight' ? formatWeight(pb.weight, state.units) : formatSize(pb.length, state.units)}
                <span style={{ fontSize: 14, color: T.inkMute, marginLeft: 8, fontFamily: 'inherit', fontWeight: 400 }}>
                  · {pb.date}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: T.inkMute, marginTop: 4 }}>No PB recorded yet.</div>
            )}
          </div>
          <button onClick={onAddPB} style={{
            background: T.ocean, color: T.parchment, border: 'none', padding: '8px 12px',
            borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
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
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

/* Footer for verified regulations. Shows verified date + source
   domain (extracted from source_url), plus a tap-to-verify link
   opening the source in the system browser. Compliance-hardening:
   angler sees freshness AND has a path to authoritative source. */
function VerifiedRegFooter({ row, jurisdiction, isTablet }) {
  const age = regulationAge(row);
  const verifiedDate = row.verified_at
    ? new Date(row.verified_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  let sourceDomain = null;
  if (row.source_url) {
    try { sourceDomain = new URL(row.source_url).hostname.replace(/^www\./, ''); }
    catch { sourceDomain = null; }
  }
  const agency = jurisdiction?.agency || 'your state agency';
  const ageColor = age.tier === 'fresh' ? T.inkMute
                 : age.tier === 'aging' ? T.brass
                 :                        T.warn;
  return (
    <div style={{
      marginTop: isTablet ? 16 : 12,
      paddingTop: isTablet ? 12 : 10,
      borderTop: `1px dashed ${T.cardEdge}`,
      fontSize: isTablet ? 12 : 11,
      color: ageColor,
      fontStyle: 'italic', lineHeight: 1.5,
    }}>
      Regulations last verified {verifiedDate || 'recently'}
      {sourceDomain ? <> against <strong style={{ fontStyle: 'normal', color: ageColor }}>{sourceDomain}</strong></> : null}.
      {' '}Always check with {agency} before keeping fish.
      {row.source_url && (
        <>
          {' '}
          <a
            href={row.source_url}
            target="_blank" rel="noopener noreferrer"
            style={{
              color: T.brass, textDecoration: 'underline',
              textDecorationThickness: '1px',
              fontStyle: 'normal',
            }}
          >
            Open source →
          </a>
        </>
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
          <span style={{ fontSize: 16, fontWeight: 700, color: ssColor }}>{ss.reason}</span>
        )}
      </div>
      <div style={{ border: `1px solid ${T.cardEdge}`, borderRadius: 4, overflow: 'hidden' }}>
        {fedColumn && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: T.parchmentDeep, borderBottom: `1px solid ${T.cardEdge}`, fontSize: 12, fontWeight: 700, color: T.brassDeep, padding: '6px 10px', letterSpacing: 0.6 }}>
            <span></span>
            <span style={{ textAlign: 'right' }}>{jurisdiction.short}</span>
            <span style={{ textAlign: 'right' }}>FED</span>
          </div>
        )}
        {rows.filter(r => r.val !== '—' || r.fed && r.fed !== '—').map((r, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: fedColumn ? '1fr 1fr 1fr' : '1fr 1fr',
            padding: '8px 10px', fontSize: 15, borderTop: i > 0 ? `1px solid ${T.cardEdge}55` : 'none', gap: 8,
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
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 14, color: T.inkSoft, lineHeight: 1.55 }}>
            {reg.gear.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </div>
      )}
      {reg.hms && (
        <div style={{ marginTop: 10, padding: 10, background: T.warnBg, border: `1.5px solid ${T.warn}`, borderRadius: 4, fontSize: 14, color: T.brassDeep, display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={16} /> <strong>HMS permit required</strong> — federal Atlantic HMS permit must be aboard.
        </div>
      )}
      {reg.sectors && (
        <div style={{ marginTop: 10, padding: 10, background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Sector-specific</SectionLabel>
          {Object.entries(reg.sectors).map(([sector, txt]) => (
            <div key={sector} style={{ fontSize: 14, marginBottom: 4 }}>
              <strong style={{ color: T.ink }}>{sector}:</strong> <span style={{ color: T.inkSoft }}>{txt}</span>
            </div>
          ))}
        </div>
      )}
      {reg.notes && (
        <div style={{ marginTop: 10, fontSize: 14, color: T.inkSoft, fontStyle: 'italic', lineHeight: 1.5 }}>{reg.notes}</div>
      )}
      <div style={{
        marginTop: 12, padding: 10, borderRadius: 4,
        background: reg.verified ? T.openBg : T.parchmentDeep,
        border: `1px solid ${reg.verified ? T.open : T.cardEdge}`,
      }}>
        <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5, marginBottom: 8 }}>
          {reg.verified ? (
            <><strong style={{ color: T.open }}>Verified — official.</strong> Confirmed against the agency for the current season. Rules can still change in-season; the official page is one tap away.</>
          ) : (
            <><strong style={{ color: T.warn }}>Seed data — not official.</strong> Seasons and limits change in-season. Confirm the current rule with the agency before you keep a fish.</>
          )}
        </div>
        {jurisdiction?.regsUrl && (
          <a href={jurisdiction.regsUrl} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, color: T.brass,
            fontWeight: 700, fontSize: 15, textDecoration: 'none',
          }}>
            Open official {jurisdiction.agency} regulations <ChevronRight size={15} />
          </a>
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: T.inkMute, display: 'flex', justifyContent: 'space-between' }}>
          <span>Source: {reg.source}</span>
          <span>{reg.verified ? 'Verified' : 'Seed'} {reg.lastUpdated}</span>
        </div>
      </div>
    </>
  );
}

/* CompareScreen was removed in build 9. Lookalikes fold into the
   quiz as a dedicated question type; the standalone side-by-side
   comparison flow was low-signal for anglers. Lookalikes list on the
   species detail page now links straight to the other species. */

/* ============================================================
   REGULATIONS LIST + DETAIL
   ============================================================ */
export function RegulationsListScreen({ state, jurisdiction, update, onPick }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
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
      // Bait fish are excluded from every Regulations surface — their
      // rules are cast-net/bait-harvest guidance, not keep/release
      // compliance. Matches the admin + auto-updater grid filter.
      .filter(s => s.category !== 'bait')
      .filter(s => !lower || s.commonName.toLowerCase().includes(lower) || s.altNames.some(a => a.toLowerCase().includes(lower)))
      .map(s => {
        const reg = jurisdiction ? regulationFor(s.id, jurisdiction.id).regulation : null;
        return { s, reg, status: reg ? seasonState(reg.open).status : 'unknown' };
      });
    // Sort: by-type groups by family (live-store category order, alpha
    // within); by-status floats what you can keep right now to the top;
    // by-name is A–Z. Categories come from the live overlay so any admin-
    // added categories sort correctly against their sort_order.
    const statusRank = { unknown: 0, closed: 1, upcoming: 2, open: 3 };
    const catOrder = Object.fromEntries(getCategories().map((c, i) => [c.id, i]));
    list.sort((a, b) => {
      if (sort === 'status') return (statusRank[a.status] - statusRank[b.status]) || a.s.commonName.localeCompare(b.s.commonName);
      if (sort === 'type')   return ((catOrder[a.s.category] ?? 99) - (catOrder[b.s.category] ?? 99)) || a.s.commonName.localeCompare(b.s.commonName);
      return a.s.commonName.localeCompare(b.s.commonName);
    });
    return list;
  }, [q, sort, jurisdiction]);

  const favRows = rows.filter(r => favSet.has(r.s.id));
  const otherRows = rows.filter(r => !favSet.has(r.s.id));

  // Unknown category (species with a category id not currently in the
  // overlay OR the bundled seed) falls back to "Other" — better than
  // dropping the species entirely.
  const catName = (id) => (categoryById(id)?.name) || 'Other';

  const segBtn = (state, set, key, label) => (
    <button onClick={() => set(key)} style={{
      flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
      fontSize: 14, fontWeight: 700, letterSpacing: 0.3,
      background: state === key ? T.brass : T.parchmentDeep,
      color: state === key ? T.oceanDeep : T.inkSoft,
      border: `1.5px solid ${state === key ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  const sectionHeaderSize = isTablet ? (isLandscape ? 14 : 13) : 10;
  const sectionHeaderPad  = isTablet ? '18px 4px 8px' : '10px 4px 4px';
  const rowGap = isTablet ? 10 : 6;

  return (
    <div style={{ padding: isTablet ? '22px 22px 12px' : '16px 16px 8px' }}>
      <H1 size={isTablet ? (isLandscape ? 30 : 28) : 22} style={{ marginBottom: 4 }}>Regulations</H1>
      {jurisdiction && <div style={{ fontSize: isTablet ? 16 : 13, color: T.brassDeep, fontWeight: 600, marginBottom: isTablet ? 16 : 12 }}>{jurisdiction.name}</div>}
      <div style={{ position: 'relative', marginBottom: isTablet ? 14 : 10 }}>
        <Search size={isTablet ? 20 : 16} color={T.inkMute} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search species…" style={{ ...inputStyle, paddingLeft: isTablet ? 40 : 32, fontSize: isTablet ? 16 : undefined, background: T.card }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isTablet ? 8 : 6, marginBottom: isTablet ? 12 : 8 }}>
        <span style={{ fontSize: isTablet ? 13 : 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sort</span>
        {segBtn(sort, setSort, 'type', 'Type')}
        {segBtn(sort, setSort, 'name', 'A–Z')}
        {segBtn(sort, setSort, 'status', 'Status')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, marginTop: 6 }}>
        {favRows.length > 0 && (
          <>
            <div style={{ fontSize: sectionHeaderSize, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: sectionHeaderPad, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Star size={isTablet ? 16 : 12} fill={T.brass} color={T.brass} /> Your fish
            </div>
            {favRows.map(({ s, reg, status }) => (
              <RegRow key={'fav-' + s.id} s={s} reg={reg} status={status} state={state}
                      favorited={true} onToggleFav={() => toggleFav(s.id)} onPick={onPick} isTablet={isTablet} />
            ))}
          </>
        )}
        {(() => {
          const out = []; let lastCat = null;
          for (const { s, reg, status } of otherRows) {
            if (sort === 'type' && s.category !== lastCat) {
              lastCat = s.category;
              out.push(
                <div key={'h-' + s.category} style={{ fontSize: sectionHeaderSize, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: sectionHeaderPad }}>
                  {catName(s.category)}
                </div>
              );
            }
            out.push((
              <RegRow key={s.id} s={s} reg={reg} status={status} state={state}
                      favorited={false} onToggleFav={() => toggleFav(s.id)} onPick={onPick} isTablet={isTablet} />
            ));
          }
          return out;
        })()}
      </div>
    </div>
  );
}

function RegRow({ s, reg, status, state, favorited, onToggleFav, onPick, isTablet = false }) {
  const imgSize   = isTablet ? 60 : 38;
  const nameSize  = isTablet ? 21 : 15;
  const metaSize  = isTablet ? 15 : 11;
  const cardPad   = isTablet ? 14 : 10;
  const cardGap   = isTablet ? 14 : 10;
  const starSize  = isTablet ? 26 : 18;
  return (
    <Card onClick={() => onPick(s.id)} style={{ display: 'flex', gap: cardGap, alignItems: 'center', padding: cardPad }}>
      <SpeciesImage species={s} size={imgSize} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: nameSize, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
        <div style={{ fontSize: metaSize, color: T.inkMute, marginTop: isTablet ? 4 : 2 }}>
          {reg ? `Min ${formatSize(reg.minSize, state.units)} · Bag ${reg.bagLimit ?? '—'}` : 'No data'}
        </div>
      </div>
      <StatusPill status={status} size={isTablet ? 'large' : 'small'} />
      <StarButton favorited={favorited} onToggle={onToggleFav} size={starSize} />
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
        <div style={{ fontSize: 15, color: T.brassDeep, fontWeight: 600 }}>
          {jurisdiction ? jurisdiction.name : 'No waters selected'}
        </div>
        <button onClick={onChangeJurisdiction} style={{
          background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
          padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800,
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
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Total length</div>
            <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
              Tip of the closed mouth to the tip of the tail, with the tail squeezed together for the longest measurement.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Fork length</div>
            <div style={{ fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
              Tip of the mouth to the center of the fork in the tail. Used for many pelagics.
            </div>
          </div>
          <div style={{ fontSize: 14, color: T.inkMute, lineHeight: 1.5, borderTop: `1px solid ${T.cardEdge}`, paddingTop: 8 }}>
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
          const reg = jurisdiction ? regulationFor(s.id, jurisdiction.id).regulation : null;
          return (
            <Card key={s.id} onClick={() => onPick(s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10 }}>
              <SpeciesImage species={s} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                <div style={{ fontSize: 12, color: T.inkMute, marginTop: 2 }}>
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
export function RegulationAlertsScreen({ state, jurisdiction, onPick, onEditFavorites }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  const buckets = useMemo(() => {
    const favSet = new Set(state?.favorites || []);
    if (!jurisdiction) return { yourClosed: [], otherClosed: [], yourUnknown: [], otherUnknown: [], favSet };
    const yourClosed = [], otherClosed = [], yourUnknown = [], otherUnknown = [];
    for (const s of SPECIES) {
      if (s.category === 'bait') continue; // no bait on regs surfaces
      const reg = regulationFor(s.id, jurisdiction.id).regulation;
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

  const rowImgSize   = isTablet ? 60 : 38;
  const rowNameSize  = isTablet ? 21 : 15;
  const rowMetaSize  = isTablet ? 14 : 11;
  const rowPad       = isTablet ? 14 : 10;
  const rowGap       = isTablet ? 14 : 12;
  const chevronSize  = isTablet ? 20 : 14;
  const pillSize     = isTablet ? 'large' : 'small';

  const renderRow = ({ s, reg }, opts = {}) => (
    <Card key={s.id} onClick={() => onPick(s.id)} style={{ display: 'flex', gap: rowGap, alignItems: 'center', padding: rowPad, borderColor: opts.accentBorder || T.cardEdge }}>
      <SpeciesImage species={s} size={isTablet ? rowImgSize : (opts.imgSize || 38)} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: rowNameSize, fontWeight: 600, color: T.ink }}>{s.commonName}</span>
          {buckets.favSet.has(s.id) && <Star size={isTablet ? 16 : 12} fill={T.brass} color={T.brass} />}
        </div>
        {opts.showSeason && <div style={{ fontSize: rowMetaSize, color: T.inkMute, marginTop: isTablet ? 4 : 2 }}>{cleanSeason(reg?.open) || 'Season closed'}</div>}
      </div>
      <StatusPill status={opts.status} size={pillSize} />
      <ChevronRight size={chevronSize} color={T.brass} />
    </Card>
  );

  return (
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px' }}>
      <H1 size={isTablet ? (isLandscape ? 30 : 28) : 22} style={{ marginBottom: 4 }}>Regulation Alerts</H1>
      {jurisdiction && <div style={{ fontSize: isTablet ? 16 : 13, color: T.brassDeep, fontWeight: 600, marginBottom: isTablet ? 18 : 14 }}>{jurisdiction.name}</div>}

      {/* PRIORITY: Your starred fish that are closed right now. */}
      {hasAnyFavorites && (
        buckets.yourClosed.length > 0 ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 10px' }}>
              <Star size={14} fill={T.brass} color={T.brass} />
              <SectionLabel style={{ color: T.closed, flex: 1 }}>Your fish — closed ({buckets.yourClosed.length})</SectionLabel>
              {onEditFavorites && (
                <button onClick={onEditFavorites} aria-label="Edit your starred fish"
                  style={{
                    background: 'transparent', color: T.brass,
                    border: `1px solid ${T.brass}`,
                    padding: '4px 10px', borderRadius: 6,
                    fontSize: 11.5, fontWeight: 800, letterSpacing: 1,
                    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                  <Pencil size={11} /> EDIT
                </button>
              )}
            </div>
            <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkSoft, marginBottom: isTablet ? 16 : 12, lineHeight: 1.5, padding: isTablet ? '12px 14px' : '8px 10px', background: T.closedBg, borderRadius: 6, border: `1px solid ${T.closed}55` }}>
              The species you star are closed in {jurisdiction ? jurisdiction.name : 'these waters'} right now. Do not retain.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 22 }}>
              {buckets.yourClosed.map(row => renderRow(row, { status: 'closed', accentBorder: T.closed, showSeason: true, imgSize: 40 }))}
            </div>
          </>
        ) : totalClosed > 0 ? (
          <Card style={{ marginBottom: 22, padding: isTablet ? 20 : 14, borderColor: T.open, display: 'flex', alignItems: 'flex-start', gap: isTablet ? 14 : 10 }}>
            <CheckCircle2 size={isTablet ? 30 : 24} color={T.open} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: isTablet ? 18 : 14, fontWeight: 700, color: T.ink }}>None of your starred fish are closed</div>
              <div style={{ fontSize: isTablet ? 15 : 12, color: T.inkSoft, marginTop: isTablet ? 6 : 4 }}>
                See "Additional closures" below for {totalClosed} other species closed in these waters.
              </div>
            </div>
          </Card>
        ) : null
      )}

      {/* No favourites at all + no closures: show the existing all-clear card. */}
      {totalClosed === 0 && (
        <Card style={{ marginBottom: 22, padding: isTablet ? 24 : 16, textAlign: 'center', borderColor: T.open }}>
          <CheckCircle2 size={isTablet ? 42 : 32} color={T.open} style={{ display: 'block', margin: '0 auto 8px' }} />
          <div style={{ fontSize: isTablet ? 20 : 14, fontWeight: 700, color: T.ink, marginBottom: isTablet ? 6 : 4 }}>No active closures</div>
          <div style={{ fontSize: isTablet ? 15 : 12, color: T.inkSoft }}>
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

      {/* Season varies — soft section for species whose season string
          isn't cleanly parseable (rolling federal seasons, split-year
          openings). With the fed fallback in regulationFor most rows
          now resolve to real numbers; anything still here has genuine
          text like "Verify with the agency". Presented as a footnote,
          not a red flag. */}
      {totalUnknown > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 2px 8px' }}>
            <SectionLabel style={{ color: T.inkMute }}>Season varies ({totalUnknown})</SectionLabel>
          </div>
          <div style={{ fontSize: isTablet ? 13 : 11, color: T.inkMute, marginBottom: isTablet ? 12 : 10, lineHeight: 1.5 }}>
            Season windows shift year to year for these — tap for the current bag / size limit and a link to the {jurisdiction ? jurisdiction.agency || jurisdiction.name : 'agency'} page.
          </div>
          {buckets.yourUnknown.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 2px 8px' }}>
                <Star size={12} fill={T.brass} color={T.brass} />
                <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: T.brass, fontWeight: 800, flex: 1 }}>Your fish</span>
                {onEditFavorites && (
                  <button onClick={onEditFavorites} aria-label="Edit your starred fish"
                    style={{
                      background: 'transparent', color: T.brass,
                      border: `1px solid ${T.brass}`,
                      padding: '3px 8px', borderRadius: 6,
                      fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8,
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}>
                    <Pencil size={10} /> EDIT
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {buckets.yourUnknown.map(row => renderRow(row, { status: 'unknown' }))}
              </div>
            </>
          )}
          {buckets.otherUnknown.length > 0 && (
            <>
              {buckets.yourUnknown.length > 0 && (
                <span style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: T.inkMute, fontWeight: 800, display: 'block', margin: '4px 2px 8px' }}>All other species</span>
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
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  const s = speciesById(id);
  if (!s) return <div style={{ padding: 20 }}>Not found.</div>;
  // Precedence: verified Supabase overlay → bundled fallback → none.
  // regulationFor returns { source, regulation, row } so the render
  // can add a caveat chip for bundled and an honest empty state
  // (with the agency deep link) for none.
  const regResult    = jurisdiction ? regulationFor(id, jurisdiction.id) : { source: 'none', regulation: null };
  const reg          = regResult.regulation;
  const regRow       = regResult.row || null; // raw Supabase row when source='verified'
  const regSource    = regResult.source;
  const fedReg = regulationFor(id, 'fed_gulf').regulation;
  // No comparison column when the state view is ALREADY showing the
  // federal rules via fallback — it would compare federal to itself.
  const showFedColumn = reg && fedReg && !reg._fromFed
    && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
  const pb = state.pbs?.[id];
  return (
    <div style={{ padding: isTablet ? '22px 22px' : '16px 16px' }}>
      <Card style={{ marginBottom: isTablet ? 16 : 10, display: 'flex', alignItems: 'center', gap: isTablet ? 18 : 12, padding: isTablet ? 18 : undefined }} onClick={onSpecies}>
        <SpeciesImage species={s} size={isTablet ? (isLandscape ? 120 : 96) : 56} />
        <div style={{ flex: 1 }}>
          <H1 size={isTablet ? (isLandscape ? 34 : 30) : 20}>{s.commonName}</H1>
          <div style={{ fontStyle: 'italic', fontSize: isTablet ? 16 : 12, color: T.inkMute, marginTop: isTablet ? 4 : 0 }}>{s.scientific}</div>
          <div style={{ fontSize: isTablet ? 14 : 11, color: T.brass, marginTop: isTablet ? 8 : 4, fontWeight: 600 }}>View species details →</div>
        </div>
      </Card>
      {onAddPB && (
        <button onClick={(e) => { e.stopPropagation(); onAddPB(); }} style={{
          width: '100%', marginBottom: isTablet ? 16 : 12, background: T.brass, color: T.oceanDeep, border: 'none',
          padding: isTablet ? '14px 18px' : '10px 14px', borderRadius: 8,
          fontSize: isTablet ? 16 : 13, fontWeight: 800, letterSpacing: 0.5,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Trophy size={isTablet ? 18 : 14} /> {pb ? 'Edit Personal Best' : 'Add Personal Best'}
        </button>
      )}
      {!jurisdiction ? (
        <Card><div style={{ color: T.inkMute, fontSize: isTablet ? 15 : 13 }}>Select your fishing waters first.</div></Card>
      ) : !reg ? (
        <Card>
          <div style={{ color: T.inkMute, fontSize: isTablet ? 15 : 13, lineHeight: 1.5, marginBottom: 10 }}>
            No regulation on file for {jurisdiction.name} yet. The link below
            opens the {jurisdiction.agency || 'agency'} page for current bag,
            size, and season limits.
          </div>
          <a
            href={s.hms
              ? 'https://www.fisheries.noaa.gov/topic/atlantic-highly-migratory-species'
              : (jurisdiction.regsUrl || 'https://www.fisheries.noaa.gov/southeast/recreational-fishing/recreational-fishing-gulf-mexico')}
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              fontSize: isTablet ? 14 : 12, fontWeight: 700,
              color: T.brass, textDecoration: 'underline',
            }}
          >
            Open {s.hms ? 'NOAA HMS' : (jurisdiction.agency || 'agency')} regs →
          </a>
        </Card>
      ) : (
        <Card style={{ padding: isTablet ? 20 : undefined }}>
          <SectionLabel style={{ marginBottom: isTablet ? 12 : 8, fontSize: isTablet ? 13 : undefined }}>{jurisdiction.name}</SectionLabel>
          {(regSource === 'verified-fed' || regSource === 'bundled-fed') && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginBottom: isTablet ? 14 : 10,
              fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: T.brass, background: 'rgba(25, 212, 242, 0.08)',
              padding: '3px 10px', borderRadius: 999,
              border: `1px solid ${T.brass}55`,
            }}>
              {/* Honest framing: we don't have this state's own rules,
                  so we're SHOWING the federal ones — not asserting the
                  state defers (delegated species like red snapper set
                  their own state seasons). */}
              SHOWING FEDERAL GULF RULES · NO {(jurisdiction.short || jurisdiction.name).toUpperCase()} DATA ON FILE
            </div>
          )}
          {(regSource === 'bundled' || regSource === 'bundled-fed') && (
            <div style={{
              display: 'inline-block', marginBottom: isTablet ? 14 : 10,
              fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: T.inkMute, background: T.parchmentDeep,
              padding: '3px 8px', borderRadius: 999,
              border: `1px solid ${T.cardEdge}`,
              marginLeft: regSource === 'bundled-fed' ? 6 : 0,
            }}>
              LOCAL DATA · NOT YET VERIFIED
            </div>
          )}
          {(regSource === 'verified' || regSource === 'verified-fed') && reg?._seasonFromBundled && (
            <div style={{
              display: 'inline-block', marginBottom: isTablet ? 14 : 10,
              fontSize: 11, fontWeight: 800, letterSpacing: 1,
              color: T.warn, background: T.warnBg,
              padding: '3px 8px', borderRadius: 999,
              border: `1px solid ${T.warn}55`,
              marginLeft: 6,
            }}>
              SEASON FROM LOCAL DATA — NOT IN VERIFIED SOURCE
            </div>
          )}
          {stale && (
            <div style={{ background: T.warnBg, border: `1.5px solid ${T.warn}`, padding: isTablet ? 14 : 10, borderRadius: 4, fontSize: isTablet ? 14 : 12, color: T.brassDeep, marginBottom: isTablet ? 16 : 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={isTablet ? 20 : 16} /> Data is more than 7 days old. Refresh when online.
            </div>
          )}
          <RegBlock reg={reg} units={state.units} jurisdiction={jurisdiction} fedColumn={showFedColumn ? fedReg : null} />
          {(regSource === 'verified' || regSource === 'verified-fed') && regRow && (
            <VerifiedRegFooter row={regRow} jurisdiction={jurisdiction} isTablet={isTablet} />
          )}
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
  const catOrder = useMemo(() => Object.fromEntries(getCategories().map((c, i) => [c.id, i])), []);
  const catName = (id) => (categoryById(id)?.name) || 'Other';

  const rows = useMemo(() => {
    const statusRank = { unknown: 0, closed: 1, upcoming: 2, open: 3 };
    const list = SPECIES
      .filter(s => s.active !== false)
      .filter(s => s.category !== 'bait') // no bait on regs surfaces
      .map(s => {
        const reg = jurisdiction ? regulationFor(s.id, jurisdiction.id).regulation : null;
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
      fontSize: 14, fontWeight: 700, letterSpacing: 0.3,
      background: sort === key ? T.brass : T.parchmentDeep,
      color: sort === key ? T.oceanDeep : T.inkSoft,
      border: `1.5px solid ${sort === key ? T.brass : T.cardEdge}`,
    }}>{label}</button>
  );

  const statusLabel = { unknown: 'Season varies', closed: 'Closed', upcoming: 'Opens soon', open: 'Open now' };

  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 12 }}>All species</H1>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Sort</span>
        {segBtn('type', 'Type')}
        {segBtn('name', 'A–Z')}
        {segBtn('status', 'Status')}
      </div>

      {favRows.length > 0 && (
        <>
          <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
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
                  <div key={'h-' + s.category} style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px' }}>
                    {catName(s.category)}
                  </div>
                );
              }
            } else if (sort === 'status') {
              if (status !== lastGroup) {
                lastGroup = status;
                out.push(
                  <div key={'h-' + status} style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: T.brass, fontWeight: 800, padding: '10px 4px 4px' }}>
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
export function PBsScreen({ state, signedIn, onView, onLogCatch, onViewCatches }) {
  const { cols: gridCols } = useScreenSize();
  const pbsCols = gridCols.pbsList;
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
        <div style={{ fontSize: 15, color: T.inkSoft, marginTop: 4 }}>Your records, by species.</div>
      </div>

      {recorded.length === 0 ? (
        <Card style={{ padding: 18, textAlign: 'center' }}>
          <Trophy size={36} color={T.brass} style={{ display: 'block', margin: '0 auto 10px' }} />
          <div style={{ fontWeight: 800, color: T.ink, fontSize: 17, marginBottom: 6 }}>
            No personal bests recorded
          </div>
          <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>
            Personal bests come from your logged catches. Log a new fish, or
            promote one you've already logged in the Logbook.
          </div>
          {actions}
        </Card>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${pbsCols}, minmax(0, 1fr))`,
            gap: 8, marginBottom: 18,
          }}>
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
                          <img src={photoThumbUrl(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Trophy size={18} color={T.brass} style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                      <div style={{ fontSize: 14, color: T.inkSoft, marginTop: 2 }}>
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
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  const s = speciesById(speciesId); const pb = state.pbs[speciesId];
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
  // Direct share (no modal preview): build text + resolve up to 3
  // photos to data URLs → shareReport hands off to Web Share API or
  // clipboard fallback. Photos in order from pb.photos.
  const doShare = async () => {
    const text = buildPBReport({ anglerName: state.anglerName, species: s, pb, units: state.units });
    const photoDataUrls = (await Promise.all(photos.slice(0, 3).map(photoAsDataUrl))).filter(Boolean);
    await shareReport({
      title: `${(state.anglerName || 'My').trim() || 'My'} ${s.commonName} PB`,
      text,
      photoDataUrls,
      fileName: `pb-${speciesId}`,
    });
  };
  return (
    <div style={{ padding: '16px 16px' }}>
      <Card style={{ background: T.oceanDeep, color: T.parchment, border: `1.5px solid ${T.brass}`, textAlign: 'center', padding: 18, marginBottom: 12 }}>
        <Trophy size={24} color={T.brass} style={{ margin: '0 auto 6px', display: 'block' }} />
        <H1 size={20} style={{ color: T.parchment }}>{s.commonName}</H1>
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(244, 227, 193, 0.1)', borderRadius: 4 }}>
          <div style={{ fontSize: 12, letterSpacing: 1.5, color: T.brass, fontWeight: 700, textTransform: 'uppercase' }}>{primary.label}</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 600, color: T.parchment, marginTop: 4 }}>{primary.val}</div>
          <div style={{ fontSize: 14, color: '#B8C5CD', marginTop: 4 }}>{secondary.label}: {secondary.val}</div>
        </div>
      </Card>
      {photos.length > 0 && (
        photos.length === 1 ? (
          <Card onClick={() => setLightboxIdx(0)} className="kyc-tappable" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <PhotoImg photo={photos[0]} alt={s.commonName} style={{ width: '100%', display: 'block', maxHeight: isTablet ? (isLandscape ? 640 : 560) : 320, objectFit: 'contain', background: T.parchmentDeep }} />
          </Card>
        ) : (
          <div className="kyc-hscroll" style={{
            display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
            margin: '0 -16px 12px', padding: '0 16px 4px',
            scrollSnapType: 'x proximity',
          }}>
            {photos.map((p, i) => (
              <div key={i} onClick={() => setLightboxIdx(i)} className="kyc-tappable" style={{ flex: isTablet ? '0 0 60%' : '0 0 78%', borderRadius: 8, overflow: 'hidden', scrollSnapAlign: 'start', border: `1px solid ${T.cardEdge}`, cursor: 'zoom-in', background: T.parchmentDeep }}>
                <PhotoImg photo={p} alt={`${s.commonName} ${i + 1}`} style={{ width: '100%', height: isTablet ? (isLandscape ? 500 : 440) : 240, objectFit: 'contain', display: 'block' }} />
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
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, padding: '6px 0', borderBottom: i < pb.history.length - 1 ? `1px solid ${T.cardEdge}55` : 'none' }}>
                <span style={{ color: T.inkSoft }}>
                  {h.primaryMetric === 'weight' ? formatWeight(h.weight, state.units) : formatSize(h.length, state.units)}
                </span>
                <span style={{ color: T.inkMute, fontSize: 12 }}>{h.date} — beaten {h.beatenOn}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton onClick={onEdit} style={{ flex: 1 }}><Pencil size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Edit</PrimaryButton>
        <GhostButton onClick={doShare} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Share2 size={14} /> Share
        </GhostButton>
        <GhostButton onClick={remove} style={{ color: T.closed, borderColor: T.closed, padding: '14px 14px' }}><Trash2 size={16} /></GhostButton>
      </div>
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
    // savePhoto owns the tier-aware downscale — pass raw File and it
    // decides target dims (native: 2400 px / 0.90, web: 1600 / 0.82).
    Promise.all(batch.map((f) => savePhoto(f))).then((entries) => {
      setPhotos(p => [...p, ...entries].slice(0, 3));
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
  const removePhotoAt = (i) => setPhotos(p => {
    deletePhoto(p[i]); // fire-and-forget disk cleanup
    return p.filter((_, idx) => idx !== i);
  });
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
          <div style={{ fontSize: 14, color: T.inkMute }}>{edit ? 'Update PB' : 'New personal best'}</div>
        </div>
      </Card>

      {existing && beats && (
        <Card style={{ background: T.openBg, border: `1.5px solid ${T.open}`, marginBottom: 12 }}>
          <div style={{ color: T.open, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: -4, marginBottom: 6, fontSize: 12, color: T.brass }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              📍 {lat.toFixed(5)}°, {lon.toFixed(5)}°{locFromPhoto && <span style={{ color: T.inkMute, marginLeft: 4 }}>— from photo</span>}
            </span>
            <button onClick={clearLocation} style={{ background: 'transparent', border: 'none', color: T.inkMute, fontSize: 12, cursor: 'pointer', padding: 2 }}>Clear coords</button>
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
          <span style={{ fontSize: 12, color: T.inkMute }}>{photos.length} / 3</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[0, 1, 2].map(i => {
            const p = photos[i];
            if (p) {
              return (
                <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }}>
                  <img src={photoThumbUrl(p)} alt={`PB photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
                <span style={{ fontSize: 11.5, letterSpacing: 0.8, fontWeight: 700 }}>
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

/* Feature-email preferences row. One-way opt-out for now — new
   signups are auto-enrolled via the on_auth_user_created trigger;
   this card lets the user turn those launch emails off. Re-opt-in
   surface can be added when we have more than one feature to
   subscribe to. */
/* ============================================================
   ANGLER PROFILE (3.3) — segmentation only, DOES NOT change regs
   ============================================================
   Four optional fields collected either in onboarding (skippable)
   or in Settings. Values are stored on state.angler* keys, sync via
   the user_state channel (USER_STATE_KEYS in cloudsync.js), and are
   never read by the regulations pipeline. If fisherType === 'commercial'
   we surface a "we currently cover recreational rules" caveat so a
   commercial angler doesn't rely on the wrong limits. */
export const PROFILE_FIELDS = [
  {
    key: 'anglerIsCaptain', label: 'Licensed captain?',
    options: [
      { value: true,  label: 'Yes' },
      { value: false, label: 'No'  },
    ],
  },
  {
    key: 'anglerFisherType', label: 'How do you fish?',
    options: [
      { value: 'recreational', label: 'Recreational' },
      { value: 'charter',      label: 'Charter or for-hire' },
      { value: 'commercial',   label: 'Commercial' },
    ],
  },
  {
    key: 'anglerExperience', label: 'Experience level',
    options: [
      { value: 'beginner',     label: 'Beginner' },
      { value: 'intermediate', label: 'Intermediate' },
      { value: 'experienced',  label: 'Experienced' },
      { value: 'pro',          label: 'Pro' },
    ],
  },
  {
    key: 'anglerTripFreq', label: 'How often do you fish?',
    options: [
      { value: 'few_year',     label: 'A few times a year' },
      { value: 'monthly',      label: 'Monthly' },
      { value: 'weekly',       label: 'Weekly' },
      { value: 'several_week', label: 'Several times a week' },
    ],
  },
];

/* True when every profile field has a value on state — used by the
   Home "Finish setup" nudge (3.4) to decide whether to prompt. */
export function profileFieldsComplete(state) {
  if (!state) return false;
  for (const f of PROFILE_FIELDS) {
    if (state[f.key] === undefined || state[f.key] === null) return false;
  }
  return true;
}

function FishingProfileCard({ state, update, isTablet }) {
  const commercial = state?.anglerFisherType === 'commercial';
  const setField = (key, value) => {
    update({ [key]: value, anglerProfileCompletedAt: profileFieldsComplete({ ...state, [key]: value }) ? new Date().toISOString() : null });
  };
  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionLabel style={{ marginBottom: 8 }}>Fishing profile</SectionLabel>
      <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.45, marginBottom: 10 }}>
        Optional — helps us tune the app. Does not change which regulations you see.
      </div>
      {PROFILE_FIELDS.map((f) => (
        <ProfilePickerRow
          key={f.key}
          label={f.label}
          value={state?.[f.key]}
          options={f.options}
          onChange={(v) => setField(f.key, v)}
          isTablet={isTablet}
        />
      ))}
      {commercial && (
        <div style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 6,
          background: T.warnBg, color: T.brassDeep,
          border: `1px solid ${T.warn}`, fontSize: isTablet ? 13 : 12, lineHeight: 1.5,
        }}>
          <strong>Heads up:</strong> ReelIntel currently covers recreational
          fishing regulations. Commercial limits, permits, and reporting are
          governed separately — always defer to NOAA HMS / your state
          licensing authority for commercial rules.
        </div>
      )}
    </Card>
  );
}

function ProfilePickerRow({ label, value, options, onChange, isTablet }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: isTablet ? 13 : 12, color: T.ink, fontWeight: 700, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={String(o.value)}
              onClick={() => onChange(active ? null : o.value)}
              style={{
                background: active ? T.brass : 'transparent',
                color: active ? T.oceanDeep : T.inkSoft,
                border: `1px solid ${active ? T.brass : T.cardEdge}`,
                padding: isTablet ? '7px 12px' : '6px 10px',
                borderRadius: 999,
                fontSize: isTablet ? 12.5 : 11.5, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FeatureEmailPrefsCard() {
  const [loading, setLoading]     = useState(true);
  const [optedOut, setOptedOut]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getMyPreferences();
      if (!alive) return;
      if (r.ok) setOptedOut(!!r.prefs?.featureEmailsOptedOut);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const optOut = async () => {
    if (!window.confirm('Turn off feature launch emails? You can turn them back on later by contacting support.')) return;
    setSaving(true); setError('');
    const r = await optOutOfFeatureEmails();
    setSaving(false);
    if (!r.ok) { setError(r.error || 'save failed'); return; }
    setOptedOut(true);
  };

  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionLabel style={{ marginBottom: 6 }}>Feature launch emails</SectionLabel>
      {loading ? (
        <div style={{ fontSize: 14, color: T.inkMute }}>Loading…</div>
      ) : optedOut ? (
        <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.45 }}>
          You're opted out. We won't email you when new ReelIntel features ship.
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 14, color: T.inkSoft, lineHeight: 1.45 }}>
            We'll email you once when new features go live (like Fish ID). One email per launch, not a newsletter.
          </div>
          <GhostButton onClick={optOut} disabled={saving} style={{ padding: '6px 12px', fontSize: 14, flexShrink: 0 }}>
            {saving ? 'Turning off…' : 'Turn off'}
          </GhostButton>
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 14, color: T.closed }}>
          {error}
        </div>
      )}
    </Card>
  );
}

export function SettingsScreen({ state, jurisdiction, update, session, syncStatus, lastSyncedAt, onForceSync, onChangeJurisdiction, onShowDisclaimer, onEditFavorites, onEditAccount }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const setUnits = (u) => update({ units: u });

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
    <div className={isTablet ? 'kyc-settings-tablet' : undefined} style={{ padding: isTablet ? '22px 22px' : '16px 16px' }}>
      {/* Tablet-only typographic bump. Selectors target the *outer*
          div of every Card sibling underneath the Settings root and
          the immediate label/value <div>s inside — those consistently
          use inline fontSize that we override with !important. */}
      {isTablet && (
        <style>{`
          .kyc-settings-tablet > div[style*="border-radius: 14px"] { padding: 18px 20px !important; margin-bottom: 12px !important; }
          .kyc-settings-tablet > div[style*="border-radius: 14px"] > div[style*="font-size: 14px"] { font-size: 17px !important; }
          .kyc-settings-tablet > div[style*="border-radius: 14px"] > div[style*="font-size: 13px"] { font-size: 15px !important; }
          .kyc-settings-tablet > div[style*="border-radius: 14px"] > div[style*="font-size: 12px"] { font-size: 14px !important; }
          .kyc-settings-tablet > div[style*="border-radius: 14px"] > div[style*="font-size: 11px"] { font-size: 13px !important; }
          .kyc-settings-tablet > div[style*="border-radius: 14px"] div[data-kyc-section-label] { font-size: 13px !important; letter-spacing: 1.4px !important; }
        `}</style>
      )}
      <H1 size={isTablet ? 30 : 22} style={{ marginBottom: isTablet ? 20 : 14 }}>Settings</H1>
      <AccountSection
        session={session}
        syncStatus={syncStatus}
        lastSyncedAt={lastSyncedAt}
        onForceSync={onForceSync}
        initialEmail={state.anglerEmail}
      />
      {/* Waters row sits directly below Account — this is the only
          place jurisdiction can be changed. Home shows a read-only
          "Current Regulations: {name}" line above the hero. */}
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Waters / Jurisdiction</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, color: T.ink, fontWeight: 700 }}>{jurisdiction?.name || 'Not set'}</div>
          <GhostButton onClick={onChangeJurisdiction} style={{ padding: '6px 12px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 4 }}>
            Change <ChevronRight size={14} />
          </GhostButton>
        </div>
        {jurisdiction?.agency && (
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4 }}>{jurisdiction.agency}</div>
        )}
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Angler profile</SectionLabel>
        <div style={{ fontSize: 16, color: T.ink, fontWeight: 700 }}>
          {state.anglerName || <span style={{ color: T.inkMute, fontWeight: 500 }}>No name set</span>}
        </div>
        <div style={{ fontSize: 14, color: T.inkSoft, marginTop: 2, wordBreak: 'break-all' }}>
          {state.anglerEmail || <span style={{ color: T.inkMute }}>No email set</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.45, flex: 1, paddingRight: 10 }}>
            Name appears on your shared catch and Personal Best report cards.
          </div>
          <GhostButton onClick={onEditAccount} style={{ padding: '6px 12px', fontSize: 14, flexShrink: 0 }}>Edit</GhostButton>
        </div>
      </Card>
      <FishingProfileCard state={state} update={update} isTablet={isTablet} />
      {session?.user?.id && <FeatureEmailPrefsCard />}
      {/* Admin console entry — web-only, admin allowlist only. When
          __KYC_ADMIN__ is false (ios:build) the whole Card constant-
          folds out and never reaches the iOS bundle. */}
      {__KYC_ADMIN__ && (state.anglerEmail || '').trim().toLowerCase() === 'robertb1023@me.com' && (
        <Card style={{ marginBottom: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Admin</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.45, flex: 1, paddingRight: 10 }}>
              Species editor. Web-only; not shipped in the iOS bundle.
            </div>
            <GhostButton onClick={() => { window.location.hash = '#/admin'; }} style={{ padding: '6px 12px', fontSize: 14, flexShrink: 0 }}>Open</GhostButton>
          </div>
        </Card>
      )}
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Your fish</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, color: T.ink, fontWeight: 600 }}>
            {(state.favorites || []).length} starred
          </div>
          <GhostButton onClick={onEditFavorites} style={{ padding: '6px 12px', fontSize: 14 }}>Edit</GhostButton>
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 6, lineHeight: 1.45 }}>
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
      <FishIdModelCard />
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Your fishing data</SectionLabel>
        <div style={{ fontSize: 15, color: T.inkSoft, marginBottom: 10 }}>
          {nCatches} catch{nCatches === 1 ? '' : 'es'} logged · {nPBs} personal best{nPBs === 1 ? '' : 's'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton onClick={exportData} style={{ flex: 1 }}>Export backup</GhostButton>
          <GhostButton onClick={importData} style={{ flex: 1 }}>Restore backup</GhostButton>
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 8, lineHeight: 1.4 }}>
          Backup is a single JSON file with catches (photos included), personal bests, notes, and settings. Save it to Files / iCloud Drive so you don't lose your log if you reset the app or change phones.
        </div>
      </Card>

      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Report or contact</SectionLabel>
        <a href="mailto:robert@reelintel.ai?subject=Regulation%20correction" style={{ color: T.brass, fontWeight: 600, fontSize: 16, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mail size={16} /> Email a regulation correction
        </a>
      </Card>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Legal</SectionLabel>
        <button onClick={onShowDisclaimer} style={{ background: 'transparent', border: 'none', color: T.brass, fontWeight: 600, fontSize: 16, cursor: 'pointer', padding: 0 }}>
          Re-read disclaimer
        </button>
      </Card>
    </div>
  );
}

/* Fish ID model status card.
   Shows the currently-loaded model version + a "Check for updates"
   button. Runtime state comes from model-loader.js — kept as a
   subscription so pushing a new promoted model updates the card
   without a manual refresh. */
function FishIdModelCard() {
  const [tick, setTick] = React.useState(0);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    // Lazy-import so the module isn't force-loaded before boot init
    // ran (which happens in App.jsx).
    let unsub;
    (async () => {
      const { subscribeModel } = await import('./model-loader.js');
      unsub = subscribeModel(() => setTick(t => t + 1));
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const [status, setStatus] = React.useState('loading');
  const [info, setInfo] = React.useState(null);
  const [errMsg, setErrMsg] = React.useState(null);
  const [logLines, setLogLines] = React.useState([]);
  const [showLog, setShowLog] = React.useState(false);
  React.useEffect(() => {
    (async () => {
      const { getModelStatus, getModelInfo, getModelError, getModelLog } = await import('./model-loader.js');
      setStatus(getModelStatus());
      setInfo(getModelInfo());
      setErrMsg(getModelError());
      setLogLines(getModelLog());
    })();
  }, [tick]);

  const check = async () => {
    setChecking(true);
    try {
      const { forceRefreshModel } = await import('./model-loader.js');
      await forceRefreshModel();
    } finally {
      setChecking(false);
    }
  };

  const label =
    status === 'ready'      ? info?.version_name || '—'
  : status === 'loading'    ? 'Loading…'
  : status === 'no-network' ? 'Not yet synced'
  : status === 'error'      ? 'Failed to load'
  : '—';

  return (
    <Card style={{ marginBottom: 10 }}>
      <SectionLabel style={{ marginBottom: 6 }}>Fish ID model</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 16, color: T.ink, fontWeight: 700 }}>{label}</div>
          {status === 'ready' && info?.labels && (
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 3 }}>
              {info.labels.length} species · updates over the air
            </div>
          )}
          {status === 'no-network' && (
            <div style={{ fontSize: 12, color: T.inkMute, marginTop: 3 }}>
              Open the app once online to download the current model.
            </div>
          )}
          {status === 'error' && errMsg && (
            <div style={{
              fontSize: 12, color: T.warn || '#c66',
              marginTop: 4, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxWidth: 260,
            }}>
              {errMsg}
            </div>
          )}
        </div>
        <GhostButton onClick={check} disabled={checking} style={{ padding: '6px 12px', fontSize: 14 }}>
          {checking ? 'Checking…' : 'Check for updates'}
        </GhostButton>
      </div>

      {/* Diagnostic log — collapsed by default. Users can pop it open
          and screenshot when reporting model-load issues. */}
      {logLines.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setShowLog(v => !v)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: T.inkMute, fontSize: 12, padding: 0,
              textDecoration: 'underline',
            }}
          >
            {showLog ? 'Hide details' : `Show details (${logLines.length})`}
          </button>
          {showLog && (
            <pre style={{
              marginTop: 6, padding: 8, background: '#0a1420', color: '#c9d5e1',
              border: `1px solid ${T.cardEdge}`, borderRadius: 6,
              fontSize: 11, lineHeight: 1.4,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 260, overflow: 'auto',
            }}>
              {logLines.join('\n')}
            </pre>
          )}
        </div>
      )}
    </Card>
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
          <div style={{ fontSize: 12, color: T.inkSoft }}>
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
          <span style={{ fontSize: 11, color: T.brass, fontWeight: 800, letterSpacing: 1.4 }}>COORDS</span>
          {placed ? (
            <span style={{ fontSize: 15, color: T.ink, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {coords.lat.toFixed(5)}°, {coords.lon.toFixed(5)}°
            </span>
          ) : (
            <span style={{ fontSize: 14, color: T.inkMute, fontStyle: 'italic' }}>Tap the map to place a pin</span>
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

export function CatchLogScreen({ state, signedIn, onNew, onView, onViewPB }) {
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
        fontSize: 12, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
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
        fontSize: 12, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
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
      fontSize: 12, fontWeight: 700, letterSpacing: 0.3, cursor: 'pointer', flex: 'none',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>{label}</button>
  );

  // Quick logs are catches saved with only a photo + environmentals
  // and no species. The Logbook nag banner surfaces the count so the
  // angler doesn't lose track — filter chip below jumps to just those.
  const quickPending = items.filter(c => c.status === 'quick');

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
        <H1 size={22}>Logbook</H1>
        <button onClick={onNew} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 15, fontWeight: 800, letterSpacing: 0.5, cursor: 'pointer' }}>
          <Plus size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> NEW
        </button>
      </div>

      {quickPending.length > 0 && (
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginBottom: 12, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <AlertTriangle size={18} color={T.warn} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 15, color: T.ink, lineHeight: 1.4 }}>
            <strong>{quickPending.length}</strong> {quickPending.length === 1 ? 'catch needs' : 'catches need'} details — tap a row to add species & measurements.
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 18, color: T.inkSoft }}>
            <Camera size={36} color={T.brass} style={{ display: 'block', margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 700, color: T.ink, marginBottom: 6 }}>
              {pbList.length > 0 ? 'No catches logged yet' : 'Nothing logged yet'}
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.5 }}>Tap <b>NEW</b> after you land one. The app records the photo, GPS, time of day, sun &amp; moon, and (when online) weather — building your personal where-and-what dataset.</div>
          </div>
        </Card>
      ) : (
        <>
          {/* List / Map toggle + Filter toggle. Toggle is a raised
              segmented control so anglers can find Map at a glance —
              previous 12px flat pills got lost against the surround. */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
                fontSize: 16, fontWeight: 800, letterSpacing: 0.8,
                background: view === 'list' ? T.brass : T.parchmentDeep,
                color: view === 'list' ? T.oceanDeep : T.parchment,
                border: `2px solid ${view === 'list' ? T.brass : T.cardEdge}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: view === 'list' ? '0 4px 14px rgba(25,212,242,0.25)' : 'none',
              }}
            >
              <BookOpen size={16} /> LIST
            </button>
            <button
              onClick={() => setView('map')}
              aria-pressed={view === 'map'}
              style={{
                flex: 1, padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
                fontSize: 16, fontWeight: 800, letterSpacing: 0.8,
                background: view === 'map' ? T.brass : T.parchmentDeep,
                color: view === 'map' ? T.oceanDeep : T.parchment,
                border: `2px solid ${view === 'map' ? T.brass : T.cardEdge}`,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: view === 'map' ? '0 4px 14px rgba(25,212,242,0.25)' : 'none',
              }}
            >
              <MapPinIcon size={16} /> MAP
            </button>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
              aria-expanded={filtersOpen}
              style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                fontSize: 14, fontWeight: 700,
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
                  fontSize: 11, fontWeight: 800,
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
                    fontSize: 12, fontWeight: 800, letterSpacing: 0.6, cursor: 'pointer', padding: 0,
                  }}>Clear all</button>
                )}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Species</span>
                {allChip('speciesIds', 'All')}
                {speciesInLog.map(s => chip(s.id, 'speciesIds', s.commonName))}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Moon</span>
                {allChip('moonPhases', 'Any')}
                {chip('new', 'moonPhases', 'New')}
                {chip('waxing', 'moonPhases', 'Waxing')}
                {chip('full', 'moonPhases', 'Full')}
                {chip('waning', 'moonPhases', 'Waning')}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>Time</span>
                {allChip('timesOfDay', 'Any')}
                {chip('dawn', 'timesOfDay', 'Dawn')}
                {chip('day', 'timesOfDay', 'Day')}
                {chip('dusk', 'timesOfDay', 'Dusk')}
                {chip('night', 'timesOfDay', 'Night')}
              </div>
              <div className="kyc-hscroll" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: T.inkMute, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'center', flex: 'none' }}>PB</span>
                {pbChip(pbAllActive, 'All catches', () => setFilters(f => ({ ...f, pbOnly: false })))}
                {pbChip(pbOnlyActive, <><Trophy size={11} /> Only PBs</>, () => setFilters(f => ({ ...f, pbOnly: true })))}
              </div>
            </div>
          )}

          {view === 'list'
            ? <CatchListView items={filtered} onView={onView} pbCatchIds={pbCatchIds} state={state} />
            : <CatchMapView items={filtered} onView={onView} />}
        </>
      )}
    </div>
  );
}

function CatchListView({ items, onView, pbCatchIds, state }) {
  const { size, cols: gridCols } = useScreenSize();
  const isTablet = size !== 'phone';
  const listCols = gridCols.logList;
  const thumbSize = isTablet ? 140 : 96;
  const cardPad = isTablet ? 14 : 10;
  const gridGap = isTablet ? 14 : 8;
  const speciesFontSize = isTablet ? 20 : 15;
  const metaFontSize = isTablet ? 14 : 11;
  const placeholderSize = isTablet ? 124 : 84;
  const placeholderIcon = isTablet ? 34 : 26;
  const [lightbox, setLightbox] = useState(null); // { photos, index, caption } or null
  const isPB = (id) => pbCatchIds && pbCatchIds.has(id);
  if (items.length === 0) return <Card><div style={{ textAlign: 'center', padding: 18, color: T.inkSoft, fontSize: 15 }}>No catches match these filters.</div></Card>;
  // Stop the row-level onClick (which navigates to the catch detail)
  // when the angler taps an individual photo thumbnail to enlarge it.
  const stop = (e) => { e.stopPropagation(); };

  // Row-level direct share. Same behavior as the detail-page share
  // button — resolves up to 3 photos, picks PB or regular template.
  const shareRow = async (c, e) => {
    e.stopPropagation();
    const s = speciesById(c.speciesId);
    const pb = c.speciesId ? state?.pbs?.[c.speciesId] : null;
    const isRowPB = !!pb && pb.catchId === c.id;
    const text = isRowPB
      ? buildPBReport({ anglerName: state?.anglerName, species: s, pb, units: state?.units })
      : buildCatchReport({ anglerName: state?.anglerName, species: s, c, units: state?.units });
    const photos = catchPhotos(c).slice(0, 3);
    const photoDataUrls = (await Promise.all(photos.map(photoAsDataUrl))).filter(Boolean);
    await shareReport({
      title: `${(state?.anglerName || 'My').trim() || 'My'} ${s ? s.commonName : 'catch'}`,
      text,
      photoDataUrls,
      fileName: `catch-${c.id}`,
    });
  };
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${listCols}, minmax(0, 1fr))`,
      gap: gridGap,
    }}>
      {items.map(c => {
        const s = speciesById(c.speciesId);
        const when = new Date(c.dateIso);
        const cPhotos = catchPhotos(c);
        const isQuick = c.status === 'quick';
        const speciesName = s ? s.commonName : (isQuick ? 'Unidentified catch' : (c.speciesId || 'Unknown'));
        return (
          <Card key={c.id} onClick={() => onView && onView(c.id)} style={{ padding: cardPad, display: 'flex', flexDirection: 'column', gap: isTablet ? 12 : 8, borderLeft: isQuick ? `3px solid ${T.warn}` : undefined, position: 'relative' }}>
            {/* Photo strip — full width, horizontal scroll for multi-photo
                catches, single thumb for one, camera placeholder for zero. */}
            {cPhotos.length === 0 ? (
              <div style={{ width: placeholderSize, height: placeholderSize, background: T.parchmentDeep, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' }}>
                <Camera size={placeholderIcon} color={T.inkMute} />
              </div>
            ) : (
              <div
                className="kyc-hscroll"
                onClick={stop}
                style={{
                  display: 'flex', gap: isTablet ? 8 : 6,
                  overflowX: 'auto', overflowY: 'hidden',
                  margin: `0 -${cardPad}px`, padding: `0 ${cardPad}px 4px`,
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
                      flex: `0 0 ${thumbSize}px`, width: thumbSize, height: thumbSize,
                      padding: 0, border: `1px solid ${T.cardEdge}`, borderRadius: 6,
                      background: T.parchmentDeep, overflow: 'hidden', cursor: 'zoom-in',
                      scrollSnapAlign: 'start',
                    }}
                  >
                    <img src={photoThumbUrl(p)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            )}

            {/* Content row */}
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'Georgia, serif', fontSize: speciesFontSize, fontWeight: 700, color: T.ink }}>{speciesName}</span>
                {isQuick && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: T.warnBg, color: T.warn,
                    border: `1px solid ${T.warn}`,
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    ! Details pending
                  </span>
                )}
                {!isQuick && c.metaNeedsReview && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: T.warnBg, color: T.warn,
                    border: `1px solid ${T.warn}`,
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    ! Needs location &amp; time
                  </span>
                )}
                {isPB(c.id) && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    background: T.parchmentDeep, color: T.brass,
                    border: `1px solid ${T.brass}`,
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.8,
                    padding: '2px 6px', borderRadius: 4,
                  }}>
                    <Trophy size={10} /> PB
                  </span>
                )}
              </div>
              <div style={{ fontSize: metaFontSize, color: T.inkSoft, marginTop: isTablet ? 4 : 2 }}>{when.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              {c.lat != null && c.lon != null && <div style={{ fontSize: metaFontSize, color: T.inkMute, marginTop: 2 }}>{c.lat.toFixed(4)}°, {c.lon.toFixed(4)}°</div>}
              <div style={{ fontSize: metaFontSize, color: T.inkMute, marginTop: 2 }}>
                {c.length ? `${c.length} in · ` : ''}
                {c.sunAlt != null ? `Sun ${c.sunAlt.toFixed(0)}° ${compassDir(c.sunAz || 0)} · ` : ''}
                {c.moonIllum != null ? `${c.moonName || 'Moon'} ${Math.round(c.moonIllum * 100)}%` : ''}
              </div>
              {c.weather && (
                <div style={{ fontSize: metaFontSize, color: T.inkSoft, marginTop: 2 }}>
                  {c.weather.tempF != null ? `${Math.round(c.weather.tempF)}°F · ` : ''}
                  {c.weather.windMph != null ? `Wind ${compassDir(c.weather.windDir || 0)} ${Math.round(c.weather.windMph)} mph · ` : ''}
                  {c.weather.cloudPct != null ? `${Math.round(c.weather.cloudPct)}% cloud` : ''}
                </div>
              )}
            </div>
            {/* Row-level share — direct, no modal. stopPropagation
                so tapping share doesn't also open the detail. */}
            <button
              onClick={(e) => shareRow(c, e)}
              aria-label={`Share ${speciesName} catch`}
              style={{
                position: 'absolute', top: 8, right: 8,
                width: 32, height: 32, background: 'transparent', border: 'none',
                color: T.inkMute, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 6,
              }}
              onMouseDown={(e) => e.currentTarget.style.color = T.brass}
              onMouseUp={(e) => e.currentTarget.style.color = T.inkMute}
            >
              <Share2 size={16} />
            </button>
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
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
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
      // Pin uses the SPECIES photo so anglers see what's caught where
      // at a glance. Falls back to the catch's own thumbnail (legacy
      // + user-photo case), then a plain dot if neither exists.
      const spPhoto = s ? speciesPhoto(s.id) : null;
      const pinUrl = spPhoto?.url || photoThumbUrl(c.photo);
      const icon = pinUrl
        ? L.divIcon({ html: `<img class="kyc-pin-img" src="${pinUrl}">`, className: '', iconSize: [34, 34], iconAnchor: [17, 17] })
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
  // On tablet, take over the available viewport: subtract the header,
  // footer, safe-area insets, and a small buffer for the caption line
  // + surrounding filter controls (~120px). On phone we keep the
  // original 420px fixed height so the filter row + map both fit
  // without scrolling weirdness.
  const mapHeight = isTablet
    ? 'calc(100vh - var(--kyc-header-height, 76px) - var(--kyc-footer-height, 80px) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 120px)'
    : 420;
  return (
    <div>
      <div ref={containerRef} style={{ height: mapHeight, minHeight: 420, borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.cardEdge}` }} />
      <div style={{ fontSize: isTablet ? 13 : 11, color: T.inkMute, marginTop: 6, textAlign: 'center' }}>
        {located} of {items.length} catch{items.length === 1 ? '' : 'es'} have GPS · pins are tappable
      </div>
    </div>
  );
}

export function CatchDetailScreen({ id, state, update, onEdit, onBack }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  const c = (state.catchLog || []).find(x => x.id === id);
  const [confirming, setConfirming] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState(null);
  // Direct share (no modal preview): build text (PB template if this
  // catch is the species' current PB, else the regular catch report),
  // resolve up to 3 photos to data URLs, hand off to shareReport.
  const doShare = async () => {
    if (!c) return;
    const s = speciesById(c.speciesId);
    const pb = c.speciesId ? state.pbs?.[c.speciesId] : null;
    const isPB = !!pb && pb.catchId === c.id;
    const text = isPB
      ? buildPBReport({ anglerName: state.anglerName, species: s, pb, units: state.units })
      : buildCatchReport({ anglerName: state.anglerName, species: s, c, units: state.units });
    const photos = catchPhotos(c).slice(0, 3);
    const photoDataUrls = (await Promise.all(photos.map(photoAsDataUrl))).filter(Boolean);
    await shareReport({
      title: `${(state.anglerName || 'My').trim() || 'My'} ${s ? s.commonName : 'catch'}`,
      text,
      photoDataUrls,
      fileName: `catch-${c.id}`,
    });
  };
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
  // Tablet: show the photo at its intrinsic size, capped by max-width
  // and max-height so a huge camera roll shot doesn't blow past the
  // viewport. width/height auto means we NEVER upscale — no Retina
  // resampling that made photos look pixelated in the previous pass.
  const singlePhotoStyle = {
    display: 'block',
    maxWidth: '100%',
    maxHeight: isTablet ? '80vh' : 280,
    width: isTablet ? 'auto' : '100%',
    height: 'auto',
    margin: isTablet ? '0 auto' : undefined,
    marginBottom: isTablet ? 0 : 14,
    background: isTablet ? T.parchmentDeep : undefined,
    borderRadius: 8,
    objectFit: isTablet ? 'contain' : 'cover',
    cursor: 'zoom-in',
  };
  return (
    <div style={{ padding: isTablet ? '22px 22px 32px' : '16px 16px 24px' }}>
      {cPhotos.length === 0
        ? <div style={{ width: '100%', height: isTablet ? 220 : 160, background: T.parchmentDeep, borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Camera size={isTablet ? 48 : 36} color={T.inkMute} /></div>
        : cPhotos.length === 1
          ? (isTablet
              ? <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <PhotoImg photo={cPhotos[0]} onClick={() => setLightboxIdx(0)} className="kyc-tappable" style={singlePhotoStyle} />
                </div>
              : <PhotoImg photo={cPhotos[0]} onClick={() => setLightboxIdx(0)} className="kyc-tappable" style={singlePhotoStyle} />)
          : <div className="kyc-hscroll" style={{
              display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
              margin: '0 -16px 14px', padding: '0 16px 4px',
              scrollSnapType: 'x proximity',
            }}>
              {cPhotos.map((p, i) => (
                <div key={i} onClick={() => setLightboxIdx(i)} className="kyc-tappable" style={{
                  flex: isTablet ? `0 0 ${isLandscape ? 720 : 620}px` : '0 0 78%',
                  maxWidth: isTablet ? '92%' : undefined,
                  borderRadius: 8, overflow: 'hidden', scrollSnapAlign: 'start',
                  border: `1px solid ${T.cardEdge}`, cursor: 'zoom-in',
                  background: isTablet ? T.parchmentDeep : undefined,
                }}>
                  <PhotoImg photo={p} alt={`${s ? s.commonName : 'Catch'} ${i + 1}`} style={{
                    display: 'block', width: '100%',
                    height: isTablet ? 'auto' : 240,
                    maxHeight: isTablet ? '75vh' : undefined,
                    objectFit: isTablet ? 'contain' : 'cover',
                  }} />
                </div>
              ))}
            </div>}

      <H1 size={isTablet ? (isLandscape ? 32 : 28) : 22}>{s ? s.commonName : (c.speciesId || 'Unknown')}</H1>
      {s && <div style={{ fontStyle: 'italic', fontSize: isTablet ? 16 : 13, color: T.inkSoft, marginBottom: isTablet ? 16 : 12 }}>{s.scientific}</div>}

      {s && (
        isAlreadyPB ? (
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              width: '100%', background: T.parchmentDeep, color: T.brass,
              border: `1.5px solid ${T.brass}`,
              padding: '10px 14px', borderRadius: 8, fontSize: 15, fontWeight: 800, letterSpacing: 0.5,
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
                padding: '6px 12px', borderRadius: 6, fontSize: 14, fontWeight: 700,
                cursor: 'pointer', alignSelf: 'center',
              }}
            >Remove PB status</button>
          </div>
        ) : (
          <button onClick={promoteToPB} style={{
            width: '100%', marginBottom: 14, background: T.brass, color: T.oceanDeep, border: 'none',
            padding: '10px 14px', borderRadius: 8, fontSize: 15, fontWeight: 800, letterSpacing: 0.5,
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
        {c.outcome === 'kept' && (
          <DetailRow label="Outcome" value={<span style={{ color: T.brass, fontWeight: 700 }}>Kept</span>} />
        )}
        {c.outcome === 'released' && (
          <DetailRow label="Outcome" value={<span style={{ color: T.open, fontWeight: 700 }}>Released</span>} />
        )}
        {c.aiIdentifiedSpeciesId && (
          <DetailRow
            label="Identified by AI"
            value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={12} color={T.brass} />
                {(() => {
                  const aiS = speciesById(c.aiIdentifiedSpeciesId);
                  const conf = c.aiConfidence != null ? ` · ${Math.round(c.aiConfidence * 100)}%` : '';
                  const confirmed = c.aiWasConfirmed ? ' · confirmed' : '';
                  return `${aiS ? aiS.commonName : c.aiIdentifiedSpeciesId}${conf}${confirmed}`;
                })()}
              </span>
            }
          />
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <SectionLabel>Conditions when caught</SectionLabel>
          {/* Archived-weather pill — surfaces when the weather block was
              pulled from the historical archive (backdated upload) rather
              than live-fetched at save time. Old catches without a source
              field predate the branch and show no pill. */}
          {c.weather && (c.weather.source === 'archive' || c.weather.source === 'forecast_past_days') && (
            <span style={{
              fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
              background: T.warnBg, color: T.warn,
              border: `1px solid ${T.warn}`,
              padding: '2px 6px', borderRadius: 4, fontWeight: 800,
            }}>🕰 archived</span>
          )}
        </div>
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
          <div style={{ fontSize: 14, color: T.inkMute, marginTop: 6 }}>Weather wasn't captured (offline at the time).</div>
        )}
      </Card>

      {c.notes && (
        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Notes</SectionLabel>
          <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.notes}</div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <GhostButton onClick={doShare} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Share2 size={14} /> Share
        </GhostButton>
        <GhostButton onClick={onEdit} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Pencil size={14} /> Edit
        </GhostButton>
        <button onClick={confirming ? remove : () => setConfirming(true)} style={{
          flex: 1, background: confirming ? T.closed : 'transparent',
          color: confirming ? '#fff' : T.closed,
          border: `1.5px solid ${T.closed}`, padding: '10px 14px', borderRadius: 6,
          fontSize: 16, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Trash2 size={14} /> {confirming ? 'Confirm' : 'Delete'}
        </button>
      </div>

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

export function CatchEntryScreen({ state, jurisdiction, update, onDone, onCancel, onHome, editingId, preselectSpeciesId, prefilledPhoto, aiConfidence, aiIdentifiedSpeciesId, aiWasConfirmed, openUploadOnMount, openSuggestOnMount, confirmPhoto }) {
  const existing = editingId ? (state.catchLog || []).find(c => c.id === editingId) : null;
  const isEdit = !!existing;
  const [speciesId, setSpeciesId] = useState(existing?.speciesId || preselectSpeciesId || '');
  const [length, setLength] = useState(existing?.length != null ? String(existing.length) : '');
  const [weight, setWeight] = useState(existing?.weight != null ? String(existing.weight) : '');
  const [notes, setNotes] = useState(existing?.notes || '');
  // Kept vs Released — persisted as entry.outcome. null = unset (angler
  // hasn't decided yet). Editable pre-save so the "did you keep this?"
  // question stays optional.
  const [outcome, setOutcome] = useState(existing?.outcome || null); // 'kept' | 'released' | null
  // AI-identified confidence from the capture flow. Only rendered on
  // the initial capture-flow arrival — clears once the angler changes
  // the species manually, since the AI's confidence no longer applies
  // to their overriding pick.
  const [aiBadgeConfidence, setAiBadgeConfidence] = useState(
    aiConfidence != null && preselectSpeciesId ? aiConfidence : null
  );
  // Enhanced species picker modal + "Suggest a species" modal state.
  // Both live in ./admin/pickers.jsx.
  const [speciesPickerOpen, setSpeciesPickerOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestInitial, setSuggestInitial] = useState('');
  const [suggestError, setSuggestError] = useState('');
  const { size: screenSize } = useScreenSize();
  const isTablet = screenSize !== 'phone';
  // Seed photos from the catch we're editing, or from an identification
  // photo handed in via prefilledPhoto (Identify → Log this catch flow).
  const [photos, setPhotos] = useState(() => {
    const seeded = catchPhotos(existing);
    if (seeded.length === 0 && prefilledPhoto) return [prefilledPhoto];
    return seeded;
  });
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
  // Photo-1 confirmation overlay. Every first photo (upload, camera,
  // or capture flow) stops here so the angler SEES what metadata was
  // found (or that none was) and confirms the species before the
  // photo drives the catch record. pendingConfirm:
  //   { dataUrl, meta: {source:'photo'|'device'|'none', lat?, lon?, time?},
  //     idStatus: 'running'|'done', idSpeciesId, idConfidence }
  const [pendingConfirm, setPendingConfirm] = useState(null);
  // True when the angler confirmed a photo WITHOUT usable metadata
  // and hasn't manually entered location+time yet. Saved on the
  // catch; drives the 'needs details' badge and excludes the catch
  // from Patterns analysis until cleared. Editing an existing row
  // seeds from what's stored.
  const [metaNeedsReview, setMetaNeedsReview] = useState(existing?.metaNeedsReview || false);

  // Open the confirmation overlay for a first photo. Runs Fish ID in
  // the background and patches the overlay state when it lands.
  const openPhotoConfirm = (dataUrl, meta) => {
    setPendingConfirm({ dataUrl, meta, idStatus: 'running', idSpeciesId: null, idConfidence: null });
    identifyPhoto(dataUrl, { jurisdictionId: jurisdiction?.id || null }).then((res) => {
      const cands = (res?.candidates || []).slice(0, 5);
      const top = cands[0] || null;
      setPendingConfirm(pc => pc && pc.dataUrl === dataUrl ? {
        ...pc,
        idStatus: 'done',
        idSpeciesId: top?.speciesId || null,
        idConfidence: typeof res?.confidenceScore === 'number' ? res.confidenceScore : (top?.score ?? null),
        idCandidates: cands,
      } : pc);
    }).catch(() => {
      setPendingConfirm(pc => pc && pc.dataUrl === dataUrl ? { ...pc, idStatus: 'done' } : pc);
    });
  };
  // Manual edit inputs.
  const [editingLoc, setEditingLoc] = useState(false);
  const [latInput, setLatInput] = useState('');
  const [lonInput, setLonInput] = useState('');
  const [editingWhen, setEditingWhen] = useState(false);
  const [whenInput, setWhenInput] = useState('');
  // Scroll target: the Review page's location/date rows resolve here
  // and jump the angler straight to the Auto-captured editors.
  const autoCapRef = useRef(null);
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

  // The Identify flow hands us a full-res data URL (FileReader output,
  // no downscale step). savePhoto owns the tier-aware downscale.
  useEffect(() => {
    if (!prefilledPhoto) return;
    let cancelled = false;
    (async () => {
      const entry = await savePhoto(prefilledPhoto);
      if (cancelled) return;
      setPhotos(p => p.map(slot => slot === prefilledPhoto ? entry : slot));
    })();
    return () => { cancelled = true; };
  }, [prefilledPhoto]);

  // Weather fetch once we have coords + a timestamp. Age-branched so
  // an upload of a backdated photo gets the historical weather at
  // that moment, not today's — see fetchWeatherForTime in helpers.js.
  // In edit mode we keep the original weather unless the user re-
  // fetches (e.g. changes GPS or when).
  useEffect(() => {
    if (loc.lat == null || loc.lon == null) return;
    if (isEdit && weather) return;
    setWxStatus('loading');
    let cancelled = false;
    fetchWeatherForTime({ lat: loc.lat, lon: loc.lon, when })
      .then((w) => {
        if (cancelled) return;
        if (w) { setWeather(w); setWxStatus('ok'); }
        else   { setWxStatus('offline'); }
      });
    return () => { cancelled = true; };
  }, [loc.lat, loc.lon, when]);

  const sun = loc.lat != null && loc.lon != null ? sunPosition(when, loc.lat, loc.lon) : null;
  const moon = moonPhase(when);

  const cameraRef = React.useRef(null);
  const uploadRef = React.useRef(null);
  const [photoSource, setPhotoSource] = useState(null); // 'camera' | 'upload' | null

  // Auto-open the file picker on mount when routed here from the
  // Log-menu "Upload photo" tile. One-shot: guard with a ref so
  // subsequent renders don't re-trigger.
  const uploadKickedRef = React.useRef(false);
  useEffect(() => {
    if (openUploadOnMount && !uploadKickedRef.current) {
      uploadKickedRef.current = true;
      // Defer to next tick so the ref is attached to the DOM node.
      setTimeout(() => uploadRef.current?.click(), 0);
    }
  }, [openUploadOnMount]);

  // Capture flow (home camera button) lands here with the photo +
  // Fish ID result already computed — open the same confirmation
  // overlay instead of the old separate confirm card. One-shot.
  const confirmKickedRef = React.useRef(false);
  useEffect(() => {
    if (confirmPhoto?.imageDataUrl && !confirmKickedRef.current) {
      confirmKickedRef.current = true;
      setPendingConfirm({
        dataUrl: confirmPhoto.imageDataUrl,
        meta: { source: 'device', time: new Date() },
        idStatus: 'done',
        idSpeciesId: confirmPhoto.aiIdentifiedSpeciesId || null,
        idConfidence: confirmPhoto.aiConfidence ?? null,
        idCandidates: confirmPhoto.candidates || [],
      });
    }
  }, [confirmPhoto]);

  // Overlay resolution: apply the (possibly cropped) photo, the
  // metadata decision, and the species pick to the form in one shot.
  const resolvePhotoConfirm = async ({ finalDataUrl, useMeta, speciesPick, suggestNew, quick, editField }) => {
    const pc = pendingConfirm;
    setPendingConfirm(null);
    if (!pc) return;
    const entry = await savePhoto(finalDataUrl || pc.dataUrl);
    setPhotos(p => [entry, ...p].slice(0, 3));
    setPhotoSource(pc.meta.source === 'device' ? 'camera' : 'upload');
    if (useMeta && pc.meta.source === 'photo') {
      if (pc.meta.lat != null) setLoc({ lat: pc.meta.lat, lon: pc.meta.lon, error: null, loading: false });
      if (pc.meta.time) setWhen(pc.meta.time);
      setMetaSource('photo');
      setMetaNeedsReview(false);
      setPhotoExifStatus(pc.meta.lat != null && pc.meta.time ? 'gps+time' : pc.meta.lat != null ? 'gps' : 'time');
    } else if (useMeta && pc.meta.source === 'device') {
      fetchGps();
      setWhen(pc.meta.time || new Date());
      setMetaSource('device');
      setMetaNeedsReview(false);
      setPhotoExifStatus(null);
    } else {
      // Confirmed WITHOUT metadata — flag the record until the angler
      // fills in location + time manually. Protects Patterns/analysis
      // from silently-wrong defaults.
      setMetaSource(null);
      setMetaNeedsReview(true);
      setPhotoExifStatus('none');
    }
    if (speciesPick) {
      setSpeciesId(speciesPick);
      setAiBadgeConfidence(pc.idConfidence ?? null);
    }
    if (suggestNew) {
      setSuggestInitial('');
      setSuggestOpen(true);
    }
    // Quick Confirm: arm a one-shot save. resolvePhotoConfirm sets
    // species/loc/when via setState, so we can't save synchronously
    // here — the armed effect below fires once those have landed.
    if (quick && speciesPick && !suggestNew) setArmedQuickSave(true);

    // Tapped the Location / Date row on the Review page: open that
    // editor and scroll the Auto-captured card into view so it's ready
    // to edit the moment the overlay closes.
    if (editField) {
      if (editField === 'loc') startEditLoc();
      else if (editField === 'when') startEditWhen();
      setTimeout(() => {
        autoCapRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  };
  const cancelPhotoConfirm = () => setPendingConfirm(null);

  // Quick Confirm one-shot: once resolvePhotoConfirm's species has
  // landed in state, save as a 'quick' catch and leave to the Logbook.
  const [armedQuickSave, setArmedQuickSave] = useState(false);
  useEffect(() => {
    if (!armedQuickSave || !speciesId) return;
    setArmedQuickSave(false);
    save({ quick: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedQuickSave, speciesId]);

  // Fish ID → "Add to database": land here with the scanned photo
  // already attached and the suggest modal open, so the angler can
  // name the unknown fish immediately. One-shot.
  const suggestKickedRef = React.useRef(false);
  useEffect(() => {
    if (openSuggestOnMount && !suggestKickedRef.current) {
      suggestKickedRef.current = true;
      setSuggestInitial('');
      setSuggestOpen(true);
    }
  }, [openSuggestOnMount]);

  // Only Photo #1 drives the catch's location & time. Photos #2 and
  // #3 are just additional shots — they don't change anything.
  // Common post-capture flow — accepts a data URL from either the
  // Capacitor Camera path (native) or the hidden file input (web).
  const acceptCameraPhoto = async (rawDataUrl) => {
    if (!rawDataUrl || photos.length >= 3) return;
    const isFirst = photos.length === 0;
    if (isFirst) {
      // Photo 1 drives the record — stop at the confirmation overlay
      // (device GPS + capture time are the metadata on offer).
      openPhotoConfirm(rawDataUrl, { source: 'device', time: new Date() });
      return;
    }
    const entry = await savePhoto(rawDataUrl);
    setPhotos(p => [...p, entry].slice(0, 3));
    setPhotoSource('camera');
  };

  const handleCameraPick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // File input path (web + fallback). Read to data URL, then hand
    // to the common accept flow.
    const r = new FileReader();
    r.onload = () => acceptCameraPhoto(String(r.result));
    r.readAsDataURL(f);
  };

  // Native path: invoke Capacitor Camera directly so saveToGallery
  // fires and the full-res capture also lands in the iOS Photos
  // library, matching the angler's expectation that camera photos go
  // into Recents. Web falls through to the hidden file input.
  const takePhotoNow = async () => {
    if (photos.length >= 3) return;
    if (!isNative()) {
      cameraRef.current?.click();
      return;
    }
    const dataUrl = await getPhoto({ cameraOnly: true });
    if (dataUrl) acceptCameraPhoto(dataUrl);
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
    // Additional shots (2-3) apply instantly — they carry no data.
    const instant = wasEmpty ? batch.slice(1) : batch;
    if (instant.length) {
      Promise.all(instant.map((f) => savePhoto(f))).then((entries) => {
        setPhotos(p => [...p, ...entries].slice(0, 3));
        setPhotoSource('upload');
      });
    }
    if (!wasEmpty) return;
    // Photo 1: read EXIF first, then stop at the confirmation overlay
    // so the angler SEES whether metadata was found before it drives
    // the record. Some photos return DateTimeOriginal as a string
    // like "2024:03:15 12:30:45"; parseExifDate handles both forms.
    const f = batch[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
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
        openPhotoConfirm(dataUrl, (gotGps || parsed) ? {
          source: 'photo',
          lat: gotGps ? meta.latitude : null,
          lon: gotGps ? meta.longitude : null,
          time: parsed || null,
        } : { source: 'none' });
      }).catch(() => openPhotoConfirm(dataUrl, { source: 'none' }));
    };
    reader.readAsDataURL(f);
  };

  const removePhotoAt = (i) => {
    setPhotos(p => {
      // Fire-and-forget the disk delete so we don't leave orphan files.
      // Best-effort: failures are silent (already deleted, missing file).
      deletePhoto(p[i]);
      return p.filter((_, idx) => idx !== i);
    });
    // If we removed the first photo, the source tag no longer reflects
    // what's on screen — clear it so the angler isn't misled.
    if (i === 0) {
      setPhotoExifStatus(null);
      if (metaSource === 'photo') setMetaSource(null);
    }
  };

  // On-demand crop for a catch photo. DELIBERATELY not automatic:
  // catch photos are keepsakes — anglers usually want the people in
  // frame, so the whole photo goes in by default. (Fish ID's capture
  // flow still auto-crops, where isolating the fish helps the model.)
  const [cropIdx, setCropIdx] = React.useState(null);
  const [cropSrc, setCropSrc] = React.useState(null);
  const openPhotoCrop = async (i) => {
    const p = photos[i];
    if (!p) return;
    // CropStep draws to a canvas, so it needs a data URL (capacitor://
    // src taints). photoAsDataUrl handles all entry shapes.
    const src = await photoAsDataUrl(p);
    if (!src) return;
    setCropIdx(i);
    setCropSrc(src);
  };
  const applyPhotoCrop = async ({ dataUrl }) => {
    if (dataUrl == null || cropIdx == null) { setCropIdx(null); setCropSrc(null); return; }
    const old = photos[cropIdx];
    const entry = await savePhoto(dataUrl);
    setPhotos(p => p.map((ph, idx) => idx === cropIdx ? entry : ph));
    deletePhoto(old); // drop the uncropped bytes; entry replaces it
    setCropIdx(null);
    setCropSrc(null);
  };
  // Manually overrides the photo-derived location with a fresh device GPS.
  const useDeviceGps = () => {
    fetchGps();
    setMetaSource('device');
    setMetaNeedsReview(false);
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
      setMetaNeedsReview(false);
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
      setMetaNeedsReview(false);
    }
    setEditingWhen(false);
  };

  const canSave = !!speciesId;
  const save = (opts = {}) => {
    const entry = {
      id: existing ? existing.id : 'c_' + Date.now(),
      // Quick Confirm from the Review page saves a 'quick' catch — the
      // Logbook badge + nag banner become the "we'll remind you" nudge.
      // Otherwise: editing a Quick Log flips it back to 'complete', and
      // a normal save is 'complete'.
      status: opts.quick ? 'quick'
        : existing?.status === 'quick' ? 'complete'
        : (existing?.status || 'complete'),
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
      outcome, // 'kept' | 'released' | null
      // AI identification metadata rides along on every capture-flow
      // catch. Existing/edit rows preserve whatever was already there.
      aiIdentifiedSpeciesId: aiIdentifiedSpeciesId ?? existing?.aiIdentifiedSpeciesId ?? null,
      aiConfidence:          aiConfidence          ?? existing?.aiConfidence          ?? null,
      aiWasConfirmed:        aiWasConfirmed        ?? existing?.aiWasConfirmed        ?? false,
      // True until the angler supplies real location + time for a
      // photo that carried none — drives the 'needs details' badge
      // and keeps the catch out of Patterns analysis meanwhile.
      metaNeedsReview,
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
    // Cross-device sync is wired into update() itself now (see App.jsx
    // syncChanges hook). The old research publish flow was retired
    // when the sync layer landed in build 14.
    onDone();
  };

  // Species list for the picker — bundled active species merged with
  // any user-added custom species (those still awaiting review OR
  // already merged/approved but pre-sync). Approved ones will drop
  // out on the next species-store refresh since the merger removes
  // them from customSpecies at that point.
  const customUsable = useMemo(() => {
    return (state.customSpecies || [])
      .filter(cs => cs && cs.id && (cs.status === 'pending' || cs.status === 'approved' || cs.status === 'merged'))
      .map(cs => ({
        id: cs.id,
        commonName: cs.commonName,
        scientific: cs.scientific || '',
        altNames: cs.altNames || [],
        category: 'custom',
        active: true,
        custom: true,
      }));
  }, [state.customSpecies]);
  const speciesSorted = useMemo(() => {
    const merged = [...SPECIES, ...customUsable];
    return merged.slice().sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [customUsable]);

  // Resolves a species id against both bundled SPECIES and the local
  // customSpecies list so the current selection renders correctly
  // even when the user just added it via the Suggest flow.
  const resolveSpecies = (id) => (
    speciesById(id) || customUsable.find(s => s.id === id) || null
  );

  // Legality banner — derived from the current REGULATIONS entry for
  // this species + jurisdiction. Runs entirely off the bundled dataset
  // so it works airplane-mode. Absent regs default to a neutral
  // "check with the agency" state — never say "legal" when we don't
  // know.
  const legalityResult = jurisdiction && speciesId ? regulationFor(speciesId, jurisdiction.id) : { source: 'none', regulation: null };
  const legalityReg = legalityResult.regulation;
  const legalitySeason = legalityReg ? seasonState(legalityReg.open) : null;
  const legalityChips = [];
  if (legalityReg) {
    if (legalitySeason?.reason) legalityChips.push(legalitySeason.reason);
    if (legalityReg.minSize != null) legalityChips.push(`Min size ${formatSize(legalityReg.minSize, state.units)}`);
    if (legalityReg.maxSize != null) legalityChips.push(`Max size ${formatSize(legalityReg.maxSize, state.units)}`);
    if (legalityReg.bagLimit != null) legalityChips.push(`Bag limit ${legalityReg.bagLimit}`);
    if (legalityReg._fromFed) legalityChips.push('Federal Gulf rules');
  }
  // Length check against the slot: an undersize/oversize fish can't
  // be kept REGARDLESS of season status — even when the season is
  // unknown, 12" < 16" min is a certain verdict.
  const lengthIn = length !== '' && Number.isFinite(Number(length))
    ? (state.units === 'metric' ? Number(length) / 2.54 : Number(length))
    : null;
  const sizeViolation = legalityReg && lengthIn != null && (
    (legalityReg.minSize != null && lengthIn < legalityReg.minSize) ? 'under' :
    (legalityReg.maxSize != null && lengthIn > legalityReg.maxSize) ? 'over'  : null
  );
  // Retention prohibitions: bag limit 0 or prohibition vocabulary in
  // the season/notes text mean "never keep", whatever the season
  // parser thought.
  const prohibited = legalityReg && (
    legalityReg.bagLimit === 0
    || PROHIBITED_RE.test(String(legalityReg.open || ''))
    || PROHIBITED_RE.test(String(legalityReg.notes || ''))
  );
  // Verdict order: certain no-keep facts first (prohibition, size
  // violation), then season state, then unknown.
  const effectiveLegality =
    !speciesId ? null
    : !legalityReg ? 'unknown'
    : prohibited ? 'closed'
    : sizeViolation ? 'closed'
    : legalitySeason?.status === 'closed'   ? 'closed'
    : legalitySeason?.status === 'upcoming' ? 'closed'  // not open yet = can't keep today
    : legalitySeason?.status === 'open'     ? 'open'
    : 'unknown';
  // A green verdict computed from FED-fallback data is not a state-
  // waters guarantee — delegated species (red snapper!) set their own
  // state seasons. No-keep verdicts stay decisive (conservative);
  // the open verdict softens to a federal-scoped statement.
  const fedSoftOpen = effectiveLegality === 'open' && !!legalityReg?._fromFed;
  const legalityHeadline =
    effectiveLegality === 'open'
      ? (fedSoftOpen ? 'Open under FEDERAL rules — state season may differ' : 'Legal to keep')
    : effectiveLegality === 'closed' ? (
        prohibited ? 'Retention prohibited — release it'
      : sizeViolation === 'under' ? 'Undersize — release it'
      : sizeViolation === 'over'  ? 'Oversize — release it'
      : legalitySeason?.status === 'upcoming' ? 'Season not open yet'
      : 'Season closed — release it')
    // Unknown: lead with what we KNOW (size/bag rules are on file for
    // nearly every species), never a bare "confirm source" punt.
    : legalityReg ? 'Rules below — season set in-season'
    : 'No rules on file for these waters';

  return (
    <div style={{ padding: '16px 16px 24px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>{isEdit ? 'Edit catch' : 'Log a catch'}</H1>

      {aiBadgeConfidence != null && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: T.parchmentDeep, border: `1px solid ${T.brass}`,
          color: T.brass, fontSize: 12, fontWeight: 800, letterSpacing: 0.8,
          padding: '4px 10px', borderRadius: 999, marginBottom: 12,
        }}>
          <Sparkles size={12} strokeWidth={2.4} />
          AI IDENTIFIED · {Math.round(aiBadgeConfidence * 100)}%
        </div>
      )}

      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel>Photos</SectionLabel>
          <span style={{ fontSize: 12, color: T.inkMute }}>{photos.length} / 3</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          {[0, 1, 2].map(i => {
            const p = photos[i];
            if (p) {
              return (
                <div key={i} style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden', border: i === 0 ? `1.5px solid ${T.brass}` : `1px solid ${T.cardEdge}` }}>
                  <img src={photoThumbUrl(p)} alt={`Catch photo ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {i === 0 && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'rgba(25, 212, 242, 0.92)', color: T.oceanDeep,
                      fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textAlign: 'center',
                      padding: '3px 4px',
                    }}>
                      LOCATION + TIME
                    </div>
                  )}
                  <button onClick={() => openPhotoCrop(i)} aria-label="Crop photo" style={{
                    position: 'absolute', top: 4, left: 4,
                    borderRadius: 6, padding: '3px 7px',
                    background: 'rgba(3, 27, 51, 0.85)', color: '#5ecdf2',
                    border: '1px solid #5ecdf2', cursor: 'pointer',
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
                  }}>
                    CROP
                  </button>
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
                {isNext && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8 }}>ADD</span>}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 10, lineHeight: 1.45, padding: '6px 8px', background: T.parchmentDeep, borderRadius: 6 }}>
          <strong style={{ color: T.brass }}>Photo 1</strong> sets the catch's location &amp; time. If Photo 1 was taken away from the catch spot (e.g. at the dock), edit the location and time below.
        </div>
        {/* Take/Upload buttons removed — you reach this page with a
            photo already, and the dashed ADD tiles above add more.
            Cancel / SAVE CATCH live in the sticky bar at the bottom. */}
        <div style={{ fontSize: 12, color: T.inkMute, marginTop: 4, lineHeight: 1.45 }}>
          {photos.length >= 3
            ? 'Maximum of 3 photos. Remove one to add a different photo.'
            : 'Tap a dashed tile above to add another photo (up to 3).'}
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleCameraPick} style={{ display: 'none' }} />
        <input ref={uploadRef} type="file" accept="image/*" multiple onChange={handleUploadPick} style={{ display: 'none' }} />
        {/* Photo-1 confirmation overlay — metadata verdict + species
            confirm + optional crop, blocking until the angler decides. */}
        {pendingConfirm && (
          <PhotoConfirmOverlay
            pc={pendingConfirm}
            resolveSpecies={resolveSpecies}
            speciesOptions={speciesSorted}
            units={state.units}
            onResolve={resolvePhotoConfirm}
            onCancel={cancelPhotoConfirm}
            onHome={onHome}
          />
        )}
        {/* On-demand crop overlay (position:fixed). Catch photos keep
            the full frame by default; this is the opt-in trim. */}
        {cropIdx != null && cropSrc && (
          <CropStep
            imageSrc={cropSrc}
            title="Crop photo"
            primaryLabel="Use crop"
            cancelLabel="Cancel"
            onCancel={() => { setCropIdx(null); setCropSrc(null); }}
            onConfirm={applyPhotoCrop}
          />
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Species</SectionLabel>
        {speciesId && (() => {
          const s = resolveSpecies(speciesId);
          if (!s) return null;
          return (
            <div style={{ marginBottom: 10, fontFamily: 'Georgia, serif' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: T.ink, lineHeight: 1.2 }}>
                {s.commonName}
                {s.custom && (
                  <span style={{
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                    color: '#5ecdf2', fontWeight: 800, marginLeft: 8,
                    verticalAlign: 'middle',
                  }}>
                    Custom
                  </span>
                )}
              </div>
              {s.scientific && (
                <div style={{ fontSize: 15, color: T.inkSoft, fontStyle: 'italic', marginTop: 2 }}>
                  {s.scientific}
                </div>
              )}
            </div>
          );
        })()}
        <button
          type="button"
          onClick={() => setSpeciesPickerOpen(true)}
          style={{
            ...inputStyle, padding: '10px 12px', textAlign: 'left',
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          }}
        >
          <Search size={14} color={T.brass} />
          <span style={{ flex: 1, color: speciesId ? T.ink : T.inkMute }}>
            {speciesId
              ? (resolveSpecies(speciesId)?.commonName || 'Change species…')
              : 'Search or pick a species…'}
          </span>
          <ChevronRight size={14} color={T.inkSoft} />
        </button>

        {/* Legality banner — reads the bundled REGULATIONS table for
            this species + jurisdiction. Airplane-mode safe. Green
            "Legal to keep" when open + no size violation, red when
            closed, neutral when we don't have data. Chips list the
            deciding factors so the angler can see the numbers, not
            just the verdict. */}
        {speciesId && jurisdiction && effectiveLegality && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 8,
            background: effectiveLegality === 'open'   ? (fedSoftOpen ? T.warnBg : T.openBg)
                       : effectiveLegality === 'closed' ? T.closedBg
                       : T.parchmentDeep,
            border: `1px solid ${
              effectiveLegality === 'open'   ? (fedSoftOpen ? T.warn : T.open)
              : effectiveLegality === 'closed' ? T.closed
              : T.cardEdge
            }`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: legalityChips.length ? 10 : 0 }}>
              {effectiveLegality === 'open'
                ? <ShieldCheck    size={28} strokeWidth={2.4} color={fedSoftOpen ? T.warn : T.open} style={{ flexShrink: 0 }} />
                : effectiveLegality === 'closed'
                ? <ShieldAlert    size={28} strokeWidth={2.4} color={T.closed} style={{ flexShrink: 0 }} />
                : <ShieldQuestion size={28} strokeWidth={2.4} color={T.inkSoft} style={{ flexShrink: 0 }} />}
              <div style={{
                fontSize: 19, fontWeight: 800, letterSpacing: 0.3,
                color: effectiveLegality === 'open' ? (fedSoftOpen ? T.warn : T.open)
                     : effectiveLegality === 'closed' ? T.closed
                     : T.inkSoft,
              }}>
                {legalityHeadline}
              </div>
            </div>
            {legalityChips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {legalityChips.map((chip, i) => (
                  <span key={i} style={{
                    fontSize: 15, color: T.ink, background: T.parchmentDeep,
                    border: `1px solid ${T.cardEdge}`, padding: '6px 11px', borderRadius: 999,
                  }}>{chip}</span>
                ))}
              </div>
            )}
            {/* Agency deep link — always available when the season isn't
                a definitive open/closed, so "set in-season" is one tap
                from the answer instead of a dead end. */}
            {effectiveLegality === 'unknown' && jurisdiction?.regsUrl && (
              <a href={jurisdiction.regsUrl} target="_blank" rel="noopener noreferrer"
                 onClick={(e) => e.stopPropagation()}
                 style={{
                   display: 'inline-block', marginTop: 10,
                   fontSize: 16, fontWeight: 700, color: T.brass,
                   textDecoration: 'underline',
                 }}>
                Current {jurisdiction.agency || 'agency'} season →
              </a>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Field label={`Length (${state.units === 'metric' ? 'cm' : 'in'})`} value={length} onChange={setLength} type="number" placeholder="—" />
          <Field label={`Weight (${state.units === 'metric' ? 'kg' : 'lb'})`} value={weight} onChange={setWeight} type="number" placeholder="—" />
        </div>

        {/* Kept / Released toggle — the angler's outcome, separate
            from the legality banner. Tracking this over time drives
            the "release rate" analytic in Patterns. */}
        <div style={{ marginTop: 12 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Outcome</SectionLabel>
          <div style={{ display: 'flex', gap: 6 }}>
            <PickButton active={outcome === 'kept'}     onClick={() => setOutcome(outcome === 'kept' ? null : 'kept')}>Kept</PickButton>
            <PickButton active={outcome === 'released'} onClick={() => setOutcome(outcome === 'released' ? null : 'released')}>Released</PickButton>
          </div>
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
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 700, color: T.ink }}>
                  <Trophy size={14} color={T.brass} /> Personal Best for {sName}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: T.inkMute, marginTop: 4, lineHeight: 1.4 }}>
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

      <div ref={autoCapRef}>
      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Auto-captured</SectionLabel>
        {photoExifStatus === 'none' && (
          <div style={{ fontSize: 12, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had no location or time metadata — set them manually below or use device GPS.
          </div>
        )}
        {photoExifStatus === 'gps' && (
          <div style={{ fontSize: 12, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had location but no time — set the time manually below if needed.
          </div>
        )}
        {photoExifStatus === 'time' && (
          <div style={{ fontSize: 12, color: T.warn, padding: '6px 8px', background: T.warnBg, borderRadius: 6, lineHeight: 1.45, marginBottom: 8 }}>
            Photo 1 had time but no location — use device GPS or enter coordinates manually.
          </div>
        )}
        <DetailRow label="Time" value={
          editingWhen ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input type="datetime-local" value={whenInput} onChange={e => setWhenInput(e.target.value)} style={{ padding: '4px 6px', fontSize: 14, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <button onClick={saveEditWhen} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingWhen(false)} style={{ background: 'transparent', color: T.inkMute, border: `1px solid ${T.cardEdge}`, padding: '3px 6px', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </span>
          ) : (
            <span>
              {when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
              {metaSource === 'photo' && <span style={{ color: T.brass, fontSize: 12, marginLeft: 6 }}>· from Photo 1</span>}
              {metaSource === 'manual' && <span style={{ color: T.brass, fontSize: 12, marginLeft: 6 }}>· manual</span>}
              <button onClick={startEditWhen} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4, marginLeft: 6, cursor: 'pointer' }}>Edit</button>
            </span>
          )
        } />
        <DetailRow label="Location" value={
          editingLoc ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <input type="number" step="any" value={latInput} onChange={e => setLatInput(e.target.value)} placeholder="Lat" style={{ width: 80, padding: '4px 6px', fontSize: 14, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <input type="number" step="any" value={lonInput} onChange={e => setLonInput(e.target.value)} placeholder="Lon" style={{ width: 90, padding: '4px 6px', fontSize: 14, background: T.parchmentDeep, color: T.ink, border: `1px solid ${T.cardEdge}`, borderRadius: 4 }} />
              <button onClick={saveEditLoc} style={{ background: T.brass, color: T.oceanDeep, border: 'none', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Save</button>
              <button onClick={() => setEditingLoc(false)} style={{ background: 'transparent', color: T.inkMute, border: `1px solid ${T.cardEdge}`, padding: '3px 6px', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </span>
          ) : loc.loading ? (
            <span>Acquiring GPS… <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Enter manually</button></span>
          ) : loc.error ? (
            <span>Unavailable — {loc.error}. <button onClick={fetchGps} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Retry</button> <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, marginLeft: 4, cursor: 'pointer' }}>Enter manually</button></span>
          ) : (loc.lat == null || loc.lon == null) ? (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
              <span style={{ color: T.inkMute }}>Not set —</span>
              <button onClick={() => setPickerOpen(true)} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Pin on map</button>
              <button onClick={useDeviceGps} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Use device GPS</button>
              <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>Enter manually</button>
            </span>
          ) : (
            <span>
              {loc.lat.toFixed(5)}°, {loc.lon.toFixed(5)}°
              {metaSource === 'photo' && <span style={{ color: T.brass, fontSize: 12, marginLeft: 6 }}>· from Photo 1</span>}
              {metaSource === 'manual' && <span style={{ color: T.brass, fontSize: 12, marginLeft: 6 }}>· manual</span>}
              {metaSource === 'pin' && <span style={{ color: T.brass, fontSize: 12, marginLeft: 6 }}>· pinned</span>}
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={() => setPickerOpen(true)} style={{ background: 'transparent', border: `1px solid ${T.brass}`, color: T.brass, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Pin on map</button>
                <button onClick={startEditLoc} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Edit</button>
                <button onClick={useDeviceGps} style={{ background: 'transparent', border: `1px solid ${T.cardEdge}`, color: T.inkSoft, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer' }}>Device GPS</button>
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
      </div>

      {/* Spacer so the last field clears the fixed action bar below. */}
      <div style={{ height: 84 }} />
      {/* Sticky action bar — always in view above the tab bar, same
          pattern as the Fish ID results bar. */}
      <div style={{
        position: 'fixed', left: 0, right: 0,
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${isTablet ? 76 : 60}px)`,
        zIndex: 20,
        padding: '12px 14px',
        background: 'rgba(4,22,42,0.96)', backdropFilter: 'blur(6px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', gap: 8,
      }}>
        <GhostButton onClick={onCancel} style={{ flex: 1, minHeight: 52 }}>Cancel</GhostButton>
        <PrimaryButton onClick={save} disabled={!canSave} style={{ flex: 2, minHeight: 52, fontSize: 17, fontWeight: 800 }}>{isEdit ? 'Save changes' : 'SAVE CATCH'}</PrimaryButton>
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

      {speciesPickerOpen && (
        <SpeciesPickerModal
          speciesOptions={speciesSorted}
          currentSpeciesId={speciesId}
          isTablet={isTablet}
          onCancel={() => setSpeciesPickerOpen(false)}
          onPick={(id) => {
            setSpeciesId(id);
            setAiBadgeConfidence(null);
            setSpeciesPickerOpen(false);
          }}
          onRequestSuggest={(searchText) => {
            const capReached = (state.customSpecies || []).filter(cs => cs.status !== 'rejected').length >= 25;
            if (capReached) {
              setSuggestError("You've already suggested 25 species. Wait for those to be reviewed before adding more.");
              return;
            }
            setSuggestInitial(searchText);
            setSuggestError('');
            setSpeciesPickerOpen(false);
            setSuggestOpen(true);
          }}
          title="Pick species"
        />
      )}

      {suggestOpen && (
        <SpeciesSuggestModal
          initialCommonName={suggestInitial}
          hasPhotoAvailable={photos.length > 0}
          onCancel={() => setSuggestOpen(false)}
          onSubmit={({ commonName, scientificName, altNames, notes: suggNotes, includePhoto }) => {
            const clientId = newClientSpeciesId();
            const now = new Date().toISOString();
            const entry = {
              id: clientId,
              commonName,
              scientific: scientificName || '',
              altNames: altNames ? altNames.split(',').map(s => s.trim()).filter(Boolean) : [],
              notes: suggNotes || '',
              submittedAt: now,
              status: 'pending',
            };
            const next = [...(state.customSpecies || []), entry];
            update({ customSpecies: next });
            setSpeciesId(clientId);
            setAiBadgeConfidence(null);
            setSuggestOpen(false);
            // Best-effort cloud submit — offline is fine, sync tries
            // again on next boot from the local customSpecies entry.
            const photoPath = (includePhoto && photos[0])
              ? (typeof photos[0] === 'object' ? photos[0].storagePath : null)
              : null;
            submitSuggestion({
              clientSpeciesId: clientId,
              commonName,
              scientificName,
              altNames,
              notes: suggNotes,
              photoStoragePath: photoPath,
            }).catch(() => {});
          }}
        />
      )}

      {suggestError && (
        <div role="alert" onClick={() => setSuggestError('')} style={{
          position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 600,
          background: T.card, border: `1px solid #c66`, color: T.ink,
          borderRadius: 10, padding: 12, fontSize: 15, cursor: 'pointer',
          boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
        }}>
          {suggestError} <span style={{ color: T.inkMute, fontSize: 12 }}>(tap to dismiss)</span>
        </div>
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
    if (s.active === false) return false;
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

/* ============================================================
   PHOTO CONFIRM OVERLAY — Photo 1 gatekeeper.
   Shows the photo (with opt-in crop), states plainly whether
   usable metadata was found, and confirms the species after Fish
   ID runs. Nothing lands on the catch record until the angler
   picks one of the explicit Confirm actions — so wrong metadata
   can never slip in silently and poison Patterns/analysis.
   ============================================================ */
function PhotoConfirmOverlay({ pc, resolveSpecies, speciesOptions, units, onResolve, onCancel, onHome }) {
  const [workingUrl, setWorkingUrl] = useState(pc.dataUrl); // cropped or original
  const [cropping, setCropping] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speciesPick, setSpeciesPick] = useState(null); // null = follow idSpeciesId
  const [suggestNew, setSuggestNew] = useState(false);

  const chosenId = suggestNew ? null : (speciesPick ?? pc.idSpeciesId ?? null);
  const chosen = chosenId ? resolveSpecies(chosenId) : null;
  const pct = pc.idConfidence != null ? Math.round(pc.idConfidence * 100) : null;
  const speciesName = chosen?.commonName || 'this fish';

  const hasMeta = pc.meta.source === 'photo'
    ? (pc.meta.lat != null || !!pc.meta.time)
    : pc.meta.source === 'device';

  // Location + time preview strings for the two summary rows.
  const locText = pc.meta.source === 'device' ? 'Current device location'
    : pc.meta.source === 'photo' && pc.meta.lat != null
      ? `${pc.meta.lat.toFixed(4)}°, ${pc.meta.lon.toFixed(4)}°`
      : 'No location yet';
  const locSub = pc.meta.source === 'device' ? 'Using device GPS'
    : pc.meta.source === 'photo' && pc.meta.lat != null ? 'From this photo'
      : 'Add it on the next step';
  const whenDate = pc.meta.time || new Date();
  const whenText = whenDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    + ' · ' + whenDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // LOG CATCH → into the full details form (species/loc/time prefilled).
  // editField jumps straight to the Location or Date editor on the form.
  const logCatch = (editField) => onResolve({ finalDataUrl: workingUrl, useMeta: hasMeta, speciesPick: chosenId, suggestNew, editField });
  // QUICK CONFIRM → save immediately as a 'quick' catch + reminder.
  const quickConfirm = () => onResolve({ finalDataUrl: workingUrl, useMeta: hasMeta, speciesPick: chosenId, suggestNew, quick: true });

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 4px', width: '100%',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textAlign: 'left', color: T.ink,
    borderTop: `1px solid ${T.cardEdge}`,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: T.bgDeep, color: T.ink,
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      padding: '8px 16px 16px',
      paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
    }}>
      {/* Header — title + X close (discards the catch, back to Home). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <H1 size={26}>Review catch</H1>
        <button
          onClick={onHome || onCancel}
          aria-label="Close and discard"
          style={{
            background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`,
            color: T.inkSoft, borderRadius: 999, width: 38, height: 38,
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* ---------- TOP HALF: photo + identification + details ---------- */}
      <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {/* Photo + circular crop-icon affordance */}
        <div style={{ position: 'relative' }}>
          <img src={workingUrl} alt="Your catch" style={{ width: '100%', maxHeight: 300, objectFit: 'cover', display: 'block', background: '#000' }} />
          <button onClick={() => setCropping(true)} aria-label="Crop photo" style={{
            position: 'absolute', top: 12, right: 12,
            width: 42, height: 42, borderRadius: 999,
            background: 'rgba(3, 27, 51, 0.7)', color: T.ink,
            border: `1px solid rgba(255,255,255,0.25)`, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CropIcon size={18} />
          </button>
        </div>

        <div style={{ padding: 14 }}>
          {/* Identification */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 999, flexShrink: 0,
              border: `1.5px solid ${T.brass}`, color: T.brass,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <FishIcon size={24} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SectionLabel style={{ marginBottom: 2 }}>Identification</SectionLabel>
              {suggestNew ? (
                <div style={{ fontSize: 22, fontWeight: 800, color: T.brass, lineHeight: 1.15 }}>New species</div>
              ) : chosen ? (
                <div style={{ fontSize: 24, fontWeight: 800, color: T.ink, lineHeight: 1.15 }}>{chosen.commonName}</div>
              ) : pc.idStatus === 'running' ? (
                <div style={{ fontSize: 18, color: T.inkMute }}>Identifying…</div>
              ) : (
                <div style={{ fontSize: 18, color: T.inkMute }}>Not identified — pick below</div>
              )}
              {!suggestNew && chosen && pct != null && (
                <div style={{
                  display: 'inline-block', marginTop: 6,
                  background: T.parchmentDeep, borderRadius: 999,
                  padding: '4px 12px', fontSize: 13, fontWeight: 700,
                  color: pct >= 80 ? T.open : pct >= 60 ? T.brass : T.warn,
                }}>
                  {speciesPick ? 'Picked by you' : `Best match · ${pct}% confidence`}
                </div>
              )}
            </div>
          </div>

          {/* Location row — tap to adjust on the details step */}
          <button onClick={() => logCatch('loc')} style={{ ...rowStyle, marginTop: 12 }}>
            <MapPinIcon size={20} color={T.brass} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{locText}</div>
              <div style={{ fontSize: 13, color: T.inkMute }}>{locSub}</div>
            </div>
            <ChevronRight size={20} color={T.inkMute} />
          </button>

          {/* Date & time row — tap to adjust on the details step */}
          <button onClick={() => logCatch('when')} style={rowStyle}>
            <CalendarIcon size={20} color={T.brass} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{whenText}</div>
              <div style={{ fontSize: 13, color: T.inkMute }}>Date &amp; time</div>
            </div>
            <ChevronRight size={20} color={T.inkMute} />
          </button>

          {/* Not-a-[species] → picker (search or add) → back here */}
          <button
            onClick={() => setPickerOpen(true)}
            style={{
              width: '100%', marginTop: 14,
              background: 'transparent', border: `1.5px solid ${T.brass}`,
              color: T.brass, borderRadius: 10, padding: '12px',
              fontSize: 15, fontWeight: 800, cursor: 'pointer',
            }}
          >
            {chosen ? `Not a ${speciesName}?` : 'Pick the species'}
          </button>
        </div>
      </Card>

      {/* ---------- BOTTOM: primary LOG CATCH + quiet quick-confirm link ---------- */}
      <div style={{ marginTop: 14, paddingBottom: 8 }}>
        <button onClick={() => logCatch()} style={{
          width: '100%', background: T.brass, color: T.oceanDeep, border: 'none',
          borderRadius: 14, padding: '16px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 20, fontWeight: 900, letterSpacing: 0.3 }}>
            <CheckCircle2 size={24} color={T.oceanDeep} strokeWidth={2.6} />
            LOG CATCH
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, opacity: 0.85 }}>Details look good</span>
        </button>
        {/* Quiet secondary — a small yellow (BEST MATCH accent) pill so
            LOG CATCH stays the dominant action. */}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            onClick={quickConfirm}
            disabled={!chosenId}
            style={{
              display: 'inline-block',
              background: 'transparent', border: `1px solid ${T.warn}`,
              color: chosenId ? T.warn : T.inkMute,
              fontSize: 14, fontWeight: 700, borderRadius: 999,
              padding: '9px 18px', cursor: chosenId ? 'pointer' : 'not-allowed',
              opacity: chosenId ? 1 : 0.5,
            }}
          >
            Quick confirm — save now, we'll remind you
          </button>
        </div>
      </div>

      {cropping && (
        <CropStep
          imageSrc={workingUrl}
          title="Crop photo"
          primaryLabel="Use crop"
          cancelLabel="Cancel"
          onCancel={() => setCropping(false)}
          onConfirm={({ dataUrl }) => {
            if (dataUrl) setWorkingUrl(dataUrl);
            setCropping(false);
          }}
        />
      )}

      {pickerOpen && (
        <SpeciesPickerModal
          speciesOptions={speciesOptions}
          currentSpeciesId={chosenId}
          onCancel={() => setPickerOpen(false)}
          onPick={(sid) => { setSpeciesPick(sid); setSuggestNew(false); setPickerOpen(false); }}
          onRequestSuggest={() => { setSuggestNew(true); setSpeciesPick(null); setPickerOpen(false); }}
          title="What species is it?"
        />
      )}
    </div>
  );
}

const _BAG_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 10, 15, 20];

function pickBagLimitQuestion(jurisdiction, prevSpeciesId = null) {
  const candidates = SPECIES.filter(s => {
    if (s.active === false) return false;
    if (s.id === prevSpeciesId) return false;
    if (s.category === 'bait') return false; // no bait regs questions
    // Uses the same store precedence as the display path — verified
    // Supabase overlay first, bundled fallback second. Fed-fallback
    // regs are EXCLUDED: the prompt names the state, so grading a
    // federal number as the state answer would teach the wrong limit.
    const reg = regulationFor(s.id, jurisdiction.id).regulation;
    return reg && !reg._fromFed && reg.bagLimit != null;
  });
  if (candidates.length === 0) return null;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const limit = regulationFor(correct.id, jurisdiction.id).regulation.bagLimit;
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
    if (s.active === false) return false;
    if (s.id === prevSpeciesId) return false;
    if (s.category === 'bait') return false; // no bait regs questions
    // Same store precedence as bag-limit picker above; fed-fallback
    // regs excluded for the same reason.
    const reg = regulationFor(s.id, jurisdiction.id).regulation;
    return reg && !reg._fromFed && reg.minSize != null;
  });
  if (candidates.length === 0) return null;
  const correct = candidates[Math.floor(Math.random() * candidates.length)];
  const size = regulationFor(correct.id, jurisdiction.id).regulation.minSize;
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

/* Lookalikes question — three-tier graded scoring.

   Given an anchor species with a non-empty s.lookalikes[] array, ask
   which species is commonly confused with it. Answers are graded, not
   binary:
     - Any species in anchor.lookalikes → full credit (1.0, green)
     - Same category as anchor but NOT in lookalikes → partial (0.5, amber)
     - Different category → wrong (0.0, red)

   Options are constructed to make the tier distribution deterministic:
     1× primary lookalike (canonical correct, first in anchor.lookalikes)
     1× same-category non-lookalike (partial-credit trap)
     2× different-category distractors (obvious wrongs)
   Then shuffled so tier order isn't predictable to the angler. */
function pickLookalikesQuestion(seenAnchorIds = new Set()) {
  const candidates = SPECIES.filter(s =>
    !seenAnchorIds.has(s.id)
    && Array.isArray(s.lookalikes)
    && s.lookalikes.some(id => speciesById(id))
  );
  if (candidates.length === 0) return null;
  const anchor = candidates[Math.floor(Math.random() * candidates.length)];

  // Primary lookalike = first resolvable entry in anchor.lookalikes.
  // That's the "canonical" pairing the seed data authors prioritized.
  const primary = anchor.lookalikes.map(id => speciesById(id)).find(Boolean);
  if (!primary) return null;

  const sameCatPool = SPECIES.filter(s =>
    s.id !== anchor.id
    && s.id !== primary.id
    && s.category === anchor.category
    && !anchor.lookalikes.includes(s.id)
  );
  const sameCatDistractor = _shuffle(sameCatPool)[0];

  const otherCatPool = SPECIES.filter(s =>
    s.id !== anchor.id
    && s.id !== primary.id
    && s.category !== anchor.category
    && !anchor.lookalikes.includes(s.id)
    && (!sameCatDistractor || s.id !== sameCatDistractor.id)
  );
  const otherCatDistractors = _shuffle(otherCatPool).slice(0, 2);

  // Compose the option list. If same-category distractor pool was
  // empty (rare — very short-category anchor), backfill with another
  // different-category option so we still get 4 answers.
  const seed = [primary];
  if (sameCatDistractor) seed.push(sameCatDistractor);
  seed.push(...otherCatDistractors);
  if (seed.length < 4) {
    const backup = _shuffle(SPECIES.filter(s =>
      s.id !== anchor.id && !seed.some(x => x.id === s.id) && !anchor.lookalikes.includes(s.id)
    ));
    for (const s of backup) {
      if (seed.length >= 4) break;
      seed.push(s);
    }
  }
  if (seed.length < 4) return null;

  return {
    type: 'lookalikes',
    species: anchor,
    correctSpecies: primary,           // used by feedback UI
    primaryLookalike: primary,         // explicit alias per spec
    anchorLookalikes: anchor.lookalikes,
    prompt: <>Which of these is often confused with a <strong>{anchor.commonName}</strong>?</>,
    options: _shuffle(seed).map(s => ({
      key: s.id, label: s.commonName, species: s,
      // isCorrect kept for backwards-compat with the shared render
      // path — true only for full-credit picks. Tier is computed at
      // scoring time from the picked species vs the anchor.
      isCorrect: anchor.lookalikes.includes(s.id),
    })),
  };
}

function pickQuizQuestion(state, jurisdiction, prevSpeciesId = null, seenAnchorIds = new Set()) {
  // Without a jurisdiction set we can't ask reg questions — fall back
  // to species-ID or lookalikes only.
  const types = jurisdiction
    ? ['species', 'bag', 'size', 'lookalikes']
    : ['species', 'lookalikes'];
  const pick = types[Math.floor(Math.random() * types.length)];
  const q = pick === 'bag'        ? pickBagLimitQuestion(jurisdiction, prevSpeciesId)
          : pick === 'size'       ? pickSizeLimitQuestion(jurisdiction, state.units, prevSpeciesId)
          : pick === 'lookalikes' ? pickLookalikesQuestion(seenAnchorIds)
          : pickSpeciesQuestion(prevSpeciesId);
  // If a reg-question pool is empty for the chosen jurisdiction,
  // fall back to species so the angler always gets something.
  return q || pickSpeciesQuestion(prevSpeciesId);
}

/* Classify a picked option into one of three grading tiers. For all
   non-lookalikes question types the picked option is either correct
   or wrong (no partial). Returns { tier, score } where tier is
   'full' | 'partial' | 'wrong' and score is 1 | 0.5 | 0.

   Tier is derived server-side (from the question + picked species)
   rather than from an option flag so the option data is free of any
   scoring hints an inspector could exploit. */
function classifyAnswer(question, picked) {
  if (!question || !picked) return { tier: 'wrong', score: 0 };
  if (question.type === 'lookalikes') {
    const anchor = question.species;
    if (anchor?.lookalikes?.includes(picked.id)) return { tier: 'full',    score: 1   };
    if (picked.category && anchor?.category === picked.category)
                                             return { tier: 'partial', score: 0.5 };
    return                                          { tier: 'wrong',   score: 0   };
  }
  // Non-lookalikes: full or nothing.
  return picked.__isCorrect ? { tier: 'full', score: 1 } : { tier: 'wrong', score: 0 };
}

export function QuizScreen({ state, jurisdiction, update, onPickSpecies, onBack }) {
  const { size } = useScreenSize();
  const isTablet = size !== 'phone';
  const isLandscape = size === 'tablet-landscape';
  const [seenAnchorIds] = useState(() => new Set());
  // Ref on the Next-question button so we can scroll it to the top
  // of the viewport when an answer lands. Prevents the browser from
  // "jumping to top" after DOM changes on wrong-answer explanations.
  const nextBtnRef = useRef(null);
  const [question, setQuestion] = useState(() => pickQuizQuestion(state, jurisdiction));
  const [selectedKey, setSelectedKey] = useState(null);
  // Decimal score to accommodate 0.5 partial credit. Split tracks how
  // many were full / partial / wrong for the end-of-session summary.
  const [score, setScore] = useState({ points: 0, total: 0, full: 0, partial: 0, wrong: 0 });
  const [streak, setStreak] = useState(0);
  // Toast state: 'full' | 'partial' | 'wrong' | null.
  // Shown right after the user picks — Correct gets a Next-question CTA,
  // Close / Wrong get a Learn-more CTA that dismisses to the fish detail.
  const [toastTier, setToastTier] = useState(null);
  // Snapshot of the best streak at mount so a new best animates in
  // without interrupting the session. Persisted via update() when a
  // new best is set.
  const bestStreak = state?.quizBestStreak ?? 0;
  const [newBestFlash, setNewBestFlash] = useState(false);

  // Register the anchor so the next question doesn't repeat it.
  useEffect(() => {
    if (question?.type === 'lookalikes' && question.species?.id) {
      seenAnchorIds.add(question.species.id);
    }
  }, [question, seenAnchorIds]);

  // After an answer lands, scroll the Next-question button to the top
  // of the viewport so the review + explanation sits directly below
  // the CTA. Before this fix a wrong answer caused the browser to
  // jump the scroll offset (from the DOM growing / focus change) and
  // the angler landed at the top of the page instead of at the CTA.
  useEffect(() => {
    if (!selectedKey) return;
    // Two rAF so React commit + browser layout both settle before we
    // scroll — otherwise Safari clamps to a stale scroll target.
    let raf1, raf2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        nextBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [selectedKey]);

  const next = () => {
    setSelectedKey(null);
    setToastTier(null);
    setQuestion(pickQuizQuestion(state, jurisdiction, question?.species?.id, seenAnchorIds));
  };

  const pick = (opt) => {
    if (selectedKey) return;
    setSelectedKey(opt.key);
    // Pass through the option's own isCorrect via a non-persistent
    // temporary — the classifier reads either the lookalikes match
    // or (for other types) the option's __isCorrect flag.
    const picked = opt.species ? { ...opt.species, __isCorrect: opt.isCorrect } : { id: opt.key, __isCorrect: opt.isCorrect };
    const { tier, score: pts } = classifyAnswer(question, picked);
    setScore(s => ({
      points: s.points + pts,
      total: s.total + 1,
      full: s.full + (tier === 'full' ? 1 : 0),
      partial: s.partial + (tier === 'partial' ? 1 : 0),
      wrong: s.wrong + (tier === 'wrong' ? 1 : 0),
    }));
    // Update session streak + persist best if beaten.
    setStreak(prev => {
      const nextStreak = tier === 'full' ? prev + 1 : 0;
      if (nextStreak > bestStreak && update) {
        update({ quizBestStreak: nextStreak });
        setNewBestFlash(true);
        setTimeout(() => setNewBestFlash(false), 1600);
      }
      return nextStreak;
    });
    setToastTier(tier);
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
  const pickedSpecies = selectedOpt?.species || (selectedOpt && speciesById(selectedOpt.key));
  // Grade the picked answer. For lookalikes this yields full / partial /
  // wrong; for other question types partial never triggers.
  const grade = selectedOpt
    ? classifyAnswer(question, pickedSpecies ? { ...pickedSpecies, __isCorrect: selectedOpt.isCorrect } : { id: selectedOpt.key, __isCorrect: selectedOpt.isCorrect })
    : null;
  const tier = grade?.tier; // 'full' | 'partial' | 'wrong' | null
  const isCorrect = tier === 'full';
  const tierColor = tier === 'full' ? T.open : tier === 'partial' ? T.warn : T.closed;
  const tierBg    = tier === 'full' ? T.openBg : tier === 'partial' ? T.warnBg : T.closedBg;
  // For wrong-category picks in a lookalikes question, teach by
  // showing the anchor next to the PRIMARY lookalike (what they
  // should've picked). For full/partial, show anchor next to what
  // they actually picked so the comparison reinforces the choice.
  const compareRight = question.type === 'lookalikes'
    ? (tier === 'wrong' ? question.primaryLookalike : pickedSpecies)
    : null;
  // Precedence: verified Supabase overlay → bundled fallback → none.
  // Was reading REGULATIONS bundled directly, which meant Quiz always
  // showed stale bundled regs even after admin verified fresher
  // AI-drafted rows in the Regulations tab. Route through the same
  // regulationFor() helper the RegulationsList and RegulationDetail
  // screens use so all three surfaces stay in sync.
  const reg = jurisdiction ? regulationFor(sp.id, jurisdiction.id).regulation : null;
  const status = reg ? seasonState(reg.open).status : 'unknown';

  const catName = (id) => (categoryById(id)?.name) || id;
  const fmtScore = (n) => (n % 1 === 0 ? String(n) : n.toFixed(1));

  const typeLabel = {
    species: 'Spot the species from the photo.',
    bag: 'Recall the daily bag limit for this species in your waters.',
    size: 'Recall the minimum legal size for this species in your waters.',
    lookalikes: 'Which species is commonly confused with the one shown?',
  }[question.type];

  // For bag / size / lookalikes we show the species photo + name in the
  // prompt (so the angler knows what fish they're answering about).
  // For the species-ID question we hide the name until they answer.
  const revealSpeciesName = question.type !== 'species';

  return (
    <div style={{ padding: isTablet ? '22px 22px 32px' : '16px 16px 24px' }}>
      {/* Slim persistent streak banner. Runs the whole width above the
          question so the record-to-beat cue is always in view without
          competing with the question card. Session streak on the left
          (flame when active), best on the right in brass.
          The inline scoreboard below still shows the running score. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12,
        height: isTablet ? 40 : 34,
        padding: isTablet ? '0 14px' : '0 12px',
        marginBottom: isTablet ? 12 : 10,
        background: T.parchmentDeep,
        border: `1px solid ${T.cardEdge}`,
        borderRadius: 8,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: isTablet ? 14 : 12, color: T.inkSoft, fontWeight: 700,
        }}>
          <span aria-hidden style={{
            fontSize: isTablet ? 15 : 13,
            opacity: streak > 0 ? 1 : 0.35,
          }}>🔥</span>
          <span style={{ color: streak > 0 ? T.ink : T.inkMute }}>
            Streak {streak}
          </span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: isTablet ? 13 : 11, fontWeight: 800,
          color: T.brass, letterSpacing: 0.6, textTransform: 'uppercase',
        }}>
          <Trophy size={isTablet ? 14 : 12} strokeWidth={2} />
          Best {bestStreak}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8, flexWrap: 'wrap' }}>
        <H1 size={isTablet ? (isLandscape ? 32 : 30) : 22}>Fish ID Quiz</H1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: isTablet ? 16 : 12, color: T.inkSoft }}>
          <span title={`${score.full} correct · ${score.partial} partial · ${score.wrong} wrong`}>
            {fmtScore(score.points)} / {score.total}
          </span>
          {streak >= 2 && (
            <span style={{
              color: T.brass, fontWeight: 800,
              transform: newBestFlash ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 220ms ease',
            }}>
              🔥 {streak}
            </span>
          )}
          {bestStreak > 0 && (
            <span style={{ color: T.inkMute, fontWeight: 600, fontSize: isTablet ? 14 : 11 }}
              title="Best streak — beat it!">
              best {bestStreak}
            </span>
          )}
        </div>
      </div>
      {score.total > 0 && score.partial > 0 && (
        <div style={{ fontSize: isTablet ? 12 : 10, color: T.inkMute, marginBottom: 6, letterSpacing: 0.4 }}>
          {score.full} full · {score.partial} partial · {score.wrong} wrong
        </div>
      )}
      <div style={{ fontSize: isTablet ? 15 : 12, color: T.inkMute, marginBottom: isTablet ? 18 : 14 }}>
        {typeLabel}
      </div>

      {/* Photo */}
      <div style={{
        background: 'linear-gradient(165deg, #0F3A56 0%, #07223A 60%, #04162A 100%)',
        borderRadius: 14, border: `1px solid ${T.cardEdge}`,
        height: isTablet ? (isLandscape ? 420 : 380) : 240,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', marginBottom: revealSpeciesName ? 6 : (isTablet ? 18 : 14),
        position: 'relative',
      }}>
        {photo?.url
          ? <img src={photo.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
          : <SpeciesImage species={sp} size={isTablet ? 280 : 200} style={{ height: isTablet ? 280 : 200 }} />}
      </div>
      {revealSpeciesName && (
        <div style={{ fontFamily: 'Georgia, serif', fontSize: isTablet ? 24 : 18, fontWeight: 700, color: T.ink, marginBottom: isTablet ? 18 : 14, textAlign: 'center' }}>
          {sp.commonName}
        </div>
      )}

      {/* Prompt */}
      <div style={{ fontSize: isTablet ? 17 : 13, color: T.inkSoft, margin: '0 2px 10px', lineHeight: 1.5 }}>
        {question.prompt}
      </div>

      {/* Options — after an answer, lookalikes options use tier tinting:
          full-credit lookalike → green, same-category (partial) → amber,
          different-category → dim. The picked option gets its own tier
          color even if not full-credit. Other question types stay
          full-or-nothing green/red. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.options.map(opt => {
          const isPicked = selectedKey === opt.key;
          let bg = T.card, border = T.cardEdge, color = T.ink, iconNode = null;
          if (selectedKey) {
            if (question.type === 'lookalikes') {
              const optSpecies = opt.species || speciesById(opt.key);
              const optGrade = classifyAnswer(question, optSpecies ? { ...optSpecies, __isCorrect: opt.isCorrect } : { id: opt.key });
              if (optGrade.tier === 'full') {
                bg = T.openBg; border = T.open; color = T.open;
                if (isPicked) iconNode = <CheckCircle2 size={18} color={T.open} />;
              } else if (isPicked && optGrade.tier === 'partial') {
                bg = T.warnBg; border = T.warn; color = T.warn;
                iconNode = <AlertTriangle size={18} color={T.warn} />;
              } else if (isPicked) {
                bg = T.closedBg; border = T.closed; color = T.closed;
                iconNode = <X size={18} color={T.closed} />;
              } else {
                color = T.inkMute;
              }
            } else {
              if (opt.isCorrect) { bg = T.openBg; border = T.open; color = T.open; iconNode = <CheckCircle2 size={18} color={T.open} />; }
              else if (isPicked) { bg = T.closedBg; border = T.closed; color = T.closed; iconNode = <X size={18} color={T.closed} />; }
              else { color = T.inkMute; }
            }
          }
          return (
            <button key={opt.key} onClick={() => pick(opt)} disabled={!!selectedKey} style={{
              background: bg, border: `1.5px solid ${border}`, borderRadius: 10,
              padding: isTablet ? '18px 20px' : '12px 14px',
              cursor: selectedKey ? 'default' : 'pointer',
              textAlign: 'left', color,
              fontSize: isTablet ? 17 : 14, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span>{opt.label}</span>
              {iconNode}
            </button>
          );
        })}
      </div>

      {/* Next question — placed ABOVE the fish detail so the angler
          never has to scroll past the review section to move on. For a
          full-credit answer the toast's Next-question CTA is the
          faster path; for close/wrong picks this button IS the CTA
          (the toast dismisses to Learn instead). */}
      {selectedKey && (
        <div ref={nextBtnRef} style={{ scrollMarginTop: 12 }}>
          <PrimaryButton onClick={next} style={{ marginTop: 14, marginBottom: 6 }}>
            Next question
            <ChevronRight size={16} style={{ display: 'inline', marginLeft: 6, verticalAlign: 'middle' }} />
          </PrimaryButton>
        </div>
      )}

      {/* Result + species review */}
      {selectedKey && (
        <Card style={{ marginTop: 8, background: question.type === 'lookalikes' ? tierBg : undefined, borderColor: question.type === 'lookalikes' ? tierColor : undefined }}>
          {/* Tier-aware verdict line — lookalikes get three-tier phrasing
              (full / partial / wrong); other types keep the classic
              green-check or red-X messaging. */}
          <div style={{ fontSize: isTablet ? 18 : 15, fontWeight: 800, color: question.type === 'lookalikes' ? tierColor : (isCorrect ? T.open : T.closed), marginBottom: 10, lineHeight: 1.4 }}>
            {question.type === 'lookalikes' ? (
              tier === 'full' ? (
                <>✓ Correct — {sp.commonName} is often confused with {pickedSpecies?.commonName}.</>
              ) : tier === 'partial' ? (
                <>◐ Good eye — both are {catName(sp.category)}. But {sp.commonName} is most commonly confused with {question.primaryLookalike?.commonName}. Tell them apart by: {sp.keyIds?.[0] || '—'}.</>
              ) : (
                <>✗ Not quite — {pickedSpecies?.commonName} is a {catName(pickedSpecies?.category)}, different family. {sp.commonName} is most commonly confused with {question.primaryLookalike?.commonName}.</>
              )
            ) : (
              isCorrect
                ? '✓ Correct!'
                : question.type === 'species'
                  ? `✗ It's a ${sp.commonName}`
                  : `✗ The answer is ${correctOpt?.label}`
            )}
          </div>

          {/* Side-by-side panel for lookalikes: anchor + either the
              picked species (full/partial credit) or the primary
              lookalike (wrong — teach what they should have picked).
              Wrong-category picks explicitly aren't shown side-by-side
              with the wrong species, only with the correct target. */}
          {question.type === 'lookalikes' && compareRight && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                <div style={{ textAlign: 'center' }}>
                  <SpeciesImage species={sp} size={80} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 6 }}>{sp.commonName}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <SpeciesImage species={compareRight} size={80} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 6 }}>{compareRight.commonName}</div>
                </div>
              </div>
              {sp.keyIds?.[0] && (
                <div style={{ background: T.parchmentDeep, borderRadius: 6, padding: '8px 10px', fontSize: 14, color: T.inkSoft, lineHeight: 1.5 }}>
                  <span style={{ color: T.brass, fontWeight: 700 }}>Key tell for {sp.commonName}:</span> {sp.keyIds[0]}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <SpeciesImage species={sp} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 19, fontWeight: 700, color: T.ink }}>
                {sp.commonName}
              </div>
              <div style={{ fontStyle: 'italic', fontSize: 14, color: T.inkSoft, marginTop: 2 }}>
                {sp.scientific}
              </div>
              {sp.altNames?.length > 0 && (
                <div style={{ fontSize: 12, color: T.brass, marginTop: 4, letterSpacing: 0.5 }}>
                  also: {sp.altNames.join(' · ')}
                </div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 15, color: T.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
            {sp.habitat}
          </div>

          <SectionLabel style={{ marginBottom: 6 }}>Key IDs</SectionLabel>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18, color: T.inkSoft, fontSize: 15, lineHeight: 1.55 }}>
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
                <div style={{ fontSize: 14, color: T.inkMute, padding: 8 }}>
                  No regulations on file for this species in {jurisdiction.name}.
                </div>
              )}
            </>
          )}

          {onPickSpecies && (
            <button onClick={() => onPickSpecies(sp.id)} style={{
              marginTop: 12, background: 'transparent', color: T.brass,
              border: 'none', padding: 0, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              Full species page <ChevronRight size={12} />
            </button>
          )}
        </Card>
      )}

      {/* Result popup — appears on answer pick. Full-credit shows a
          big green "Correct!" with a Next-question CTA. Close / wrong
          picks dismiss to the fish detail below so the angler learns
          before moving on. Tap outside / close to dismiss on any tier. */}
      {toastTier && (
        <QuizResultPopup
          tier={toastTier}
          streak={streak}
          bestStreak={bestStreak}
          newBest={newBestFlash}
          isTablet={isTablet}
          onNext={next}
          onLearn={() => setToastTier(null)}
        />
      )}
    </div>
  );
}

/* Result popup for the quiz. Non-blocking on close / wrong — dismisses
   to reveal the fish detail card so the angler can learn what they
   got wrong. Full-credit answers get a Next-question CTA that skips
   the review entirely. */
function QuizResultPopup({ tier, streak, bestStreak, newBest, isTablet, onNext, onLearn }) {
  const isFull    = tier === 'full';
  const isPartial = tier === 'partial';
  const color     = isFull ? T.open : isPartial ? T.warn : T.closed;
  const bg        = isFull ? T.openBg : isPartial ? T.warnBg : T.closedBg;
  const label     = isFull ? 'Correct!' : isPartial ? 'Close!' : 'Wrong';
  const emoji     = isFull ? '🎣' : isPartial ? '🐟' : '🎯';
  const subline   = isFull
    ? 'Great eye. Keep the streak going.'
    : isPartial
      ? 'Right family, wrong species — scroll to learn the tell.'
      : 'Scroll to learn the ID cues for next time.';

  return (
    <div
      role="dialog"
      aria-live="polite"
      onClick={onLearn}
      style={{
        position: 'fixed', inset: 0, zIndex: 900,
        // Heavier scrim so the page content behind the popup goes
        // firmly to the background rather than competing with the
        // result text. Blur backs it up for iOS Safari where opacity
        // alone still lets edges bleed through busy photos.
        background: 'rgba(4, 14, 26, 0.82)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // Solid opaque card so the emoji + label + streak line
          // never compete with the darkened page behind. The tier
          // color survives as the border + the emoji / label /
          // button treatments — the card itself doesn't need to
          // be tinted to communicate the tier.
          background: T.card,
          border: `2px solid ${color}`,
          borderRadius: 16,
          padding: isTablet ? '28px 32px' : '20px 22px',
          maxWidth: 420, width: '100%',
          textAlign: 'center',
          boxShadow: `0 18px 48px rgba(0,0,0,0.6), 0 0 0 6px ${bg}`,
        }}
      >
        <div style={{ fontSize: isTablet ? 60 : 44, lineHeight: 1, marginBottom: 6 }}>
          {emoji}
        </div>
        <div style={{
          fontSize: isTablet ? 36 : 28, fontWeight: 900,
          color, letterSpacing: 1, marginBottom: 8,
        }}>
          {label}
        </div>
        <div style={{ fontSize: isTablet ? 14 : 12, color: T.inkSoft, lineHeight: 1.5, marginBottom: 16 }}>
          {subline}
        </div>
        {isFull && streak >= 2 && (
          <div style={{
            fontSize: isTablet ? 15 : 13, color: T.brass, fontWeight: 800, marginBottom: 12,
            transform: newBest ? 'scale(1.1)' : 'scale(1)',
            transition: 'transform 220ms ease',
          }}>
            🔥 {streak} in a row{newBest ? ' — new best!' : bestStreak > 0 ? ` · best ${bestStreak}` : ''}
          </div>
        )}
        {isFull ? (
          <>
            <button
              onClick={onNext}
              style={{
                width: '100%', padding: '14px 16px', borderRadius: 10,
                background: color, color: T.oceanDeep,
                border: 'none', fontSize: isTablet ? 17 : 15, fontWeight: 800,
                cursor: 'pointer', letterSpacing: 0.4,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              Next question <ChevronRight size={18} />
            </button>
            <button
              onClick={onLearn}
              style={{
                width: '100%', marginTop: 8,
                background: 'transparent', color: T.inkSoft,
                border: 'none', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', textDecoration: 'underline',
                padding: '6px 8px',
              }}
            >
              See details first
            </button>
          </>
        ) : (
          <button
            onClick={onLearn}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: 10,
              background: color, color: T.oceanDeep,
              border: 'none', fontSize: isTablet ? 17 : 15, fontWeight: 800,
              cursor: 'pointer', letterSpacing: 0.4,
            }}
          >
            Learn what to look for
          </button>
        )}
      </div>
    </div>
  );
}
