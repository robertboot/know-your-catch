import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Production builds are served from the GitHub Pages project sub-path;
// local dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/know-your-catch/' : '/',
  plugins: [react()],
  server: { port: 5173, open: true },
}));
