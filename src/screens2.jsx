import React, { useState, useMemo } from 'react';
import {
  Search, ChevronRight, AlertTriangle, Plus, Pencil, Trophy, Camera, Trash2, Mail,
  Wrench, Ruler,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, SPECIES, REGULATIONS,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { defaultState, saveState } from './storage.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, cleanSeason, seasonState,
} from './helpers.js';
import {
  StatusPill, FishMark, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, SpeciesRow,
  inputStyle,
} from './components.jsx';

/* ============================================================
   SPECIES DETAIL
   ============================================================ */
export function SpeciesDetailScreen({ id, state, jurisdiction, stale, onLookalike, onAddPB, onFullRegs, onKeep, update }) {
  const s = speciesById(id);
  const [showNoteEdit, setShowNoteEdit] = useState(false);
  const [noteDraft, setNoteDraft] = useState(state.notes[id] || '');
  if (!s) return <div style={{ padding: 20 }}>Species not found.</div>;
  const reg = jurisdiction ? REGULATIONS[id]?.[jurisdiction.id] : null;
  const fedReg = REGULATIONS[id]?.fed_gulf;
  const showFedColumn = reg && fedReg && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
  const pb = state.pbs[id];

  const saveNote = () => {
    update({ notes: { ...state.notes, [id]: noteDraft.trim() } });
    setShowNoteEdit(false);
  };

  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <Card style={{ background: T.oceanDeep, color: T.parchment, border: `1.5px solid ${T.brass}`, padding: 18, marginBottom: 14, textAlign: 'center' }}>
        <FishMark species={s} size={100} />
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
                  <FishMark species={o} size={36} />
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
        <span style={{ fontSize: 14, fontWeight: 700, color: ssColor }}>{ss.reason}</span>
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
          <FishMark species={a} size={64} />
          <div style={{ marginTop: 6, fontFamily: 'Georgia, serif', fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{a.commonName}</div>
        </Card>
        <Card style={{ textAlign: 'center', padding: 10 }}>
          <FishMark species={b} size={64} />
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
export function RegulationsListScreen({ state, jurisdiction, onPick }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lower = q.toLowerCase().trim();
    return SPECIES.filter(s => !lower || s.commonName.toLowerCase().includes(lower) || s.altNames.some(a => a.toLowerCase().includes(lower)))
      .sort((a, b) => a.commonName.localeCompare(b.commonName));
  }, [q]);
  return (
    <div style={{ padding: '16px 16px 8px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>Regulations</H1>
      {jurisdiction && <div style={{ fontSize: 13, color: T.brassDeep, fontWeight: 600, marginBottom: 12 }}>{jurisdiction.name}</div>}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search species…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(s => {
          const reg = jurisdiction ? REGULATIONS[s.id]?.[jurisdiction.id] : null;
          const status = reg ? seasonState(reg.open).status : 'unknown';
          return (
            <Card key={s.id} onClick={() => onPick(s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10 }}>
              <FishMark species={s} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                <div style={{ fontSize: 11, color: T.inkMute }}>
                  {reg ? `Min ${formatSize(reg.minSize, state.units)} · Bag ${reg.bagLimit ?? '—'}` : 'No data'}
                </div>
              </div>
              <StatusPill status={status} size="small" />
              <ChevronRight size={16} color={T.brass} />
            </Card>
          );
        })}
      </div>
    </div>
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
              <FishMark species={s} size={38} />
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

export function RegulationDetailScreen({ id, state, jurisdiction, stale, onSpecies }) {
  const s = speciesById(id);
  if (!s) return <div style={{ padding: 20 }}>Not found.</div>;
  const reg = jurisdiction ? REGULATIONS[id]?.[jurisdiction.id] : null;
  const fedReg = REGULATIONS[id]?.fed_gulf;
  const showFedColumn = reg && fedReg && jurisdiction?.id !== 'fed_gulf' && differs(reg, fedReg);
  return (
    <div style={{ padding: '16px 16px' }}>
      <Card style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }} onClick={onSpecies}>
        <FishMark species={s} size={56} />
        <div style={{ flex: 1 }}>
          <H1 size={20}>{s.commonName}</H1>
          <div style={{ fontStyle: 'italic', fontSize: 12, color: T.inkMute }}>{s.scientific}</div>
          <div style={{ fontSize: 11, color: T.brass, marginTop: 4, fontWeight: 600 }}>View species details →</div>
        </div>
      </Card>
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
export function SpeciesListScreen({ onPick }) {
  const [q, setQ] = useState('');
  const sorted = useMemo(() => [...SPECIES].sort((a, b) => a.commonName.localeCompare(b.commonName)), []);
  const filtered = useMemo(() => {
    const lower = q.toLowerCase().trim();
    if (!lower) return sorted;
    return sorted.filter(s => s.commonName.toLowerCase().includes(lower) || s.altNames.some(a => a.toLowerCase().includes(lower)) || s.scientific.toLowerCase().includes(lower));
  }, [q, sorted]);
  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 12 }}>All species</H1>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={16} color={T.inkMute} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" style={{ ...inputStyle, paddingLeft: 32, background: T.card }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.map(s => <SpeciesRow key={s.id} species={s} onClick={() => onPick(s.id)} />)}
      </div>
    </div>
  );
}

/* ============================================================
   PBs
   ============================================================ */
export function PBsScreen({ state, onAdd, onView }) {
  const recorded = Object.keys(state.pbs);
  return (
    <div style={{ padding: '16px 16px' }}>
      <div style={{ marginBottom: 14 }}>
        <H1 size={22}>Personal Bests</H1>
        <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 4 }}>Your records, by species.</div>
      </div>
      {recorded.length > 0 && (
        <>
          <SectionLabel style={{ marginBottom: 8 }}>Recorded</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
            {recorded.map(id => {
              const s = speciesById(id); const pb = state.pbs[id];
              if (!s) return null;
              return (
                <Card key={id} onClick={() => onView(id)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.parchmentDeep, borderColor: T.brass }}>
                  <Trophy size={20} color={T.brass} />
                  <FishMark species={s} size={44} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                    <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                      {pb.primaryMetric === 'weight' ? formatWeight(pb.weight, state.units) : formatSize(pb.length, state.units)} · {pb.date}
                    </div>
                  </div>
                  <ChevronRight size={16} color={T.brass} />
                </Card>
              );
            })}
          </div>
        </>
      )}
      <SectionLabel style={{ marginBottom: 8 }}>Add a PB</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {SPECIES.filter(s => !state.pbs[s.id]).map(s => (
          <Card key={s.id} onClick={() => onAdd(s.id)} style={{ textAlign: 'center', padding: '10px 6px' }}>
            <FishMark species={s} size={40} />
            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: T.ink, lineHeight: 1.2 }}>{s.commonName}</div>
            <div style={{ fontSize: 10, color: T.brass, marginTop: 2 }}><Plus size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> Add</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function PBDetailScreen({ speciesId, state, update, onEdit, onBack }) {
  const s = speciesById(speciesId); const pb = state.pbs[speciesId];
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
      {pb.photo && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
          <img src={pb.photo} alt={s.commonName} style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'cover' }} />
        </Card>
      )}
      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Details</SectionLabel>
        <DetailRow label="Date" value={pb.date} />
        {pb.jurisdiction && <DetailRow label="Waters" value={jurisdictionById(pb.jurisdiction)?.name || pb.jurisdiction} />}
        {pb.location && <DetailRow label="Location" value={pb.location} />}
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
        <PrimaryButton onClick={onEdit}><Pencil size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Update / replace</PrimaryButton>
        <GhostButton onClick={remove} style={{ color: T.closed, borderColor: T.closed, padding: '14px 14px' }}><Trash2 size={16} /></GhostButton>
      </div>
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
  const [photo, setPhoto] = useState(existing?.photo || null);
  const fileRef = React.useRef(null);
  if (!s) return <div style={{ padding: 20 }}>Species not found.</div>;

  const lenNum = parseFloat(length); const wtNum = parseFloat(weight);
  const beats = existing && ((primaryMetric === 'weight' && wtNum > (existing.weight || 0)) || (primaryMetric === 'length' && lenNum > (existing.length || 0)));
  const canSave = (lenNum > 0 || wtNum > 0);

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setPhoto(r.result);
    r.readAsDataURL(f);
  };

  const save = () => {
    const entry = {
      length: lenNum > 0 ? lenNum : null, weight: wtNum > 0 ? wtNum : null,
      primaryMetric, date, location: location.trim(), notes: notes.trim(),
      gearBait: gearBait.trim(), jurisdiction: jurId, photo,
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
        <FishMark species={s} size={50} />
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
        <Field label="Gear / bait (optional)" value={gearBait} onChange={setGearBait} placeholder="e.g. live cigar minnow, 80 ft" />
        <div style={{ marginTop: 10 }}>
          <SectionLabel style={{ marginBottom: 6 }}>Notes</SectionLabel>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional notes" />
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <SectionLabel style={{ marginBottom: 8 }}>Photo</SectionLabel>
        {photo ? (
          <>
            <img src={photo} alt="PB" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 4, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostButton onClick={() => fileRef.current?.click()} style={{ flex: 1, fontSize: 13, padding: '8px' }}>Replace</GhostButton>
              <GhostButton onClick={() => setPhoto(null)} style={{ flex: 1, fontSize: 13, padding: '8px', color: T.closed, borderColor: T.closed }}>Remove</GhostButton>
            </div>
          </>
        ) : (
          <GhostButton onClick={() => fileRef.current?.click()} style={{ width: '100%' }}>
            <Camera size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Take or upload photo
          </GhostButton>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
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
export function SettingsScreen({ state, jurisdiction, update, onChangeJurisdiction, onShowDisclaimer }) {
  const setUnits = (u) => update({ units: u });
  const clearAll = () => {
    if (window.confirm('Clear all PBs, notes, and settings? This cannot be undone.')) {
      saveState(defaultState);
      window.location.reload();
    }
  };
  return (
    <div style={{ padding: '16px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Settings</H1>
      <Card style={{ marginBottom: 10 }}>
        <SectionLabel style={{ marginBottom: 6 }}>Fishing waters</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 14, color: T.ink, fontWeight: 600 }}>{jurisdiction?.name || 'Not set'}</div>
          <GhostButton onClick={onChangeJurisdiction} style={{ padding: '6px 12px', fontSize: 12 }}>Change</GhostButton>
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
        <SectionLabel style={{ marginBottom: 8 }}>Report or contact</SectionLabel>
        <a href="mailto:corrections@knowyourcatch.example?subject=Regulation%20correction" style={{ color: T.brass, fontWeight: 600, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
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
