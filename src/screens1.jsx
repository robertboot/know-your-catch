import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Fish, Search, ChevronRight, AlertTriangle, Plus, Pencil, BookOpen,
  Trophy, Camera, Trash2, Mail, Anchor, ListChecks, Wrench, Layers, X,
  RotateCcw, Image as ImageIcon, Sparkles, ArrowLeft,
  MapPin, Ruler, ClipboardList, CloudSun, Wind, Waves, Thermometer,
  CheckCircle2,
} from 'lucide-react';
import { T } from './theme.js';
import {
  JURISDICTIONS, CATEGORIES, SPECIES, REGULATIONS,
  DATA_VERSION, DATA_BUILD_DATE,
} from './data.js';
import { defaultState, saveState } from './storage.js';
import {
  speciesById, jurisdictionById, getComparison,
  formatSize, formatWeight, regStatus, differs, seasonState,
} from './helpers.js';
import {
  StatusPill, FishMark, Card, PrimaryButton, GhostButton, SectionLabel, H1,
  DetailRow, Field, PickButton, BigButton, SpeciesRow,
  inputStyle,
} from './components.jsx';
import { identifyPhoto, ANALYSIS_FEATURES } from './identifyPhoto.js';

/* ============================================================
   SPLASH
   ============================================================ */
