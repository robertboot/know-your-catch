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

export const BASEMAP_LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}';

export const BASEMAP_ATTRIBUTION =
  'Esri, GEBCO, NOAA, National Geographic';

// Esri's ocean tiles stop here. Asking for 14 returns blank tiles, which
// reads as "no data" rather than "zoomed too far".
export const BASEMAP_MAX_ZOOM = 13;
