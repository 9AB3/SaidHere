import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const indexPath = path.join(publicRoot, 'index.html');
const fallbackPath = path.join(publicRoot, 'fallback.html');
const CANONICAL_HOST = 'saidhere.app';
const RENDER_HOST = 'saidhere-api-9ab3.onrender.com';

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  return res;
}

function sendIndex(_req, res) {
  noStore(res);
  return res.sendFile(indexPath);
}

function renderAppFallback(res, appHref) {
  const template = fs.readFileSync(fallbackPath, 'utf8');
  const html = template
    .replace('href="saidhere://"', `href="${appHref}"`)
    .replace(/\n\s*<script>[\s\S]*?<\/script>\s*/i, '\n');
  res.type('html');
  noStore(res);
  return res.send(html);
}

export function mountCanonicalWebRedirect(app) {
  app.use((req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    const pathName = req.path || '/';

    // Account, order and admin pages can contain customer details or a one-time
    // NFC URL. Never leave those responses in a browser/proxy cache.
    if (
      pathName === '/admin' || pathName.startsWith('/admin/') ||
      pathName === '/my-walls' || pathName.startsWith('/my-walls/') ||
      pathName === '/shop' || pathName.startsWith('/shop/') ||
      pathName === '/purchase' || pathName.startsWith('/purchase/')
    ) {
      noStore(res);
    }

    // During the custom-domain cutover the old static saidhere.app service still
    // forwards /admin to the Render service. Keep /admin and API traffic on the
    // Render hostname when explicitly addressed there so old builds remain valid.
    const keepLegacyHost =
      pathName === '/health' ||
      pathName === '/api' ||
      pathName.startsWith('/api/') ||
      pathName === '/admin' ||
      pathName.startsWith('/admin/');

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

  // Public HTML should always reflect the currently deployed build. These pages
  // change frequently during launch, so browsers and proxies must not retain an
  // older copy after a Render deploy.
  app.get('/', sendIndex);
  app.get(['/privacy', '/privacy/'], (_req, res) => {
    noStore(res);
    return res.sendFile(path.join(publicRoot, 'privacy', 'index.html'));
  });
  app.get(['/support', '/support/'], (_req, res) => {
    noStore(res);
    return res.sendFile(path.join(publicRoot, 'support', 'index.html'));
  });

  app.get('/t/:token', (req, res) => {
    const token = encodeURIComponent(req.params.token || '');
    return renderAppFallback(res, `saidhere://t/${token}`);
  });
  app.get('/w/:slug', (req, res) => {
    const slug = encodeURIComponent(req.params.slug || '');
    return renderAppFallback(res, `saidhere://w/${slug}`);
  });

  app.use(express.static(publicRoot, {
    dotfiles: 'ignore',
    fallthrough: true,
    index: false,
    maxAge: '1h',
  }));
}
