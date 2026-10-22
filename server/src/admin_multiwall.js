import { hashToken } from './auth.js';
import {
  hashAdminPassword,
  normalizeAdminUsername,
  validateAdminPassword,
} from './admin_auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(part.slice(at + 1).trim()); }
    catch (_) { cookies[key] = part.slice(at + 1).trim(); }
  }
  return cookies;
}

function roleLabel(role) {
  return role === 'owner' ? 'Main Admin' : 'Moderator';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

async function requireAdmin(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `update admin_sessions s
          set last_seen_at = now()
         from admin_users u
        where s.token_hash = $1
          and s.admin_user_id = u.id
          and s.expires_at > now()
          and u.active = true
      returning s.id as session_id, u.id, u.username, u.display_name, u.role,
                u.wall_id, u.must_change_password`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const user = result.rows[0];
    req.multiwallAdmin = {
      ...user,
      raw,
      csrf: hashToken(`admin-csrf:${raw}`),
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.multiwallAdmin?.csrf || clean(req.body?._csrf) !== req.multiwallAdmin.csrf) {
    return res.status(403).send('Request expired. Refresh the page and try again.');
  }
  return next();
}

function requireOwner(req, res, next) {
  if (req.multiwallAdmin?.role !== 'owner') return res.sendStatus(403);
  return next();
}

async function writeAudit(admin, action, { targetAdminUserId = null, wallId = null, wallName = null, details = {} } = {}) {
  try {
    await pool.query(
      `insert into admin_audit_log
         (admin_user_id, username_snapshot, action, wall_id, wall_name, target_admin_user_id, details)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [admin.id, admin.username, action, wallId, wallName, targetAdminUserId, JSON.stringify(details)],
    );
  } catch (error) {
    console.error('[multiwall-audit]', error);
  }
}

function normalizeWallIds(raw) {
  const input = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return [...new Set(input.map(clean).filter((value) => UUID_RE.test(value)))];
}

async function validateWallIds(wallIds) {
  if (wallIds.length === 0) throw new Error('Assign at least one Wall to this Moderator.');
  const result = await pool.query(`select id from walls where id = any($1::uuid[])`, [wallIds]);
  if (result.rowCount !== wallIds.length) throw new Error('One or more selected Walls no longer exist.');
}

async function replaceAssignments(client, adminUserId, wallIds) {
  await client.query(`delete from admin_wall_assignments where admin_user_id = $1`, [adminUserId]);
  for (const wallId of wallIds) {
    await client.query(
      `insert into admin_wall_assignments (admin_user_id, wall_id)
       values ($1, $2) on conflict do nothing`,
      [adminUserId, wallId],
    );
  }
  // Keep the old single wall_id populated as a compatibility fallback for legacy
  // routes while multi-Wall access is handled through admin_wall_assignments.
  await client.query(
    `update admin_users set wall_id = $2, updated_at = now() where id = $1`,
    [adminUserId, wallIds[0] || null],
  );
}

async function listAllWalls() {
  const result = await pool.query(
    `select id, display_name, location_hint, active
       from walls
      order by display_name asc`,
  );
  return result.rows;
}

async function getAdminUser(userId) {
  const result = await pool.query(
    `select u.id, u.username, u.display_name, u.role, u.active, u.must_change_password,
            u.created_at, u.last_login_at,
            coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.display_name)
              order by w.display_name) filter (where w.id is not null), '[]'::jsonb) as assigned_walls
       from admin_users u
       left join admin_wall_assignments a on a.admin_user_id = u.id
       left join walls w on w.id = a.wall_id
      where u.id = $1
      group by u.id
      limit 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function listAdminUsers() {
  const result = await pool.query(
    `select u.id, u.username, u.display_name, u.role, u.active, u.must_change_password,
            u.created_at, u.last_login_at,
            coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.display_name)
              order by w.display_name) filter (where w.id is not null), '[]'::jsonb) as assigned_walls
       from admin_users u
       left join admin_wall_assignments a on a.admin_user_id = u.id
       left join walls w on w.id = a.wall_id
      group by u.id
      order by case u.role when 'owner' then 1 else 2 end, u.username`,
  );
  return result.rows;
}

async function activeOwnerCount() {
  const result = await pool.query(`select count(*)::int as count from admin_users where role = 'owner' and active = true`);
  return result.rows[0].count;
}

async function createModerator({ username, displayName, password, wallIds }) {
  const normalized = normalizeAdminUsername(username);
  if (!/^[a-z0-9._-]{3,50}$/.test(normalized)) throw new Error('Username must be 3–50 characters using letters, numbers, dot, dash or underscore.');
  if (!displayName || displayName.length > 80) throw new Error('Display name must be between 1 and 80 characters.');
  validateAdminPassword(password);
  await validateWallIds(wallIds);

  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `insert into admin_users
         (username, display_name, password_hash, role, wall_id, active, must_change_password)
       values ($1, $2, $3, 'moderator', $4, true, true)
       returning id, username, display_name, role, active`,
      [normalized, displayName, hashAdminPassword(password), wallIds[0]],
    );
    await replaceAssignments(client, result.rows[0].id, wallIds);
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    if (error?.code === '23505') throw new Error('That username is already in use.');
    throw error;
  } finally {
    client.release();
  }
}

