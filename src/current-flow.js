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
const PARTICLE_COUNT = 1400;
const MAX_AGE_FRAMES = 90;
const TRAIL_FADE = 0.90;   // lower = shorter tails

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
    if (!c00 && !c10 && !c01 && !c11) return null;
    let u = 0, v = 0, w = 0;
    const add = (c, weight) => { if (c) { u += c[0] * weight; v += c[1] * weight; w += weight; } };
    add(c00, (1 - ti) * (1 - tj));
    add(c10, ti * (1 - tj));
    add(c01, (1 - ti) * tj);
    add(c11, ti * tj);
    if (w <= 0) return null;
    return [u / w, v / w];
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
      const tick = () => { this._frame(); this._raf = requestAnimationFrame(tick); };
      this._raf = requestAnimationFrame(tick);
    },

    _stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    },

    _frame() {
      const map = this._map, cv = this._canvas;
      if (!map || !cv || !this._bounds) return;
      const ctx = cv.getContext('2d');
      const size = map.getSize();

      // Fade rather than clear: the tail IS the direction cue.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - TRAIL_FADE})`;
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';

      ctx.lineWidth = 1.1;
      ctx.beginPath();
      const { s, n, w, e } = this._bounds;
      for (const p of this._particles) {
        const f = sample(p.lat, p.lon);
        if (!f || p.age++ > MAX_AGE_FRAMES) {
          p.lat = s + Math.random() * (n - s);
          p.lon = w + Math.random() * (e - w);
          p.age = 0;
          continue;
        }
        const [u, v] = f;
        const dLat = v * KT_TO_DEG_LAT_PER_SEC * TIME_SCALE;
        // A degree of longitude is shorter than a degree of latitude away
        // from the equator; without this, everything drifts east.
        const dLon = (u * KT_TO_DEG_LAT_PER_SEC * TIME_SCALE) / Math.cos(toRad(p.lat));
        const a = map.latLngToContainerPoint([p.lat, p.lon]);
        p.lat += dLat; p.lon += dLon;
        const b2 = map.latLngToContainerPoint([p.lat, p.lon]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
      }
      ctx.strokeStyle = 'rgba(190, 240, 255, 0.85)';
      ctx.stroke();
    },
  });

  return new Flow();
}
