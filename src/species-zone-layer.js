/* Species zones as soft rasters — the one copy, read by the admin Trip
 * Planning tab and the app's Ocean Maps.
 *
 * One raster per species rather than hundreds of circles: the cells are
 * painted into a tiny canvas at grid resolution and the browser stretches
 * it, so bilinear scaling melts the grid into the smooth organic areas a
 * species map should have. Circles overlapped into polka-dot soup the
 * moment two neighbours were both hot.
 *
 * The rows arrive PER REGION. Each species' rows have to be merged into
 * one canvas before painting, or the region boxes double-paint at every
 * seam and the Gulf gets drawn with visible stitching.
 *
 * Colours are here and nowhere else — see [[duplicated-knowledge]]. The
 * keys are the species ids from trip-modes.js, which are also what the
 * server writes as hotspot_zones.mode_key.
 */
export const SPECIES_ZONE_COLORS = {
  mahi:           '#2BE07F',
  yellowfin_tuna: '#ffd23d',
  blackfin_tuna:  '#c08cff',
  bigeye_tuna:    '#7c3aed',
  bluefin_tuna:   '#5ac8f5',
  wahoo:          '#ff5a3d',
  blue_marlin:    '#4f7bff',
  white_marlin:   '#0d9488',
  sailfish:       '#ff9a3d',
  swordfish:      '#ff7ab8',
};

const FALLBACK = '#c9a227';

/* `rows` are hotspot_zones rows: { mode_key, step_deg, cells }, where a
   cell is [lat, lon, score] sorted best-first by the server.
   `speciesOn` is a Set of mode_key. Returns a Leaflet LayerGroup, or null
   when there is nothing to draw. The caller owns adding and removing it. */
export function createSpeciesZoneLayer(L, rows, speciesOn, { pane } = {}) {
  const wanted = (rows || []).filter(z => speciesOn.has(z.mode_key) && z.cells?.length);
  if (!wanted.length) return null;

  const bySpecies = new Map();
  for (const z of wanted) {
    const m = bySpecies.get(z.mode_key)
      || { mode_key: z.mode_key, step_deg: z.step_deg, cells: [] };
    m.cells = m.cells.concat(z.cells);
    bySpecies.set(z.mode_key, m);
  }

  const group = L.layerGroup();
  let drew = 0;
  for (const z of bySpecies.values()) {
    z.cells.sort((a, b) => b[2] - a[2]);   // best-first across the whole Gulf
    const color = SPECIES_ZONE_COLORS[z.mode_key] || FALLBACK;
    const [cr, cg, cb] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const step = z.step_deg || 0.06;
    const lats = z.cells.map(c => c[0]), lons = z.cells.map(c => c[1]);
    const latMin = Math.min(...lats), latMax = Math.max(...lats);
    const lonMin = Math.min(...lons), lonMax = Math.max(...lons);
    const W = Math.round((lonMax - lonMin) / step) + 1;
    const H = Math.round((latMax - latMin) / step) + 1;
    if (W < 1 || H < 1 || W * H > 400000) continue;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const n = z.cells.length;
    z.cells.forEach(([lat, lon], idx) => {
      const x = Math.round((lon - lonMin) / step);
      const y = Math.round((latMax - lat) / step);   // canvas y grows downward
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      // Strongest fifth solid, next quarter softer, the rest a wash.
      const a = idx < n * 0.15 ? 150 : idx < n * 0.40 ? 105 : 60;
      const p = (y * W + x) * 4;
      img.data[p] = cr; img.data[p + 1] = cg; img.data[p + 2] = cb;
      img.data[p + 3] = Math.max(img.data[p + 3], a);
    });
    ctx.putImageData(img, 0, 0);
    L.imageOverlay(canvas.toDataURL(), [
      [latMin - step / 2, lonMin - step / 2],
      [latMax + step / 2, lonMax + step / 2],
    ], { pane, opacity: 1, interactive: false }).addTo(group);
    drew++;
  }
  return drew ? group : null;
}
