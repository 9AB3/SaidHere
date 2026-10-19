import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep index.js as the stable API source and mount the polished browser admin
// experience into the generated runtime before the legacy /admin routes.
const dbImport = "import { pool } from './db.js';";
const adminImport = "import { mountAdminPortal } from './admin_portal.js';";
const brandImport = "import { mountAdminBrand } from './admin_brand.js';";
if (!source.includes(adminImport) || !source.includes(brandImport)) {
  if (!source.includes(dbImport)) {
    throw new Error('Could not find the database import marker.');
  }
  const imports = [dbImport];
  if (!source.includes(brandImport)) imports.push(brandImport);
  if (!source.includes(adminImport)) imports.push(adminImport);
  source = source.replace(dbImport, imports.join('\n'));
}

const adminRouteMarker = "app.get('/admin',";
if (!source.includes('mountAdminPortal(app);')) {
  const markerIndex = source.indexOf(adminRouteMarker);
  if (markerIndex < 0) {
    throw new Error('Could not find the legacy admin route marker.');
  }
  source = `${source.slice(0, markerIndex)}mountAdminBrand(app);\nmountAdminPortal(app);\n\n${source.slice(markerIndex)}`;
} else if (!source.includes('mountAdminBrand(app);')) {
  source = source.replace('mountAdminPortal(app);', 'mountAdminBrand(app);\nmountAdminPortal(app);');
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime with branded authenticated browser admin portal.');
