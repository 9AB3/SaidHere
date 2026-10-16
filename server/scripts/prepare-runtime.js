import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

const helmetNeedle = 'app.use(helmet());';
const helmetReplacement = `const standardHelmet = helmet();
const adminHelmet = helmet({ contentSecurityPolicy: false });
app.use((req, res, next) => {
  const middleware = req.path.startsWith('/admin') ? adminHelmet : standardHelmet;
  return middleware(req, res, next);
});`;

if (!source.includes(helmetNeedle)) {
  throw new Error('Could not find the Helmet middleware line to patch.');
}
source = source.replace(helmetNeedle, helmetReplacement);

const topNeedle = '    ${errorHtml}\n    ${noticeHtml}\n    <h2>Create Wall</h2>';
const topReplacement = '    ${resultHtml}\n    ${errorHtml}\n    ${noticeHtml}\n    <h2>Create Wall</h2>';
if (!source.includes(topNeedle)) {
  throw new Error('Could not find the admin result placement marker.');
}
source = source.replace(topNeedle, topReplacement);

const oldResultNeedle = '    ${resultHtml}\n    ${wallsHtml}';
if (!source.includes(oldResultNeedle)) {
  throw new Error('Could not find the old admin result position.');
}
source = source.replace(oldResultNeedle, '    ${wallsHtml}');

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime with working admin actions and prominent NFC result.');
