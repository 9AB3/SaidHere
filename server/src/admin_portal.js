import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const COOKIE_NAME = 'the_wall_admin';
const DEFAULT_SESSION_HOURS = 12;

function cleanBody(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

function credentials() {
  const username = cleanBody(process.env.ADMIN_USERNAME) || 'admin';
  const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || '';
  const configured = Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD);
  return { username, password, configured };
}

function sessionSecret() {
  const explicit = process.env.ADMIN_SESSION_SECRET || '';
  if (explicit) return Buffer.from(explicit, 'utf8');
  const { password } = credentials();
  const fallback = `${password}|${process.env.ADMIN_KEY || ''}|the-wall-admin-session`;
  return crypto.createHash('sha256').update(fallback).digest();
}

function sessionHours() {
  const parsed = Number(process.env.ADMIN_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 168) : DEFAULT_SESSION_HOURS;
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function createSessionToken(username) {
  const expiresAt = Date.now() + sessionHours() * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    u: username,
    exp: expiresAt,
    n: crypto.randomBytes(12).toString('base64url'),
  }), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0 || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const { username } = credentials();
    if (data?.v !== 1 || data?.u !== username || !Number.isFinite(data?.exp) || data.exp <= Date.now()) {
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function csrfToken(sessionToken) {
  return crypto.createHmac('sha256', sessionSecret())
    .update(`csrf:${sessionToken}`)
    .digest('base64url');
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

function requireBrowserAdmin(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME] || '';
  const session = verifySessionToken(token);
  if (!session) {
    clearSessionCookie(req, res);
    const nextPath = req.method === 'GET' ? req.originalUrl : '/admin/walls';
    return res.redirect(303, `/admin/login?next=${encodeURIComponent(nextPath)}`);
  }
  req.adminSession = { ...session, raw: token, csrf: csrfToken(token) };
  return next();
}

function requireCsrf(req, res, next) {
  const expected = req.adminSession?.csrf || '';
  const supplied = cleanBody(req.body?._csrf);
  if (!expected || !safeEqual(supplied, expected)) {
    return res.status(403).type('html').send(messagePage({
      title: 'Request expired',
      message: 'That admin form is no longer valid. Go back to the Walls dashboard and try again.',
      actionHref: '/admin/walls',
      actionLabel: 'Back to Walls',
    }));
  }
  return next();
}

function validateWallFields(displayName, locationHint) {
  if (!displayName || displayName.length > 80) {
    throw new Error('Wall name must be between 1 and 80 characters.');
  }
  if (locationHint.length > 120) {
    throw new Error('Location must be 120 characters or fewer.');
  }
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

async function listWalls() {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            count(distinct v.session_id)::int as discovered_by,
            count(distinct p.id)::int as post_count
       from walls w
       left join wall_visits v on v.wall_id = w.id
       left join wall_posts p on p.wall_id = w.id and p.hidden_at is null
      group by w.id
      order by w.created_at desc`,
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

async function editWall(wallId, displayName, locationHint) {
  validateWallFields(displayName, locationHint);
  const result = await pool.query(
    `update walls
        set display_name = $2,
            location_hint = $3
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
  const result = await pool.query(`delete from walls where id = $1 returning display_name`, [wallId]);
  if (result.rowCount === 0) throw new Error('Wall not found.');
  return result.rows[0].display_name;
}

function layout({ title, body, username = null }) {
  const account = username
    ? `<div class="account"><span>${escapeHtml(username)}</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="__CSRF__"><button class="link-button" type="submit">Log out</button></form></div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)} · The Wall Admin</title>
<style>
:root{--ink:#181512;--paper:#eee4d3;--muted:#776e61;--line:#c9bda9;--red:#8d352d;--green:#496443;--bg:#d8ccb7}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(145deg,#d9cdb9,#bfb29b);color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}.shell{max-width:1180px;margin:0 auto;min-height:100vh;padding:24px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}.brand{display:flex;align-items:center;gap:12px}.mark{width:46px;height:46px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-weight:1000;border-radius:7px;letter-spacing:-2px}.brand h1{font-size:22px;margin:0;font-weight:950}.brand small{display:block;color:var(--muted);font-weight:700}.account{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:800}.account form{margin:0}.link-button{border:0;background:transparent;text-decoration:underline;padding:4px;cursor:pointer;color:var(--ink)}.panel{background:rgba(246,239,226,.92);border:1px solid rgba(65,55,43,.22);box-shadow:0 10px 30px rgba(46,37,27,.12);padding:22px;margin-bottom:18px}.panel h2,.panel h3{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.field{display:flex;flex-direction:column;gap:7px}.field label{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.7px}.field input{width:100%;border:1px solid #918575;background:#fffaf0;padding:12px 13px;font:inherit}.actions{display:flex;gap:9px;flex-wrap:wrap}.button,button.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:10px 14px;text-decoration:none;font-weight:900;font-size:12px;letter-spacing:.35px;cursor:pointer}.button.secondary{background:transparent;color:var(--ink)}.button.warn{background:var(--red);border-color:var(--red)}.button.good{background:var(--green);border-color:var(--green)}.wall-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wall-card{background:rgba(245,237,223,.88);border-left:5px solid var(--ink);padding:18px;box-shadow:0 4px 13px rgba(35,28,20,.08)}.wall-card.inactive{opacity:.72;border-left-color:var(--red)}.wall-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.wall-card h3{font-size:20px;margin:0 0 4px;font-weight:950}.location{color:var(--muted);font-weight:750}.badge{font-size:10px;font-weight:950;letter-spacing:.6px;text-transform:uppercase;border:1px solid currentColor;padding:5px 7px}.badge.active{color:var(--green)}.badge.inactive{color:var(--red)}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}.metric{border-top:1px solid var(--line);padding-top:8px}.metric strong{display:block;font-size:17px}.metric span{font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:900;letter-spacing:.5px}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.notice,.error{padding:12px 14px;margin-bottom:16px;font-weight:800}.notice{background:#dce6d5;border-left:4px solid var(--green)}.error{background:#efd5d0;border-left:4px solid var(--red)}.danger-zone{border-left:5px solid var(--red)}.nfc{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;width:100%;padding:13px;background:#fffaf0;border:1px solid #968b7a;font-size:14px}.help{color:var(--muted);line-height:1.5}.login-shell{max-width:430px;margin:10vh auto;padding:20px}.login-title{text-align:center;margin-bottom:20px}.login-title .mark{margin:0 auto 12px;width:68px;height:68px;font-size:22px}.login-title h1{margin:0;font-size:30px;font-weight:1000}.login-title p{color:var(--muted)}.stack{display:flex;flex-direction:column;gap:14px}.full{width:100%}.back{display:inline-block;margin-bottom:14px;color:var(--muted);font-weight:800;text-decoration:none}
@media(max-width:760px){.shell{padding:16px}.topbar{align-items:flex-start}.account{flex-direction:column;align-items:flex-end}.grid,.wall-grid{grid-template-columns:1fr}.meta{grid-template-columns:repeat(3,1fr)}.panel{padding:17px}.wall-card{padding:16px}.actions .button,.actions button.button{flex:1 1 44%}}
</style>
</head>
<body>${body}</body>
</html>`;
}

function withCsrf(html, csrf) {
  return html.replaceAll('__CSRF__', escapeHtml(csrf || ''));
}

function loginPage({ error = null, next = '/admin/walls' } = {}) {
  const body = `<div class="login-shell"><div class="login-title"><div class="mark">TW</div><h1>The Wall Admin</h1><p>Manage physical Walls and NFC plaques.</p></div><div class="panel">${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/login" class="stack"><input type="hidden" name="next" value="${escapeHtml(next)}"><div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div><button class="button full" type="submit">Log in</button></form></div></div>`;
  return layout({ title: 'Login', body });
}

function shellBody({ username, csrf, content }) {
  const body = `<div class="shell"><div class="topbar"><div class="brand"><div class="mark">TW</div><div><h1>The Wall Admin</h1><small>Physical Wall management</small></div></div><div class="account"><span>${escapeHtml(username)}</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="__CSRF__"><button class="link-button" type="submit">Log out</button></form></div></div>${content}</div>`;
  return withCsrf(layout({ title: 'Walls', body }), csrf);
}

function messagePage({ title, message, actionHref, actionLabel }) {
  const body = `<div class="login-shell"><div class="panel"><h2>${escapeHtml(title)}</h2><p class="help">${escapeHtml(message)}</p><a class="button" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a></div></div>`;
  return layout({ title, body });
}

function dashboardPage({ walls, username, csrf, notice = null, error = null }) {
  const cards = walls.length === 0
    ? '<div class="panel"><p>No Walls have been created yet.</p></div>'
    : `<div class="wall-grid">${walls.map((wall) => `<article class="wall-card ${wall.active ? '' : 'inactive'}"><div class="wall-head"><div><h3>${escapeHtml(wall.display_name)}</h3><div class="location">${escapeHtml(wall.location_hint || 'No location set')}</div></div><span class="badge ${wall.active ? 'active' : 'inactive'}">${wall.active ? 'Active' : 'Inactive'}</span></div><div class="meta"><div class="metric"><strong>${escapeHtml(wall.post_count)}</strong><span>Messages</span></div><div class="metric"><strong>${escapeHtml(wall.discovered_by)}</strong><span>Visitors</span></div><div class="metric"><strong>${escapeHtml(formatDate(wall.created_at))}</strong><span>Created</span></div></div><div class="code">Public ID: ${escapeHtml(wall.slug)}</div><div class="actions" style="margin-top:15px"><a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/edit">Edit</a><form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/status"><input type="hidden" name="_csrf" value="__CSRF__"><input type="hidden" name="active" value="${wall.active ? 'false' : 'true'}"><button class="button ${wall.active ? 'secondary' : 'good'}" type="submit">${wall.active ? 'Deactivate' : 'Reactivate'}</button></form><a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/replace-nfc">Replace NFC</a><a class="button secondary" href="/admin/walls/${encodeURIComponent(wall.id)}/clear">Clear messages</a><a class="button warn" href="/admin/walls/${encodeURIComponent(wall.id)}/delete">Delete</a></div></article>`).join('')}</div>`;
  const content = `${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<section class="panel"><h2>Create a Wall</h2><p class="help">Create the place first, then program the one-time NFC URL that appears onto the physical plaque.</p><form method="post" action="/admin/walls/create"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required placeholder="9A Raworth"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" placeholder="Singleton NSW"></div></div><div class="actions" style="margin-top:14px"><button class="button" type="submit">Create Wall + NFC URL</button></div></form></section><section><h2>Walls <span style="color:var(--muted);font-weight:700">(${walls.length})</span></h2>${cards}</section>`;
  return shellBody({ username, csrf, content });
}

function editPage({ wall, username, csrf, error = null }) {
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel"><h2>Edit Wall</h2>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/edit"><input type="hidden" name="_csrf" value="__CSRF__"><div class="grid"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required value="${escapeHtml(wall.display_name)}"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" value="${escapeHtml(wall.location_hint || '')}"></div></div><p class="code">Public ID: ${escapeHtml(wall.slug)}</p><div class="actions"><button class="button" type="submit">Save changes</button><a class="button secondary" href="/admin/walls">Cancel</a></div></form></section>`;
  return shellBody({ username, csrf, content });
}

function confirmPage({ wall, username, csrf, kind }) {
  const config = {
    'replace-nfc': {
      title: 'Replace NFC plaque URL',
      description: 'This keeps the Wall, messages and history, but permanently invalidates every previous NFC plaque URL for this Wall.',
      word: 'REPLACE',
      button: 'Generate replacement NFC URL',
      buttonClass: 'button warn',
    },
    clear: {
      title: 'Clear all messages',
      description: 'This permanently deletes every message and reply from this Wall. The Wall and NFC plaque stay active.',
      word: 'CLEAR',
      button: 'Clear messages',
      buttonClass: 'button warn',
    },
    delete: {
      title: 'Delete Wall',
      description: 'This permanently deletes the Wall, messages, visit history and NFC association. The existing plaque will stop working.',
      word: 'DELETE',
      button: 'Delete Wall permanently',
      buttonClass: 'button warn',
    },
  }[kind];
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel danger-zone"><h2>${config.title}</h2><h3>${escapeHtml(wall.display_name)}</h3><p class="help">${config.description}</p><form method="post" action="/admin/walls/${encodeURIComponent(wall.id)}/${kind}" class="stack"><input type="hidden" name="_csrf" value="__CSRF__"><div class="field"><label>Type ${config.word} to confirm</label><input name="confirmation" autocomplete="off" required></div><div class="actions"><button class="${config.buttonClass}" type="submit">${config.button}</button><a class="button secondary" href="/admin/walls">Cancel</a></div></form></section>`;
  return shellBody({ username, csrf, content });
}

function nfcResultPage({ wall, username, csrf, replacement = false }) {
  const content = `<a class="back" href="/admin/walls">← Back to Walls</a><section class="panel"><h2>${replacement ? 'Replacement NFC URL ready' : 'Wall created'}</h2><h3>${escapeHtml(wall.display_name)}</h3><p class="help">Program this exact URL onto the NFC tag. <strong>Save it now.</strong> Only the hash is stored, so this raw URL cannot be displayed again later.</p><div class="field"><label>NFC URL</label><input class="nfc" readonly value="${escapeHtml(wall.nfc_url)}"></div><p><a href="${escapeHtml(wall.nfc_url)}">Open NFC URL to test</a></p><div class="actions"><a class="button" href="/admin/walls">Done — back to Walls</a></div></section>`;
  return shellBody({ username, csrf, content });
}

function redirectDashboard(res, { notice = null, error = null } = {}) {
  const params = new URLSearchParams();
  if (notice) params.set('notice', notice);
  if (error) params.set('error', error);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return res.redirect(303, `/admin/walls${suffix}`);
}

export function mountAdminPortal(app) {
  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const portalLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.use(portalLimiter);

  router.get('/login', (req, res) => {
    const existing = verifySessionToken(parseCookies(req)[COOKIE_NAME] || '');
    if (existing) return res.redirect(303, '/admin/walls');
    const next = cleanBody(req.query?.next) || '/admin/walls';
    return res.type('html').send(loginPage({ next }));
  });

  router.post('/login', loginLimiter, (req, res) => {
    const configured = credentials();
    if (!configured.password) {
      return res.status(503).type('html').send(loginPage({
        error: 'Admin login is not configured on the server.',
        next: '/admin/walls',
      }));
    }
    const username = cleanBody(req.body?.username);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const next = cleanBody(req.body?.next) || '/admin/walls';
    if (!safeEqual(username, configured.username) || !safeEqual(password, configured.password)) {
      return res.status(401).type('html').send(loginPage({
        error: 'Incorrect username or password.',
        next,
      }));
    }
    const token = createSessionToken(configured.username);
    setSessionCookie(req, res, token);
    const safeNext = next.startsWith('/admin/') ? next : '/admin/walls';
    return res.redirect(303, safeNext);
  });

  router.use(requireBrowserAdmin);

  router.post('/logout', requireCsrf, (req, res) => {
    clearSessionCookie(req, res);
    return res.redirect(303, '/admin/login');
  });

  router.get('/', (_req, res) => res.redirect(303, '/admin/walls'));

  router.get('/walls', async (req, res) => {
    try {
      const walls = await listWalls();
      return res.type('html').send(dashboardPage({
        walls,
        username: req.adminSession.u,
        csrf: req.adminSession.csrf,
        notice: cleanBody(req.query?.notice),
        error: cleanBody(req.query?.error),
      }));
    } catch (error) {
      console.error('[admin-portal/walls]', error);
      return res.status(500).type('html').send(messagePage({
        title: 'Could not load Walls',
        message: error?.message || 'Database error.',
        actionHref: '/admin/walls',
        actionLabel: 'Try again',
      }));
    }
  });

  router.post('/walls/create', requireCsrf, async (req, res) => {
    try {
      const wall = await createWall(
        cleanBody(req.body?.display_name),
        cleanBody(req.body?.location_hint),
      );
      return res.status(201).type('html').send(nfcResultPage({
        wall,
        username: req.adminSession.u,
        csrf: req.adminSession.csrf,
      }));
    } catch (error) {
      console.error('[admin-portal/create]', error);
      return redirectDashboard(res, { error: error?.message || 'Could not create Wall.' });
    }
  });

  router.get('/walls/:wallId/edit', async (req, res) => {
    const wall = await getWall(req.params.wallId);
    if (!wall) return res.status(404).type('html').send(messagePage({ title: 'Wall not found', message: 'This Wall no longer exists.', actionHref: '/admin/walls', actionLabel: 'Back to Walls' }));
    return res.type('html').send(editPage({ wall, username: req.adminSession.u, csrf: req.adminSession.csrf }));
  });

  router.post('/walls/:wallId/edit', requireCsrf, async (req, res) => {
    try {
      const wall = await editWall(
        req.params.wallId,
        cleanBody(req.body?.display_name),
        cleanBody(req.body?.location_hint),
      );
      return redirectDashboard(res, { notice: `Updated ${wall.display_name}.` });
    } catch (error) {
      const wall = await getWall(req.params.wallId);
      if (!wall) return redirectDashboard(res, { error: 'Wall not found.' });
      return res.status(400).type('html').send(editPage({
        wall: {
          ...wall,
          display_name: cleanBody(req.body?.display_name) || wall.display_name,
          location_hint: cleanBody(req.body?.location_hint),
        },
        username: req.adminSession.u,
        csrf: req.adminSession.csrf,
        error: error?.message || 'Could not update Wall.',
      }));
    }
  });

  router.post('/walls/:wallId/status', requireCsrf, async (req, res) => {
    try {
      const active = cleanBody(req.body?.active).toLowerCase() === 'true';
      const wall = await setWallActive(req.params.wallId, active);
      return redirectDashboard(res, { notice: `${wall.display_name} is now ${wall.active ? 'active' : 'inactive'}.` });
    } catch (error) {
      return redirectDashboard(res, { error: error?.message || 'Could not change Wall status.' });
    }
  });

  for (const kind of ['replace-nfc', 'clear', 'delete']) {
    router.get(`/walls/:wallId/${kind}`, async (req, res) => {
      const wall = await getWall(req.params.wallId);
      if (!wall) return res.status(404).type('html').send(messagePage({ title: 'Wall not found', message: 'This Wall no longer exists.', actionHref: '/admin/walls', actionLabel: 'Back to Walls' }));
      return res.type('html').send(confirmPage({ wall, username: req.adminSession.u, csrf: req.adminSession.csrf, kind }));
    });
  }

  router.post('/walls/:wallId/replace-nfc', requireCsrf, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'REPLACE') {
      return redirectDashboard(res, { error: 'Replacement cancelled because REPLACE was not entered exactly.' });
    }
    try {
      const wall = await replaceNfc(req.params.wallId);
      return res.type('html').send(nfcResultPage({
        wall,
        username: req.adminSession.u,
        csrf: req.adminSession.csrf,
        replacement: true,
      }));
    } catch (error) {
      return redirectDashboard(res, { error: error?.message || 'Could not replace NFC URL.' });
    }
  });

  router.post('/walls/:wallId/clear', requireCsrf, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'CLEAR') {
      return redirectDashboard(res, { error: 'Clear cancelled because CLEAR was not entered exactly.' });
    }
    try {
      const result = await clearWallMessages(req.params.wallId);
      return redirectDashboard(res, { notice: `Cleared ${result.deletedCount} message${result.deletedCount === 1 ? '' : 's'} from ${result.wall.display_name}.` });
    } catch (error) {
      return redirectDashboard(res, { error: error?.message || 'Could not clear messages.' });
    }
  });

  router.post('/walls/:wallId/delete', requireCsrf, async (req, res) => {
    if (cleanBody(req.body?.confirmation) !== 'DELETE') {
      return redirectDashboard(res, { error: 'Delete cancelled because DELETE was not entered exactly.' });
    }
    try {
      const displayName = await deleteWall(req.params.wallId);
      return redirectDashboard(res, { notice: `Deleted ${displayName}. Its old NFC plaque URL is now invalid.` });
    } catch (error) {
      return redirectDashboard(res, { error: error?.message || 'Could not delete Wall.' });
    }
  });

  // Prevent the legacy browser admin routes in index.js from handling /admin requests.
  router.use((_req, res) => {
    return res.status(404).type('html').send(messagePage({
      title: 'Admin page not found',
      message: 'That admin page does not exist.',
      actionHref: '/admin/walls',
      actionLabel: 'Back to Walls',
    }));
  });

  app.use('/admin', router);
}
