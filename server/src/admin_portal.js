import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { hashToken, makeToken } from './auth.js';
import {
  hashAdminPassword,
  normalizeAdminUsername,
  validateAdminPassword,
  verifyAdminPassword,
} from './admin_auth.js';
import { pool } from './db.js';

const COOKIE_NAME = 'the_wall_admin';
const DEFAULT_SESSION_HOURS = 12;
const VALID_ROLES = new Set(['owner', 'moderator']);

function cleanBody(value) {
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

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function roleLabel(role) {
  return role === 'owner' ? 'Main Admin' : 'Moderator';
}

function sessionHours() {
  const parsed = Number(process.env.ADMIN_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 168) : DEFAULT_SESSION_HOURS;
}

function parseCookies(req) {
  const raw = req.get('cookie') || '';
  const cookies = {};
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_) {
      cookies[key] = value;
    }
  }
  return cookies;
}

function setSessionCookie(req, res, token) {
  const maxAge = Math.round(sessionHours() * 60 * 60);
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/admin',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/admin',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function csrfToken(rawSessionToken) {
  return hashToken(`admin-csrf:${rawSessionToken}`);
}

async function createAdminSession(req, user) {
  const rawToken = makeToken(48);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60 * 1000);
  const userAgent = (req.get('user-agent') || '').slice(0, 500);
  const result = await pool.query(
    `insert into admin_sessions (admin_user_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, $4)
     returning id`,
    [user.id, tokenHash, expiresAt, userAgent],
  );
  return { rawToken, sessionId: result.rows[0].id };
}

async function requireBrowserAdmin(req, res, next) {
  try {
    const rawToken = parseCookies(req)[COOKIE_NAME] || '';
    if (!rawToken) {
      const nextPath = req.method === 'GET' ? req.originalUrl : '/admin/walls';
      return res.redirect(303, `/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
    const tokenHash = hashToken(rawToken);
    const result = await pool.query(
      `update admin_sessions s
          set last_seen_at = now()
         from admin_users u
        where s.token_hash = $1
          and s.admin_user_id = u.id
          and s.expires_at > now()
          and u.active = true
      returning s.id as session_id, s.admin_user_id,
                u.username, u.display_name, u.role, u.wall_id, u.must_change_password`,
      [tokenHash],
    );
    if (result.rowCount === 0) {
      clearSessionCookie(req, res);
      const nextPath = req.method === 'GET' ? req.originalUrl : '/admin/walls';
      return res.redirect(303, `/admin/login?next=${encodeURIComponent(nextPath)}`);
    }
    const row = result.rows[0];
    req.adminSession = {
      id: row.session_id,
      raw: rawToken,
      csrf: csrfToken(rawToken),
      user: {
        id: row.admin_user_id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        wallId: row.wall_id,
        mustChangePassword: row.must_change_password,
      },
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  const expected = req.adminSession?.csrf || '';
  const supplied = cleanBody(req.body?._csrf);
  if (!expected || supplied !== expected) {
    return res.status(403).type('html').send(messagePage({
      title: 'Request expired',
      message: 'That admin form is no longer valid. Go back and try again.',
      actionHref: '/admin/walls',
      actionLabel: 'Back to Walls',
    }));
  }
  return next();
}

function canManageWalls(user) {
  return user?.role === 'owner';
}

function canModerate(user) {
  return user?.role === 'owner' || user?.role === 'moderator';
}

function requireWallManager(req, res, next) {
  if (!canManageWalls(req.adminSession?.user)) {
    return res.status(403).type('html').send(messagePage({
      title: 'Main Admin access required',
      message: 'Moderators can review their assigned Wall and reported posts, but cannot change Wall configuration.',
      actionHref: '/admin/walls',
      actionLabel: 'Back to Walls',
    }));
  }
  return next();
}

function requireModerator(req, res, next) {
  if (!canModerate(req.adminSession?.user)) return res.sendStatus(403);
  return next();
}

function requireOwner(req, res, next) {
  if (req.adminSession?.user?.role !== 'owner') {
    return res.status(403).type('html').send(messagePage({
      title: 'Main Admin access required',
      message: 'Only the Main Admin can manage users and view the full audit log.',
      actionHref: '/admin/walls',
      actionLabel: 'Back to Walls',
    }));
  }
  return next();
}

async function writeAudit(user, action, {
  wallId = null,
  wallName = null,
  targetAdminUserId = null,
  details = {},
} = {}) {
  if (!user) return;
  try {
    await pool.query(
      `insert into admin_audit_log
         (admin_user_id, username_snapshot, action, wall_id, wall_name, target_admin_user_id, details)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [user.id, user.username, action, wallId, wallName, targetAdminUserId, JSON.stringify(details)],
    );
  } catch (error) {
    console.error('[admin-audit]', error);
  }
}

function validateWallFields(displayName, locationHint) {
  if (!displayName || displayName.length > 80) throw new Error('Wall name must be between 1 and 80 characters.');
  if (locationHint.length > 120) throw new Error('Location must be 120 characters or fewer.');
}

function validateAdminFields(username, displayName, role) {
  if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
    throw new Error('Username must be 3–50 characters using letters, numbers, dot, dash or underscore.');
  }
  if (!displayName || displayName.length > 80) throw new Error('Display name must be between 1 and 80 characters.');
  if (!VALID_ROLES.has(role)) throw new Error('Invalid admin role.');
}

async function ensureWallExists(wallId) {
  if (!wallId) throw new Error('Choose the Wall this Moderator owns.');
  const result = await pool.query(`select id from walls where id = $1 limit 1`, [wallId]);
  if (result.rowCount === 0) throw new Error('The selected Wall no longer exists.');
}