async function updateAdminUser(target, { displayName, active, wallIds }, currentAdminId) {
  if (!displayName || displayName.length > 80) throw new Error('Display name must be between 1 and 80 characters.');
  if (target.id === currentAdminId && !active) throw new Error('You cannot deactivate the Main Admin account you are currently using.');
  if (target.role === 'owner' && target.active && !active && await activeOwnerCount() <= 1) {
    throw new Error('At least one active Main Admin account is required.');
  }
  if (target.role === 'moderator') await validateWallIds(wallIds);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update admin_users
          set display_name = $2, active = $3, updated_at = now()
        where id = $1`,
      [target.id, displayName, active],
    );
    if (target.role === 'moderator') await replaceAssignments(client, target.id, wallIds);
    if (!active) await client.query(`delete from admin_sessions where admin_user_id = $1`, [target.id]);
    await client.query('commit');
    return getAdminUser(target.id);
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function listAssignedWalls(adminUserId) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            count(distinct v.session_id)::int as discovered_by,
            count(distinct p.id)::int as post_count
       from admin_wall_assignments a
       join walls w on w.id = a.wall_id
       left join wall_visits v on v.wall_id = w.id
       left join wall_posts p on p.wall_id = w.id and p.hidden_at is null
      where a.admin_user_id = $1
      group by w.id
      order by w.display_name asc`,
    [adminUserId],
  );
  return result.rows;
}

async function listAssignedReports(adminUserId) {
  const result = await pool.query(
    `select p.id, p.wall_id, p.parent_id, p.body, p.created_at, p.hidden_at,
            w.display_name as wall_name, w.location_hint,
            count(r.id)::int as report_count,
            max(r.created_at) as last_reported_at
       from post_reports r
       join wall_posts p on p.id = r.post_id
       join walls w on w.id = p.wall_id
       join admin_wall_assignments a on a.wall_id = p.wall_id and a.admin_user_id = $1
      group by p.id, w.id
      order by max(r.created_at) desc`,
    [adminUserId],
  );
  return result.rows;
}

async function getAssignedReportedPost(client, adminUserId, postId) {
  const result = await client.query(
    `select p.id, p.wall_id, p.body, p.hidden_at, w.display_name as wall_name,
            count(r.id)::int as report_count
       from wall_posts p
       join walls w on w.id = p.wall_id
       join post_reports r on r.post_id = p.id
       join admin_wall_assignments a on a.wall_id = p.wall_id and a.admin_user_id = $2
      where p.id = $1
      group by p.id, w.id`,
    [postId, adminUserId],
  );
  return result.rows[0] || null;
}

async function moderateAssignedPost(admin, postId, action) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const post = await getAssignedReportedPost(client, admin.id, postId);
    if (!post) throw new Error('Reported post not found or not assigned to you.');
    if (action === 'remove') {
      await client.query(`delete from wall_posts where id = $1`, [postId]);
    } else {
      await client.query(`update wall_posts set hidden_at = null where id = $1`, [postId]);
      await client.query(`delete from post_reports where post_id = $1`, [postId]);
    }
    await client.query('commit');
    await writeAudit(admin, `report.${action}`, {
      wallId: post.wall_id,
      wallName: post.wall_name,
      details: { post_id: post.id, report_count: post.report_count },
    });
    return post;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function navFor(user) {
  const ownerLinks = user.role === 'owner'
    ? '<a href="/admin/users">Users</a><a href="/admin/audit">Audit log</a>'
    : '';
  return `<nav><a href="/admin/walls">Walls</a><a href="/admin/reports">Reports</a>${ownerLinks}<a href="/admin/account/password">Password</a></nav>`;
}

