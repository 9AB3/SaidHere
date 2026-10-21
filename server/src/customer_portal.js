import express from 'express';

import { hashToken, makeToken } from './auth.js';
import {
  hashAdminPassword as hashPassword,
  validateAdminPassword as validatePassword,
  verifyAdminPassword as verifyPassword,
} from './admin_auth.js';
import { pool } from './db.js';

const COOKIE_NAME = 'the_wall_customer';
const SESSION_HOURS = 24 * 30;

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
  const result = {};
  for (const part of (req.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    const key = part.slice(0, at).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(part.slice(at + 1).trim());
    } catch (_) {
      result[key] = part.slice(at + 1).trim();
    }
  }
  return result;
}

function setCustomerCookie(req, res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/my-walls',
    `Max-Age=${SESSION_HOURS * 60 * 60}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCustomerCookie(req, res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/my-walls',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function csrf(rawToken) {
  return hashToken(`customer-csrf:${rawToken}`);
}

async function startSession(req, customerId) {
  const raw = makeToken(48);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  const result = await pool.query(
    `insert into customer_sessions (customer_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, $4) returning id`,
    [customerId, hashToken(raw), expiresAt, (req.get('user-agent') || '').slice(0, 500)],
  );
  return { raw, id: result.rows[0].id };
}

async function requireCustomer(req, res, next) {
  try {
    const raw = parseCookies(req)[COOKIE_NAME] || '';
    if (!raw) return res.redirect(303, `/my-walls/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `update customer_sessions s
          set last_seen_at = now()
         from customer_accounts c
        where s.token_hash = $1
          and s.customer_id = c.id
          and s.expires_at > now()
          and c.active = true
      returning s.id as session_id, c.id, c.email, c.display_name`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) {
      clearCustomerCookie(req, res);
      return res.redirect(303, `/my-walls/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    req.customerSession = {
      id: result.rows[0].session_id,
      raw,
      csrf: csrf(raw),
      customer: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        displayName: result.rows[0].display_name,
      },
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.customerSession?.csrf || clean(req.body?._csrf) !== req.customerSession.csrf) {
    return res.status(403).type('html').send(messagePage('Request expired', 'Please return to My Walls and try again.'));
  }
  return next();
}

async function writeCustomerAudit(customer, action, { wall = null, details = {} } = {}) {
  try {
    await pool.query(
      `insert into customer_audit_log
         (customer_id, email_snapshot, action, wall_id, wall_name, details)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [customer.id, customer.email, action, wall?.id || null, wall?.display_name || null, JSON.stringify(details)],
    );
  } catch (error) {
    console.error('[customer-audit]', error);
  }
}

async function ownedWall(customerId, wallId) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
            o.started_at as owned_since,
            count(distinct p.id) filter (where p.hidden_at is null)::int as post_count,
            count(distinct v.session_id)::int as visitor_count
       from wall_ownerships o
       join walls w on w.id = o.wall_id
       left join wall_posts p on p.wall_id = w.id
       left join wall_visits v on v.wall_id = w.id
      where o.customer_id = $1 and o.wall_id = $2 and o.ended_at is null
      group by w.id, o.started_at
      limit 1`,
    [customerId, wallId],
  );
  return result.rows[0] || null;
}

async function customerWalls(customerId) {
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.active,
            count(distinct p.id) filter (where p.hidden_at is null)::int as post_count,
            count(distinct v.session_id)::int as visitor_count,
            count(distinct r.id)::int as report_count
       from wall_ownerships o
       join walls w on w.id = o.wall_id
       left join wall_posts p on p.wall_id = w.id
       left join wall_visits v on v.wall_id = w.id
       left join post_reports r on r.post_id = p.id
      where o.customer_id = $1 and o.ended_at is null
      group by w.id
      order by o.started_at desc`,
    [customerId],
  );
  return result.rows;
}

async function customerOrders(customerId) {
  const result = await pool.query(
    `select id, status, quantity, created_at, paid_at, fulfilled_at
       from commerce_orders
      where customer_id = $1
      order by created_at desc
      limit 20`,
    [customerId],
  );
  return result.rows;
}

