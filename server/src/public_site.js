import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { installCommerceEmailPolish, mountCommercePolish } from './commerce_polish.js';
import { installOrderReferenceEmailPatch } from './email_order_ref_patch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(here, '..', 'public');
const indexPath = path.join(publicRoot, 'index.html');
const fallbackPath = path.join(publicRoot, 'fallback.html');
const CANONICAL_HOST = 'saidhere.app';
const RENDER_HOST = 'saidhere-api-9ab3.onrender.com';
const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appID: '7MB2M6PX4Y.com.9ab3.saidhere',
        paths: ['/t/*', '/w/*'],
      },
    ],
  },
};

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

function sendAppleAssociation(res) {
  res.set('Cache-Control', 'public, max-age=300');
  return res.status(200).type('application/json').send(JSON.stringify(APPLE_APP_SITE_ASSOCIATION));
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
  installCommerceEmailPolish();
  installOrderReferenceEmailPatch();

  app.use((req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    const pathName = req.path || '/';

    if (
      pathName === '/admin' || pathName.startsWith('/admin/') ||
      pathName === '/my-walls' || pathName.startsWith('/my-walls/') ||
      pathName === '/shop' || pathName.startsWith('/shop/') ||
      pathName === '/purchase' || pathName.startsWith('/purchase/')
    ) {
      noStore(res);
    }

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

  // These routes are deliberately registered before the legacy commerce and
  // purchase-success mounts in index.js, so they become the customer-facing flow
  // while the existing Stripe webhook remains the payment source of truth.
  mountCommercePolish(app);
}

export function mountPublicSite(app) {
  app.get('/.well-known/apple-app-site-association', (_req, res) => sendAppleAssociation(res));
  app.get('/apple-app-site-association', (_req, res) => sendAppleAssociation(res));

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
