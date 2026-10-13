/* Plan Your Trip — where to go, and when.
 *
 * Home answers one question: should I go today. This answers the other
 * one, and it is deliberately a separate screen rather than more cards on
 * Home — a trip is planned sitting down, days ahead, not glanced at over
 * coffee.
 *
 * Everything here reads cached rows. The page is opened on the way out of
 * the pass as often as at the kitchen table, so nothing on it may depend
 * on a signal. Where a reading is old, it says so: a break is an
 * OBSERVATION of one satellite pass, and by Thursday a Sunday pass has
 * drifted miles.
 */
import { useEffect, useMemo, useState } from 'react';
import { T } from './theme.js';
import { H1, Card, SectionLabel } from './components.jsx';
import { client } from './supabase-client.js';
import { OceanMapsScreen, SPOT_COLORS, SPOT_LABELS } from './screens_ocean.jsx';
import { readMarineCache, writeMarineCache, describeAge } from './marine-cache.js';
import { DAYS_CACHE, homeWater, reachableSpots, compassPoint, MAX_RUN_NM,
         groupByBreak, spotStanding, spotAgeNote, breakKey,
         plainWhy, spotStats, spotRankColor } from './home-water.js';
import { fishabilityHour, fishabilityGrade, fishabilityColor } from './forecast-extras.js';

