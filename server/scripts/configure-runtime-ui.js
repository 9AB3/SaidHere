import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(here, '..', 'src', 'index.runtime.js');
let source = fs.readFileSync(runtimePath, 'utf8');

const importMarker = "import helmet from 'helmet';";
const importLine = "import { wallUiLanguage } from './ui_language.js';";
if (!source.includes(importLine)) {
  if (!source.includes(importMarker)) throw new Error('Could not find Helmet import marker for UI terminology middleware.');
  source = source.replace(importMarker, `${importMarker}\n${importLine}`);
}

const appMarker = "app.set('trust proxy', 1);";
const mountLine = 'app.use(wallUiLanguage);';
if (!source.includes(mountLine)) {
  if (!source.includes(appMarker)) throw new Error('Could not find Express app marker for UI terminology middleware.');
  source = source.replace(appMarker, `${appMarker}\n${mountLine}`);
}

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Applied Wall product terminology and quantity-input UI middleware.');
