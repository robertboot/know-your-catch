/* Animated surface currents — a Leaflet layer that shows water MOVING.
 *
 * Arrows on a chart are read one at a time; a flow field is read at a
 * glance. What a captain wants to see is where the Loop Current edge runs
 * and which way an eddy turns, and that is a shape, not a list of vectors.
 *
 * The field is sparse (0.25°, roughly 15 nm) and the particles are dense,
 * so the illusion of smooth flow comes from interpolating BETWEEN grid
 * points rather than from more data. Bilinear, because nearest-neighbour
 * makes particles jump at cell boundaries and the eye reads the jumps as
 * turbulence that is not there.
 *
 * Draws into its own canvas in the overlay pane, so it costs nothing when
 * the opacity is zero: the animation loop stops rather than running
 * invisibly.
 */
import L from 'leaflet';

const KT_TO_DEG_LAT_PER_SEC = 1 / 60 / 3600;   // 1 kt = 1 nm/h = 1/60° lat per hour
const toRad = (d) => (d * Math.PI) / 180;

/* Particles move at a multiple of real speed — at true scale a 1 kt
   current crawls about a pixel a minute and reads as a still image. */
const TIME_SCALE = 2600;
const PARTICLE_COUNT = 1100;
const MAX_AGE_FRAMES = 110;
const TRAIL_FADE = 0.945;  // higher = longer tails, so the shape of the flow holds

/* Speed bands. Drawn as three paths rather than one, so fast water is
   visibly fast — a single colour makes a 2 kt eddy edge look exactly like
   half a knot of drift, which is the one distinction the layer exists to
   make. Three stroke calls a frame; the cost is in the particle loop, not
   here. */
const SPEED_BANDS = [
  // Dark-blue lines: the pale blues disappeared against the pale GEBCO
  // basemap everywhere the water was slow.
  { max: 0.5, color: 'rgba(23, 74, 125, 0.60)', width: 1.2 },
  { max: 1.2, color: 'rgba(16, 90, 166, 0.85)', width: 1.7 },
  { max: Infinity, color: 'rgba(10, 56, 110, 1)', width: 2.4 },
];
// 30fps, not 60. Flow reads identically at half the frame rate and costs
// half as much — and this runs beside a Leaflet map with image overlays
// and several hundred markers, which is where the budget actually goes.
const FRAME_MS = 1000 / 30;

