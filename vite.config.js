import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Base resolution:
//  - KYC_BASE env override (e.g. './' for a CDN/relative preview build)
//  - production build defaults to the GitHub Pages project sub-path
//  - local dev stays at root
// `command` is 'serve' for BOTH dev and preview, so key the base off
// `mode` instead: production (build + preview) uses the Pages sub-path;
// the dev server stays at root. KYC_BASE overrides (e.g. './' for a
// relative CDN build).
//
// KYC_ADMIN gates the admin console. Default true on web (dev + prod
// bundle at know-your-catch.web); ios:build sets it to false so the
// admin module and its lazy chunk are dead-code eliminated from the
// TestFlight bundle. Reviewers and regular testers never see /admin
// in the iOS app.
/* Meta Pixel — WEB BUILD ONLY, and structurally so.
 *
 * The same index.html builds the iOS bundle. A tracker inside the app
 * would change what the App Store privacy declaration has to say and pull
 * the app into App Tracking Transparency — a consent prompt, for a
 * marketing tag the app has no use for. So this is injected at build time
 * behind the KYC_WEB flag rather than written into the HTML, which means
 * it CANNOT reach the app however the app is built.
 *
 * Not on privacy.html either: that page is linked from the App Store
 * listing, and tracking visitors on the page that explains how you handle
 * their data is a bad look and an easy thing to be asked about.
 */
const META_PIXEL_ID = '1122198573489431';

function metaPixel() {
  return {
    name: 'kyc-meta-pixel',
    transformIndexHtml(html, ctx) {
      if (process.env.KYC_WEB !== 'true') return html;
      if (!ctx.filename.endsWith('index.html')) return html;
      const tag = `<!-- Meta Pixel Code -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}'); fbq('track', 'PageView');</script>
<noscript><img height="1" width="1" style="display:none" alt=""
  src="https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->`;
      return html.replace('</head>', `${tag}\n</head>`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: process.env.KYC_BASE || (mode === 'production' ? '/know-your-catch/' : '/'),
  define: {
    __KYC_ADMIN__: JSON.stringify(process.env.KYC_ADMIN !== 'false'),
    // KYC_WEB=true is set by npm run web:build (the reelintel.ai deploy).
    // Flips the router into path-based mode so `/` renders the marketing
    // landing page and `/admin` renders the admin console.
    __KYC_WEB__: JSON.stringify(process.env.KYC_WEB === 'true'),
  },
  plugins: [react(), metaPixel()],
  server: { port: 5173, open: true },
  build: {
    rollupOptions: {
      input: {
        // Main SPA entry.
        main:    resolve(__dirname, 'index.html'),
        // Static privacy page. Registered as an input so Vite runs
        // %VITE_SUPABASE_URL% / %VITE_SUPABASE_ANON_KEY% substitution
        // in its <script> block — that script fetches the latest
        // legal_docs row on load so admin edits appear without a
        // redeploy. Falls back to the HTML shipped in the file if
        // Supabase isn't reachable.
        privacy: resolve(__dirname, 'privacy.html'),
      },
    },
  },
}));
