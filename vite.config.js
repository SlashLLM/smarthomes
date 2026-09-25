import { defineConfig } from 'vite';
import devApiPlugin from './vite-plugin-dev-api.js';

export default defineConfig({
  publicDir: 'public',
  // Serves api/ during `npm run dev`; Vercel handles it in production.
  plugins: [
    devApiPlugin(),
    // Vite only serves admin/index.html at /admin/; bare /admin would fall
    // through to the homepage. Vercel (cleanUrls) already serves /admin.
    {
      name: 'admin-trailing-slash',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const [path, qs] = req.url.split('?');
          if (path !== '/admin') return next();
          res.statusCode = 302;
          res.setHeader('Location', '/admin/' + (qs ? '?' + qs : ''));
          res.end();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.split('?')[0] !== '/admin') return next();
          res.statusCode = 302;
          res.setHeader('Location', '/admin/');
          res.end();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      // intro-lab is an internal preview page (noindex) for choosing the intro.
      input: { main: 'index.html', introLab: 'intro-lab.html', admin: 'admin/index.html' },
    },
  },
  server: {
    port: 3000,
    open: true,
    allowedHosts: true
  }
});
