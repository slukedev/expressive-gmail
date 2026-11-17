import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import { defineConfig } from 'vite';

// Runs the app outside the extension, against the demo mailbox. Used for
// design work and the Playwright suite.
export default defineConfig({
  publicDir: 'public',
  server: { port: Number(process.env.PREVIEW_PORT) || 5199, strictPort: true, open: false },
  plugins: [
    react(),
    {
      name: 'preview-index',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Which checkout this is, so the e2e suite never tests another worktree's code (scripts/preview-checkout.mjs).
          if (req.url === '/__checkout') {
            res.setHeader('content-type', 'text/plain');
            res.end(fs.realpathSync(server.config.root));
            return;
          }
          if (req.url === '/' || req.url?.startsWith('/?')) req.url = `/preview/index.html${req.url.slice(1)}`;
          next();
        });
      },
    },
  ],
  optimizeDeps: { include: ['@material/material-color-utilities'] },
});
