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
export default defineConfig(({ mode }) => ({
  base: process.env.KYC_BASE || (mode === 'production' ? '/know-your-catch/' : '/'),
  define: {
    __KYC_ADMIN__: JSON.stringify(process.env.KYC_ADMIN !== 'false'),
    // KYC_WEB=true is set by npm run web:build (the reelintel.ai deploy).
    // Flips the router into path-based mode so `/` renders the marketing
    // landing page and `/admin` renders the admin console.
    __KYC_WEB__: JSON.stringify(process.env.KYC_WEB === 'true'),
  },
  plugins: [react()],
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
