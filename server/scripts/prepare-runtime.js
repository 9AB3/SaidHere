import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');
const commerceSourcePath = path.join(serverRoot, 'src', 'commerce.js');
const commerceRuntimePath = path.join(serverRoot, 'src', 'commerce.runtime.js');
const customerSourcePath = path.join(serverRoot, 'src', 'customer_portal.js');
const customerRuntimePath = path.join(serverRoot, 'src', 'customer_portal.runtime.js');

function replaceFunction(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not find ${label} runtime markers.`);
  return `${source.slice(0, start)}${replacement}\n\n${source.slice(end)}`;
}

// Keep payment reconciliation and SMTP2GO email handling in commerce_support.js.
// The support module contains the final Nodemailer/SMTP implementation, so the
// runtime imports it directly rather than transforming an older email provider.
let commerceSource = fs.readFileSync(commerceSourcePath, 'utf8');
const commerceDbImport = "import { pool } from './db.js';";
const commerceSupportImport = "import { reconcilePaidCheckout, ensureOrderCustomerLink, manualClaimLinkForOrder } from './commerce_support.js';";
if (!commerceSource.includes(commerceSupportImport)) {
  if (!commerceSource.includes(commerceDbImport)) throw new Error('Could not find the commerce database import marker.');
  commerceSource = commerceSource.replace(commerceDbImport, `${commerceDbImport}\n${commerceSupportImport}`);
}

commerceSource = replaceFunction(
  commerceSource,
  'async function markCheckoutPaid(session) {',
  'async function markCheckoutExpired(session) {',
  "async function markCheckoutPaid(session) {\n  return reconcilePaidCheckout(session);\n}",
  'paid checkout',
);

// Use ordinary Stripe Checkout for the physical plaque. Do not inject preview
// or account-specific payment-mode flags into generated production code.

const missingCustomerMarker = "    if (!order.customer_id) throw new Error('This paid order has no customer account attached.');";
if (!commerceSource.includes(missingCustomerMarker)) throw new Error('Could not find the fulfilment customer marker.');
commerceSource = commerceSource.replace(
  missingCustomerMarker,
  '    const orderCustomerId = await ensureOrderCustomerLink(client, order);',
);

const ownershipMarker = '[order.customer_id, wall.id, order.id, plaque.id],';
if (!commerceSource.includes(ownershipMarker)) throw new Error('Could not find the fulfilment ownership marker.');
commerceSource = commerceSource.replace(ownershipMarker, '[orderCustomerId, wall.id, order.id, plaque.id],');

commerceSource = replaceFunction(
  commerceSource,
  'async function manualClaimLink(orderId) {',
  'export function mountCommerce(app) {',
  "async function manualClaimLink(orderId) {\n  return manualClaimLinkForOrder(orderId);\n}",
  'manual claim link',
);

fs.writeFileSync(commerceRuntimePath, commerceSource, 'utf8');

// The customer dashboard aggregates Wall activity but sorts by ownership date.
// PostgreSQL requires that sort column in GROUP BY too.
let customerSource = fs.readFileSync(customerSourcePath, 'utf8');
const customerGroupMarker = '      group by w.id\n      order by o.started_at desc`';
if (!customerSource.includes(customerGroupMarker)) {
  throw new Error('Could not find the customer Walls GROUP BY marker.');
}
customerSource = customerSource.replace(
  customerGroupMarker,
  '      group by w.id, o.started_at\n      order by o.started_at desc`',
);
fs.writeFileSync(customerRuntimePath, customerSource, 'utf8');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep index.js as the stable consumer API source. The generated runtime layers
// the canonical web host, Stripe webhook, commerce, first-scan plaque setup,
// customer owner portal and polished browser admin around it without disturbing
// TestFlight API compatibility.
const dbImport = "import { pool } from './db.js';";
const adminImport = "import { mountAdminPortal } from './admin_portal.js';";
const brandImport = "import { mountAdminBrand } from './admin_brand.js';";
const ownershipNavImport = "import { mountOwnershipAdminNav } from './admin_ownership_nav.js';";
const commerceImport = "import { mountCommerce, mountStripeWebhook } from './commerce.runtime.js';";
const activationImport = "import { mountPurchaseActivation } from './purchase_activation.js';";
const plaqueSetupImport = "import { mountPlaqueSetup } from './plaque_setup.js';";
const customerImport = "import { mountCustomerPortal } from './customer_portal.runtime.js';";
const publicImport = "import { mountCanonicalWebRedirect, mountPublicSite } from './public_site.js';";
const requiredImports = [brandImport, ownershipNavImport, commerceImport, activationImport, plaqueSetupImport, customerImport, adminImport, publicImport];
if (requiredImports.some((line) => !source.includes(line))) {
  if (!source.includes(dbImport)) {
    throw new Error('Could not find the database import marker.');
  }
  const imports = [dbImport, ...requiredImports.filter((line) => !source.includes(line))];
  source = source.replace(dbImport, imports.join('\n'));
}

// Stripe signature verification requires the untouched raw request body, so the
// webhook must be mounted before the application's body parsers.
if (!source.includes('mountStripeWebhook(app);')) {
  const bodyParserMarker = "app.use(express.json({ limit: '32kb' }));";
  const bodyParserIndex = source.indexOf(bodyParserMarker);
  if (bodyParserIndex < 0) {
    throw new Error('Could not find the JSON body parser marker.');
  }
  source = `${source.slice(0, bodyParserIndex)}mountStripeWebhook(app);\n${source.slice(bodyParserIndex)}`;
}

// Browser forms such as /shop/checkout submit application/x-www-form-urlencoded.
// Parse them after the Stripe raw-body webhook is mounted so req.body contains
// email, quantity and the admin/customer form fields.
const jsonParserMarker = "app.use(express.json({ limit: '32kb' }));";
const urlEncodedParser = "app.use(express.urlencoded({ extended: false, limit: '32kb' }));";
if (!source.includes(urlEncodedParser)) {
  if (!source.includes(jsonParserMarker)) {
    throw new Error('Could not find the JSON parser for URL-encoded form setup.');
  }
  source = source.replace(jsonParserMarker, `${jsonParserMarker}\n${urlEncodedParser}`);
}

const adminRouteMarker = "app.get('/admin',";
const markerIndex = source.indexOf(adminRouteMarker);
if (markerIndex < 0) {
  throw new Error('Could not find the legacy admin route marker.');
}

const mountBlock = [
  'mountCanonicalWebRedirect(app);',
  'mountAdminBrand(app);',
  'mountOwnershipAdminNav(app);',
  // The paid-return activation route must mount before commerce's generic success page.
  'mountPurchaseActivation(app);',
  'mountCommerce(app);',
  // First-scan interception must mount before the original /api/tags/open and public /t route.
  'mountPlaqueSetup(app);',
  'mountCustomerPortal(app);',
  'mountAdminPortal(app);',
  'mountPublicSite(app);',
].join('\n');

if (!source.includes('mountAdminPortal(app);')) {
  source = `${source.slice(0, markerIndex)}${mountBlock}\n\n${source.slice(markerIndex)}`;
} else {
  const desired = [
    'mountCanonicalWebRedirect(app);',
    'mountAdminBrand(app);',
    'mountOwnershipAdminNav(app);',
    'mountPurchaseActivation(app);',
    'mountCommerce(app);',
    'mountPlaqueSetup(app);',
    'mountCustomerPortal(app);',
    'mountAdminPortal(app);',
    'mountPublicSite(app);',
  ];
  for (const line of desired) {
    if (source.includes(line)) continue;
    if (line === 'mountOwnershipAdminNav(app);' || line === 'mountPurchaseActivation(app);' || line === 'mountCommerce(app);' || line === 'mountPlaqueSetup(app);' || line === 'mountCustomerPortal(app);') {
      source = source.replace('mountAdminPortal(app);', `${line}\nmountAdminPortal(app);`);
    } else if (line === 'mountCanonicalWebRedirect(app);' || line === 'mountAdminBrand(app);') {
      source = source.replace('mountAdminPortal(app);', `${line}\nmountAdminPortal(app);`);
    } else if (line === 'mountPublicSite(app);') {
      source = source.replace('mountAdminPortal(app);', `mountAdminPortal(app);\n${line}`);
    }
  }
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime for checkout, first-scan plaque setup, SMTP2GO email, customer ownership, admin, NFC and API hosting.');