async function createWall(displayName, locationHint) {
  validateWallFields(displayName, locationHint);
  const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
  const token = makeToken(36);
  const tokenHash = hashToken(token);
  const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint)
       values ($1, $2, $3)
       returning id, slug, display_name, location_hint, active, created_at`,
      [slug, displayName, locationHint],
    );
    await client.query(
      `insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true)`,
      [wallResult.rows[0].id, tokenHash],
    );
    await client.query('commit');
    return { ...wallResult.rows[0], nfc_url: `${appBase}/t/${token}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function listWalls(user) {
  if (user.role === 'moderator' && !user.wallId) return [];
  const params = [];
  let where = '';
  if (user.role === 'moderator') {
    params.push(user.wallId);
    where = 'where w.id = $1';
  }
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            count(distinct v.session_id)::int as discovered_by,
            count(distinct p.id)::int as post_count
       from walls w
       left join wall_visits v on v.wall_id = w.id
       left join wall_posts p on p.wall_id = w.id and p.hidden_at is null
       ${where}
      group by w.id
      order by w.created_at desc`,
    params,
  );
  return result.rows;
}

async function listAllWalls() {
  const result = await pool.query(
    `select id, display_name, location_hint, active from walls order by display_name asc`,
  );
  return result.rows;
}

async function getWall(wallId) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            count(distinct v.session_id)::int as discovered_by,
            count(distinct p.id)::int as post_count
       from walls w
       left join wall_visits v on v.wall_id = w.id
       left join wall_posts p on p.wall_id = w.id and p.hidden_at is null
      where w.id = $1
      group by w.id`,
    [wallId],
  );
  return result.rows[0] || null;
}

async function getWallForUser(user, wallId) {
  if (user.role === 'owner') return getWall(wallId);
  if (!user.wallId || String(user.wallId) !== String(wallId)) return null;
  return getWall(wallId);
}

async function editWall(wallId, displayName, locationHint) {
  validateWallFields(displayName, locationHint);
  const result = await pool.query(
    `update walls set display_name = $2, location_hint = $3
      where id = $1
      returning id, slug, display_name, location_hint, active, created_at`,
    [wallId, displayName, locationHint],
  );
  if (result.rowCount === 0) throw new Error('Wall not found.');
  return result.rows[0];
}

async function setWallActive(wallId, active) {
  const result = await pool.query(
    `update walls set active = $2 where id = $1 returning id, display_name, active`,
    [wallId, active],
  );
  if (result.rowCount === 0) throw new Error('Wall not found.');
  return result.rows[0];
}