export function PlanTripScreen({ state, tier = 'phone' }) {
  const [spots, setSpots] = useState(null);
  const [spotsAge, setSpotsAge] = useState(null);
  const [outlook, setOutlook] = useState(null);
  const [dayPick, setDayPick] = useState(0);
  const [focus, setFocus] = useState(null);   // which break the map should show

  const home = useMemo(() => homeWater(state), [state]);
  const sz = (p, t, d) => (tier === 'desktop' ? d : tier === 'tablet' ? t : p);

  // The ten-day outlook Home caches. Read-only — this screen never fetches
  // weather itself, so it cannot disagree with the Home card about the week.
  useEffect(() => {
    const hit = readMarineCache(DAYS_CACHE, home.lat, home.lon);
    if (hit?.data?.length) setOutlook(hit.data);
  }, [home.lat, home.lon]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = readMarineCache('hotspots', 0, 0);
      if (cached && alive) {
        setSpots(groupByBreak(reachableSpots(cached.data, home)));
        setSpotsAge(cached.ageMs);
      }
      const c = client();
      if (!c) return;
      const since = new Date(Date.now() - 72 * 3600000).toISOString();
      const { data, error } = await c.from('hotspots')
        .select('id,region_id,score,why,kind,lat,lon,sst_f,depth_ft,current_kt,length_nm,bearing_deg,cells,observed_at')
        .gte('observed_at', since)
        .order('score', { ascending: false })
        .limit(60);
      if (!alive || error || !data) return;
      setSpots(groupByBreak(reachableSpots(data, home)));
      setSpotsAge(null);
      writeMarineCache('hotspots', 0, 0, data);
    })();
    return () => { alive = false; };
  }, [home.lat, home.lon]);

  /* How old these will be on the day picked. Null when there is nothing
     to say — same day, or nothing to say it about. */
  const ageNote = useMemo(() => {
    if (!spots?.length || !outlook?.length) return null;
    const observed = spots.reduce((a, s) => (a && a > s.observed_at ? a : s.observed_at), null);
    const day = outlook[Math.min(dayPick, outlook.length - 1)]?.date;
    return spotAgeNote(observed, day, dayPick === 0);
  }, [spots, outlook, dayPick]);

  /* One list, numbered once. The map is given the same numbers and the
     same colours, so "2" on the card and "2" on the water are the same
     break rather than two things that look similar. */
  const shown = useMemo(() => (spots || []).slice(0, 6), [spots]);
  const numbers = useMemo(() => {
    const out = {};
    shown.forEach((s, i) => { out[breakKey(s)] = { n: i + 1, color: spotRankColor(i) }; });
    return out;
  }, [shown]);

  const gradeOf = (d) => fishabilityHour({
    wind: d.windMax, gust: d.windMax != null ? d.windMax * 1.3 : null,
    waveFt: d.waveFtMax, periodS: d.periodMaxS, code: d.code,
  });

  return (
    <div style={{ padding: sz('16px 16px 8px', '20px 20px 10px', '24px 24px 12px') }}>
      <H1 size={sz(22, 26, 30)} style={{ marginBottom: 4 }}>Plan your trip</H1>
      <div style={{ fontSize: sz(12.5, 14, 15.5), color: T.inkMute, marginBottom: 14, lineHeight: 1.5 }}>
        The best water within {MAX_RUN_NM} nm of {home.label}, and the days worth running it.
      </div>

      {/* WHEN. Graded by the same model as the Home card and the forecast,
          so three screens cannot disagree about one week. */}
      {outlook?.length > 1 && (
        <>
          <SectionLabel>When to go</SectionLabel>
          <div style={{ display: 'flex', gap: 7, margin: '8px 0 16px', overflowX: 'auto', paddingBottom: 4 }}>
            {outlook.slice(0, 7).map((d, i) => {
              const score = gradeOf(d);
              const on = i === dayPick;
              const dt = new Date(d.date + 'T12:00:00');
              return (
                <button key={d.date} type="button" onClick={() => setDayPick(i)} style={{
                  flex: '0 0 auto', width: 58, textAlign: 'center', padding: '7px 0 8px',
                  borderRadius: 11, cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? T.parchmentDeep : 'transparent',
                  border: `1.5px solid ${on ? T.brass : T.cardEdge}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: T.ink }}>
                    {i === 0 ? 'Today' : dt.toLocaleDateString(undefined, { weekday: 'short' })}
                  </div>
                  <div style={{ fontSize: 10, color: T.inkMute, marginTop: 1 }}>
                    {dt.getMonth() + 1}/{dt.getDate()}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 900, marginTop: 4,
                                color: score == null ? T.inkMute : fishabilityColor(score) }}>
                    {score == null ? '—' : fishabilityGrade(score)}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      <SectionLabel>Where to go</SectionLabel>

      {spots == null && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ padding: 16, textAlign: 'center', color: T.inkMute, fontSize: 14 }}>Loading…</div>
        </Card>
      )}

      {/* Nothing within reach is a real answer, and a better one than the
          nearest thing hundreds of miles away. */}
      {spots?.length === 0 && (
        <Card style={{ marginTop: 8 }}>
          <div style={{ padding: 16, color: T.inkSoft, fontSize: 14, lineHeight: 1.55 }}>
            No breaks within {MAX_RUN_NM} nm of {home.label} in the last satellite pass. The water
            is even out there — worth watching the day strip above and coming back.
          </div>
        </Card>
      )}

      {ageNote && spots?.length > 0 && (
        <div style={{ fontSize: 12.5, color: T.warn, fontWeight: 700, margin: '8px 0 4px', lineHeight: 1.5 }}>
          {ageNote}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {shown.map((s, i) => {
          const key = breakKey(s);
          const colour = spotRankColor(i);
          const on = focus === key;
          const stats = spotStats(s);
          const st = spotStanding(s.score);
          const tone = st.tone === 'good' ? T.open : st.tone === 'fair' ? T.brass : T.inkMute;
          return (
          /* Numbered, and the number is on the map too. Tapping still
             zooms to one, but the map already shows every area on this
             list — the tap is for a closer look, not the only way to see
             where a card is pointing. */
          <Card key={s.id || i} onClick={() => setFocus(on ? null : key)}
                style={{
                  padding: sz(13, 16, 18), borderRadius: 16, cursor: 'pointer',
                  borderLeft: `5px solid ${colour}`,
                  outline: on ? `2px solid ${colour}` : 'none',
                }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{
                flex: '0 0 auto', width: 26, height: 26, borderRadius: '50%',
                background: colour, color: '#0b1220', fontWeight: 900, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: sz(17, 19, 21), fontWeight: 800, color: T.ink, lineHeight: 1.2 }}>
                  {Math.round(s._run.dist)} nm {compassPoint(s._run.brg)}
                </div>
                <div style={{ fontSize: 12.5, color: T.inkMute, marginTop: 2 }}>
                  <span style={{ color: SPOT_COLORS[s.kind] || T.brass, fontWeight: 800 }}>
                    {SPOT_LABELS[s.kind] || s.kind}
                  </span>
                  {' · '}of {home.label}
                  {spotsAge != null ? ` · saved ${describeAge(spotsAge)}` : ''}
                </div>
              </div>
              {/* What the score MEANS, not a letter borrowed from the
                  safety scale. A 20 here is a faint fishing sign; an F on
                  the day strip is a sea you should not be out in. */}
              <span style={{
                flex: '0 0 auto', fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
                color: tone, border: `1px solid ${tone}55`, borderRadius: 999,
                padding: '4px 9px', whiteSpace: 'nowrap', textTransform: 'uppercase',
              }}>{st.label}</span>
            </div>

            {/* A sentence, not the instrument read-out. The server's `why`
                is a comma-run of six measurements ending in the run from
                that REGION's port — a second, different distance to one
                spot, which is the bug the Home card had. */}
            <div style={{ fontSize: sz(13.5, 15, 16), color: T.inkSoft, lineHeight: 1.5, marginTop: 9 }}>
              {plainWhy(s)}
            </div>

            {/* The numbers in a row, so two breaks can be read across
                rather than parsed out of two paragraphs. */}
            {stats.length > 0 && (
              <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <div style={{ fontSize: 10, letterSpacing: 0.5, color: T.inkMute,
                                  textTransform: 'uppercase', fontWeight: 800 }}>{x.label}</div>
                    <div style={{ fontSize: sz(15, 16.5, 18), fontWeight: 800, color: T.ink,
                                  marginTop: 2 }}>{x.value}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          );
        })}
      </div>

      {/* The map, open. It is the answer on this page, not a destination
          off it — a button that only reveals something already loaded is a
          tap that does nothing. Embedded drops the map screen's own title
          and padding so it reads as part of this page. */}
      <div style={{ marginTop: 18 }}>
        <SectionLabel>On the map</SectionLabel>
        {/* Why the shapes look the way they do, said once. The areas are
            drawn from the break's own length and heading, so they read
            with every satellite layer switched off — the imagery is a
            separate switch, not what makes the spots visible. */}
        <div style={{ fontSize: 12, color: T.inkMute, lineHeight: 1.5, marginTop: 4 }}>
          All {shown.length} areas are shown together, numbered to match the list.
          Sea temp and chlorophyll are separate switches on the map.
        </div>
        <div style={{ marginTop: 8 }}>
          <OceanMapsScreen isTablet={tier !== 'phone'} initialLayer={null} state={state}
                           embedded focusBreak={focus} spotNumbers={numbers} />
        </div>
      </div>
    </div>
  );
}
