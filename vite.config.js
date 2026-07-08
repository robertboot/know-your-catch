import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
}));
