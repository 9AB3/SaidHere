import express from 'express';
import rateLimit from 'express-rate-limit';

import { hashToken } from './auth.js';
import { mountCustomerPasswordReset } from './customer_password_reset.js';
import { mountWallDiscoveryLocations } from './wall_discovery_locations.js';
import { pool } from './db.js';

const CUSTOMER_COOKIE_NAME = 'the_wall_customer';

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
    try { result[key] = decodeURIComponent(part.slice(at + 1).trim()); }
    catch (_) { result[key] = part.slice(at + 1).trim(); }
  }
  return result;
}

function clearCustomerCookie(req, res) {
  const parts = [
    `${CUSTOMER_COOKIE_NAME}=`,
    'Path=/my-walls',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production' || req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function currentCustomerSession(req) {
  const raw = parseCookies(req)[CUSTOMER_COOKIE_NAME] || '';
  if (!raw) return null;
  const result = await pool.query(
    `select s.id as session_id, c.id, c.email
       from customer_sessions s
       join customer_accounts c on c.id = s.customer_id
      where s.token_hash = $1
        and s.expires_at > now()
        and c.active = true
      limit 1`,
    [hashToken(raw)],
  );
  if (result.rowCount === 0) return null;
  return {
    raw,
    csrf: hashToken(`customer-csrf:${raw}`),
    sessionId: result.rows[0].session_id,
    customerId: result.rows[0].id,
    email: result.rows[0].email,
  };
}

function deletionPage(session, error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete owner account · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:560px;margin:6vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px}.card h1{font-size:32px;margin:0 0 10px}.card p,.card li{color:#625a50;line-height:1.55}.warning{padding:13px 15px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px;font-weight:750}.field{display:flex;flex-direction:column;gap:6px;margin:18px 0}.field label{font-size:11px;text-transform:uppercase;font-weight:900}.field input{min-height:48px;padding:11px;border:1px solid #9f9382;border-radius:8px;font:inherit}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:11px 16px;border:0;border-radius:8px;background:#963c33;color:#fff;font-weight:900;cursor:pointer}.back{display:inline-block;margin-top:18px;color:#171411;font-weight:850}.error{padding:12px 14px;background:#f0d8d3;border-radius:8px;margin:14px 0;font-weight:750}</style></head><body><div class="shade"><main class="card"><h1>Delete owner account</h1><p>Signed in as <strong>${escapeHtml(session.email)}</strong>.</p><div class="warning">This is permanent. Walls you currently own will be deactivated and you will lose owner access to them.</div><p>Deleting the owner account removes the active login account, password, sessions and account activation/reset tokens. Purchase and shipping records that must be retained for fulfilment, accounting, fraud prevention or legal obligations may remain as described in the Privacy Policy.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/my-walls/account/delete"><input type="hidden" name="_csrf" value="${escapeHtml(session.csrf)}"><div class="field"><label>Type DELETE to confirm</label><input name="confirmation" autocomplete="off" required></div><button class="button" type="submit">Delete my owner account</button></form><a class="back" href="/my-walls">Cancel and return to My Walls</a></main></div></body></html>`;
}

function deletionCompletePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account deleted · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:520px;margin:9vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;text-align:center}.card h1{font-size:30px;margin:0 0 10px}.card p{color:#625a50;line-height:1.55}.button{display:flex;align-items:center;justify-content:center;min-height:50px;margin-top:18px;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}</style></head><body><div class="shade"><main class="card"><h1>Owner account deleted.</h1><p>Your login account has been disabled and anonymised, all active owner sessions have been removed, and Walls you owned have been deactivated.</p><a class="button" href="/">Return to The Wall</a></main></div></body></html>`;
}

function activeAccountPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account already active · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.82);padding:18px}.card{max-width:480px;margin:9vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfaa;border-radius:18px;text-align:center}.card h1{font-size:30px;margin:0 0 10px}.card p{color:#625a50;line-height:1.55}.button{display:flex;align-items:center;justify-content:center;min-height:50px;margin-top:18px;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}</style></head><body><div class="shade"><main class="card"><h1>Your account is already active.</h1><p>This activation link can no longer change your password. Sign in to My Walls instead.</p><a class="button" href="/my-walls/login">Sign in to My Walls</a></main></div></body></html>`;
}

