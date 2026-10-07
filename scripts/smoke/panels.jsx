/* Smoke-render harness — mount admin panels in a real browser and fail on
 * the first runtime error.
 *
 * esbuild checks syntax, not whether an identifier resolves. A panel that
 * references a variable nobody declared builds perfectly and throws
 * "Can't find variable" the moment it renders — which has now happened
 * more than once, each time reaching the live console before anyone saw
 * it. Mounting the component is the cheapest thing that would have caught
 * it.
 *
 * Panels are mounted WITHOUT a Supabase session on purpose: every one of
 * them has to survive a signed-out, no-network first paint anyway, and
 * that is the state a reviewer or a cold load hits.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import TripPlanningPanel from '../../src/admin/TripPlanningPanel.jsx';
import HomeDashboard from '../../src/admin/HomeDashboard.jsx';

const PANELS = { TripPlanningPanel, HomeDashboard };

window.__mount = (name) => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const Comp = PANELS[name];
  if (!Comp) throw new Error(`unknown panel ${name}`);
  // onGoTab is the only prop any panel requires; a no-op is enough to
  // prove the thing renders, which is all this harness claims.
  createRoot(host).render(React.createElement(Comp, { onGoTab: () => {} }));
};
window.__panels = Object.keys(PANELS);