function layout({ title, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)} · SaidHere Admin</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#eee;color:#171717}.shell{max-width:1180px;margin:auto;padding:24px}.topbar{display:flex;justify-content:space-between;align-items:center}.brand{display:flex;gap:10px;align-items:center}.mark{width:42px;height:42px;background:#111;color:#fff;display:grid;place-items:center}.account{display:flex;gap:10px;align-items:center}nav{display:flex;gap:8px;margin:16px 0}.panel{background:#fff;padding:20px;margin-bottom:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:flex;flex-direction:column;gap:6px}.field input,.field select{padding:10px}.button{display:inline-flex;padding:9px 12px;background:#171717;color:#fff;text-decoration:none;border:1px solid #171717;cursor:pointer}.button.secondary{background:#fff;color:#171717}.button.warn{background:#8d352d;border-color:#8d352d}.actions,.report-actions{display:flex;gap:8px;flex-wrap:wrap}.table{width:100%;border-collapse:collapse}.table th,.table td{padding:10px;border-bottom:1px solid #ddd;text-align:left}.table-wrap{overflow:auto}.code{font:12px ui-monospace,monospace;color:#777}.badge{font-size:11px}.wall-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wall-card{background:#fff;padding:16px}.wall-head{display:flex;justify-content:space-between}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.metric strong{display:block}.report-list{display:flex;flex-direction:column;gap:10px}.report-card{background:#fff;padding:16px}.report-top{display:flex;justify-content:space-between}.notice,.error,.warning{padding:10px;margin-bottom:10px}.notice{background:#edf7ef}.error{background:#faecea}.warning{background:#fff5d8}.stack{display:flex;flex-direction:column;gap:12px}.help{color:#666}.wall-check-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.wall-check{display:flex;gap:8px;align-items:flex-start;border:1px solid #ddd;padding:9px;border-radius:8px}.wall-check input{width:auto!important;min-height:0!important;margin-top:2px}.wall-check small{display:block;color:#777;margin-top:2px}@media(max-width:720px){.grid,.wall-grid,.wall-check-grid{grid-template-columns:1fr}}
  </style></head><body>${body}</body></html>`;
}

function shellBody({ user, csrf, content, title }) {
  return layout({
    title,
    body: `<div class="shell"><div class="topbar"><div class="brand"><div class="mark">TW</div><div><h1>SaidHere Admin</h1><small>Physical Wall management</small></div></div><div class="account"><span>${escapeHtml(user.display_name || user.username)} · ${escapeHtml(roleLabel(user.role))}</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="link-button" type="submit">Log out</button></form></div></div>${navFor(user)}${content}</div>`,
  });
}

function wallCheckboxes(walls, selectedIds = []) {
  const selected = new Set(selectedIds.map(String));
  if (!walls.length) return '<p class="help">Create a Wall first.</p>';
  return `<div class="wall-check-grid">${walls.map((wall) => `<label class="wall-check"><input type="checkbox" name="wall_ids" value="${escapeHtml(wall.id)}" ${selected.has(String(wall.id)) ? 'checked' : ''}><span><strong>${escapeHtml(wall.display_name)}</strong>${wall.location_hint ? `<small>${escapeHtml(wall.location_hint)}</small>` : ''}${wall.active ? '' : '<small>Inactive</small>'}</span></label>`).join('')}</div>`;
}

function usersPage({ users, walls, admin, csrf, notice = '', error = '' }) {
  const rows = users.map((user) => {
    const names = user.role === 'owner'
      ? 'All Walls'
      : (user.assigned_walls || []).map((wall) => wall.name).join(' · ') || 'No Walls assigned';
    return `<tr><td><strong>${escapeHtml(user.display_name)}</strong><div class="code">${escapeHtml(user.username)}</div><div class="code">Walls: ${escapeHtml(names)}</div></td><td><span class="role">${escapeHtml(roleLabel(user.role))}</span></td><td>${user.active ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>'}${user.must_change_password ? '<div class="code">Temporary password</div>' : ''}</td><td>${escapeHtml(formatDate(user.last_login_at))}</td><td><a class="button secondary" href="/admin/users/${encodeURIComponent(user.id)}/edit">Edit</a> <a class="button secondary" href="/admin/users/${encodeURIComponent(user.id)}/password">Reset password</a></td></tr>`;
  }).join('');

  const content = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <section class="panel"><h2>Add admin user</h2><form method="post" action="/admin/users/create" class="stack"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><div class="grid"><div class="field"><label>Username</label><input name="username" maxlength="50" required></div><div class="field"><label>Display name</label><input name="display_name" maxlength="80" required></div><div class="field"><label>Initial password</label><input name="password" type="password" minlength="8" required></div></div><div class="field"><label>Assigned Walls</label>${wallCheckboxes(walls)}</div><p class="help">A Moderator can be responsible for one or more Walls. Only the Main Admin can change these assignments.</p><div><button class="button" type="submit" ${walls.length ? '' : 'disabled'}>Create Moderator</button></div></form></section>
  <section class="panel"><h2>Admin users</h2><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div><p class="help"><strong>Main Admin:</strong> full access to every Wall, user management, moderation and audit. <strong>Moderator:</strong> can see and moderate every Wall assigned to them, but cannot assign themselves additional Walls.</p></section>`;
  return shellBody({ user: admin, csrf, content, title: 'Users' });
}

function userEditPage({ target, walls, admin, csrf, error = '' }) {
  const selectedIds = (target.assigned_walls || []).map((wall) => wall.id);
  const wallField = target.role === 'moderator'
    ? `<div class="field"><label>Assigned Walls</label>${wallCheckboxes(walls, selectedIds)}<p class="help">Select every Wall this Moderator is responsible for.</p></div>`
    : `<div class="field"><label>Access</label><input value="All Walls" disabled></div>`;
  const content = `<a class="back" href="/admin/users">← Back to Users</a><section class="panel"><h2>Edit admin user</h2>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/users/${encodeURIComponent(target.id)}/edit" class="stack"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><div class="grid"><div class="field"><label>Username</label><input value="${escapeHtml(target.username)}" disabled></div><div class="field"><label>Role</label><input value="${escapeHtml(roleLabel(target.role))}" disabled></div><div class="field"><label>Display name</label><input name="display_name" maxlength="80" required value="${escapeHtml(target.display_name)}"></div></div>${wallField}<div class="field"><label>Status</label><select name="active"><option value="true" ${target.active ? 'selected' : ''}>Active</option><option value="false" ${!target.active ? 'selected' : ''}>Inactive</option></select></div><div class="actions"><button class="button" type="submit">Save user</button><a class="button secondary" href="/admin/users">Cancel</a></div></form></section>`;
  return shellBody({ user: admin, csrf, content, title: 'Edit User' });
}

