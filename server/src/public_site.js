import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const indexPath = path.join(publicRoot, 'index.html');

function sendIndex(_req, res) {
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(indexPath);
}

export function mountPublicSite(app) {
  // Apple must be able to fetch this file directly over HTTPS with no redirect.
  app.get('/.well-known/apple-app-site-association', (_req, res) => {
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

  // NFC and Wall universal-link fallbacks. If iOS/Android opens the app these
  // routes are not rendered; if a browser receives the URL, show the web fallback.
  app.get('/t/:token', sendIndex);
  app.get('/w/:slug', sendIndex);

  // Images and any other public static assets used by the pages above.
  app.use(express.static(publicRoot, {
    dotfiles: 'ignore',
    fallthrough: true,
    index: false,
    maxAge: '1h',
  }));
}