async function blockClaimForActiveAccount(req, res, next) {
  try {
    const token = clean(req.params.token);
    if (!token) return next();
    const result = await pool.query(
      `select t.customer_id, c.password_hash
         from customer_claim_tokens t
         join customer_accounts c on c.id = t.customer_id
        where t.token_hash = $1
          and t.used_at is null
          and t.expires_at > now()
          and c.active = true
        limit 1`,
      [hashToken(token)],
    );
    if (result.rowCount === 0 || !result.rows[0].password_hash) return next();

    await pool.query(
      `update customer_claim_tokens
          set used_at = coalesce(used_at, now())
        where customer_id = $1 and used_at is null`,
      [result.rows[0].customer_id],
    );
    return res.status(409).type('html').send(activeAccountPage());
  } catch (error) {
    return next(error);
  }
}

function decorateLoginPage(req, res, next) {
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    if (typeof body !== 'string' || !body.includes('action="/my-walls/login"')) {
      return originalSend(body);
    }
    let html = body;
    const notice = clean(req.query?.notice);
    if (notice && !html.includes('data-password-notice')) {
      const marker = '<form method="post" action="/my-walls/login">';
      html = html.replace(marker, `<div class="notice" data-password-notice>${escapeHtml(notice)}</div>${marker}`);
    }
    if (!html.includes('/my-walls/forgot-password')) {
      html = html.replace(
        '</form><p class="help"',
        '</form><p style="text-align:center;margin:14px 0 0"><a href="/my-walls/forgot-password" style="color:#171411;font-weight:900">Forgot password?</a></p><p class="help"',
      );
    }
    return originalSend(html);
  };
  return next();
}

export function mountCustomerSecurity(app) {
  mountCustomerPasswordReset(app);
  mountWallDiscoveryLocations(app);

  const router = express.Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const claimLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const setupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/account/delete', async (req, res, next) => {
    try {
      const session = await currentCustomerSession(req);
      if (!session) {
        return res.redirect(303, '/my-walls/login?next=%2Fmy-walls%2Faccount%2Fdelete');
      }
      return res.type('html').send(deletionPage(session));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/account/delete', async (req, res, next) => {
    let session;
    try {
      session = await currentCustomerSession(req);
      if (!session) {
        return res.redirect(303, '/my-walls/login?next=%2Fmy-walls%2Faccount%2Fdelete');
      }
      if (clean(req.body?._csrf) !== session.csrf) {
        return res.status(403).type('html').send(deletionPage(session, 'This request expired. Reload the page and try again.'));
      }
      if (clean(req.body?.confirmation) !== 'DELETE') {
        return res.status(400).type('html').send(deletionPage(session, 'Type DELETE exactly to confirm account deletion.'));
      }

      const client = await pool.connect();
      try {
        await client.query('begin');
        const walls = await client.query(
          `select wall_id
             from wall_ownerships
            where customer_id = $1 and ended_at is null
            for update`,
          [session.customerId],
        );
        const wallIds = walls.rows.map((row) => row.wall_id);
        if (wallIds.length > 0) {
          await client.query(`update walls set active = false where id = any($1::uuid[])`, [wallIds]);
          await client.query(
            `update wall_ownerships
                set ended_at = now()
              where customer_id = $1 and ended_at is null`,
            [session.customerId],
          );
        }
        await client.query(`delete from customer_sessions where customer_id = $1`, [session.customerId]);
        await client.query(`delete from customer_claim_tokens where customer_id = $1`, [session.customerId]);
        await client.query(`delete from customer_password_reset_tokens where customer_id = $1`, [session.customerId]);
        await client.query(
          `update customer_audit_log
              set email_snapshot = 'deleted account'
            where customer_id = $1`,
          [session.customerId],
        );
        await client.query(
          `update customer_accounts
              set email = $2,
                  display_name = '',
                  password_hash = null,
                  active = false,
                  stripe_customer_id = null,
                  updated_at = now()
            where id = $1`,
          [session.customerId, `deleted+${session.customerId}@deleted.invalid`],
        );
        await client.query('commit');
      } catch (error) {
        try { await client.query('rollback'); } catch (_) {}
        throw error;
      } finally {
        client.release();
      }

      clearCustomerCookie(req, res);
      return res.type('html').send(deletionCompletePage());
    } catch (error) {
      return next(error);
    }
  });

  router.post('/login', loginLimiter, (_req, _res, next) => next());
  router.use('/login', decorateLoginPage);
  router.get('/claim/:token', blockClaimForActiveAccount);
  router.post('/claim/:token', claimLimiter, blockClaimForActiveAccount);
  router.post('/setup/:token', setupLimiter, (_req, _res, next) => next());
  app.use('/my-walls', router);
}
