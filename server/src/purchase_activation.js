import express from 'express';

import { reconcileCheckoutSessionById } from './commerce_reconcile.js';
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
      style: 'currency',
      currency: String(currency || 'aud').toUpperCase(),
    }).format(Number(amount) / 100);
  } catch (_) {
    return `$${(Number(amount) / 100).toFixed(2)}`;
  }
}

async function getOrder(sessionId) {
  if (!clean(sessionId).startsWith('cs_')) return null;
  const result = await pool.query(
    `select o.id, o.status, o.purchaser_email, o.customer_id,
            o.stripe_checkout_session_id, o.quantity, o.amount_total, o.currency,
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

function page({ order = null, reconcileError = '' }) {
  const paid = order && ['paid', 'fulfilled'].includes(order.status);
  const accountActive = Boolean(order?.password_hash);
  const emailSent = Boolean(order?.customer_confirmation_sent_at);
  const emailError = Boolean(clean(order?.customer_confirmation_error));

  let body;
  if (!order) {
    body = '<h1>We could not find that order.</h1><p>Return to the shop or contact The Wall support.</p><a class="button secondary" href="/shop">Back to shop</a>';
  } else if (!paid) {
    body = `<div class="status waiting">Payment processing</div><h1>We’re confirming your payment.</h1><p>Your order exists, but Stripe has not confirmed it as paid yet.</p>${reconcileError ? '<div class="error">Payment status could not be refreshed just now. Your order has not been lost.</div>' : ''}<a class="button secondary" href="/purchase/success?session_id=${encodeURIComponent(order.stripe_checkout_session_id || '')}">Check again</a>`;
  } else {
    const emailBlock = emailSent
      ? '<div class="email-state good">✓ Confirmation email sent.</div>'
      : emailError
        ? '<div class="email-state bad"><b>Your order is safe.</b><br>We could not send the confirmation email. The first physical scan can still activate your owner account.</div>'
        : '<div class="email-state warn">Your order is confirmed. Email delivery has not been recorded yet.</div>';
    const next = accountActive
      ? '<p>Your Wall owner account is already active.</p><a class="button" href="/my-walls">Open My Walls</a>'
      : emailSent
        ? '<p>Use the activation link in your confirmation email to create your Wall owner login.</p><a class="button" href="/my-walls/login">Go to My Walls</a>'
        : '<p>You do not need the email to use your order. When your Wall arrives, its first NFC scan can verify the purchase email and activate your owner account securely.</p><a class="button" href="/my-walls/login">Go to My Walls</a>';
    body = `<div class="status paid">Payment confirmed</div><h1>Your Wall order is in.</h1>${emailBlock}<div class="summary"><div><span>Order</span><b>${escapeHtml(order.id)}</b></div><div><span>Walls</span><b>${escapeHtml(order.quantity)}</b></div><div><span>Total</span><b>${escapeHtml(money(order.amount_total, order.currency))}</b></div></div>${next}<p class="help">We’ll link the NFC before shipping. You choose the Wall name and location on the first scan.</p>`;
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Order confirmed · The Wall</title><style>
    *{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,Arial,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.8);padding:18px}.card{max-width:560px;margin:6vh auto;background:rgba(255,251,243,.98);border:1px solid #cabfaa;border-radius:18px;padding:28px;box-shadow:0 18px 50px rgba(25,20,15,.18)}.wall{display:block;width:120px;max-width:38%;margin:0 auto 20px;object-fit:contain}.status{width:max-content;margin:0 auto 10px;padding:6px 9px;border-radius:999px;font-size:9px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.status.paid{background:#dfead9;color:#355230}.status.waiting{background:#f2e4b9;color:#76550e}.card h1{text-align:center;font-size:32px;letter-spacing:-.8px;line-height:1.05;margin:0 0 13px}.card p{line-height:1.55;color:#625a50}.summary{display:grid;grid-template-columns:2fr .7fr 1fr;gap:7px;margin:18px 0}.summary>div{min-width:0;padding:11px;background:#f2ede4;border-radius:9px}.summary span{display:block;margin-bottom:5px;color:#7b7266;font-size:8px;text-transform:uppercase;letter-spacing:.7px;font-weight:900}.summary b{display:block;font-size:11px;overflow-wrap:anywhere}.email-state{margin:16px 0;padding:11px 12px;border-radius:9px;font-size:12px;line-height:1.45;font-weight:750}.email-state.good{background:#e5efe1;color:#3e5c39}.email-state.warn{background:#f5e7bf;color:#76530d}.email-state.bad{background:#f0d8d3;color:#7c342f}.button{display:flex;width:100%;min-height:50px;align-items:center;justify-content:center;margin-top:12px;border:1px solid #171411;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900;letter-spacing:.5px}.button.secondary{background:#fffdf8;color:#171411}.error{padding:11px 13px;background:#f0d8d3;border-left:4px solid #963c33;border-radius:8px}.help{font-size:12px!important;color:#7b7266!important}@media(max-width:520px){.card{padding:22px 18px;margin:3vh auto}.summary{grid-template-columns:1fr 1fr}.summary>div:first-child{grid-column:1/-1}.card h1{font-size:28px}}
  </style></head><body><div class="shade"><main class="card"><img class="wall" src="/plaque.png" alt="The Wall">${body}</main></div></body></html>`;
}

export function mountPurchaseActivation(app) {
  const router = express.Router();

  router.get('/success', async (req, res, next) => {
    try {
      const sessionId = clean(req.query?.session_id);
      let reconcileError = '';
      if (sessionId.startsWith('cs_')) {
        try {
          await reconcileCheckoutSessionById(sessionId);
        } catch (error) {
          reconcileError = error?.message || 'Could not recheck payment with Stripe.';
          console.error('[purchase-success-reconcile]', reconcileError);
        }
      }
      return res.type('html').send(page({ order: await getOrder(sessionId), reconcileError }));
    } catch (error) {
      return next(error);
    }
  });

  // Account activation is deliberately not accepted from the Stripe success URL.
  // A Checkout Session ID can appear in browser history. Activation instead uses
  // the one-time emailed claim token or possession of the physical Wall on first scan.
  app.use('/purchase', router);
}