export function SplashScreen({ onContinue }) {
  return (
    <div
      onClick={onContinue}
      style={{
        position: 'fixed', inset: 0, background: T.bgDeep,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, cursor: 'pointer', padding: 24,
      }}
    >
      <img
        src={`${import.meta.env.BASE_URL}brand/splash.png`}
        alt="Know Your Catch — Identify, Check Rules, Stay Legal. Built for the Gulf of America."
        style={{ maxWidth: 'min(86vw, 380px)', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
      />
      <div style={{ position: 'absolute', bottom: 30, color: T.inkMute, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
        Tap to continue
      </div>
    </div>
  );
}

/* ============================================================
   HOME
   ============================================================ */
const FEATURED_IDS = ['red_snapper', 'king_mackerel', 'gag_grouper', 'greater_amberjack', 'cobia', 'mahi', 'wahoo'];

function regForSpecies(id, jurId) {
  const byJur = REGULATIONS[id];
  if (!byJur) return null;
  return byJur[jurId] || byJur.fed_gulf || Object.values(byJur)[0] || null;
}

const STATUS_TEXT = {
  open:     { label: 'Season Open*',   color: T.open },
  closed:   { label: 'Season Closed*', color: T.closed },
  upcoming: { label: 'Opens Soon*',    color: T.warn },
  caution:  { label: 'Season Open*',   color: T.open },
  unknown:  { label: 'Check Source',   color: T.inkSoft },
};

function ActionTile({ icon, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: T.card, border: `1px solid ${T.cardEdge}`, borderRadius: 12,
      padding: '16px 14px', cursor: 'pointer', textAlign: 'left',
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: T.ink, lineHeight: 1.2, maxWidth: '70%' }}>{title}</span>
        <span style={{ color: T.brass, flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.4, flex: 1 }}>{subtitle}</div>
      <ChevronRight size={18} color={T.brass} />
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, color: T.inkMute, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 14, color: T.ink, fontWeight: 700, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function SectionHead({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 2px 10px' }}>
      <SectionLabel style={{ color: T.inkSoft }}>{children}</SectionLabel>
      {action && (
        <button onClick={onAction} style={{ background: 'transparent', border: 'none', color: T.brass, fontSize: 11, fontWeight: 800, letterSpacing: 1, cursor: 'pointer', padding: 0 }}>
          {action}
        </button>
      )}
    </div>
  );
}

function FeaturedCard({ species, status, bag, onClick }) {
  const st = STATUS_TEXT[status] || STATUS_TEXT.unknown;
  return (
    <button onClick={onClick} style={{
      flex: '0 0 152px', background: T.card, border: `1px solid ${T.cardEdge}`,
      borderRadius: 14, padding: 10, cursor: 'pointer', textAlign: 'left',
    }}>
      <div style={{
        position: 'relative', borderRadius: 10, height: 100, marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        background: 'linear-gradient(165deg, #16415c 0%, #0c2335 55%, #061320 100%)',
        boxShadow: `inset 0 0 0 1px ${T.cardEdge}`,
      }}>
        <FishMark species={species} size={130} />
        <span style={{
          position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'rgba(6,19,32,0.78)', padding: '3px 8px', borderRadius: 999,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.4, color: st.color,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.color }} />
          {st.label.toUpperCase()}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {species.commonName}
      </div>
      <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
        {species.scientific}
      </div>
      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6, fontWeight: 600 }}>
        Bag Limit: <span style={{ color: T.ink }}>{bag != null ? bag : '—'}</span>
      </div>
    </button>
  );
}

export function HomeScreen({
  state, jurisdiction, stale, onChangeJurisdiction,
  onIdentify, onRegulations, onMeasure, onReport, onSpecies, onSpeciesList,
}) {
  const jurId = jurisdiction?.id || 'fed_gulf';
  const featured = FEATURED_IDS
    .map(id => {
      const s = speciesById(id);
      if (!s) return null;
      const r = regForSpecies(id, jurId);
      return { s, status: r ? seasonState(r.open).status : 'unknown', bag: r?.bagLimit };
    })
    .filter(Boolean);
  const anyClosed = featured.some(f => f.status === 'closed');

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Location */}
      <Card style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12 }}>
        <div style={{ background: T.oceanDeep, color: T.brass, width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MapPin size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SectionLabel style={{ color: T.brass, fontSize: 10 }}>Current Location</SectionLabel>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {jurisdiction ? jurisdiction.name : 'Select fishing waters'}
          </div>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {jurisdiction ? jurisdiction.agency : 'Tap change to pick your waters'}
          </div>
        </div>
        <button onClick={onChangeJurisdiction} style={{
          background: 'transparent', color: T.brass, border: `1.5px solid ${T.brass}`,
          padding: '7px 12px', borderRadius: 8, fontSize: 11, fontWeight: 800,
          letterSpacing: 1, cursor: 'pointer', textTransform: 'uppercase', flexShrink: 0,
        }}>Change</button>
      </Card>

      {stale && (
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginTop: 12, display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 12 }}>
          <AlertTriangle size={20} color={T.warn} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: T.ink }}>
            <strong>Regulations data is more than 7 days old.</strong> Connect to internet when possible to refresh.
          </div>
        </Card>
      )}

      {/* Action grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <ActionTile icon={<Fish size={22} />} title="Identify Fish" subtitle="Browse species and ID guide" onClick={onIdentify} />
        <ActionTile icon={<ClipboardList size={22} />} title="Check Regulations" subtitle="View rules, limits and seasons" onClick={onRegulations} />
        <ActionTile icon={<Ruler size={22} />} title="Measure Fish" subtitle="Check size limits and possession" onClick={onMeasure} />
        <ActionTile icon={<Camera size={22} />} title="Report Catch" subtitle="Log your catch and keep records" onClick={onReport} />
      </div>

      {/* Today's conditions */}
      <SectionHead action="VIEW FORECAST" onAction={onRegulations}>Today's Conditions</SectionHead>
      <Card style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, borderRadius: 12 }}>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <CloudSun size={30} color={T.warn} />
          <div style={{ fontSize: 26, fontWeight: 800, color: T.ink, marginTop: 4, lineHeight: 1 }}>82°</div>
          <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>Partly Cloudy</div>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <Metric label="WIND" value="SE 14 mph" />
          <Metric label="WAVES" value="2.1 ft" />
          <Metric label="WATER" value="79°" />
        </div>
      </Card>

      {/* Regulation alerts */}
      <SectionHead action="VIEW ALL" onAction={onRegulations}>Regulation Alerts</SectionHead>
      <Card style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 12 }}>
        {anyClosed ? (
          <AlertTriangle size={26} color={T.warn} style={{ flexShrink: 0 }} />
        ) : (
          <CheckCircle2 size={26} color={T.open} style={{ flexShrink: 0 }} />
        )}
        <div>
          <div style={{ fontSize: 14, color: T.ink, fontWeight: 600, lineHeight: 1.4 }}>
            {anyClosed
              ? 'Some featured species have an active closure in these waters.'
              : 'No active closures or restrictions in your area.'}
          </div>
          <div style={{ fontSize: 12, color: T.inkMute, marginTop: 3 }}>Always check before you head out.</div>
        </div>
      </Card>

      {/* Featured species */}
      <SectionHead action="VIEW ALL" onAction={onSpeciesList}>Featured Species</SectionHead>
      <div className="kyc-hscroll" style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6, margin: '0 -16px', padding: '0 16px 6px' }}>
        {featured.map(f => (
          <FeaturedCard key={f.s.id} species={f.s} status={f.status} bag={f.bag} onClick={() => onSpecies(f.s.id)} />
        ))}
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: T.inkMute, lineHeight: 1.5 }}>
        * Based on seed data (v{DATA_VERSION}, {DATA_BUILD_DATE}) — not yet officially verified.
        Open a species to see the rule and a one-tap link to the official agency.
      </div>

      <div style={{ marginTop: 18, padding: '14px 12px', borderTop: `1px solid ${T.cardEdge}`, fontSize: 11, color: T.inkMute, textAlign: 'center' }}>
        Built for the Gulf of America · For anglers, by anglers · v{DATA_VERSION}
      </div>
    </div>
  );
}

