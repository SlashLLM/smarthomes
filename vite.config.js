import { defineConfig } from 'vite';
import devApiPlugin from './vite-plugin-dev-api.js';

export default defineConfig({
  publicDir: 'public',
  // Serves api/ during `npm run dev`; Vercel handles it in production.
  plugins: [devApiPlugin()],
  server: {
    port: 3000,
    open: true,
    allowedHosts: true
  }
});
