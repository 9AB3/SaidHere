import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep index.js as the stable API source and mount the canonical-host redirect,
// polished browser admin, and public saidhere.app site into the generated runtime
// before the legacy /admin routes. /api remains on the Render host temporarily so
// existing TestFlight builds keep working during the domain cutover.
const dbImport = "import { pool } from './db.js';";
const adminImport = "import { mountAdminPortal } from './admin_portal.js';";
const brandImport = "import { mountAdminBrand } from './admin_brand.js';";
const publicImport = "import { mountCanonicalWebRedirect, mountPublicSite } from './public_site.js';";
if (!source.includes(adminImport) || !source.includes(brandImport) || !source.includes(publicImport)) {
  if (!source.includes(dbImport)) {
    throw new Error('Could not find the database import marker.');
  }
  const imports = [dbImport];
  if (!source.includes(brandImport)) imports.push(brandImport);
  if (!source.includes(adminImport)) imports.push(adminImport);
  if (!source.includes(publicImport)) imports.push(publicImport);
  source = source.replace(dbImport, imports.join('\n'));
}

const adminRouteMarker = "app.get('/admin',";
const markerIndex = source.indexOf(adminRouteMarker);
if (markerIndex < 0) {
  throw new Error('Could not find the legacy admin route marker.');
}

const mountBlock = 'mountCanonicalWebRedirect(app);\nmountAdminBrand(app);\nmountAdminPortal(app);\nmountPublicSite(app);';
if (!source.includes('mountAdminPortal(app);')) {
  source = `${source.slice(0, markerIndex)}${mountBlock}\n\n${source.slice(markerIndex)}`;
} else {
  if (!source.includes('mountCanonicalWebRedirect(app);')) {
    source = source.replace('mountAdminPortal(app);', 'mountCanonicalWebRedirect(app);\nmountAdminPortal(app);');
  }
  if (!source.includes('mountAdminBrand(app);')) {
    source = source.replace('mountAdminPortal(app);', 'mountAdminBrand(app);\nmountAdminPortal(app);');
  }
  if (!source.includes('mountPublicSite(app);')) {
    source = source.replace('mountAdminPortal(app);', 'mountAdminPortal(app);\nmountPublicSite(app);');
  }
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime for canonical saidhere.app web, admin, NFC and API hosting.');