/* ============================================================
   IDENTIFY — photo-first
   ============================================================ */
export function IdentifyScreen({ onPhoto, onBrowse, onSearch }) {
  const fileRef = useRef(null);

  // When user picks/captures a photo, read it as base64 and hand to onPhoto.
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onPhoto(reader.result); // data URL
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={24} style={{ marginBottom: 6 }}>Identify</H1>
      <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, marginTop: 0, marginBottom: 16 }}>
        Take or upload a photo to identify your catch.
      </p>

      {/* Primary photo capture card */}
      <button onClick={() => fileRef.current?.click()} style={{
        width: '100%', background: T.oceanDeep, color: T.parchment,
        border: `2px solid ${T.brass}`, borderRadius: 6, padding: '28px 18px',
        cursor: 'pointer', textAlign: 'center', marginBottom: 18,
        boxShadow: '0 2px 0 rgba(124, 86, 24, 0.15)',
      }}>
        <div style={{ background: T.brass, color: T.oceanDeep, width: 72, height: 72, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Camera size={36} />
        </div>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 600 }}>Photo identification</div>
        <div style={{ fontSize: 12, color: '#B8C5CD', marginTop: 4 }}>Take a photo or pick from your library</div>
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 14px', color: T.inkMute }}>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
        <SectionLabel style={{ fontSize: 11 }}>or identify manually</SectionLabel>
        <div style={{ flex: 1, height: 1, background: T.cardEdge }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <BigButton onClick={onBrowse} icon={<Layers size={24} />} title="Browse by category" subtitle="Snapper, grouper, mackerel, jacks…" />
        <BigButton onClick={onSearch} icon={<Search size={24} />} title="Search by name" subtitle="Common names, scientific, regional" />
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — analyzing
   ============================================================ */
export function PhotoAnalyzingScreen({ imageDataUrl, onResult }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let alive = true;
    const stepTimer = setInterval(() => {
      setStep(s => (s + 1) % ANALYSIS_FEATURES.length);
    }, 500);
    identifyPhoto(imageDataUrl).then(result => {
      if (!alive) return;
      clearInterval(stepTimer);
      onResult(result);
    });
    return () => { alive = false; clearInterval(stepTimer); };
  }, [imageDataUrl, onResult]);

  return (
    <div style={{ position: 'relative', minHeight: '70vh' }}>
      <div style={{ position: 'relative' }}>
        <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', display: 'block', maxHeight: '50vh', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(8,38,53,0.0) 40%, rgba(8,38,53,0.85) 100%)' }} />
      </div>
      <div style={{ padding: '20px 18px', background: T.oceanDeep, color: T.parchment }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Sparkles size={20} color={T.brass} />
          <H1 size={20} style={{ color: T.parchment }}>Analyzing photo…</H1>
        </div>
        <SectionLabel style={{ color: T.brass, marginBottom: 10 }}>Examining features</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {ANALYSIS_FEATURES.map((f, i) => (
            <div key={i} style={{
              fontSize: 13, color: i <= step ? T.parchment : '#7A8B96',
              transition: 'color 0.3s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: i <= step ? T.brass : '#3B4A57',
                display: 'inline-block', transition: 'background 0.3s',
              }} />
              {f}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18, fontSize: 11, color: '#7A8B96', fontStyle: 'italic', textAlign: 'center' }}>
          On-device analysis · no internet required
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PHOTO — result
   ============================================================ */
export function PhotoResultScreen({ result, imageDataUrl, onPickSpecies, onRetake, onManual }) {
  const { confidence, candidates } = result || {};

  if (!candidates || candidates.length === 0 || confidence === 'low') {
    return (
      <div style={{ padding: '18px 16px' }}>
        <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginBottom: 14, border: `2px solid ${T.cardEdge}` }} />
        <Card style={{ background: T.warnBg, borderColor: T.warn, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <AlertTriangle size={22} color={T.warn} />
            <div>
              <div style={{ fontWeight: 700, color: T.brassDeep, fontSize: 14 }}>Couldn't identify confidently</div>
              <div style={{ fontSize: 13, color: T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                The image was too uncertain to commit to a species. Try a clearer photo, or identify manually.
              </div>
            </div>
          </div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={onRetake}><RotateCcw size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</PrimaryButton>
          <GhostButton onClick={onManual} style={{ width: '100%' }}>Identify manually instead</GhostButton>
        </div>
      </div>
    );
  }

  // HIGH confidence — confirmed result for top candidate
  if (confidence === 'high') {
    const top = candidates[0];
    const s = speciesById(top.speciesId);
    return (
      <div style={{ padding: '14px 14px' }}>
        <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', marginBottom: 12, border: `2px solid ${T.brass}` }}>
          <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 14px 12px', background: 'linear-gradient(to top, rgba(8,38,53,0.92), transparent)', color: T.parchment }}>
            <SectionLabel style={{ color: T.brass }}>Confirmed</SectionLabel>
            <H1 size={22} style={{ color: T.parchment, marginTop: 2 }}>{s?.commonName || top.speciesId}</H1>
            <div style={{ fontStyle: 'italic', fontSize: 12, color: '#B8C5CD' }}>{s?.scientific}</div>
          </div>
        </div>

        <Card style={{ marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 8 }}>What we saw</SectionLabel>
          <ul style={{ margin: 0, paddingLeft: 18, color: T.inkSoft, fontSize: 14, lineHeight: 1.55 }}>
            {top.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Card>

        {s?.lookalikes?.length > 0 && (
          <Card style={{ marginBottom: 12, background: T.parchmentDeep, borderColor: T.brass }}>
            <SectionLabel style={{ marginBottom: 6 }}>Confirm with your eyes</SectionLabel>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10 }}>
              Even a confident match can be wrong on lookalikes. Glance at these — does one fit better?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.lookalikes.map(otherId => {
                const o = speciesById(otherId);
                if (!o) return null;
                return (
                  <button key={otherId} onClick={() => onPickSpecies(otherId)} style={{
                    background: T.parchmentDeep, border: `1px solid ${T.cardEdge}`, padding: '8px 10px',
                    borderRadius: 4, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}>
                    <FishMark species={o} size={32} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: T.ink }}>It's a {o.commonName}</div>
                      <div style={{ fontSize: 11, color: T.inkMute }}>Tap to switch</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PrimaryButton onClick={() => onPickSpecies(top.speciesId)}>See full details & regulations</PrimaryButton>
          <GhostButton onClick={onRetake} style={{ width: '100%' }}><RotateCcw size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</GhostButton>
        </div>
      </div>
    );
  }

  // MEDIUM confidence — narrowed-to-N disambiguation
  return (
    <div style={{ padding: '14px 14px' }}>
      <img src={imageDataUrl} alt="Your catch" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, marginBottom: 12, border: `2px solid ${T.cardEdge}` }} />
      <SectionLabel style={{ marginBottom: 4 }}>Not confident enough to confirm</SectionLabel>
      <H1 size={22} style={{ marginBottom: 4 }}>Narrowed to {candidates.length}</H1>
      <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5 }}>
        Pick the one that matches your fish. Tap a card to see full details and the discriminating features.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {candidates.map(c => {
          const s = speciesById(c.speciesId);
          if (!s) return null;
          return (
            <Card key={c.speciesId} onClick={() => onPickSpecies(c.speciesId)} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <FishMark species={s} size={50} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 600, color: T.ink }}>{s.commonName}</div>
                {c.evidence?.length > 0 && (
                  <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 4, lineHeight: 1.35 }}>{c.evidence.join(' · ')}</div>
                )}
              </div>
              <ChevronRight size={18} color={T.brass} />
            </Card>
          );
        })}
      </div>
      <GhostButton onClick={onRetake} style={{ width: '100%', marginBottom: 8 }}><RotateCcw size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Try another photo</GhostButton>
      <GhostButton onClick={onManual} style={{ width: '100%' }}>It's none of these — identify manually</GhostButton>
    </div>
  );
}

