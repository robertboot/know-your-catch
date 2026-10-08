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
import ModelsPanel from '../../src/admin/ModelsPanel.jsx';

const PANELS = { TripPlanningPanel, HomeDashboard, ModelsPanel };

/* The models DETAIL view is the widest page in the admin — a per-species
   table and a 135x135 confusion matrix — and it only renders once a model
   is loaded. The harness aliases src/model-store.js to a stub holding a
   realistic 135-class row so the page under test is the one people read,
   not its empty state. */
window.__mountModelDetail = async () => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  createRoot(host).render(React.createElement(ModelsPanel, { onOpenTestTool: () => {} }));
  // Let the list paint, then open the first row's detail.
  await new Promise(r => setTimeout(r, 400));
  // The list row is a clickable Card (a div with onClick), not a button.
  // Click the element holding the version name; it bubbles to the card.
  const open = [...document.querySelectorAll('div')]
    .filter(d => (d.textContent || '').trim() === '12.4')
    .pop();
  if (open) open.click();
  await new Promise(r => setTimeout(r, 600));
  return !!open;
};

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

/* Does anything run off the side of the screen?
 *
 * The admin is read on a laptop, and a panel wider than the window pushes
 * its own controls out of reach — a section you cannot scroll to is a
 * section that does not exist. It has happened twice: the app page at a
 * fixed width, and the models detail view.
 *
 * Reports every element wider than the viewport, innermost first, so the
 * answer is the actual offender rather than its parents. */
window.__overflow = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width <= vw + 1 && r.right <= vw + 1) continue;
    // An element that scrolls or clips its own content is doing its job —
    // and so is anything INSIDE such an element. Map tiles are drawn far
    // past the edge of the map and clipped by it; they are not a layout
    // fault. Only report what actually escapes to the page.
    let clipped = false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const ov = getComputedStyle(n).overflowX;
      if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') { clipped = true; break; }
    }
    if (clipped) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      width: Math.round(r.width), right: Math.round(r.right),
      scrollWidth: el.scrollWidth,
      text: (el.textContent || '').trim().slice(0, 50),
      depth: (() => { let d = 0, n = el; while ((n = n.parentElement)) d++; return d; })(),
    });
  }
  const sorted = out.sort((a, b) => b.depth - a.depth);
  // The innermost offender is rarely the cause — walk up and report the
  // OUTERMOST ancestor that is also too wide. That is the element whose
  // width everything below is merely inheriting.
  let chain = [];
  if (sorted.length) {
    const first = [...document.querySelectorAll('*')].find((el) => {
      const r = el.getBoundingClientRect();
      return Math.round(r.width) === sorted[0].width && (el.textContent || '').trim() === sorted[0].text;
    });
    for (let n = first; n && n !== document.body; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      chain.push({
        tag: n.tagName.toLowerCase(),
        width: Math.round(r.width), right: Math.round(r.right),
        scrollWidth: n.scrollWidth, display: cs.display,
        minWidth: cs.minWidth, flex: cs.flex, gridCols: cs.gridTemplateColumns.slice(0, 40),
        tooWide: r.right > vw + 1,
        text: (n.textContent || '').trim().slice(0, 40),
      });
    }
  }
  return { viewport: vw, docScrollWidth: document.documentElement.scrollWidth,
           offenders: sorted.slice(0, 4), chain };
};
