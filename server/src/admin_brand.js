import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plaquePath = path.resolve(here, '../../lib/267ABF9F-A613-4DD2-B026-87B6C2B6AEBD.png');
const wallBackgroundPath = path.resolve(here, '../../lib/12CA723C-705E-4593-834A-72D72424FC4F.png');
const adminUiPath = path.resolve(here, 'admin_ui.js');
const ordersNativeWriterPath = path.resolve(here, 'admin_orders_native_writer.js');

// The legacy admin pages still provide the forms/routes. The replacement UI runs
// before the page is revealed so users never see the legacy layout flash first.
const preloadCss = String.raw`<style id="saidhere-admin-preload">
html.admin-preload body{opacity:0!important;pointer-events:none!important}
html.admin-preload body{animation:saidhereAdminFailsafe .01s 2s forwards}
@keyframes saidhereAdminFailsafe{to{opacity:1;pointer-events:auto}}
</style>`;

function addPreloadClass(html) {
  return html.replace(/<html([^>]*)>/i, (match, attrs) => {
    if (/\bclass\s*=\s*["']/i.test(attrs)) {
      return match.replace(/\bclass\s*=\s*(["'])(.*?)\1/i, (_m, quote, classes) => `class=${quote}${classes} admin-preload${quote}`);
    }
    return `<html${attrs} class="admin-preload">`;
  });
}

function injectBrand(html) {
  if (typeof html !== 'string' || !html.includes('</head>')) return html;
  let output = html.replaceAll(
    '<div class="mark">TW</div>',
    '<img class="plaque-logo" src="/admin/plaque.png" alt="SaidHere plaque">',
  );
  output = addPreloadClass(output);
  output = output.replace(
    '</head>',
    `${preloadCss}<script src="/admin/ui.js" defer></script><script src="/admin/orders-native-writer.js" defer></script></head>`,
  );
  return output;
}

export function mountAdminBrand(app) {
  app.get('/admin/plaque.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(plaquePath);
  });

  app.get('/admin/wall-background.png', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(wallBackgroundPath);
  });

  app.get('/admin/ui.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(adminUiPath);
  });

  app.get('/admin/orders-native-writer.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(ordersNativeWriterPath);
  });

  app.use('/admin', (_req, res, next) => {
    const originalSend = res.send.bind(res);
    res.send = (body) => originalSend(injectBrand(body));
    return next();
  });
}