/* ============================================================
   CATEGORIES & CATEGORY
   ============================================================ */
export function CategoriesScreen({ onPick }) {
  const counts = useMemo(() => {
    const map = {};
    SPECIES.forEach(s => { map[s.category] = (map[s.category] || 0) + 1; });
    return map;
  }, []);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Browse by category</H1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {CATEGORIES.map(c => (
          <Card key={c.id} onClick={() => onPick(c.id)} style={{ textAlign: 'center', padding: '14px 8px' }}>
            <FishMark species={{ category: c.id }} size={48} />
            <div style={{ marginTop: 8, fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600, color: T.ink }}>{c.name}</div>
            <div style={{ fontSize: 11, color: T.inkMute, marginTop: 2 }}>{counts[c.id] || 0} species</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function CategoryScreen({ catId, onPick }) {
  const cat = CATEGORIES.find(c => c.id === catId);
  const list = SPECIES.filter(s => s.category === catId);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 4 }}>{cat?.name || 'Category'}</H1>
      <div style={{ fontSize: 12, color: T.inkMute, marginBottom: 14 }}>{list.length} species</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(s => <SpeciesRow key={s.id} species={s} onClick={() => onPick(s.id)} />)}
      </div>
    </div>
  );
}

/* ============================================================
   SEARCH
   ============================================================ */
