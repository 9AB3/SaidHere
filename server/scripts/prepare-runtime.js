import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const sourcePath = path.join(serverRoot, 'src', 'index.js');
const runtimePath = path.join(serverRoot, 'src', 'index.runtime.js');

let source = fs.readFileSync(sourcePath, 'utf8');

// Keep the normal Helmet policy everywhere except the browser admin page.
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

// Put a newly-created/replaced NFC URL above the forms so it is immediately visible.
const topNeedle = '    ${errorHtml}\\n    ${noticeHtml}\\n    <h2>Create Wall</h2>';
const topReplacement = '    ${resultHtml}\\n    ${errorHtml}\\n    ${noticeHtml}\\n    <h2>Create Wall</h2>';
if (!source.includes(topNeedle)) {
  throw new Error('Could not find the admin result placement marker.');
}
source = source.replace(topNeedle, topReplacement);

const oldResultNeedle = '    ${resultHtml}\\n    ${wallsHtml}';
if (!source.includes(oldResultNeedle)) {
  throw new Error('Could not find the old admin result position.');
}
source = source.replace(oldResultNeedle, '    ${wallsHtml}');

// Replace JavaScript-driven Wall buttons with plain HTML forms. This deliberately
// works even if JavaScript is disabled or blocked by a browser/security policy.
const wallRowsStart = source.indexOf('  const wallRows = Array.isArray(walls)');
const wallsHtmlStart = source.indexOf('  const wallsHtml = Array.isArray(walls)', wallRowsStart);
if (wallRowsStart < 0 || wallsHtmlStart < 0) {
  throw new Error('Could not find the Wall table rendering block.');
}

const replacementWallRows = `  const wallRows = Array.isArray(walls)
    ? walls.map((wall) => {
      const formId = 'wall-form-' + String(wall.id).replace(/[^a-zA-Z0-9_-]/g, '');
      return \`<tr>
        <td><input form="\${formId}" name="display_name" value="\${escapeHtml(wall.display_name)}" maxlength="80" required></td>
        <td><input form="\${formId}" name="location_hint" value="\${escapeHtml(wall.location_hint || '')}" maxlength="120"></td>
        <td><code>\${escapeHtml(wall.slug)}</code></td>
        <td><span class="status \${wall.active ? 'active' : 'inactive'}">\${wall.active ? 'Active' : 'Inactive'}</span></td>
        <td>\${escapeHtml(wall.discovered_by)}</td>
        <td>\${escapeHtml(wall.post_count)}</td>
        <td>\${escapeHtml(formatAdminDate(wall.created_at))}</td>
        <td class="actions">
          <form id="\${formId}" method="post" class="row-actions">
            <input name="admin_key" type="password" required autocomplete="current-password" placeholder="Admin key">
            <button type="submit" class="secondary" formaction="/admin/walls/\${escapeHtml(wall.id)}/edit">Save</button>
            <button type="submit" class="secondary" formaction="/admin/walls/\${escapeHtml(wall.id)}/status" name="active" value="\${wall.active ? 'false' : 'true'}">\${wall.active ? 'Deactivate' : 'Reactivate'}</button>
            <button type="submit" class="secondary" formaction="/admin/walls/\${escapeHtml(wall.id)}/rotate" name="confirmation" value="ROTATE">Replace NFC</button>
            <button type="submit" class="secondary" formaction="/admin/walls/\${escapeHtml(wall.id)}/clear" name="confirmation" value="CLEAR">Clear messages</button>
            <button type="submit" class="danger" formaction="/admin/walls/\${escapeHtml(wall.id)}/delete" name="confirmation" value="DELETE">Delete Wall</button>
          </form>
        </td>
      </tr>\`;
    }).join('')
    : '';
`;

source = source.slice(0, wallRowsStart) + replacementWallRows + source.slice(wallsHtmlStart);

// Remove the now-unneeded JavaScript completely.
source = source.replace(/  <script>[\\s\\S]*?<\\/script>\\n/, '');

// Replace the obsolete global admin-key prompt with instructions for the row forms.
source = source.replace(
  '<p><label><strong>Admin key for Wall actions</strong><br><input id="wall-action-key" type="password" autocomplete="current-password" placeholder="Required for Wall changes"></label></p>',
  '<p class="help"><strong>Wall actions:</strong> enter the admin key in that Wall’s row, edit the name/location directly if needed, then press the required action.</p>',
);

// Make the per-row controls usable without affecting the create/view forms.
source = source.replace(
  '.nfc-url{overflow-wrap:anywhere;white-space:normal}',
  '.nfc-url{overflow-wrap:anywhere;white-space:normal}.row-actions{background:none;padding:0;margin:0;display:flex;gap:7px;align-items:center}.row-actions input{width:150px}.actions{min-width:760px}',
);

fs.writeFileSync(runtimePath, source, 'utf8');
console.log('Prepared SaidHere runtime with no-JavaScript admin actions and prominent NFC result.');