function moderatorWallsPage({ walls, admin, csrf }) {
  const cards = walls.length
    ? `<div class="wall-grid">${walls.map((wall) => `<article class="wall-card ${wall.active ? '' : 'inactive'}"><div class="wall-head"><div><h3>${escapeHtml(wall.display_name)}</h3><div class="location">${escapeHtml(wall.location_hint || 'No location set')}</div></div><span class="badge ${wall.active ? 'active' : 'inactive'}">${wall.active ? 'Active' : 'Inactive'}</span></div><div class="meta"><div class="metric"><strong>${escapeHtml(wall.post_count)}</strong><span>Messages</span></div><div class="metric"><strong>${escapeHtml(wall.discovered_by)}</strong><span>Visitors</span></div><div class="metric"><strong>${escapeHtml(formatDate(wall.created_at))}</strong><span>Created</span></div></div><div class="code">Public ID: ${escapeHtml(wall.slug)}</div><div class="actions" style="margin-top:15px"><a class="button secondary" href="/admin/reports">Review reports</a></div></article>`).join('')}</div>`
    : '<div class="panel"><p>No Walls are assigned to this Moderator yet.</p></div>';
  const content = `${admin.must_change_password ? '<div class="warning">This account is still using a temporary password. <a href="/admin/account/password">Change it now</a>.</div>' : ''}<div class="notice">You can see every Wall assigned to your Moderator account. Wall assignments can only be changed by the Main Admin.</div><section><h2>Walls <span style="font-size:12px;font-weight:700">${walls.length}</span></h2>${cards}</section>`;
  return shellBody({ user: admin, csrf, content, title: 'Walls' });
}

