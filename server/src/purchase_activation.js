import express from 'express';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

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

function page({ order = null, error = '' }) {
  const paid = order && ['paid', 'fulfilled'].includes(order.status);
  const alreadyClaimed = Boolean(order?.password_hash);
  const body = !order
    ? '<h1>We could not find that order.</h1><p>Return to the shop or contact The Wall support.</p>'
    : !paid
      ? '<h1>Payment is processing.</h1><p>Your order exists, but Stripe has not confirmed payment yet. Refresh this page shortly.</p>'
      : alreadyClaimed
        ? `<h1>Order received.</h1><p>Your Wall owner account is already active for <strong>${escapeHtml(order.purchaser_email)}</strong>.</p><a class="button" href="/my-walls/login">Sign in to My Walls</a>`
        : `<h1>Payment received.</h1><p>Your plaque order is confirmed. Activate the Wall owner account linked to this purchase.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/purchase/activate"><input type="hidden" name="session_id" value="${escapeHtml(order.stripe_checkout_session_id)}"><label>Confirm purchase email<input name="email" type="email" autocomplete="email" required placeholder="Email used at checkout"></label><button class="button" type="submit">Activate My Walls</button></form><p class="help">This verifies the paid order before allowing you to set your Wall owner password.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.78);padding:18px}.card{max-width:520px;margin:8vh auto;background:rgba(255,251,243,.97);border:1px solid #cabfaa;border-radius:17px;padding:25px;box-shadow:0 16px 45px rgba(25,20,15,.18)}.plaque{display:block;width:92px;height:92px;object-fit:cover;margin:0 auto 16px;border-radius:13px}.card h1{text-align:center;font-size:30px;margin:0 0 12px}.card p{line-height:1.55;color:#625a50}.card form{margin-top:18px}.card label{display:flex;flex-direction:column;gap:7px;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:900}.card input{min-height:50px;padding:11px 12px;border:1px solid #9d917f;border-radius:8px;background:#fffdf8;font:inherit}.button{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;margin-top:12px;border:0;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900;letter-spacing:.5px}.error{padding:11px 13px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px}.help{font-size:12px!important;color:#7b7266!important}</style></head><body><div class="shade"><main class="card"><img class="plaque" src="/plaque.png" alt="The Wall">${body}</main></div></body></html>`;
}

async function getOrder(sessionId) {
  const result = await pool.query(
    `select o.id, o.status, o.purchaser_email, o.customer_id, o.stripe_checkout_session_id,
            c.password_hash
       from commerce_orders o
       left join customer_accounts c on c.id = o.customer_id
      where o.stripe_checkout_session_id = $1
      limit 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function createClaimForPaidOrder(order) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query(
      `select o.id, o.customer_id, o.status, c.password_hash
         from commerce_orders o
         join customer_accounts c on c.id = o.customer_id
        where o.id = $1
        for update`,
      [order.id],
    );
    if (locked.rowCount === 0 || !['paid', 'fulfilled'].includes(locked.rows[0].status)) {
      throw new Error('This purchase is not ready to activate yet.');
    }
    if (locked.rows[0].password_hash) {
      await client.query('commit');
      return null;
    }
    await client.query(
      `update customer_claim_tokens set used_at = coalesce(used_at, now())
        where customer_id = $1 and order_id = $2 and used_at is null`,
      [locked.rows[0].customer_id, order.id],
    );
    const raw = makeToken(32);
    await client.query(
      `insert into customer_claim_tokens (customer_id, order_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '30 minutes')`,
      [locked.rows[0].customer_id, order.id, hashToken(raw)],
    );
    await client.query('commit');
    return raw;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

export function mountPurchaseActivation(app) {
  const router = express.Router();

  router.get('/success', async (req, res, next) => {
    try {
      const order = await getOrder(clean(req.query?.session_id));
      return res.type('html').send(page({ order }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/activate', async (req, res, next) => {
    try {
      const sessionId = clean(req.body?.session_id);
      const email = clean(req.body?.email).toLowerCase();
      const order = await getOrder(sessionId);
      if (!order || !['paid', 'fulfilled'].includes(order.status)) {
        return res.status(400).type('html').send(page({ order, error: 'Payment has not been confirmed for this order yet.' }));
      }
      if (email !== clean(order.purchaser_email).toLowerCase()) {
        return res.status(403).type('html').send(page({ order, error: 'That email does not match the paid order.' }));
      }
      if (order.password_hash) return res.redirect(303, '/my-walls/login');
      const token = await createClaimForPaidOrder(order);
      if (!token) return res.redirect(303, '/my-walls/login');
      return res.redirect(303, `/my-walls/claim/${encodeURIComponent(token)}`);
    } catch (error) {
      return next(error);
    }
  });

  app.use('/purchase', router);
}
