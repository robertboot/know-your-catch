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
export default defineConfig(({ mode }) => ({
  base: process.env.KYC_BASE || (mode === 'production' ? '/know-your-catch/' : '/'),
  plugins: [react()],
  server: { port: 5173, open: true },
}));
