/* The map under the map — ONE definition.
 *
 * CARTO started demanding an API key, and because the tile URL was written
 * out in three places the app's ocean maps, the admin heatmap and Trip
 * Planning all began rendering "API KEY REQUIRED" across the water at the
 * same moment. See [[duplicated-knowledge]].
 *
 * Esri's World Ocean Base needs no key and, unlike a dark street map,
 * actually shows bathymetry — depth shading and contours, which is the one
 * thing a fishing map wants underneath everything else. Labels are a
 * separate reference layer so they can sit above the data overlays.
 *
 * Note the {z}/{y}/{x} order: Esri's REST tiles are row-then-column, the
 * opposite of the usual {z}/{x}/{y}. Swapping them yields a map that looks
 * plausible and is in the wrong place.
 */
export const BASEMAP_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';

/* Boundaries and places, NOT the ocean reference layer.
 *
 * World_Ocean_Reference carries the basin names, and Esri's cartography
 * labels this one "Gulf of Mexico" — baked into the tile as pixels, with
 * no setting to override it. Swapping to the land reference keeps the
 * coastal towns and state lines and drops the basin label, leaving room
 * for addBasinLabel() to draw the name Robert's users actually use. */
export const BASEMAP_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const BASEMAP_ATTRIBUTION =
  'Esri, GEBCO, NOAA, National Geographic';

// Esri's ocean tiles stop here. Asking for 14 returns blank tiles, which
// reads as "no data" rather than "zoomed too far".
export const BASEMAP_MAX_ZOOM = 13;

/* The basin name, drawn by us.
 *
 * Zoomed in past the whole-Gulf view it is noise — nobody 20 miles off
 * Perdido Pass needs telling which ocean they are in — so it fades out,
 * the way a real basemap handles a label at the wrong scale.
 */
export const BASIN_LABEL = { text: 'Gulf of America', lat: 25.6, lon: -90.2, maxZoom: 7 };

export function addBasinLabel(L, map, { pane } = {}) {
  const marker = L.marker([BASIN_LABEL.lat, BASIN_LABEL.lon], {
    interactive: false,
    keyboard: false,
    pane: pane || 'shadowPane',
    icon: L.divIcon({
      className: '',
      iconSize: [220, 20],
      iconAnchor: [110, 10],
      html: '<div style="text-align:center;white-space:nowrap;'
        + 'font:600 13px/1 -apple-system,system-ui,sans-serif;letter-spacing:2.5px;'
        + 'text-transform:uppercase;color:rgba(255,255,255,0.72);'
        + 'text-shadow:0 1px 3px rgba(0,0,0,.65)">' + BASIN_LABEL.text + '</div>',
    }),
  });
  const sync = () => {
    const el = marker.getElement();
    if (el) el.style.display = map.getZoom() > BASIN_LABEL.maxZoom ? 'none' : '';
  };
  marker.addTo(map);
  sync();
  map.on('zoomend', sync);
  return marker;
}
