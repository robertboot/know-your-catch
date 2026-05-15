import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base resolution:
//  - KYC_BASE env override (e.g. './' for a CDN/relative preview build)
//  - production build defaults to the GitHub Pages project sub-path
//  - local dev stays at root
export default defineConfig(({ command }) => ({
  base: process.env.KYC_BASE || (command === 'build' ? '/know-your-catch/' : '/'),
  plugins: [react()],
  server: { port: 5173, open: true },
}));