export function SearchScreen({ onPick }) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase().trim();
    return SPECIES.map(s => {
      let score = 0; let matchedAlt = null;
      if (s.commonName.toLowerCase().includes(lower)) score += 10;
      if (s.scientific.toLowerCase().includes(lower)) score += 5;
      s.altNames.forEach(a => {
        if (a.toLowerCase().includes(lower)) { score += 8; matchedAlt = a; }
      });
      if (s.category.toLowerCase().includes(lower)) score += 2;
      return { s, score, matchedAlt };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  }, [q]);
  return (
    <div style={{ padding: '18px 16px' }}>
      <H1 size={22} style={{ marginBottom: 14 }}>Search</H1>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <Search size={18} color={T.inkMute} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Type a fish name…"
          style={{ ...inputStyle, paddingLeft: 38, fontSize: 15, background: T.card }}
        />
      </div>
      {!q && (
        <div style={{ fontSize: 13, color: T.inkMute, padding: '20px 12px', textAlign: 'center', background: T.parchmentDeep, borderRadius: 4 }}>
          Try "snapper," "mahi," "kingfish," "mangrove," or any Gulf species name.
        </div>
      )}
      {q && results.length === 0 && (
        <div style={{ fontSize: 13, color: T.inkMute, padding: 12 }}>No matches. Try a different spelling or category.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(r => (
          <Card key={r.s.id} onClick={() => onPick(r.s.id)} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <FishMark species={r.s} size={44} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, fontWeight: 600 }}>{r.s.commonName}</div>
              {r.matchedAlt && <div style={{ fontSize: 11, color: T.brassDeep }}>also: {r.matchedAlt}</div>}
              <div style={{ fontSize: 11, color: T.inkMute, fontStyle: 'italic' }}>{r.s.scientific}</div>
            </div>
            <ChevronRight size={18} color={T.brass} />
          </Card>
        ))}
      </div>
    </div>
  );
}
