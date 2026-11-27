/* Public regulation pages - one per species per waters - built from
 * regulations/public/snapshot.json into <out>/regulations/…
 *
 * Why these exist: the question an angler types into a search box is
 * "is red snapper open in Alabama", and the app that answers it was
 * invisible to that search. The site is a single-page app; every address
 * on it serves the same HTML, so a search engine saw one page. These are
 * plain HTML - no app bundle, no script needed to read them - so each
 * answer has its own address, title and text.
 *
 * What they may say is exactly what the app says and no more. The
 * open/closed answer comes from the snapshot, which worked it out with
 * the app's own season logic (see scripts/reg-snapshot.mjs), and the
 * snapshot is refreshed daily, so a page is at most a day behind. Every
 * page names the agency, links its rules, and says this is not the
 * regulator.
 *
 *   node scripts/make-reg-pages.mjs dist-web
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadAppLogic, ROOT } from './lib/app-logic.mjs';

const OUT = path.resolve(process.argv[2] || 'dist-web');
const SITE = 'https://www.reelintel.ai';
const SNAP = path.join(ROOT, 'regulations/public/snapshot.json');
if (!fs.existsSync(SNAP)) { console.log('[reg-pages] no snapshot - skipped'); process.exit(0); }
if (!fs.existsSync(OUT)) { console.error(`[reg-pages] ${OUT} not found - run the build first`); process.exit(1); }

const { SPECIES, JURISDICTIONS, cleanSeason } = await loadAppLogic();
const { rows } = JSON.parse(fs.readFileSync(SNAP, 'utf8'));

// Address words. Changing one of these moves every page under it, so
// they are spelled out rather than derived.
const WATERS = {
  al_state:      { slug: 'alabama',                 place: 'Alabama state waters',           short: 'Alabama' },
  ms_state:      { slug: 'mississippi',             place: 'Mississippi state waters',       short: 'Mississippi' },
  la_state:      { slug: 'louisiana',               place: 'Louisiana state waters',         short: 'Louisiana' },
  tx_state:      { slug: 'texas',                   place: 'Texas state waters',             short: 'Texas' },
  fl_state:      { slug: 'florida-gulf',            place: 'Florida Gulf state waters',      short: 'Florida (Gulf)' },
  fl_atlantic:   { slug: 'florida-atlantic',        place: 'Florida Atlantic state waters',  short: 'Florida (Atlantic)' },
  fed_gulf:      { slug: 'federal-gulf',            place: 'federal Gulf waters',            short: 'Federal Gulf' },
  fed_satlantic: { slug: 'federal-south-atlantic',  place: 'federal South Atlantic waters',  short: 'Federal South Atlantic' },
};
const ORDER = ['al_state', 'fl_state', 'ms_state', 'la_state', 'tx_state', 'fed_gulf', 'fl_atlantic', 'fed_satlantic'];
const SECTOR = { private: 'Private anglers', state_charter: 'State-licensed charters', for_hire_federal: 'Federally permitted for-hire boats' };

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const speciesById = new Map(SPECIES.map((s) => [s.id, s]));
const jurById = new Map(JURISDICTIONS.map((j) => [j.id, j]));
const sslug = (id) => id.replace(/_/g, '-');
const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const inches = (n) => (n == null ? null : `${Number(n)} in`);

function statusOf(r) {
  if (r.status === 'open') return { cls: 'open', label: 'Open now', say: 'is open' };
  if (r.status === 'closed') return { cls: 'closed', label: 'Closed now', say: 'is closed' };
  if (r.status === 'upcoming') return { cls: 'closed', label: r.opens ? `Closed · opens ${longDate(r.opens)}` : 'Closed · opens soon',
                                        say: r.opens ? `is closed and opens ${longDate(r.opens)}` : 'is closed and opens soon' };
  return { cls: 'unknown', label: 'Check the season', say: null };
}

const CSS = `
:root{--bg:#031B33;--card:#0A2743;--edge:#1B4566;--ink:#fff;--soft:#B8C8D8;--mute:#8AA3B8;--cyan:#18C5DF;--open:#54C96B;--closed:#E0685B;--gold:#FFC343}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--cyan)}.wrap{max-width:760px;margin:0 auto;padding:0 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-bottom:1px solid var(--edge);margin-bottom:22px}
header img{height:38px;width:auto;display:block}.cta{display:inline-block;background:var(--cyan);color:#06212f;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:10px}
.crumb{font-size:13px;color:var(--mute);margin-bottom:10px}.crumb a{color:var(--mute)}
h1{font-size:30px;line-height:1.2;margin:0 0 6px}h2{font-size:19px;margin:30px 0 10px}
.lede{color:var(--soft);margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:18px;margin-bottom:14px}
.badge{display:inline-block;font-weight:800;font-size:14px;letter-spacing:.3px;padding:6px 12px;border-radius:999px;margin-bottom:12px}
.badge.open{background:rgba(84,201,107,.16);color:var(--open);border:1px solid rgba(84,201,107,.5)}
.badge.closed{background:rgba(224,104,91,.16);color:var(--closed);border:1px solid rgba(224,104,91,.5)}
.badge.unknown{background:rgba(255,195,67,.14);color:var(--gold);border:1px solid rgba(255,195,67,.45)}
.who{font-size:12px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:var(--gold);margin-bottom:8px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:0}dt{color:var(--mute)}dd{margin:0;font-weight:600}
.note{color:var(--soft);font-size:14.5px;margin:12px 0 0}.small{font-size:13px;color:var(--mute)}
ul.list{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
ul.list a{display:flex;justify-content:space-between;gap:10px;background:var(--card);border:1px solid var(--edge);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink)}
ul.list span.s{font-size:12px;font-weight:800}ul.list .open{color:var(--open)}ul.list .closed{color:var(--closed)}ul.list .unknown{color:var(--gold)}
.promo{background:linear-gradient(155deg,#0E3558,#07223b);border:1px solid var(--edge);border-radius:16px;padding:20px;margin-top:26px}
.promo h2{margin-top:0}footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--edge)}
@media (max-width:520px){h1{font-size:25px}header img{height:32px}.cta{padding:10px 14px;font-size:14px}}
`;

function shell({ title, description, url, body, jsonld }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#031B33">
<link rel="icon" type="image/png" href="/brand/reelintel-icon.png">
<meta property="og:type" content="article"><meta property="og:site_name" content="ReelIntel">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${SITE}/og-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<style>${CSS}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head><body><div class="wrap">
<header><a href="/"><img src="/brand/icon-horz.png" alt="ReelIntel" onerror="this.replaceWith(document.createTextNode('ReelIntel'))"></a>
<a class="cta" href="/app?signup&amp;ref=seo">Get the app free</a></header>
${body}
<div class="promo"><h2>These rules on your phone, offshore, with no signal</h2>
<p class="lede" style="margin-bottom:14px">ReelIntel identifies your catch from a photo and shows the season, size and bag limit for the waters you are in. It works offline, and it is free.</p>
<a class="cta" href="/app?signup&amp;ref=seo">Use it in your browser</a>
&nbsp; <a href="https://apps.apple.com/app/reelintel/id6785558103">Get it on the App Store</a></div>
<footer class="small">ReelIntel is not a regulator and this page is not legal advice. Rules change, sometimes mid-season, and in-season closures can come without notice. Confirm with the agency before you keep a fish. &copy; ReelIntel, LLC &middot; <a href="/">reelintel.ai</a> &middot; <a href="/privacy">Privacy</a></footer>
</div></body></html>`;
}

function limits(r) {
  const rowsHtml = [];
  rowsHtml.push(`<dt>Season</dt><dd>${esc(cleanSeason(r.season) || r.season)}</dd>`);
  if (r.min != null && r.max != null) rowsHtml.push(`<dt>Slot limit</dt><dd>${inches(r.min)} to ${inches(r.max)}</dd>`);
  else if (r.min != null) rowsHtml.push(`<dt>Minimum size</dt><dd>${inches(r.min)}</dd>`);
  else if (r.max != null) rowsHtml.push(`<dt>Maximum size</dt><dd>${inches(r.max)}</dd>`);
  if (r.bag != null) rowsHtml.push(`<dt>Bag limit</dt><dd>${r.bag === 0 ? 'None may be kept' : `${r.bag} per person per day`}</dd>`);
  if (r.boat != null) rowsHtml.push(`<dt>Vessel limit</dt><dd>${r.boat} per boat</dd>`);
  return `<dl>${rowsHtml.join('')}</dl>`;
}

const groups = new Map();   // jur -> species -> [rows]
for (const r of rows) {
  if (!WATERS[r.j] || !speciesById.has(r.s)) continue;
  if (!groups.has(r.j)) groups.set(r.j, new Map());
  const g = groups.get(r.j);
  if (!g.has(r.s)) g.set(r.s, []);
  g.get(r.s).push(r);
}

const urls = [];
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
// The answer shown in lists: the general rule, or the first sector.
const lead = (list) => list.find((r) => r.sector === 'all') || list[0];

let pages = 0;
for (const jid of ORDER) {
  const g = groups.get(jid); if (!g) continue;
  const W = WATERS[jid], J = jurById.get(jid);
  const names = [...g.keys()].map((id) => speciesById.get(id)).sort((a, b) => a.commonName.localeCompare(b.commonName));

  for (const sp of names) {
    const list = g.get(sp.id);
    const main = lead(list), st = statusOf(main);
    const url = `${SITE}/regulations/${W.slug}/${sslug(sp.id)}/`;
    const title = `Is ${sp.commonName.toLowerCase()} open in ${W.short}? Season, size and bag limits | ReelIntel`;
    const answer = st.say ? `${sp.commonName} ${st.say} in ${W.place}.` : `Check the current ${sp.commonName.toLowerCase()} season in ${W.place}.`;
    const description = `${answer} Season: ${cleanSeason(main.season) || main.season}`.slice(0, 158);
    const cards = list.map((r) => {
      const s = statusOf(r);
      const note = r.notes && r.notes.length <= 240 ? `<p class="note">${esc(r.notes)}</p>` : '';
      return `<div class="card">${r.sector !== 'all' ? `<div class="who">${esc(SECTOR[r.sector] || r.sector)}</div>` : ''}
<span class="badge ${s.cls}">${esc(s.label)}</span>${limits(r)}${note}
<p class="small" style="margin:12px 0 0">${r.verified ? `Rule last checked against the agency on ${longDate(r.verified)}. ` : ''}${r.source ? `<a href="${esc(r.source)}" rel="nofollow noopener">Source</a>` : ''}</p></div>`;
    }).join('\n');
    const elsewhere = ORDER.filter((o) => o !== jid && groups.get(o)?.has(sp.id)).map((o) => {
      const s = statusOf(lead(groups.get(o).get(sp.id)));
      return `<li><a href="/regulations/${WATERS[o].slug}/${sslug(sp.id)}/"><span>${esc(WATERS[o].short)}</span><span class="s ${s.cls}">${s.cls === 'open' ? 'Open' : s.cls === 'closed' ? 'Closed' : 'Check'}</span></a></li>`;
    }).join('');
    const body = `<div class="crumb"><a href="/regulations/">Fishing regulations</a> &rsaquo; <a href="/regulations/${W.slug}/">${esc(W.short)}</a></div>
<h1>${esc(sp.commonName)} in ${esc(W.place)}</h1>
<p class="lede">${esc(answer)}${sp.scientific ? ` <span class="small"><em>${esc(sp.scientific)}</em></span>` : ''}</p>
${cards}
<p class="small">Open or closed is worked out daily from the season dates above. The official rules are set by ${esc(J?.agency || 'the agency')}: <a href="${esc(J?.regsUrl || '#')}" rel="noopener">${esc(J?.agency || 'agency')} regulations</a>.</p>
${elsewhere ? `<h2>${esc(sp.commonName)} in other waters</h2><ul class="list">${elsewhere}</ul>` : ''}`;
    const jsonld = st.say ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [{ '@type': 'Question',
      name: `Is ${sp.commonName.toLowerCase()} season open in ${W.place}?`,
      acceptedAnswer: { '@type': 'Answer', text: `${answer} Season: ${cleanSeason(main.season) || main.season}` } }] } : null;
    write(`regulations/${W.slug}/${sslug(sp.id)}/index.html`, shell({ title, description, url, body, jsonld }));
    urls.push(url); pages++;
  }

  const items = names.map((sp) => { const s = statusOf(lead(g.get(sp.id)));
    return `<li><a href="/regulations/${W.slug}/${sslug(sp.id)}/"><span>${esc(sp.commonName)}</span><span class="s ${s.cls}">${s.cls === 'open' ? 'Open' : s.cls === 'closed' ? 'Closed' : 'Check'}</span></a></li>`; }).join('');
  const url = `${SITE}/regulations/${W.slug}/`;
  write(`regulations/${W.slug}/index.html`, shell({
    title: `${W.short} saltwater fishing regulations: what is open now | ReelIntel`,
    description: `Seasons, size limits and bag limits for ${names.length} saltwater species in ${W.place}, with what is open and closed today.`,
    url,
    body: `<div class="crumb"><a href="/regulations/">Fishing regulations</a></div>
<h1>${esc(W.short)} saltwater fishing regulations</h1>
<p class="lede">What is open and closed today in ${esc(W.place)}, for ${names.length} species. Tap one for its season, size and bag limit.</p>
<ul class="list">${items}</ul>`,
  }));
  urls.push(url); pages++;
}

const waterItems = ORDER.filter((o) => groups.has(o)).map((o) => `<li><a href="/regulations/${WATERS[o].slug}/"><span>${esc(WATERS[o].short)}</span><span class="s" style="color:var(--mute)">${groups.get(o).size} species</span></a></li>`).join('');
write('regulations/index.html', shell({
  title: 'Gulf and Florida saltwater fishing regulations: what is open now | ReelIntel',
  description: 'Seasons, size limits and bag limits for saltwater fish in Alabama, Florida, Mississippi, Louisiana, Texas and federal waters, with what is open today.',
  url: `${SITE}/regulations/`,
  body: `<h1>Saltwater fishing regulations</h1>
<p class="lede">Seasons, size limits and bag limits for the Gulf and Florida, checked against each agency, with what is open and closed today. Choose your waters.</p>
<ul class="list">${waterItems}</ul>`,
}));
urls.unshift(`${SITE}/regulations/`); pages++;

// One sitemap for the whole site, written over the hand-kept one.
const today = new Date().toISOString().slice(0, 10);
const sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  `  <url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  ...urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`), '</urlset>', ''].join('\n');
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sm);
console.log(`[reg-pages] wrote ${pages} pages and sitemap.xml (${urls.length + 1} addresses)`);
