import { hashToken } from './auth.js';
import { pool } from './db.js';

const COOKIE_NAME = 'the_wall_admin';

function parseCookies(req) {
  const cookies = {};
  for (const item of (req.get('cookie') || '').split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (!key) continue;
    const value = item.slice(index + 1).trim();
    try { cookies[key] = decodeURIComponent(value); }
    catch (_) { cookies[key] = value; }
  }
  return cookies;
}

function explainRequiredPasswordChange(res) {
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    if (typeof body !== 'string') return originalSend(body);

    let html = body;
    const backLink = '<a class="back" href="/admin/walls">← Back to Walls</a>';
    const notice = '<div class="notice"><strong>Security setup required.</strong> Change the temporary password below to unlock Walls, Reports, Orders, Users and Audit Log.</div>';
    if (html.includes(backLink)) html = html.replace(backLink, notice);

    const hideLockedNavigation = '<style id="password-setup-lock">nav a:not([href="/admin/account/password"]){display:none!important}</style>';
    if (html.includes('</head>') && !html.includes('password-setup-lock')) {
      html = html.replace('</head>', `${hideLockedNavigation}</head>`);
    }
    return originalSend(html);
  };
}

export function mountAdminSecurity(app) {
  app.use('/admin', async (req, res, next) => {
    try {
      const path = req.path || '/';
      if (path === '/login' || path === '/logout') return next();

      const raw = parseCookies(req)[COOKIE_NAME] || '';
      if (!raw) return next();
      const result = await pool.query(
        `select u.must_change_password
           from admin_sessions s
           join admin_users u on u.id = s.admin_user_id
          where s.token_hash = $1
            and s.expires_at > now()
            and u.active = true
          limit 1`,
        [hashToken(raw)],
      );

      const mustChangePassword = result.rowCount > 0 && result.rows[0].must_change_password;
      if (!mustChangePassword) return next();

      if (path === '/account/password') {
        if (req.method === 'GET') explainRequiredPasswordChange(res);
        return next();
      }

      return res.redirect(303, '/admin/account/password?required=1');
    } catch (error) {
      return next(error);
    }
  });
}
