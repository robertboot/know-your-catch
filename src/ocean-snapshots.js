/* The pre-rendered ocean snapshots, and the box they cover — ONE copy.
 *
 * refresh-ocean-maps writes sst-latest.png and chl-latest.png every six
 * hours over a fixed Gulf box. An image overlay is only in the right place
 * if the bounds it is drawn with are exactly the bounds it was rendered
 * over, so those numbers must never be written out twice — the failure is
 * a map that looks perfectly reasonable and is a hundred miles wrong.
 *
 * The edge function has its own copy by necessity (it cannot import from
 * src/), and says so in a comment next to it. Everything on this side
 * reads these.
 */
import { SUPABASE_URL } from './supabase-client.js';

// [SW, NE] as [lat, lon] — Leaflet's order, matching REGION in
// supabase/functions/refresh-ocean-maps/index.ts.
export const SNAPSHOT_BOUNDS = [[22.0, -98.5], [31.5, -77.5]];

export const snapshotUrl = (layerKey) =>
  SUPABASE_URL
    ? `${SUPABASE_URL}/storage/v1/object/public/ocean-maps/${layerKey}-latest.png`
    : null;