export function createCurrentFlowLayer(vectors, { step = 0.25 } = {}) {
  // vectors: [lat, lon, kt, dirDegToward]
  const byKey = new Map();
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon, kt, dir] of vectors || []) {
    // Direction is the compass bearing the water flows TOWARD, which is how
    // a captain says it. Back to components for the maths.
    const u = Math.sin(toRad(dir)) * kt;   // east
    const v = Math.cos(toRad(dir)) * kt;   // north
    byKey.set(`${Math.round(lat / step)},${Math.round(lon / step)}`, [u, v]);
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
  }
  const at = (gi, gj) => byKey.get(`${gi},${gj}`) || null;

  /* Bilinear sample. Returns null where the field has no data on any
     corner — over land, or outside the region — so a particle there dies
     instead of drifting on a guess. */
  function sample(lat, lon) {
    const fi = lat / step, fj = lon / step;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const ti = fi - i0, tj = fj - j0;
    const c00 = at(i0, j0), c10 = at(i0 + 1, j0), c01 = at(i0, j0 + 1), c11 = at(i0 + 1, j0 + 1);
    // ALL four corners or nothing. Renormalising over partial corners let a
    // particle coast up to a full cell (~15 nm) past the field's edge —
    // painting confident flow across the beach and over bare shelf.
    if (!c00 || !c10 || !c01 || !c11) return null;
    const u = c00[0] * (1 - ti) * (1 - tj) + c10[0] * ti * (1 - tj)
            + c01[0] * (1 - ti) * tj + c11[0] * ti * tj;
    const v = c00[1] * (1 - ti) * (1 - tj) + c10[1] * ti * (1 - tj)
            + c01[1] * (1 - ti) * tj + c11[1] * ti * tj;
    return [u, v];
  }

  const Flow = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      const pane = map.getPane('overlayPane');
      this._canvas = L.DomUtil.create('canvas', 'kyc-current-flow');
      this._canvas.style.position = 'absolute';
      this._canvas.style.pointerEvents = 'none';
      pane.appendChild(this._canvas);
      this._particles = [];
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
      return this;
    },

    onRemove(map) {
      this._stop();
      map.off('moveend zoomend resize', this._reset, this);
      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._canvas = null;
      return this;
    },

    setOpacity(o) {
      this._opacity = o;
      if (this._canvas) this._canvas.style.opacity = String(o);
      // Zero opacity stops the loop outright. An invisible animation is
      // still a frame of work sixty times a second on someone's phone.
      if (o <= 0) this._stop(); else this._start();
      return this;
    },

    _reset() {
      const map = this._map;
      if (!map || !this._canvas) return;
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this._canvas.width = size.x * dpr;
      this._canvas.height = size.y * dpr;
      this._canvas.style.width = `${size.x}px`;
      this._canvas.style.height = `${size.y}px`;
      // The canvas lives in the overlay pane, which Leaflet translates as
      // the map moves; pin it back to the top-left of the current view.
      L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));
      const ctx = this._canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);

      /* Precomputed lat/lon → pixel mapping for THIS view.
         The first cut called map.latLngToContainerPoint twice per particle
         per frame: 2,800 projections a frame, each allocating a Point, and
         the whole tab lagged. Over one region view the mapping is close
         enough to linear that two multiplies replace it. Rebuilt on every
         move and zoom, which is exactly when it stops being valid. */
      const c = map.getCenter();
      const o = map.latLngToContainerPoint([c.lat, c.lng]);
      const dx = map.latLngToContainerPoint([c.lat, c.lng + 0.1]);
      const dy = map.latLngToContainerPoint([c.lat + 0.1, c.lng]);
      this._proj = {
        lat0: c.lat, lon0: c.lng, x0: o.x, y0: o.y,
        pxPerLon: (dx.x - o.x) / 0.1,
        pxPerLat: (dy.y - o.y) / 0.1,     // negative: north is up
      };
      this._seed();
      if ((this._opacity ?? 1) > 0) this._start();
    },

    _seed() {
      // Clear first: a view with no overlap must not leave last view's
      // bounds behind for the respawn to aim at.
      this._bounds = null;
      const b = this._map.getBounds();
      const s = Math.max(b.getSouth(), minLat), n = Math.min(b.getNorth(), maxLat);
      const w = Math.max(b.getWest(), minLon), e = Math.min(b.getEast(), maxLon);
      this._particles = [];
      if (!(n > s && e > w)) return;   // no overlap with the data: nothing to draw
      for (let k = 0; k < PARTICLE_COUNT; k++) {
        this._particles.push({
          lat: s + Math.random() * (n - s),
          lon: w + Math.random() * (e - w),
          age: Math.floor(Math.random() * MAX_AGE_FRAMES),
        });
      }
      this._bounds = { s, n, w, e };
    },

    _start() {
      if (this._raf || !this._canvas) return;
      let last = 0;
      const tick = (t) => {
        this._raf = requestAnimationFrame(tick);
        if (t - last < FRAME_MS) return;
        last = t;
        this._frame();
      };
      this._raf = requestAnimationFrame(tick);
    },

    _stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    },

    _frame() {
      const map = this._map, cv = this._canvas;
      // No overlap with the data: stop outright rather than spinning on a
      // frame that draws nothing, which is how an invisible layer still
      // costs a phone its battery.
      if (!map || !cv || !this._bounds || !this._particles.length) { this._stop(); return; }
      const ctx = cv.getContext('2d');
      const size = map.getSize();

      // Fade rather than clear: the tail IS the direction cue.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - TRAIL_FADE})`;
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';

      const { s, n, w, e } = this._bounds;
      const pr = this._proj;
      if (!pr) return;
      const paths = SPEED_BANDS.map(() => new Path2D());
      for (const p of this._particles) {
        const f = sample(p.lat, p.lon);
        if (!f || p.age++ > MAX_AGE_FRAMES) {
          p.lat = s + Math.random() * (n - s);
          p.lon = w + Math.random() * (e - w);
          p.age = 0;
          continue;
        }
        let [u, v] = f;
        /* Compress the SPEED range, not the speed itself.
           The Loop Current core runs 3.4 kt against a Gulf averaging 0.74,
           so at true scale those particles cross thirty pixels a frame and
           draw long straight scratches that read as painted on rather than
           flowing. Stepping by the square root keeps fast water visibly
           fast — 3.4 kt still moves twice as far as 0.9 — without the
           streaks outrunning their own tails. Colour and width stay keyed
           to the TRUE speed below, so the picture still tells you how fast
           the water actually is. */
        const trueKt = Math.hypot(u, v);
        if (trueKt > 0) {
          const eased = Math.sqrt(trueKt) / trueKt;
          u *= eased; v *= eased;
        }
        const dLat = v * KT_TO_DEG_LAT_PER_SEC * TIME_SCALE;
        // A degree of longitude is shorter than a degree of latitude away
        // from the equator; without this, everything drifts east.
        const dLon = (u * KT_TO_DEG_LAT_PER_SEC * TIME_SCALE) / Math.cos(toRad(p.lat));
        const ax = pr.x0 + (p.lon - pr.lon0) * pr.pxPerLon;
        const ay = pr.y0 + (p.lat - pr.lat0) * pr.pxPerLat;
        p.lat += dLat; p.lon += dLon;
        const bx = pr.x0 + (p.lon - pr.lon0) * pr.pxPerLon;
        const by = pr.y0 + (p.lat - pr.lat0) * pr.pxPerLat;
        const kt = trueKt;
        let band = 0;
        while (band < SPEED_BANDS.length - 1 && kt > SPEED_BANDS[band].max) band++;
        paths[band].moveTo(ax, ay);
        paths[band].lineTo(bx, by);
      }
      ctx.lineCap = 'round';
      for (let b = 0; b < SPEED_BANDS.length; b++) {
        ctx.strokeStyle = SPEED_BANDS[b].color;
        ctx.lineWidth = SPEED_BANDS[b].width;
        ctx.stroke(paths[b]);
      }
    },
  });

  return new Flow();
}
