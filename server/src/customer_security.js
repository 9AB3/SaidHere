import express from 'express';
import rateLimit from 'express-rate-limit';

import { hashToken } from './auth.js';
import { pool } from './db.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
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

    // Retire any legacy unused links left from older multi-order purchases.
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

export function mountCustomerSecurity(app) {
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

  router.post('/login', loginLimiter, (_req, _res, next) => next());
  router.get('/claim/:token', blockClaimForActiveAccount);
  router.post('/claim/:token', claimLimiter, blockClaimForActiveAccount);
  router.post('/setup/:token', setupLimiter, (_req, _res, next) => next());
  app.use('/my-walls', router);
}
