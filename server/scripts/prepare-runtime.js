import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep index.js as the stable consumer API source. The generated runtime layers
// the canonical web host, Stripe webhook, commerce/fulfilment, customer owner
// portal and polished browser admin around it without disturbing TestFlight API
// compatibility.
const dbImport = "import { pool } from './db.js';";
const adminImport = "import { mountAdminPortal } from './admin_portal.js';";
const brandImport = "import { mountAdminBrand } from './admin_brand.js';";
const ownershipNavImport = "import { mountOwnershipAdminNav } from './admin_ownership_nav.js';";
const commerceImport = "import { mountCommerce, mountStripeWebhook } from './commerce.js';";
const customerImport = "import { mountCustomerPortal } from './customer_portal.js';";
const publicImport = "import { mountCanonicalWebRedirect, mountPublicSite } from './public_site.js';";
const requiredImports = [brandImport, ownershipNavImport, commerceImport, customerImport, adminImport, publicImport];
if (requiredImports.some((line) => !source.includes(line))) {
  if (!source.includes(dbImport)) {
    throw new Error('Could not find the database import marker.');
  }
  const imports = [dbImport, ...requiredImports.filter((line) => !source.includes(line))];
  source = source.replace(dbImport, imports.join('\n'));
}

// Stripe signature verification requires the untouched raw request body, so the
// webhook must be mounted before the application's global express.json parser.
if (!source.includes('mountStripeWebhook(app);')) {
  const bodyParserMarker = "app.use(express.json({ limit: '32kb' }));";
  const bodyParserIndex = source.indexOf(bodyParserMarker);
  if (bodyParserIndex < 0) {
    throw new Error('Could not find the JSON body parser marker.');
  }
  source = `${source.slice(0, bodyParserIndex)}mountStripeWebhook(app);\n${source.slice(bodyParserIndex)}`;
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
  // Commerce must mount before /admin because /admin/fulfillment is a commerce route.
  'mountCommerce(app);',
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
    'mountCommerce(app);',
    'mountCustomerPortal(app);',
    'mountAdminPortal(app);',
    'mountPublicSite(app);',
  ];
  for (const line of desired) {
    if (source.includes(line)) continue;
    if (line === 'mountOwnershipAdminNav(app);' || line === 'mountCommerce(app);' || line === 'mountCustomerPortal(app);') {
      source = source.replace('mountAdminPortal(app);', `${line}\nmountAdminPortal(app);`);
    } else if (line === 'mountCanonicalWebRedirect(app);' || line === 'mountAdminBrand(app);') {
      source = source.replace('mountAdminPortal(app);', `${line}\nmountAdminPortal(app);`);
    } else if (line === 'mountPublicSite(app);') {
      source = source.replace('mountAdminPortal(app);', `mountAdminPortal(app);\n${line}`);
    }
  }
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime for canonical web, customer ownership, commerce, admin, NFC and API hosting.');
