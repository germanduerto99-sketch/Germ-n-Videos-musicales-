import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiMiddleware } from './src/server/apiPlugin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const distDir = path.join(__dirname, 'dist');
  const publicDir = path.join(__dirname, 'public');

  // Healthcheck for independent Cloud Run / container deployment
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Mount full-stack media/sync/FFmpeg API routes
  app.use(createApiMiddleware());

  // Serve built static assets in production
  if (fs.existsSync(distDir)) {
    app.use(
      express.static(distDir, {
        maxAge: '1h',
        setHeaders(res, filePath) {
          if (filePath.endsWith('manifest.webmanifest')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
          } else if (filePath.endsWith('sw.js') || path.basename(filePath).startsWith('workbox-')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
  }

  // Fallback for public assets if needed
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  // SPA fallback
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api/')) {
      return next();
    }
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    } else {
      res.status(404).send('Build not found. Run npm run build first.');
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`Germán Videos Musicales server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