async function replaceNfc(wallId) {
  const token = makeToken(36);
  const tokenHash = hashToken(token);
  const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const wallResult = await client.query(
      `select id, slug, display_name, location_hint from walls where id = $1 for update`,
      [wallId],
    );
    if (wallResult.rowCount === 0) throw new Error('Wall not found.');
    await client.query(`update wall_tags set active = false where wall_id = $1 and active = true`, [wallId]);
    await client.query(
      `insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true)`,
      [wallId, tokenHash],
    );
    await client.query('commit');
    return { ...wallResult.rows[0], nfc_url: `${appBase}/t/${token}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function clearWallMessages(wallId) {
  const wall = await getWall(wallId);
  if (!wall) throw new Error('Wall not found.');
  const result = await pool.query(`delete from wall_posts where wall_id = $1 returning id`, [wallId]);
  return { wall, deletedCount: result.rowCount };
}

async function deleteWall(wallId) {
  const wall = await getWall(wallId);
  if (!wall) throw new Error('Wall not found.');
  await pool.query(`delete from walls where id = $1`, [wallId]);
  return wall;
}

async function getAdminUserByUsername(username) {
  const result = await pool.query(
    `select id, username, display_name, password_hash, role, wall_id, active, must_change_password,
            created_at, last_login_at
       from admin_users where username = $1 limit 1`,
    [username],
  );
  return result.rows[0] || null;
}

async function getAdminUser(userId) {
  const result = await pool.query(
    `select u.id, u.username, u.display_name, u.role, u.wall_id, u.active, u.must_change_password,
            u.created_at, u.last_login_at, w.display_name as wall_name
       from admin_users u
       left join walls w on w.id = u.wall_id
      where u.id = $1 limit 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function listAdminUsers() {
  const result = await pool.query(
    `select u.id, u.username, u.display_name, u.role, u.wall_id, u.active, u.must_change_password,
            u.created_at, u.last_login_at, w.display_name as wall_name
       from admin_users u
       left join walls w on w.id = u.wall_id
      order by case u.role when 'owner' then 1 else 2 end, u.username`,
  );
  return result.rows;
}

async function createAdminUser({ username, displayName, password, wallId }) {
  const normalized = normalizeAdminUsername(username);
  validateAdminFields(normalized, displayName, 'moderator');
  validateAdminPassword(password);
  await ensureWallExists(wallId);
  const passwordHash = hashAdminPassword(password);
  const result = await pool.query(
    `insert into admin_users
       (username, display_name, password_hash, role, wall_id, active, must_change_password)
     values ($1, $2, $3, 'moderator', $4, true, true)
     returning id, username, display_name, role, wall_id, active`,
    [normalized, displayName, passwordHash, wallId],
  );
  return result.rows[0];
}

async function activeOwnerCount() {
  const result = await pool.query(`select count(*)::int as count from admin_users where role = 'owner' and active = true`);
  return result.rows[0].count;
}

async function updateAdminUser(target, { displayName, active, wallId }, currentUserId) {
  const role = target.role === 'owner' ? 'owner' : 'moderator';
  validateAdminFields(target.username, displayName, role);
  if (target.id === currentUserId && !active) throw new Error('You cannot deactivate the Main Admin account you are currently using.');
  if (role === 'owner' && target.active && !active && await activeOwnerCount() <= 1) {
    throw new Error('At least one active Main Admin account is required.');
  }
  const assignedWallId = role === 'moderator' ? wallId : null;
  if (role === 'moderator') await ensureWallExists(assignedWallId);
  const result = await pool.query(
    `update admin_users
        set display_name = $2, role = $3, wall_id = $4, active = $5, updated_at = now()
      where id = $1
      returning id, username, display_name, role, wall_id, active, must_change_password`,
    [target.id, displayName, role, assignedWallId, active],
  );
  if (!active) await pool.query(`delete from admin_sessions where admin_user_id = $1`, [target.id]);
  return result.rows[0];
}

async function setAdminPassword(userId, password, { mustChange = false, keepSessionId = null } = {}) {
  validateAdminPassword(password);
  const passwordHash = hashAdminPassword(password);
  await pool.query(
    `update admin_users
        set password_hash = $2, must_change_password = $3, updated_at = now()
      where id = $1`,
    [userId, passwordHash, mustChange],
  );
  if (keepSessionId) {
    await pool.query(`delete from admin_sessions where admin_user_id = $1 and id <> $2`, [userId, keepSessionId]);
  } else {
    await pool.query(`delete from admin_sessions where admin_user_id = $1`, [userId]);
  }
}

async function listAuditLog() {
  const result = await pool.query(
    `select id, username_snapshot, action, wall_name, details, created_at
       from admin_audit_log order by created_at desc limit 250`,
  );
  return result.rows;
}

async function listReportedPosts(user) {
  if (user.role === 'moderator' && !user.wallId) return [];
  const params = [];
  let where = '';
  if (user.role === 'moderator') {
    params.push(user.wallId);
    where = 'where p.wall_id = $1';
  }
  const result = await pool.query(
    `select p.id, p.wall_id, p.parent_id, p.body, p.created_at, p.hidden_at,
            w.display_name as wall_name, w.location_hint,
            count(r.id)::int as report_count,
            max(r.created_at) as last_reported_at
       from post_reports r
       join wall_posts p on p.id = r.post_id
       join walls w on w.id = p.wall_id
       ${where}
      group by p.id, w.id
      order by max(r.created_at) desc`,
    params,
  );
  return result.rows;
}

async function getReportedPostForUser(client, user, postId) {
  const params = [postId];
  let access = '';
  if (user.role === 'moderator') {
    if (!user.wallId) return null;
    params.push(user.wallId);
    access = 'and p.wall_id = $2';
  }
  const result = await client.query(
    `select p.id, p.wall_id, p.body, p.hidden_at, w.display_name as wall_name,
            count(r.id)::int as report_count
       from wall_posts p
       join walls w on w.id = p.wall_id
       join post_reports r on r.post_id = p.id
      where p.id = $1 ${access}
      group by p.id, w.id`,
    params,
  );
  return result.rows[0] || null;
}

async function removeReportedPost(user, postId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const post = await getReportedPostForUser(client, user, postId);
    if (!post) throw new Error('Reported post not found or not assigned to you.');
    await client.query(`delete from wall_posts where id = $1`, [postId]);
    await client.query('commit');
    return post;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function keepReportedPost(user, postId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const post = await getReportedPostForUser(client, user, postId);
    if (!post) throw new Error('Reported post not found or not assigned to you.');
    await client.query(`update wall_posts set hidden_at = null where id = $1`, [postId]);
    await client.query(`delete from post_reports where post_id = $1`, [postId]);
    await client.query('commit');
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)} · The Wall Admin</title><style>
:root{--ink:#181512;--paper:#eee4d3;--muted:#776e61;--line:#c9bda9;--red:#8d352d;--green:#496443;--bg:#d8ccb7}*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#d9cdb9,#bfb29b);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1180px;margin:0 auto;min-height:100vh;padding:24px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:16px}.brand{display:flex;align-items:center;gap:12px}.mark{width:46px;height:46px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-weight:1000;border-radius:7px;letter-spacing:-2px}.brand h1{font-size:22px;margin:0;font-weight:950}.brand small{display:block;color:var(--muted);font-weight:700}.account{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800}.account form{margin:0}.link-button{border:0;background:transparent;text-decoration:underline;padding:4px;cursor:pointer;color:var(--ink)}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}nav a{padding:8px 11px;background:rgba(246,239,226,.6);border:1px solid rgba(65,55,43,.18);text-decoration:none;font-size:12px;font-weight:900}.panel{background:rgba(246,239,226,.92);border:1px solid rgba(65,55,43,.22);box-shadow:0 10px 30px rgba(46,37,27,.12);padding:22px;margin-bottom:18px}.panel h2,.panel h3{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{display:flex;flex-direction:column;gap:7px}.field label{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.7px}.field input,.field select{width:100%;border:1px solid #918575;background:#fffaf0;padding:12px 13px;font:inherit}.actions{display:flex;gap:9px;flex-wrap:wrap}.button,button.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:10px 14px;text-decoration:none;font-weight:900;font-size:12px;letter-spacing:.35px;cursor:pointer}.button.secondary{background:transparent;color:var(--ink)}.button.warn{background:var(--red);border-color:var(--red)}.button.good{background:var(--green);border-color:var(--green)}.wall-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wall-card{background:rgba(245,237,223,.88);border-left:5px solid var(--ink);padding:18px;box-shadow:0 4px 13px rgba(35,28,20,.08)}.wall-card.inactive{opacity:.72;border-left-color:var(--red)}.wall-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.wall-card h3{font-size:20px;margin:0 0 4px;font-weight:950}.location{color:var(--muted);font-weight:750}.badge{font-size:10px;font-weight:950;letter-spacing:.6px;text-transform:uppercase;border:1px solid currentColor;padding:5px 7px}.badge.active{color:var(--green)}.badge.inactive{color:var(--red)}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.metric{border-top:1px solid var(--line);padding-top:8px}.metric strong{display:block;font-size:17px}.metric span{font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:900;letter-spacing:.5px}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.notice,.error,.warning{padding:12px 14px;margin-bottom:16px;font-weight:800}.notice{background:#dce6d5;border-left:4px solid var(--green)}.error{background:#efd5d0;border-left:4px solid var(--red)}.warning{background:#f3dfae;border-left:4px solid #9a6a18}.danger-zone{border-left:5px solid var(--red)}.nfc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;width:100%;padding:13px;background:#fffaf0;border:1px solid #968b7a;font-size:14px}.help{color:var(--muted);line-height:1.5}.login-shell{max-width:430px;margin:10vh auto;padding:20px}.login-title{text-align:center;margin-bottom:20px}.login-title .mark{margin:0 auto 12px;width:68px;height:68px;font-size:22px}.login-title h1{margin:0;font-size:30px;font-weight:1000}.login-title p{color:var(--muted)}.stack{display:flex;flex-direction:column;gap:14px}.full{width:100%}.back{display:inline-block;margin-bottom:14px;color:var(--muted);font-weight:800;text-decoration:none}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;background:rgba(245,237,223,.7)}.table th,.table td{padding:11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.table th{font-size:10px;text-transform:uppercase;letter-spacing:.6px}.role{font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.5px}.audit-details{max-width:460px;white-space:normal;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:var(--muted)}.report-list{display:flex;flex-direction:column;gap:10px}.report-card{background:#fffaf0;border:1px solid var(--line);border-left:4px solid var(--red);padding:15px}.report-card.auto-hidden{opacity:.82}.report-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.report-wall{font-size:12px;font-weight:900}.report-count{font-size:10px;font-weight:950;color:var(--red);text-transform:uppercase}.report-body{margin:12px 0;font-size:16px;line-height:1.42;font-weight:700;white-space:pre-wrap}.report-meta{font-size:10px;color:var(--muted);margin-bottom:10px}.report-actions{display:flex;gap:8px;flex-wrap:wrap}
@media(max-width:760px){.shell{padding:16px}.topbar{align-items:flex-start}.account{flex-direction:column;align-items:flex-end}.grid,.wall-grid{grid-template-columns:1fr}.meta{grid-template-columns:repeat(3,1fr)}.panel{padding:17px}.wall-card{padding:16px}.actions .button,.actions button.button{flex:1 1 44%}.table{min-width:760px}.report-top{gap:8px}.report-body{font-size:15px}}
</style></head><body>${body}</body></html>`;
}

function withCsrf(html, csrf) {
  return html.replaceAll('__CSRF__', escapeHtml(csrf || ''));
}

function loginPage({ error = null, next = '/admin/walls' } = {}) {
  const body = `<div class="login-shell"><div class="login-title"><div class="mark">TW</div><h1>The Wall Admin</h1><p>Manage Walls, plaques and moderation.</p></div><div class="panel">${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/login" class="stack"><input type="hidden" name="next" value="${escapeHtml(next)}"><div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div><button class="button full" type="submit">Log in</button></form></div></div>`;
  return layout({ title: 'Login', body });
}

function shellBody({ user, csrf, content, title = 'Walls' }) {
  const body = `<div class="shell"><div class="topbar"><div class="brand"><div class="mark">TW</div><div><h1>The Wall Admin</h1><small>Physical Wall management</small></div></div><div class="account"><span>${escapeHtml(user.displayName || user.username)} · ${escapeHtml(roleLabel(user.role))}</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="__CSRF__"><button class="link-button" type="submit">Log out</button></form></div></div>${navFor(user)}${content}</div>`;
  return withCsrf(layout({ title, body }), csrf);
}

function messagePage({ title, message, actionHref, actionLabel }) {
  const body = `<div class="login-shell"><div class="panel"><h2>${escapeHtml(title)}</h2><p class="help">${escapeHtml(message)}</p><a class="button" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></div></div>`;
  return layout({ title, body });
}

function dashboardPage({ walls, user, csrf, notice = null, error = null }) {
  const manager = canManageWalls(user);
  const cards = walls.length === 0
    ? `<div class="panel"><p>${user.role === 'moderator' ? 'No Wall is assigned to this Moderator yet.' : 'No Walls have been created yet.'}</p></div>`
    : `<div class="wall-grid">${walls.map((wall) => {
      const managerActions = manager
        ? `<a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/edit">Edit</a><form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/status"><input type="hidden" name="_csrf" value="__CSRF__"><input type="hidden" name="active" value="${wall.active ? 'false' : 'true'}"><button class="button ${wall.active ? 'secondary' : 'good'}" type="submit">${wall.active ? 'Deactivate' : 'Reactivate'}</button></form><a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/replace-nfc">Replace NFC</a><a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/clear">Clear messages</a><a class="button warn" href="/admin/walls/${encodeURIComponent(wall.id)}/delete">Delete</a>`
        : `<a class="button secondary" href="/admin/reports">Review reports</a>`;
      return `<article class="wall-card ${wall.active ? '' : 'inactive'}"><div class="wall-head"><div><h3>${escapeHtml(wall.display_name)}</h3><div class="location">${escapeHtml(wall.location_hint || 'No location set')}</div></div><span class="badge ${wall.active ? 'active' : 'inactive'}">${wall.active ? 'Active' : 'Inactive'}</span></div><div class="meta"><div class="metric"><strong>${escapeHtml(wall.post_count)}</strong><span>Messages</span></div><div class="metric"><strong>${escapeHtml(wall.discovered_by)}</strong><span>Visitors</span></div><div class="metric"><strong>${escapeHtml(formatDate(wall.created_at))}</strong><span>Created</span></div></div><div class="code">Public ID: ${escapeHtml(wall.slug)}</div><div class="actions" style="margin-top:15px">${managerActions}</div></article>`;
    }).join('')}</div>`;
  const createPanel = manager
    ? `<section class="panel"><h2>Create a Wall</h2><p class="help">Create the place first, then program the one-time NFC URL that appears onto the physical plaque.</p><form method="post" action="/admin/walls/create"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required placeholder="9A Raworth"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" placeholder="Singleton NSW"></div></div><div class="actions" style="margin-top:14px"><button class="button" type="submit">Create Wall + NFC URL</button></div></form></section>`
    : '';
  const moderatorNote = user.role === 'moderator'
    ? `<div class="notice">Moderator access is limited to your assigned Wall. Use <a href="/admin/reports">Reports</a> to review reported posts.</div>`
    : '';
  const changeWarning = user.mustChangePassword
    ? `<div class="warning">This account is still using a temporary password. <a href="/admin/account/password">Change it now</a>.</div>`
    : '';
  const content = `${changeWarning}${moderatorNote}${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}${createPanel}<section><h2>Walls <span style="color:var(--muted);font-weight:700">(${walls.length})</span></h2>${cards}</section>`;
  return shellBody({ user, csrf, content });
}

function editPage({ wall, user, csrf, error = null }) {
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel"><h2>Edit Wall</h2>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/edit"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required value="${escapeHtml(wall.display_name)}"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" value="${escapeHtml(wall.location_hint || '')}"></div></div><p class="code">Public ID: ${escapeHtml(wall.slug)}</p><div class="actions"><button class="button" type="submit">Save changes</button><a class="button secondary" href="/admin/walls">Cancel</a></div></form></section>`;
  return shellBody({ user, csrf, content, title: 'Edit Wall' });
}

function confirmPage({ wall, user, csrf, kind }) {
  const config = {
    'replace-nfc': { title: 'Replace NFC plaque URL', description: 'This keeps the Wall, messages and history, but permanently invalidates every previous NFC plaque URL for this Wall.', word: 'REPLACE', button: 'Generate replacement NFC URL' },
    clear: { title: 'Clear all messages', description: 'This permanently deletes every message and reply from this Wall. The Wall and NFC plaque stay active.', word: 'CLEAR', button: 'Clear messages' },
    delete: { title: 'Delete Wall', description: 'This permanently deletes the Wall, messages, visit history and NFC association. The existing plaque will stop working.', word: 'DELETE', button: 'Delete Wall permanently' },
  }[kind];
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel danger-zone"><h2>${config.title}</h2><h3>${escapeHtml(wall.display_name)}</h3><p class="help">${config.description}</p><form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/${kind}" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="field"><label>Type ${config.word} to confirm</label><input name="confirmation" autocomplete="off" required></div><div class="actions"><button class="button warn" type="submit">${config.button}</button><a class="button secondary" href="/admin/walls">Cancel</a></div></form></section>`;
  return shellBody({ user, csrf, content, title: config.title });
}

function nfcResultPage({ wall, user, csrf, replacement = false }) {
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel"><h2>${replacement ? 'Replacement NFC URL ready' : 'Wall created'}</h2><h3>${escapeHtml(wall.display_name)}</h3><p class="help">Program this exact URL onto the NFC tag. <strong>Save it now.</strong> Only the hash is stored, so this raw URL cannot be displayed again later.</p><div class="field"><label>NFC URL</label><input class="nfc" readonly value="${escapeHtml(wall.nfc_url)}"></div><p><a href="${escapeHtml(wall.nfc_url)}">Open NFC URL to test</a></p><div class="actions"><a class="button" href="/admin/walls">Done — back to Walls</a></div></section>`;
  return shellBody({ user, csrf, content, title: 'NFC URL' });
}

function passwordPage({ user, csrf, notice = null, error = null }) {
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Change password</h2><p class="help">Changing your password signs out every other browser session for this account.</p><form method="post" action="/admin/account/password" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="field"><label>Current password</label><input name="current_password" type="password" autocomplete="current-password" required></div><div class="grid"><div class="field"><label>New password</label><input name="new_password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Confirm new password</label><input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></div></div><div><button class="button" type="submit">Change password</button></div></form></section>`;
  return shellBody({ user, csrf, content, title: 'Password' });
}

function wallOptions(walls, selectedId = null) {
  if (!walls.length) return '<option value="" disabled selected>Create a Wall first</option>';
  return walls.map((wall) => `<option value="${escapeHtml(wall.id)}" ${selectedId && String(selectedId) === String(wall.id) ? 'selected' : ''}>${escapeHtml(wall.display_name)}${wall.location_hint ? ` — ${escapeHtml(wall.location_hint)}` : ''}${wall.active ? '' : ' (Inactive)'}</option>`).join('');
}

function usersPage({ users, walls, user, csrf, notice = null, error = null }) {
  const rows = users.map((item) => {
    const wallLine = item.role === 'owner' ? 'All Walls' : (item.wall_name || 'No Wall assigned');
    return `<tr><td><strong>${escapeHtml(item.display_name)}</strong><div class="code">${escapeHtml(item.username)}</div><div class="code">Wall: ${escapeHtml(wallLine)}</div></td><td><span class="role">${escapeHtml(roleLabel(item.role))}</span></td><td>${item.active ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>'}${item.must_change_password ? '<div class="code">Temporary password</div>' : ''}</td><td>${escapeHtml(formatDate(item.last_login_at))}</td><td><a class="button secondary" href="/admin/users/${encodeURIComponent(item.id)}/edit">Edit</a> <a class="button secondary" href="/admin/users/${encodeURIComponent(item.id)}/password">Reset password</a></td></tr>`;
  }).join('');
  const content = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Add admin user</h2><form method="post" action="/admin/users/create" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Username</label><input name="username" maxlength="50" required placeholder="venue.manager"></div><div class="field"><label>Display name</label><input name="display_name" maxlength="80" required placeholder="Venue Manager"></div><div class="field"><label>Initial password</label><input name="password" type="password" minlength="8" required></div><div class="field"><label>Assigned Wall</label><select name="wall_id" required>${wallOptions(walls)}</select></div></div><input type="hidden" name="role" value="moderator"><p class="help">New users are Moderators. They can only see the assigned Wall and review its reported posts.</p><div><button class="button" type="submit" ${walls.length ? '' : 'disabled'}>Create Moderator</button></div></form></section><section class="panel"><h2>Admin users</h2><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div><p class="help"><strong>Main Admin:</strong> full access to every Wall, user management, reports and audit. <strong>Moderator:</strong> assigned Wall only; can review reported posts and choose Remove or Keep.</p></section>`;
  return shellBody({ user, csrf, content, title: 'Users' });
}

function userEditPage({ target, walls, user, csrf, error = null }) {
  const wallField = target.role === 'moderator'
    ? `<div class="field"><label>Assigned Wall</label><select name="wall_id" required>${wallOptions(walls, target.wall_id)}</select></div>`
    : `<div class="field"><label>Access</label><input value="All Walls" disabled></div>`;
  const content = `<a class="back" href="/admin/users">← Back to Users</a><section class="panel"><h2>Edit admin user</h2>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/users/${encodeURIComponent(target.id)}/edit" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Username</label><input value="${escapeHtml(target.username)}" disabled></div><div class="field"><label>Role</label><input value="${escapeHtml(roleLabel(target.role))}" disabled></div><div class="field"><label>Display name</label><input name="display_name" maxlength="80" required value="${escapeHtml(target.display_name)}"></div>${wallField}</div><div class="field"><label>Status</label><select name="active"><option value="true" ${target.active ? 'selected' : ''}>Active</option><option value="false" ${!target.active ? 'selected' : ''}>Inactive</option></select></div><div class="actions"><button class="button" type="submit">Save user</button><a class="button secondary" href="/admin/users">Cancel</a></div></form></section>`;
  return shellBody({ user, csrf, content, title: 'Edit User' });
}

function resetPasswordPage({ target, user, csrf, error = null }) {
  const content = `<a class="back" href="/admin/users">← Back to Users</a><section class="panel"><h2>Reset password</h2><h3>${escapeHtml(target.display_name)} · ${escapeHtml(target.username)}</h3>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<p class="help">This signs the user out everywhere and marks the new password as temporary.</p><form method="post" action="/admin/users/${encodeURIComponent(target.id)}/password" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="field"><label>Temporary password</label><input name="password" type="password" minlength="8" required></div><div><button class="button warn" type="submit">Reset password</button></div></form></section>`;
  return shellBody({ user, csrf, content, title: 'Reset Password' });
}

function reportsPage({ reports, user, csrf, notice = null, error = null }) {
  const items = reports.length
    ? `<div class="report-list">${reports.map((item) => `<article class="report-card ${item.hidden_at ? 'auto-hidden' : ''}"><div class="report-top"><div><div class="report-wall">${escapeHtml(item.wall_name)}</div><div class="code">${escapeHtml(item.location_hint || '')}</div></div><div class="report-count">${escapeHtml(item.report_count)} report${Number(item.report_count) === 1 ? '' : 's'}${item.hidden_at ? ' · auto-hidden' : ''}</div></div><div class="report-body">${escapeHtml(item.body)}</div><div class="report-meta">${item.parent_id ? 'Reply' : 'Post'} · posted ${escapeHtml(formatDate(item.created_at))} · last reported ${escapeHtml(formatDate(item.last_reported_at))}</div><div class="report-actions"><form method="post" action="/admin/reports/${encodeURIComponent(item.id)}/remove"><input type="hidden" name="_csrf" value="__CSRF__"><button class="button warn" type="submit">Remove post</button></form><form method="post" action="/admin/reports/${encodeURIComponent(item.id)}/keep"><input type="hidden" name="_csrf" value="__CSRF__"><button class="button secondary" type="submit">Keep post</button></form></div></article>`).join('')}</div>`
    : '<div class="panel"><p>No reported posts need review.</p></div>';
  const scope = user.role === 'moderator' ? 'Only reports from your assigned Wall are shown.' : 'Reports from all Walls are shown.';
  const content = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Reported posts</h2><p class="help">${scope} Three reports automatically hide a post while it waits for review. <strong>Remove</strong> permanently deletes it; <strong>Keep</strong> clears its reports and restores it if it was auto-hidden.</p></section>${items}`;
  return shellBody({ user, csrf, content, title: 'Reports' });
}

function auditPage({ entries, user, csrf }) {
  const rows = entries.map((entry) => `<tr><td>${escapeHtml(formatDate(entry.created_at))}</td><td>${escapeHtml(entry.username_snapshot)}</td><td><strong>${escapeHtml(entry.action)}</strong></td><td>${escapeHtml(entry.wall_name || '—')}</td><td><div class="audit-details">${escapeHtml(JSON.stringify(entry.details || {}))}</div></td></tr>`).join('');
  const content = `<section class="panel"><h2>Audit log</h2><p class="help">Latest 250 admin actions. This is intentionally append-only through the portal.</p><div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Wall</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  return shellBody({ user, csrf, content, title: 'Audit Log' });
}

function redirectDashboard(res, { notice = null, error = null } = {}) {
  const params = new URLSearchParams();
  if (notice) params.set('notice', notice);
  if (error) params.set('error', error);
  return res.redirect(303, `/admin/walls${params.toString() ? `?${params}` : ''}`);
}

function redirectUsers(res, { notice = null, error = null } = {}) {
  const params = new URLSearchParams();
  if (notice) params.set('notice', notice);
  if (error) params.set('error', error);
  return res.redirect(303, `/admin/users${params.toString() ? `?${params}` : ''}`);
}

function redirectReports(res, { notice = null, error = null } = {}) {
  const params = new URLSearchParams();
  if (notice) params.set('notice', notice);
  if (error) params.set('error', error);
  return res.redirect(303, `/admin/reports${params.toString() ? `?${params}` : ''}`);
}

export function mountAdminPortal(app) {
  const router = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  const portalLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 500, standardHeaders: 'draft-8', legacyHeaders: false });
  router.use(portalLimiter);

  router.get('/login', async (req, res, next) => {
    try {
      const raw = parseCookies(req)[COOKIE_NAME] || '';
      if (raw) {
        const found = await pool.query(`select 1 from admin_sessions where token_hash = $1 and expires_at > now()`, [hashToken(raw)]);
        if (found.rowCount > 0) return res.redirect(303, '/admin/walls');
      }
      const nextPath = cleanBody(req.query?.next) || '/admin/walls';
      return res.type('html').send(loginPage({ next: nextPath }));
    } catch (error) { return next(error); }
  });

  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      const username = normalizeAdminUsername(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const nextPath = cleanBody(req.body?.next) || '/admin/walls';
      const user = await getAdminUserByUsername(username);
      if (!user || !user.active || !verifyAdminPassword(password, user.password_hash)) {
        return res.status(401).type('html').send(loginPage({ error: 'Incorrect username or password.', next: nextPath }));
      }
      await pool.query(`delete from admin_sessions where expires_at <= now()`);
      const session = await createAdminSession(req, user);
      await pool.query(`update admin_users set last_login_at = now() where id = $1`, [user.id]);
      await writeAudit({ id: user.id, username: user.username }, 'auth.login');
      setSessionCookie(req, res, session.rawToken);
      const safeNext = nextPath.startsWith('/admin/') ? nextPath : '/admin/walls';
      return res.redirect(303, safeNext);
    } catch (error) { return next(error); }
  });

  router.use(requireBrowserAdmin);

  router.post('/logout', requireCsrf, async (req, res) => {
    await writeAudit(req.adminSession.user, 'auth.logout');
    await pool.query(`delete from admin_sessions where id = $1`, [req.adminSession.id]);
    clearSessionCookie(req, res);
    return res.redirect(303, '/admin/login');
  });

  router.get('/', (_req, res) => res.redirect(303, '/admin/walls'));

  router.get('/walls', async (req, res, next) => {
    try {
      const walls = await listWalls(req.adminSession.user);
      return res.type('html').send(dashboardPage({ walls, user: req.adminSession.user, csrf: req.adminSession.csrf, notice: cleanBody(req.query?.notice), error: cleanBody(req.query?.error) }));
    } catch (error) { return next(error); }
  });

  router.post('/walls/create', requireCsrf, requireWallManager, async (req, res) => {
    try {
      const wall = await createWall(cleanBody(req.body?.display_name), cleanBody(req.body?.location_hint));
      await writeAudit(req.adminSession.user, 'wall.create', { wallId: wall.id, wallName: wall.display_name, details: { location: wall.location_hint, slug: wall.slug } });
      return res.status(201).type('html').send(nfcResultPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf }));
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not create Wall.' }); }
  });

  router.get('/walls/:wallId/edit', requireWallManager, async (req, res) => {
    const wall = await getWall(req.params.wallId);
    if (!wall) return res.sendStatus(404);
    return res.type('html').send(editPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf }));
  });

  router.post('/walls/:wallId/edit', requireCsrf, requireWallManager, async (req, res) => {
    try {
      const before = await getWall(req.params.wallId);
      const wall = await editWall(req.params.wallId, cleanBody(req.body?.display_name), cleanBody(req.body?.location_hint));
      await writeAudit(req.adminSession.user, 'wall.edit', { wallId: wall.id, wallName: wall.display_name, details: { before: before ? { name: before.display_name, location: before.location_hint } : null, after: { name: wall.display_name, location: wall.location_hint } } });
      return redirectDashboard(res, { notice: `Updated ${wall.display_name}.` });
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not update Wall.' }); }
  });

  router.post('/walls/:wallId/status', requireCsrf, requireWallManager, async (req, res) => {
    try {
      const active = cleanBody(req.body?.active).toLowerCase() === 'true';
      const wall = await setWallActive(req.params.wallId, active);
      await writeAudit(req.adminSession.user, active ? 'wall.activate' : 'wall.deactivate', { wallId: wall.id, wallName: wall.display_name });
      return redirectDashboard(res, { notice: `${wall.display_name} is now ${wall.active ? 'active' : 'inactive'}.` });
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not change Wall status.' }); }
  });

  router.get('/walls/:wallId/replace-nfc', requireWallManager, async (req, res) => {
    const wall = await getWall(req.params.wallId);
    if (!wall) return res.sendStatus(404);
    return res.type('html').send(confirmPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf, kind: 'replace-nfc' }));
  });

  router.get('/walls/:wallId/clear', requireWallManager, async (req, res) => {
    const wall = await getWall(req.params.wallId);
    if (!wall) return res.sendStatus(404);
    return res.type('html').send(confirmPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf, kind: 'clear' }));
  });

  router.get('/walls/:wallId/delete', requireWallManager, async (req, res) => {
    const wall = await getWall(req.params.wallId);
    if (!wall) return res.sendStatus(404);
    return res.type('html').send(confirmPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf, kind: 'delete' }));
  });

  router.post('/walls/:wallId/replace-nfc', requireCsrf, requireWallManager, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'REPLACE') return redirectDashboard(res, { error: 'Type REPLACE exactly to continue.' });
    try {
      const wall = await replaceNfc(req.params.wallId);
      await writeAudit(req.adminSession.user, 'wall.replace_nfc', { wallId: wall.id, wallName: wall.display_name });
      return res.type('html').send(nfcResultPage({ wall, user: req.adminSession.user, csrf: req.adminSession.csrf, replacement: true }));
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not replace NFC URL.' }); }
  });

  router.post('/walls/:wallId/clear', requireCsrf, requireWallManager, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'CLEAR') return redirectDashboard(res, { error: 'Type CLEAR exactly to continue.' });
    try {
      const result = await clearWallMessages(req.params.wallId);
      await writeAudit(req.adminSession.user, 'wall.clear_messages', { wallId: result.wall.id, wallName: result.wall.display_name, details: { deleted_count: result.deletedCount } });
      return redirectDashboard(res, { notice: `Cleared ${result.deletedCount} message${result.deletedCount === 1 ? '' : 's'} from ${result.wall.display_name}.` });
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not clear messages.' }); }
  });

  router.post('/walls/:wallId/delete', requireCsrf, requireWallManager, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'DELETE') return redirectDashboard(res, { error: 'Type DELETE exactly to continue.' });
    try {
      const wall = await deleteWall(req.params.wallId);
      await writeAudit(req.adminSession.user, 'wall.delete', { wallId: wall.id, wallName: wall.display_name, details: { slug: wall.slug } });
      return redirectDashboard(res, { notice: `Deleted ${wall.display_name}. Its old NFC plaque URL is now invalid.` });
    } catch (error) { return redirectDashboard(res, { error: error?.message || 'Could not delete Wall.' }); }
  });

  router.get('/reports', requireModerator, async (req, res, next) => {
    try {
      const reports = await listReportedPosts(req.adminSession.user);
      return res.type('html').send(reportsPage({ reports, user: req.adminSession.user, csrf: req.adminSession.csrf, notice: cleanBody(req.query?.notice), error: cleanBody(req.query?.error) }));
    } catch (error) { return next(error); }
  });

  router.post('/reports/:postId/remove', requireCsrf, requireModerator, async (req, res) => {
    try {
      const post = await removeReportedPost(req.adminSession.user, req.params.postId);
      await writeAudit(req.adminSession.user, 'report.remove_post', { wallId: post.wall_id, wallName: post.wall_name, details: { report_count: post.report_count } });
      return redirectReports(res, { notice: 'Reported post removed.' });
    } catch (error) { return redirectReports(res, { error: error?.message || 'Could not remove the reported post.' }); }
  });

  router.post('/reports/:postId/keep', requireCsrf, requireModerator, async (req, res) => {
    try {
      const post = await keepReportedPost(req.adminSession.user, req.params.postId);
      await writeAudit(req.adminSession.user, 'report.keep_post', { wallId: post.wall_id, wallName: post.wall_name, details: { cleared_reports: post.report_count } });
      return redirectReports(res, { notice: 'Post kept and its reports cleared.' });
    } catch (error) { return redirectReports(res, { error: error?.message || 'Could not keep the reported post.' }); }
  });

  router.get('/account/password', (req, res) => res.type('html').send(passwordPage({ user: req.adminSession.user, csrf: req.adminSession.csrf, notice: cleanBody(req.query?.notice), error: cleanBody(req.query?.error) })));

  router.post('/account/password', requireCsrf, async (req, res) => {
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    const confirmPassword = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
    try {
      const fullUser = await getAdminUserByUsername(req.adminSession.user.username);
      if (!fullUser || !verifyAdminPassword(currentPassword, fullUser.password_hash)) throw new Error('Current password is incorrect.');
      if (newPassword !== confirmPassword) throw new Error('The new passwords do not match.');
      await setAdminPassword(fullUser.id, newPassword, { mustChange: false, keepSessionId: req.adminSession.id });
      await writeAudit(req.adminSession.user, 'account.password_changed', { targetAdminUserId: fullUser.id });
      return res.redirect(303, '/admin/account/password?notice=Password%20changed%20successfully.');
    } catch (error) {
      return res.status(400).type('html').send(passwordPage({ user: req.adminSession.user, csrf: req.adminSession.csrf, error: error?.message || 'Could not change password.' }));
    }
  });

  router.get('/users', requireOwner, async (req, res, next) => {
    try {
      const [users, walls] = await Promise.all([listAdminUsers(), listAllWalls()]);
      return res.type('html').send(usersPage({ users, walls, user: req.adminSession.user, csrf: req.adminSession.csrf, notice: cleanBody(req.query?.notice), error: cleanBody(req.query?.error) }));
    } catch (error) { return next(error); }
  });

  router.post('/users/create', requireCsrf, requireOwner, async (req, res) => {
    try {
      const created = await createAdminUser({ username: req.body?.username, displayName: cleanBody(req.body?.display_name), password: typeof req.body?.password === 'string' ? req.body.password : '', wallId: cleanBody(req.body?.wall_id) });
      await writeAudit(req.adminSession.user, 'admin_user.create', { targetAdminUserId: created.id, wallId: created.wall_id, details: { username: created.username, role: created.role } });
      return redirectUsers(res, { notice: `Created Moderator ${created.username}. Their initial password is temporary.` });
    } catch (error) {
      const message = error?.code === '23505' ? 'That username already exists.' : (error?.message || 'Could not create user.');
      return redirectUsers(res, { error: message });
    }
  });

  router.get('/users/:userId/edit', requireOwner, async (req, res, next) => {
    try {
      const [target, walls] = await Promise.all([getAdminUser(req.params.userId), listAllWalls()]);
      if (!target) return res.sendStatus(404);
      return res.type('html').send(userEditPage({ target, walls, user: req.adminSession.user, csrf: req.adminSession.csrf }));
    } catch (error) { return next(error); }
  });

  router.post('/users/:userId/edit', requireCsrf, requireOwner, async (req, res) => {
    try {
      const target = await getAdminUser(req.params.userId);
      if (!target) throw new Error('Admin user not found.');
      const updated = await updateAdminUser(target, { displayName: cleanBody(req.body?.display_name), active: cleanBody(req.body?.active) === 'true', wallId: cleanBody(req.body?.wall_id) || null }, req.adminSession.user.id);
      await writeAudit(req.adminSession.user, 'admin_user.edit', { targetAdminUserId: updated.id, wallId: updated.wall_id, details: { username: updated.username, role: updated.role, active: updated.active } });
      return redirectUsers(res, { notice: `Updated ${updated.username}.` });
    } catch (error) { return redirectUsers(res, { error: error?.message || 'Could not update user.' }); }
  });

  router.get('/users/:userId/password', requireOwner, async (req, res) => {
    const target = await getAdminUser(req.params.userId);
    if (!target) return res.sendStatus(404);
    return res.type('html').send(resetPasswordPage({ target, user: req.adminSession.user, csrf: req.adminSession.csrf }));
  });

  router.post('/users/:userId/password', requireCsrf, requireOwner, async (req, res) => {
    try {
      const target = await getAdminUser(req.params.userId);
      if (!target) throw new Error('Admin user not found.');
      if (target.id === req.adminSession.user.id) throw new Error('Use Change password for your own account.');
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      await setAdminPassword(target.id, password, { mustChange: true });
      await writeAudit(req.adminSession.user, 'admin_user.password_reset', { targetAdminUserId: target.id, details: { username: target.username } });
      return redirectUsers(res, { notice: `Reset ${target.username}'s password and signed out their existing sessions.` });
    } catch (error) { return redirectUsers(res, { error: error?.message || 'Could not reset password.' }); }
  });

  router.get('/audit', requireOwner, async (req, res) => {
    const entries = await listAuditLog();
    return res.type('html').send(auditPage({ entries, user: req.adminSession.user, csrf: req.adminSession.csrf }));
  });

  router.use((_req, res) => res.status(404).type('html').send(messagePage({ title: 'Admin page not found', message: 'That admin page does not exist.', actionHref: '/admin/walls', actionLabel: 'Back to Walls' })));
  app.use('/admin', router);
}