async function reportedPosts(customerId, wallId) {
  const result = await pool.query(
    `select p.id, p.body, p.created_at, p.hidden_at, count(r.id)::int as report_count
       from wall_ownerships o
       join wall_posts p on p.wall_id = o.wall_id
       join post_reports r on r.post_id = p.id
      where o.customer_id = $1
        and o.wall_id = $2
        and o.ended_at is null
      group by p.id
      order by count(r.id) desc, min(r.created_at) asc`,
    [customerId, wallId],
  );
  return result.rows;
}

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function baseStyles() {
  return `
:root{--ink:#171411;--paper:#f7f0e5;--muted:#786f62;--line:#c9bdab;--green:#4e6847;--red:#963c33;--amber:#9a6a18}*{box-sizing:border-box}body{margin:0;color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#d7cbb5 url('/wall-background.png') center/cover fixed}.shade{min-height:100vh;background:rgba(236,226,207,.78)}.shell{max-width:920px;margin:0 auto;padding:22px 18px 70px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 17px;background:#181614;color:var(--paper);border-radius:16px;box-shadow:0 10px 28px rgba(0,0,0,.18)}.brand{display:flex;align-items:center;gap:12px}.brand img{width:48px;height:48px;object-fit:cover;border-radius:8px}.brand strong{display:block;font-size:22px}.brand small{display:block;margin-top:2px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9c0b4;font-weight:900}.top form{margin:0}.linkbtn{border:0;background:none;color:#f5ede1;text-decoration:underline;font-weight:800}.pagehead{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:28px 0 13px}.pagehead h1{margin:0;font-size:34px;letter-spacing:-1px}.eyebrow{display:block;margin-bottom:5px;font-size:10px;text-transform:uppercase;letter-spacing:1.8px;color:var(--muted);font-weight:950}.card{background:rgba(255,252,246,.95);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 7px 18px rgba(45,36,27,.07);margin-bottom:12px}.wallrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}.wallrow h2{margin:0 0 3px;font-size:20px}.sub{color:var(--muted);font-weight:650}.metrics{display:flex;gap:18px;margin-top:12px}.metric strong{display:block;font-size:17px}.metric span{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);font-weight:900}.badge{display:inline-flex;padding:5px 8px;border:1px solid currentColor;border-radius:999px;font-size:8px;text-transform:uppercase;letter-spacing:.8px;font-weight:950}.active{color:var(--green)}.inactive{color:var(--red)}.reported{color:var(--amber)}.button,button.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 15px;border:1px solid var(--ink);border-radius:9px;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:900;letter-spacing:.4px;cursor:pointer}.button.secondary{background:#fffaf1;color:var(--ink)}.button.warn{background:var(--red);border-color:var(--red)}.button.good{background:var(--green);border-color:var(--green)}.field{display:flex;flex-direction:column;gap:6px;margin-bottom:13px}.field label{font-size:10px;text-transform:uppercase;letter-spacing:1.1px;font-weight:950;color:#5e574e}.field input{width:100%;min-height:49px;padding:11px 12px;border:1px solid #9f9382;border-radius:8px;background:#fffdf8;font:inherit}.actions{display:flex;gap:8px;flex-wrap:wrap}.notice,.error{padding:12px 14px;border-radius:10px;margin:0 0 14px;font-weight:750}.notice{background:#dde8d8;border-left:4px solid var(--green)}.error{background:#f0d8d3;border-left:4px solid var(--red)}.report{border-left:4px solid var(--amber)}.report blockquote{margin:8px 0 14px;padding:0;color:#302a24;font-size:17px;line-height:1.45}.order{display:flex;justify-content:space-between;gap:12px;align-items:center}.empty{text-align:center;padding:36px 20px;color:var(--muted)}.login{max-width:430px;margin:9vh auto 0}.login .logo{display:block;width:100px;height:100px;object-fit:cover;border-radius:16px;margin:0 auto 16px}.login h1{text-align:center;margin:0 0 6px;font-size:32px}.login>p{text-align:center;color:var(--muted);margin:0 0 18px}.back{display:inline-block;margin:18px 0 8px;color:var(--ink);font-weight:850;text-decoration:none}.help{color:var(--muted);line-height:1.55}.divider{height:1px;background:#e3dacd;margin:15px 0}@media(max-width:640px){.shell{padding:14px 12px 55px}.top{border-radius:13px}.brand img{width:42px;height:42px}.brand strong{font-size:19px}.pagehead h1{font-size:29px}.card{padding:15px}.metrics{gap:13px}.wallrow{align-items:start}.actions .button,.actions button.button{flex:1 1 45%}.order{align-items:flex-start;flex-direction:column}.login{margin-top:5vh}}`;
}

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)} · The Wall</title><style>${baseStyles()}</style></head><body><div class="shade">${body}</div></body></html>`;
}

function header(session) {
  return `<header class="top"><div class="brand"><img src="/plaque.png" alt="The Wall"><div><strong>The Wall</strong><small>My Walls</small></div></div><form method="post" action="/my-walls/logout"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><button class="linkbtn" type="submit">Log out</button></form></header>`;
}

function messagePage(title, message) {
  return layout(title, `<main class="shell"><div class="login card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button" href="/my-walls">My Walls</a></div></main>`);
}

function loginPage({ error = '', next = '/my-walls' } = {}) {
  return layout('Wall owner login', `<main class="shell"><section class="login card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>Manage your Walls</h1><p>Sign in with the email used to purchase your plaque.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/login"><input type="hidden" name="next" value="${escapeHtml(next)}"><div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required autofocus></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div><button class="button" style="width:100%" type="submit">Sign in</button></form><p class="help" style="text-align:left;margin-top:15px">Your account is created from a paid plaque order. If you have purchased but never activated your account, use the activation link sent after checkout.</p></section></main>`);
}

function claimPage({ token, email, error = '' }) {
  return layout('Activate your account', `<main class="shell"><section class="login card"><img class="logo" src="/plaque.png" alt="The Wall"><h1>Claim your Walls</h1><p>${escapeHtml(email)}</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/claim/${encodeURIComponent(token)}"><div class="field"><label>Your name</label><input name="display_name" maxlength="80" autocomplete="name" placeholder="Optional"></div><div class="field"><label>Create password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Confirm password</label><input name="confirm_password" type="password" minlength="8" autocomplete="new-password" required></div><button class="button" style="width:100%" type="submit">Activate My Walls</button></form></section></main>`);
}

