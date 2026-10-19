import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep index.js as the stable API source and mount the newer browser admin portal
// into the generated runtime before the legacy /admin routes. The portal owns all
// /admin requests, while /api/admin continues to use ADMIN_KEY for compatibility.
const dbImport = "import { pool } from './db.js';";
const adminImport = "import { mountAdminPortal } from './admin_portal.js';";
if (!source.includes(adminImport)) {
  if (!source.includes(dbImport)) {
    throw new Error('Could not find the database import marker.');
  }
  source = source.replace(dbImport, `${dbImport}\n${adminImport}`);
}

const adminRouteMarker = "app.get('/admin',";
if (!source.includes('mountAdminPortal(app);')) {
  const markerIndex = source.indexOf(adminRouteMarker);
  if (markerIndex < 0) {
    throw new Error('Could not find the legacy admin route marker.');
  }
  source = `${source.slice(0, markerIndex)}mountAdminPortal(app);\n\n${source.slice(markerIndex)}`;
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime with authenticated browser admin portal.');
