import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const indexPath = path.join(publicRoot, 'index.html');
const CANONICAL_HOST = 'saidhere.app';
const RENDER_HOST = 'saidhere-api-9ab3.onrender.com';

function sendIndex(_req, res) {
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(indexPath);
}

function renderAppFallback(res, appHref) {
  const template = fs.readFileSync(indexPath, 'utf8');
  const html = template
    .replace('href="saidhere://"', `href="${appHref}"`)
    .replace(/\n\s*<script>[\s\S]*?<\/script>\s*/i, '\n');
  res.type('html');
  res.set('Cache-Control', 'no-cache');
  return res.send(html);
}

export function mountCanonicalWebRedirect(app) {
  app.use((req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    const pathName = req.path || '/';
    const keepLegacyHost = pathName === '/health' || pathName === '/api' || pathName.startsWith('/api/');
    if (host === RENDER_HOST && !keepLegacyHost) {
      return res.redirect(308, `https://${CANONICAL_HOST}${req.originalUrl}`);
    }
    return next();
  });
}

export function mountPublicSite(app) {
  // Apple must be able to fetch this file directly over HTTPS with no redirect.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(path.join(publicRoot, '.well-known', 'apple-app-site-association'));
  });

  // Also support Apple's legacy root lookup location.
  app.get('/apple-app-site-association', (_req, res) => {
    res.type('application/json');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(path.join(publicRoot, '.well-known', 'apple-app-site-association'));
  });

  // Public informational pages now live on the same host as the API/admin portal.
  app.get('/', sendIndex);
  app.get(['/privacy', '/privacy/'], (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(publicRoot, 'privacy', 'index.html'));
  });
  app.get(['/support', '/support/'], (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    return res.sendFile(path.join(publicRoot, 'support', 'index.html'));
  });

  // HTTPS plaque URLs are the iOS/Android app links. If the OS does not hand the
  // request to the app, the browser fallback still gets an exact custom-scheme
  // button without relying on inline JavaScript that security headers could block.
  app.get('/t/:token', (req, res) => {
    const token = encodeURIComponent(req.params.token || '');
    return renderAppFallback(res, `saidhere://t/${token}`);
  });
  app.get('/w/:slug', (req, res) => {
    const slug = encodeURIComponent(req.params.slug || '');
    return renderAppFallback(res, `saidhere://w/${slug}`);
  });

  // Images and any other public static assets used by the pages above.
  app.use(express.static(publicRoot, {
    dotfiles: 'ignore',
    fallthrough: true,
    index: false,
    maxAge: '1h',
  }));
}
