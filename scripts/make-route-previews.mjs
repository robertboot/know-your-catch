/* Per-route link previews for a single-page app.
 *
 * Facebook, iMessage and Slack read Open Graph tags out of the served
 * HTML and never run the app, so every route of a SPA shares whatever
 * index.html says — /testers previewed as the homepage.
 *
 * Rather than hand-maintain a second HTML file (whose script tags would
 * drift the moment Vite re-hashes a bundle), this copies the freshly
 * built index.html and swaps only the preview tags. The copy is made
 * from the real build output, so the asset hashes are always right.
 *
 * vercel.json rewrites /testers to the file this produces.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'dist-web';
const SITE = 'https://www.reelintel.ai';

const ROUTES = [
  {
    file: 'testers.html',
    title: 'Be a ReelIntel tester — and keep the shirt',
    description:
      'Fish the Gulf? Try ReelIntel before everyone else, tell us what breaks, and we will send you a shirt for it.',
    url: `${SITE}/testers`,
    image: `${SITE}/og-testers.jpg`,
    alt: 'ReelIntel tester programme',
  },
];

const src = path.join(OUT, 'index.html');
if (!existsSync(src)) {
  console.error(`[route-previews] ${src} not found — run the build first.`);
  process.exit(1);
}
const base = readFileSync(src, 'utf8');

// Only these keys are replaced; everything else in the head is shared
// with the homepage on purpose, so a change there reaches every route.
const swap = (html, attr, key, value) => {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
  return re.test(html) ? html.replace(re, `$1${value}$2`) : html;
};

for (const r of ROUTES) {
  let html = base;
  html = swap(html, 'property', 'og:title', r.title);
  html = swap(html, 'property', 'og:description', r.description);
  html = swap(html, 'property', 'og:url', r.url);
  html = swap(html, 'property', 'og:image', r.image);
  html = swap(html, 'property', 'og:image:alt', r.alt);
  html = swap(html, 'name', 'twitter:title', r.title);
  html = swap(html, 'name', 'twitter:description', r.description);
  html = swap(html, 'name', 'twitter:image', r.image);
  html = swap(html, 'name', 'description', r.description);
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${r.title}</title>`);
  writeFileSync(path.join(OUT, r.file), html);
  console.log(`[route-previews] wrote ${OUT}/${r.file}`);
}