function moderatorReportsPage({ reports, admin, csrf, notice = '', error = '' }) {
  const items = reports.length
    ? `<div class="report-list">${reports.map((item) => `<article class="report-card ${item.hidden_at ? 'auto-hidden' : ''}"><div class="report-top"><div><div class="report-wall">${escapeHtml(item.wall_name)}</div><div class="code">${escapeHtml(item.location_hint || '')}</div></div><div class="report-count">${escapeHtml(item.report_count)} report${Number(item.report_count) === 1 ? '' : 's'}${item.hidden_at ? ' · auto-hidden' : ''}</div></div><div class="report-body">${escapeHtml(item.body)}</div><div class="report-meta">${item.parent_id ? 'Reply' : 'Post'} · posted ${escapeHtml(formatDate(item.created_at))} · last reported ${escapeHtml(formatDate(item.last_reported_at))}</div><div class="report-actions"><form method="post" action="/admin/reports/${encodeURIComponent(item.id)}/remove"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button warn" type="submit">Remove post</button></form><form method="post" action="/admin/reports/${encodeURIComponent(item.id)}/keep"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">Keep post</button></form></div></article>`).join('')}</div>`
    : '<div class="panel"><p>No reported posts need review.</p></div>';
  const content = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Reported posts</h2><p class="help">Reports from all Walls assigned to you are shown here. Three reports automatically hide a post while it waits for review.</p></section>${items}`;
  return shellBody({ user: admin, csrf, content, title: 'Reports' });
}

function redirectUsers(res, params = {}) {
  const query = new URLSearchParams();
  if (params.notice) query.set('notice', params.notice);
  if (params.error) query.set('error', params.error);
  return res.redirect(303, `/admin/users${query.size ? `?${query}` : ''}`);
}

function redirectReports(res, params = {}) {
  const query = new URLSearchParams();
  if (params.notice) query.set('notice', params.notice);
  if (params.error) query.set('error', params.error);
  return res.redirect(303, `/admin/reports${query.size ? `?${query}` : ''}`);
}

const uiPatch = `(() => {
  const install = () => {
    const style = document.createElement('style');
    style.id = 'saidhere-mobile-multiwall-fixes';
    style.textContent = \`
      .wall-check-grid{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
      .wall-check{display:flex!important;align-items:flex-start!important;gap:8px!important;padding:9px!important;border:1px solid var(--admin-line,#e2e5e9)!important;border-radius:8px!important;background:#fff!important;cursor:pointer!important}
      .wall-check input{width:auto!important;min-height:0!important;margin:2px 0 0!important;flex:0 0 auto!important}
      .wall-check strong{display:block!important;font-size:10px!important}.wall-check small{display:block!important;margin-top:2px!important;color:var(--admin-muted,#6b7280)!important;font-size:8px!important}
      @media(max-width:720px){
        .wall-row{display:grid!important;grid-template-columns:minmax(0,1fr) auto auto!important;align-items:center!important;gap:7px!important;min-height:52px!important;padding:8px 10px!important;margin-bottom:6px!important}
        .wall-main{grid-column:1!important;grid-row:1!important;min-width:0!important}.wall-main b{font-size:11px!important}
        .wall-main>span,.wall-sub,.wall-row>.wall-number{display:none!important}
        .wall-row>.badge{grid-column:2!important;grid-row:1!important;margin:0!important}
        .wall-actions{grid-column:3!important;grid-row:1!important;display:flex!important;flex-wrap:nowrap!important;justify-content:flex-end!important;padding:0!important;border:0!important;gap:5px!important}
        .wall-actions>.button{min-height:32px!important;padding:6px 8px!important;white-space:nowrap!important}
        .more-menu{position:relative!important}.more-pop{z-index:200!important}
        .wall-check-grid{grid-template-columns:1fr!important}
        body[data-admin-page="users"] .users-panel .table-wrap{overflow:visible!important;border:0!important}
        body[data-admin-page="users"] .users-panel .table{min-width:0!important;display:block!important}
        body[data-admin-page="users"] .users-panel thead{display:none!important}
        body[data-admin-page="users"] .users-panel tbody{display:flex!important;flex-direction:column!important;gap:8px!important}
        body[data-admin-page="users"] .users-panel tr{display:grid!important;grid-template-columns:1fr auto!important;gap:6px 10px!important;padding:12px!important;border:1px solid var(--admin-line,#e2e5e9)!important;border-radius:10px!important;background:#fff!important}
        body[data-admin-page="users"] .users-panel td{display:block!important;padding:0!important;border:0!important}
        body[data-admin-page="users"] .users-panel td:nth-child(1){grid-column:1!important;grid-row:1 / span 2!important}
        body[data-admin-page="users"] .users-panel td:nth-child(2){grid-column:2!important;grid-row:1!important;text-align:right!important}
        body[data-admin-page="users"] .users-panel td:nth-child(3){grid-column:2!important;grid-row:2!important;text-align:right!important}
        body[data-admin-page="users"] .users-panel td:nth-child(4){grid-column:1!important;grid-row:3!important;color:var(--admin-muted,#6b7280)!important;font-size:8px!important}
        body[data-admin-page="users"] .users-panel td:nth-child(5){grid-column:2!important;grid-row:3!important;text-align:right!important}
        body[data-admin-page="users"] .users-panel .user-actions{white-space:normal!important}
      }
      @media(max-width:430px){.wall-row>.badge{display:none!important}.wall-row{grid-template-columns:minmax(0,1fr) auto!important}.wall-actions{grid-column:2!important}}
    \`;
    document.head.append(style);

    document.querySelectorAll('.more-menu').forEach((menu) => {
      menu.addEventListener('toggle', () => {
        if (!menu.open) return;
        document.querySelectorAll('.more-menu[open]').forEach((other) => { if (other !== menu) other.open = false; });
        requestAnimationFrame(() => {
          const summary = menu.querySelector('summary');
          const pop = menu.querySelector('.more-pop');
          if (!summary || !pop || window.innerWidth > 720) return;
          const rect = summary.getBoundingClientRect();
          const width = Math.min(220, window.innerWidth - 24);
          pop.style.position = 'fixed';
          pop.style.width = width + 'px';
          pop.style.right = 'auto';
          pop.style.left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)) + 'px';
          let top = rect.bottom + 6;
          pop.style.top = top + 'px';
          const height = pop.getBoundingClientRect().height;
          if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
          pop.style.top = top + 'px';
        });
      });
    });

    document.addEventListener('click', (event) => {
      if (event.target.closest('.more-menu')) return;
      document.querySelectorAll('.more-menu[open]').forEach((menu) => { menu.open = false; });
    });

    if (location.pathname === '/admin/users') {
      const toolbarText = document.querySelector('.toolbar span');
      if (toolbarText) toolbarText.textContent = 'Main Admins and Moderators, with their assigned Walls.';
      const modalText = document.querySelector('.modal-head p');
      if (modalText && /assigned Wall/i.test(modalText.textContent || '')) modalText.textContent = 'Moderators can be assigned to one or more Walls.';
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0));
  else setTimeout(install, 0);
})();`;

export function mountAdminMultiwall(app) {
  app.use('/admin', (_req, res, next) => {
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && body.includes('</body>') && !body.includes('/admin/multiwall-ui.js')) {
        body = body.replace('</body>', '<script src="/admin/multiwall-ui.js" defer></script></body>');
      }
      return send(body);
    };
    return next();
  });

  app.get('/admin/multiwall-ui.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(uiPatch);
  });

  app.get('/admin/users', requireAdmin, requireOwner, async (req, res, next) => {
    try {
      const [users, walls] = await Promise.all([listAdminUsers(), listAllWalls()]);
      return res.type('html').send(usersPage({
        users,
        walls,
        admin: req.multiwallAdmin,
        csrf: req.multiwallAdmin.csrf,
        notice: clean(req.query?.notice),
        error: clean(req.query?.error),
      }));
    } catch (error) { return next(error); }
  });

  app.post('/admin/users/create', requireAdmin, requireCsrf, requireOwner, async (req, res) => {
    try {
      const wallIds = normalizeWallIds(req.body?.wall_ids);
      const created = await createModerator({
        username: req.body?.username,
        displayName: clean(req.body?.display_name),
        password: typeof req.body?.password === 'string' ? req.body.password : '',
        wallIds,
      });
      await writeAudit(req.multiwallAdmin, 'admin_user.create', {
        targetAdminUserId: created.id,
        details: { username: created.username, role: 'moderator', wall_ids: wallIds },
      });
      return redirectUsers(res, { notice: `Created Moderator ${created.username}. Their initial password is temporary.` });
    } catch (error) {
      return redirectUsers(res, { error: error?.message || 'Could not create Moderator.' });
    }
  });

  app.get('/admin/users/:userId/edit', requireAdmin, requireOwner, async (req, res, next) => {
    try {
      const [target, walls] = await Promise.all([getAdminUser(req.params.userId), listAllWalls()]);
      if (!target) return res.sendStatus(404);
      return res.type('html').send(userEditPage({ target, walls, admin: req.multiwallAdmin, csrf: req.multiwallAdmin.csrf }));
    } catch (error) { return next(error); }
  });

  app.post('/admin/users/:userId/edit', requireAdmin, requireCsrf, requireOwner, async (req, res) => {
    try {
      const target = await getAdminUser(req.params.userId);
      if (!target) throw new Error('Admin user not found.');
      const wallIds = target.role === 'moderator' ? normalizeWallIds(req.body?.wall_ids) : [];
      const updated = await updateAdminUser(target, {
        displayName: clean(req.body?.display_name),
        active: clean(req.body?.active) === 'true',
        wallIds,
      }, req.multiwallAdmin.id);
      await writeAudit(req.multiwallAdmin, 'admin_user.edit', {
        targetAdminUserId: updated.id,
        details: { username: updated.username, role: updated.role, active: updated.active, wall_ids: wallIds },
      });
      return redirectUsers(res, { notice: `Updated ${updated.username}.` });
    } catch (error) {
      return redirectUsers(res, { error: error?.message || 'Could not update user.' });
    }
  });

  app.get('/admin/walls', requireAdmin, async (req, res, next) => {
    if (req.multiwallAdmin.role === 'owner') return next();
    try {
      const walls = await listAssignedWalls(req.multiwallAdmin.id);
      return res.type('html').send(moderatorWallsPage({ walls, admin: req.multiwallAdmin, csrf: req.multiwallAdmin.csrf }));
    } catch (error) { return next(error); }
  });

  app.get('/admin/reports', requireAdmin, async (req, res, next) => {
    if (req.multiwallAdmin.role === 'owner') return next();
    try {
      const reports = await listAssignedReports(req.multiwallAdmin.id);
      return res.type('html').send(moderatorReportsPage({
        reports,
        admin: req.multiwallAdmin,
        csrf: req.multiwallAdmin.csrf,
        notice: clean(req.query?.notice),
        error: clean(req.query?.error),
      }));
    } catch (error) { return next(error); }
  });

  app.post('/admin/reports/:postId/remove', requireAdmin, requireCsrf, async (req, res, next) => {
    if (req.multiwallAdmin.role === 'owner') return next();
    try {
      const post = await moderateAssignedPost(req.multiwallAdmin, req.params.postId, 'remove');
      return redirectReports(res, { notice: `Removed reported post from ${post.wall_name}.` });
    } catch (error) {
      return redirectReports(res, { error: error?.message || 'Could not remove post.' });
    }
  });

  app.post('/admin/reports/:postId/keep', requireAdmin, requireCsrf, async (req, res, next) => {
    if (req.multiwallAdmin.role === 'owner') return next();
    try {
      const post = await moderateAssignedPost(req.multiwallAdmin, req.params.postId, 'keep');
      return redirectReports(res, { notice: `Kept reported post on ${post.wall_name} and cleared its reports.` });
    } catch (error) {
      return redirectReports(res, { error: error?.message || 'Could not keep post.' });
    }
  });
}