function dashboardPage({ session, walls, orders, notice = '', error = '' }) {
  const wallCards = walls.length
    ? walls.map((wall) => `<article class="card wallrow"><div><div><span class="badge ${wall.active ? 'active' : 'inactive'}">${wall.active ? 'Active' : 'Inactive'}</span>${Number(wall.report_count) > 0 ? ` <span class="badge reported">${escapeHtml(wall.report_count)} reports</span>` : ''}</div><h2>${escapeHtml(wall.display_name)}</h2><div class="sub">${escapeHtml(wall.location_hint || 'Location not set')}</div><div class="metrics"><div class="metric"><strong>${escapeHtml(wall.post_count)}</strong><span>Messages</span></div><div class="metric"><strong>${escapeHtml(wall.visitor_count)}</strong><span>Visitors</span></div></div></div><a class="button secondary" href="/my-walls/${encodeURIComponent(wall.id)}">Manage</a></article>`).join('')
    : '<div class="card empty">No Walls are assigned to your account yet. If you have just ordered, your plaque may still be waiting to be packed.</div>';
  const pending = orders.filter((order) => order.status !== 'fulfilled');
  const pendingHtml = pending.length
    ? `<section><div class="pagehead"><div><span class="eyebrow">Orders</span><h1 style="font-size:24px">Plaques being prepared</h1></div></div>${pending.map((order) => `<div class="card order"><div><strong>${escapeHtml(order.quantity)} plaque${Number(order.quantity) === 1 ? '' : 's'}</strong><div class="sub">Ordered ${escapeHtml(fmt(order.created_at))}</div></div><span class="badge reported">${escapeHtml(order.status)}</span></div>`).join('')}</section>`
    : '';
  return layout('My Walls', `<main class="shell">${header(session)}${notice ? `<div class="notice" style="margin-top:18px">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error" style="margin-top:18px">${escapeHtml(error)}</div>` : ''}<div class="pagehead"><div><span class="eyebrow">Owned by ${escapeHtml(session.customer.displayName || session.customer.email)}</span><h1>My Walls</h1></div><a class="button secondary" href="/shop">Buy another plaque</a></div>${wallCards}${pendingHtml}</main>`);
}

function managePage({ session, wall, reports, notice = '', error = '' }) {
  const reportsHtml = reports.length
    ? reports.map((post) => `<article class="card report"><div><span class="badge reported">${escapeHtml(post.report_count)} report${Number(post.report_count) === 1 ? '' : 's'}</span>${post.hidden_at ? ' <span class="badge inactive">Auto-hidden</span>' : ''}</div><blockquote>“${escapeHtml(post.body)}”</blockquote><div class="sub">Posted ${escapeHtml(fmt(post.created_at))}</div><div class="actions" style="margin-top:13px"><form method="post" action="/my-walls/${encodeURIComponent(wall.id)}/reports/${encodeURIComponent(post.id)}/keep"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><button class="button good" type="submit">Keep post</button></form><form method="post" action="/my-walls/${encodeURIComponent(wall.id)}/reports/${encodeURIComponent(post.id)}/remove"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><button class="button warn" type="submit">Remove post</button></form></div></article>`).join('')
    : '<div class="card empty">No reported posts need your attention.</div>';
  return layout(wall.display_name, `<main class="shell">${header(session)}<a class="back" href="/my-walls">← My Walls</a>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<div class="pagehead"><div><span class="eyebrow">Wall owner controls</span><h1>${escapeHtml(wall.display_name)}</h1><div class="sub">${escapeHtml(wall.location_hint || 'Location not set')}</div></div><span class="badge ${wall.active ? 'active' : 'inactive'}">${wall.active ? 'Active' : 'Inactive'}</span></div><section class="card"><h2 style="margin-top:0">Wall details</h2><p class="help">Only you and The Wall platform administrator can change these details.</p><form method="post" action="/my-walls/${encodeURIComponent(wall.id)}/edit"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><div class="field"><label>Wall name</label><input name="display_name" maxlength="80" required value="${escapeHtml(wall.display_name)}"></div><div class="field"><label>Location</label><input name="location_hint" maxlength="120" value="${escapeHtml(wall.location_hint || '')}"></div><button class="button" type="submit">Save details</button></form><div class="divider"></div><div class="metrics"><div class="metric"><strong>${escapeHtml(wall.post_count)}</strong><span>Messages</span></div><div class="metric"><strong>${escapeHtml(wall.visitor_count)}</strong><span>Visitors</span></div><div class="metric"><strong>${escapeHtml(fmt(wall.owned_since))}</strong><span>Owned since</span></div></div><div class="divider"></div><form method="post" action="/my-walls/${encodeURIComponent(wall.id)}/status"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="active" value="${wall.active ? 'false' : 'true'}"><button class="button ${wall.active ? 'warn' : 'good'}" type="submit">${wall.active ? 'Deactivate Wall' : 'Reactivate Wall'}</button></form></section><div class="pagehead"><div><span class="eyebrow">Moderation</span><h1 style="font-size:25px">Reported posts</h1></div><span class="badge reported">${reports.length} pending</span></div><p class="help">You can only remove posts that users have reported. Keeping a post clears its reports and restores it if it was automatically hidden.</p>${reportsHtml}</main>`);
}

export function mountCustomerPortal(app) {
  const router = express.Router();

  router.get('/login', async (req, res) => {
    const raw = parseCookies(req)[COOKIE_NAME] || '';
    if (raw) {
      const found = await pool.query(`select 1 from customer_sessions where token_hash = $1 and expires_at > now()`, [hashToken(raw)]);
      if (found.rowCount > 0) return res.redirect(303, '/my-walls');
    }
    return res.type('html').send(loginPage({ next: clean(req.query?.next) || '/my-walls' }));
  });

  router.post('/login', async (req, res, next) => {
    try {
      const email = clean(req.body?.email).toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const result = await pool.query(`select id, email, display_name, password_hash, active from customer_accounts where lower(email) = $1 limit 1`, [email]);
      const customer = result.rows[0];
      if (!customer || !customer.active || !customer.password_hash || !verifyPassword(password, customer.password_hash)) {
        return res.status(401).type('html').send(loginPage({ error: 'Incorrect email or password.', next: clean(req.body?.next) || '/my-walls' }));
      }
      const session = await startSession(req, customer.id);
      await pool.query(`update customer_accounts set last_login_at = now() where id = $1`, [customer.id]);
      await writeCustomerAudit(customer, 'customer.login');
      setCustomerCookie(req, res, session.raw);
      const nextPath = clean(req.body?.next);
      return res.redirect(303, nextPath.startsWith('/my-walls') ? nextPath : '/my-walls');
    } catch (error) {
      return next(error);
    }
  });

  router.get('/claim/:token', async (req, res) => {
    const token = clean(req.params.token);
    const result = await pool.query(
      `select t.id, c.email
         from customer_claim_tokens t
         join customer_accounts c on c.id = t.customer_id
        where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and c.active = true
        limit 1`,
      [hashToken(token)],
    );
    if (result.rowCount === 0) return res.status(410).type('html').send(messagePage('Activation link expired', 'Ask The Wall support to resend your purchase activation link.'));
    return res.type('html').send(claimPage({ token, email: result.rows[0].email }));
  });

  router.post('/claim/:token', async (req, res, next) => {
    const token = clean(req.params.token);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const confirm = typeof req.body?.confirm_password === 'string' ? req.body.confirm_password : '';
    try {
      if (password !== confirm) throw new Error('The passwords do not match.');
      validatePassword(password);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const found = await client.query(
          `select t.id as token_id, c.id, c.email, c.display_name
             from customer_claim_tokens t
             join customer_accounts c on c.id = t.customer_id
            where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and c.active = true
            for update`,
          [hashToken(token)],
        );
        if (found.rowCount === 0) throw new Error('This activation link has expired or has already been used.');
        const customer = found.rows[0];
        const displayName = clean(req.body?.display_name).slice(0, 80);
        await client.query(`update customer_accounts set password_hash = $2, display_name = $3, updated_at = now() where id = $1`, [customer.id, hashPassword(password), displayName]);
        await client.query(`update customer_claim_tokens set used_at = now() where id = $1`, [customer.token_id]);
        await client.query('commit');
        const session = await startSession(req, customer.id);
        setCustomerCookie(req, res, session.raw);
        await writeCustomerAudit({ id: customer.id, email: customer.email }, 'customer.account_claimed');
        return res.redirect(303, '/my-walls?notice=Your%20Wall%20owner%20account%20is%20ready.');
      } catch (error) {
        try { await client.query('rollback'); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const emailResult = await pool.query(`select c.email from customer_claim_tokens t join customer_accounts c on c.id=t.customer_id where t.token_hash=$1 limit 1`, [hashToken(token)]);
      return res.status(400).type('html').send(claimPage({ token, email: emailResult.rows[0]?.email || '', error: error?.message || 'Could not activate account.' }));
    }
  });

  router.use(requireCustomer);

  router.post('/logout', requireCsrf, async (req, res) => {
    await writeCustomerAudit(req.customerSession.customer, 'customer.logout');
    await pool.query(`delete from customer_sessions where id = $1`, [req.customerSession.id]);
    clearCustomerCookie(req, res);
    return res.redirect(303, '/my-walls/login');
  });

  router.get('/', async (req, res, next) => {
    try {
      const [walls, orders] = await Promise.all([
        customerWalls(req.customerSession.customer.id),
        customerOrders(req.customerSession.customer.id),
      ]);
      return res.type('html').send(dashboardPage({ session: req.customerSession, walls, orders, notice: clean(req.query?.notice), error: clean(req.query?.error) }));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:wallId', async (req, res, next) => {
    try {
      const wall = await ownedWall(req.customerSession.customer.id, req.params.wallId);
      if (!wall) return res.status(404).type('html').send(messagePage('Wall not found', 'This Wall is not owned by your account.'));
      const reports = await reportedPosts(req.customerSession.customer.id, wall.id);
      return res.type('html').send(managePage({ session: req.customerSession, wall, reports, notice: clean(req.query?.notice), error: clean(req.query?.error) }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:wallId/edit', requireCsrf, async (req, res, next) => {
    try {
      const wall = await ownedWall(req.customerSession.customer.id, req.params.wallId);
      if (!wall) return res.sendStatus(404);
      const displayName = clean(req.body?.display_name);
      const location = clean(req.body?.location_hint);
      if (!displayName || displayName.length > 80) throw new Error('Wall name must be between 1 and 80 characters.');
      if (location.length > 120) throw new Error('Location must be 120 characters or fewer.');
      await pool.query(`update walls set display_name = $2, location_hint = $3 where id = $1`, [wall.id, displayName, location]);
      await writeCustomerAudit(req.customerSession.customer, 'wall.details_changed', { wall, details: { display_name: displayName, location_hint: location } });
      return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}?notice=Wall%20details%20updated.`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:wallId/status', requireCsrf, async (req, res, next) => {
    try {
      const wall = await ownedWall(req.customerSession.customer.id, req.params.wallId);
      if (!wall) return res.sendStatus(404);
      const active = clean(req.body?.active) === 'true';
      await pool.query(`update walls set active = $2 where id = $1`, [wall.id, active]);
      await writeCustomerAudit(req.customerSession.customer, active ? 'wall.reactivated' : 'wall.deactivated', { wall });
      return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}?notice=${active ? 'Wall%20reactivated.' : 'Wall%20deactivated.'}`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:wallId/reports/:postId/keep', requireCsrf, async (req, res, next) => {
    try {
      const wall = await ownedWall(req.customerSession.customer.id, req.params.wallId);
      if (!wall) return res.sendStatus(404);
      const reportCheck = await pool.query(
        `select p.id from wall_posts p join post_reports r on r.post_id=p.id where p.id=$1 and p.wall_id=$2 limit 1`,
        [req.params.postId, wall.id],
      );
      if (reportCheck.rowCount === 0) return res.status(400).type('html').send(messagePage('Nothing to review', 'That post no longer has any reports.'));
      await pool.query(`delete from post_reports where post_id = $1`, [req.params.postId]);
      await pool.query(`update wall_posts set hidden_at = null where id = $1 and wall_id = $2`, [req.params.postId, wall.id]);
      await writeCustomerAudit(req.customerSession.customer, 'reported_post.kept', { wall, details: { post_id: req.params.postId } });
      return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}?notice=Post%20kept%20and%20reports%20cleared.`);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:wallId/reports/:postId/remove', requireCsrf, async (req, res, next) => {
    try {
      const wall = await ownedWall(req.customerSession.customer.id, req.params.wallId);
      if (!wall) return res.sendStatus(404);
      const reportCheck = await pool.query(
        `select p.id, p.body from wall_posts p join post_reports r on r.post_id=p.id where p.id=$1 and p.wall_id=$2 limit 1`,
        [req.params.postId, wall.id],
      );
      if (reportCheck.rowCount === 0) return res.status(400).type('html').send(messagePage('Nothing to review', 'Only reported posts can be removed by a Wall owner.'));
      await pool.query(`delete from wall_posts where id = $1 and wall_id = $2`, [req.params.postId, wall.id]);
      await writeCustomerAudit(req.customerSession.customer, 'reported_post.removed', { wall, details: { post_id: req.params.postId } });
      return res.redirect(303, `/my-walls/${encodeURIComponent(wall.id)}?notice=Reported%20post%20removed.`);
    } catch (error) {
      return next(error);
    }
  });

  app.use('/my-walls', router);
}
