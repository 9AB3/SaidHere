import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');
const customerSourcePath = path.join(serverRoot, 'src', 'customer_portal.js');
const customerRuntimePath = path.join(serverRoot, 'src', 'customer_portal.runtime.js');

// Keep one small compatibility transformation until customer_portal.js is split
// into smaller modules. PostgreSQL requires the ownership sort column in GROUP BY.
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
const dbImport = "import { pool } from './db.js';";
const imports = [
  "import { mountAdminSecurity } from './admin_security.js';",
  "import { mountAdminPortal } from './admin_portal.js';",
  "import { mountAdminBrand } from './admin_brand.js';",
  "import { mountOwnershipAdminNav } from './admin_ownership_nav.js';",
  "import { mountCommerce, mountStripeWebhook } from './commerce.js';",
  "import { mountPurchaseActivation } from './purchase_activation.js';",
  "import { mountCustomerSecurity } from './customer_security.js';",
  "import { mountPlaqueSetup } from './plaque_setup.js';",
  "import { mountSetupGuard } from './setup_guard.js';",
  "import { mountCustomerPortal } from './customer_portal.runtime.js';",
  "import { mountCanonicalWebRedirect, mountPublicSite } from './public_site.js';",
];

if (!source.includes(dbImport)) throw new Error('Could not find the database import marker.');
for (const line of imports) {
  if (!source.includes(line)) source = source.replace(dbImport, `${dbImport}\n${line}`);
}

// Stripe signature verification needs the untouched raw body. Mount the webhook
// before any JSON or URL-encoded body parser.
if (!source.includes('mountStripeWebhook(app);')) {
  const parserMarker = "app.use(express.json({ limit: '32kb' }));";
  const parserIndex = source.indexOf(parserMarker);
  if (parserIndex < 0) throw new Error('Could not find the JSON body parser marker.');
  source = `${source.slice(0, parserIndex)}mountStripeWebhook(app);\n${source.slice(parserIndex)}`;
}

const adminRouteMarker = "app.get('/admin',";
const markerIndex = source.indexOf(adminRouteMarker);
if (markerIndex < 0) throw new Error('Could not find the legacy admin route marker.');

const mountBlock = [
  'mountCanonicalWebRedirect(app);',
  // Force the seeded Main Admin to change a temporary password before any admin action.
  'mountAdminSecurity(app);',
  'mountAdminBrand(app);',
  'mountOwnershipAdminNav(app);',
  'mountPurchaseActivation(app);',
  'mountCommerce(app);',
  // Rate-limit account/login/setup endpoints and retire legacy claim links safely.
  'mountCustomerSecurity(app);',
  // First-scan interception must mount before the original tag API and public /t route.
  'mountPlaqueSetup(app);',
  'mountSetupGuard(app);',
  'mountCustomerPortal(app);',
  'mountAdminPortal(app);',
  'mountPublicSite(app);',
].join('\n');

if (!source.includes('mountAdminPortal(app);')) {
  source = `${source.slice(0, markerIndex)}${mountBlock}\n\n${source.slice(markerIndex)}`;
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime from reviewed Stripe, customer, admin, NFC and public-site modules.');
