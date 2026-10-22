import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'customer_portal.js');
const runtimePath = path.join(serverRoot, 'src', 'customer_portal.runtime.js');

// index.js keeps the runtime filename for deployment compatibility, but the file
// is now an exact copy of the reviewed source — no production code rewriting.
fs.copyFileSync(sourcePath, runtimePath);
console.log('Prepared exact customer portal runtime copy.');
