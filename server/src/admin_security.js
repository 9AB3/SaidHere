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

export function mountAdminSecurity(app) {
  app.use('/admin', async (req, res, next) => {
    try {
      const path = req.path || '/';
      if (path === '/login' || path === '/account/password' || path === '/logout') return next();

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
      if (result.rowCount > 0 && result.rows[0].must_change_password) {
        return res.redirect(303, '/admin/account/password');
      }
      return next();
    } catch (error) {
      return next(error);
    }
  });
}
