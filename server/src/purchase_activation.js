import express from 'express';

import { hashToken, makeToken } from './auth.js';
import { reconcileCheckoutSessionById } from './commerce_support.js';
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

function money(amount, currency = 'aud') {
  if (!Number.isFinite(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: String(currency || 'aud').toUpperCase(),
    }).format(Number(amount) / 100);
  } catch (_) {
    return `$${(Number(amount) / 100).toFixed(2)}`;
  }
}

function page({ order = null, error = '', reconcileError = '' }) {
  const paid = order && ['paid', 'fulfilled'].includes(order.status);
  const alreadyClaimed = Boolean(order?.password_hash);
  const emailSent = Boolean(order?.customer_confirmation_sent_at);
  const emailError = clean(order?.customer_confirmation_error);
  const body = !order
    ? '<h1>We could not find that order.</h1><p>Return to the shop or contact The Wall support.</p><a class="button secondary" href="/shop">Back to shop</a>'
    : !paid
      ? `<div class="status waiting">Payment processing</div><h1>We’re confirming your payment.</h1><p>Your order exists, but Stripe has not confirmed it as paid yet.</p>${reconcileError ? `<div class="error">${escapeHtml(reconcileError)}</div>` : ''}<a class="button secondary" href="/purchase/success?session_id=${encodeURIComponent(order.stripe_checkout_session_id || '')}">Check again</a>`
      : alreadyClaimed
        ? `<div class="status paid">Payment confirmed</div><h1>Your order is in.</h1>${emailSent ? `<div class="email-state good">✓ Confirmation email sent to ${escapeHtml(order.purchaser_email)}</div>` : emailError ? `<div class="email-state bad">Email delivery needs attention: ${escapeHtml(emailError)}</div>` : '<div class="email-state warn">Confirmation email has not been recorded yet.</div>'}<div class="summary"><div><span>Order</span><b>${escapeHtml(order.id)}</b></div><div><span>Plaques</span><b>${escapeHtml(order.quantity)}</b></div><div><span>Total</span><b>${escapeHtml(money(order.amount_total, order.currency))}</b></div></div><p>Your Wall owner account is already active.</p><a class="button" href="/my-walls/login">Open My Walls</a>`
        : `<div class="status paid">Payment confirmed</div><h1>Your Wall plaque is ordered.</h1>${emailSent ? `<div class="email-state good">✓ Confirmation email sent to ${escapeHtml(order.purchaser_email)}</div>` : emailError ? `<div class="email-state bad"><b>Your order is safe.</b><br>The confirmation email could not be delivered: ${escapeHtml(emailError)}. You can activate your account here instead.</div>` : '<div class="email-state warn">Your order is confirmed. Email delivery is still being checked.</div>'}<div class="summary"><div><span>Order</span><b>${escapeHtml(order.id)}</b></div><div><span>Plaques</span><b>${escapeHtml(order.quantity)}</b></div><div><span>Total</span><b>${escapeHtml(money(order.amount_total, order.currency))}</b></div></div><p>Activate the Wall owner account linked to this purchase. Your Wall will appear in My Walls when the physical plaque is assigned while your order is packed.</p>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/purchase/activate"><input type="hidden" name="session_id" value="${escapeHtml(order.stripe_checkout_session_id)}"><label>Confirm purchase email<input name="email" type="email" autocomplete="email" required value="${escapeHtml(order.purchaser_email)}"></label><button class="button" type="submit">Activate My Walls</button></form><p class="help">The email check prevents somebody with a copied success link from claiming your Wall account.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Order confirmed · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.8);padding:18px}.card{max-width:560px;margin:6vh auto;background:rgba(255,251,243,.98);border:1px solid #cabfaa;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(25,20,15,.18)}.plaque{display:block;width:120px;max-width:38%;margin:0 auto 20px;object-fit:contain}.status{width:max-content;margin:0 auto 10px;padding:6px 9px;border-radius:999px;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.status.paid{background:#dfead9;color:#355230}.status.waiting{background:#f2e4b9;color:#76550e}.card h1{text-align:center;font-size:32px;letter-spacing:-.8px;line-height:1.05;margin:0 0 13px}.card p{line-height:1.55;color:#625a50}.summary{display:grid;grid-template-columns:2fr .7fr 1fr;gap:7px;margin:18px 0}.summary>div{min-width:0;padding:11px;background:#f2ede4;border-radius:9px}.summary span{display:block;margin-bottom:5px;color:#7b7266;font-size:8px;text-transform:uppercase;letter-spacing:.7px;font-weight:900}.summary b{display:block;font-size:11px;overflow-wrap:anywhere}.email-state{margin:16px 0;padding:11px 12px;border-radius:9px;font-size:12px;line-height:1.45;font-weight:750}.email-state.good{background:#e5efe1;color:#3e5c39}.email-state.warn{background:#f5e7bf;color:#76530d}.email-state.bad{background:#f0d8d3;color:#7c342f}.card form{margin-top:18px}.card label{display:flex;flex-direction:column;gap:7px;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:900}.card input{min-height:50px;padding:11px 12px;border:1px solid #9d917f;border-radius:8px;background:#fffdf8;font:inherit}.button{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;margin-top:12px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900;letter-spacing:.5px}.button.secondary{background:#fffdf8;color:#171411}.error{padding:11px 13px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px}.help{font-size:12px!important;color:#7b7266!important}@media(max-width:520px){.card{padding:22px 18px;margin:3vh auto}.summary{grid-template-columns:1fr 1fr}.summary>div:first-child{grid-column:1/-1}.card h1{font-size:28px}}</style></head><body><div class="shade"><main class="card"><img class="plaque" src="/plaque.png" alt="The Wall">${body}</main></div></body></html>`;
}

async function getOrder(sessionId) {
  const result = await pool.query(
    `select o.id, o.status, o.purchaser_email, o.customer_id, o.stripe_checkout_session_id,
            o.quantity, o.amount_total, o.currency,
            o.customer_confirmation_sent_at, o.customer_confirmation_error,
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
      const sessionId = clean(req.query?.session_id);
      let reconcileError = '';
      if (sessionId) {
        try {
          await reconcileCheckoutSessionById(sessionId);
        } catch (error) {
          reconcileError = error?.message || 'Could not recheck payment with Stripe.';
          console.error('[purchase-success-reconcile]', reconcileError);
        }
      }
      const order = await getOrder(sessionId);
      return res.type('html').send(page({ order, reconcileError }));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/activate', async (req, res, next) => {
    try {
      const sessionId = clean(req.body?.session_id);
      const email = clean(req.body?.email).toLowerCase();
      let order = await getOrder(sessionId);
      if (!order || !['paid', 'fulfilled'].includes(order.status)) {
        try { await reconcileCheckoutSessionById(sessionId); } catch (_) {}
        order = await getOrder(sessionId);
      }
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
