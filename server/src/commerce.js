import crypto from 'node:crypto';
import express from 'express';

import { pool } from './db.js';
import { reconcilePaidCheckout } from './commerce_reconcile.js';

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

function baseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
}

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_WALL_PLAQUE);
}

async function stripePost(path, params, { idempotencyKey = '' } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe is not configured.');
  const headers = {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method: 'POST',
      headers,
      body: params,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Stripe took too long to respond. Please try checkout again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safeHexEqual(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!Buffer.isBuffer(rawBody) || !signatureHeader || !secret) return false;
  let timestamp = null;
  const signatures = [];
  for (const item of signatureHeader.split(',')) {
    const [key, value] = item.split('=', 2);
    if (key === 't') timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return signatures.some((signature) => safeHexEqual(signature, expected));
}

async function beginStripeEvent(event) {
  const eventId = clean(event?.id);
  if (!eventId) throw new Error('Stripe event ID is missing.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const lock = await client.query(
      `select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as locked`,
      [eventId],
    );
    if (!lock.rows[0]?.locked) {
      await client.query('rollback');
      client.release();
      return { busy: true };
    }

    const existing = await client.query(
      `select processed_at from stripe_webhook_events where stripe_event_id = $1`,
      [eventId],
    );
    if (existing.rowCount > 0 && existing.rows[0].processed_at) {
      await client.query('commit');
      client.release();
      return { duplicate: true };
    }
    if (existing.rowCount === 0) {
      await client.query(
        `insert into stripe_webhook_events (stripe_event_id, event_type, stripe_object_id)
         values ($1, $2, $3)`,
        [eventId, clean(event.type), clean(event.data?.object?.id) || null],
      );
    }
    return { client, eventId };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    client.release();
    throw error;
  }
}

async function finishStripeEvent(ledger, error = null) {
  const client = ledger?.client;
  if (!client) return;
  ledger.client = null;
  try {
    if (error) {
      await client.query(
        `update stripe_webhook_events set last_error = $2 where stripe_event_id = $1`,
        [ledger.eventId, String(error?.message || error).slice(0, 1000)],
      );
    } else {
      await client.query(
        `update stripe_webhook_events set processed_at = now(), last_error = null where stripe_event_id = $1`,
        [ledger.eventId],
      );
    }
    await client.query('commit');
  } catch (ledgerError) {
    try { await client.query('rollback'); } catch (_) {}
    throw ledgerError;
  } finally {
    client.release();
  }
}

async function markCheckoutExpired(session) {
  const orderId = clean(session?.client_reference_id || session?.metadata?.order_id);
  if (!orderId) return;
  await pool.query(
    `update commerce_orders
        set status = 'cancelled', updated_at = now()
      where id = $1 and status = 'pending'`,
    [orderId],
  );
}

export function mountStripeWebhook(app) {
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!secret) return res.status(503).send('Stripe webhook is not configured.');
    if (!verifyStripeSignature(req.body, req.get('stripe-signature') || '', secret)) {
      return res.status(400).send('Invalid Stripe signature.');
    }

    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch (_) {
      return res.status(400).send('Invalid JSON.');
    }

    let ledger = null;
    try {
      ledger = await beginStripeEvent(event);
      if (ledger.busy) return res.status(409).send('Stripe event is already being processed.');
      if (ledger.duplicate) return res.status(200).json({ received: true, duplicate: true });

      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object || {};
        if (session.payment_status === 'paid') await reconcilePaidCheckout(session);
      } else if (event.type === 'checkout.session.async_payment_succeeded') {
        await reconcilePaidCheckout(event.data?.object || {});
      } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
        await markCheckoutExpired(event.data?.object || {});
      }

      await finishStripeEvent(ledger);
      return res.status(200).json({ received: true });
    } catch (error) {
      try { await finishStripeEvent(ledger, error); }
      catch (ledgerError) { console.error('[stripe-webhook-ledger]', ledgerError); }
      console.error('[stripe-webhook]', error);
      return res.status(500).send('Webhook processing failed.');
    }
  });
}

async function createCheckout(email, quantity) {
  if (!stripeConfigured()) throw new Error('Online Wall purchasing is not configured yet.');
  const normalized = clean(email).toLowerCase();
  if (!normalized || !normalized.includes('@')) throw new Error('Enter a valid email address.');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error('Enter a quantity between 1 and 10.');

  const client = await pool.connect();
  let order;
  try {
    await client.query('begin');
    const inserted = await client.query(
      `insert into commerce_orders (purchaser_email, quantity)
       values ($1, $2)
       returning id, purchaser_email, quantity`,
      [normalized, qty],
    );
    order = inserted.rows[0];
    for (let ordinal = 1; ordinal <= qty; ordinal += 1) {
      await client.query(
        `insert into commerce_order_items (order_id, ordinal) values ($1, $2)`,
        [order.id, ordinal],
      );
    }
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  try {
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    // This Stripe account has Managed Payments enabled by default. Physical-goods
    // shipping collection is only accepted when it is disabled for this Checkout Session.
    params.set('managed_payments[enabled]', 'false');
    params.set('line_items[0][price]', process.env.STRIPE_PRICE_WALL_PLAQUE);
    params.set('line_items[0][quantity]', String(qty));
    params.set('customer_email', normalized);
    params.set('customer_creation', 'always');
    params.set('client_reference_id', order.id);
    params.set('metadata[order_id]', order.id);
    params.set('success_url', `${baseUrl()}/purchase/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${baseUrl()}/shop?cancelled=1`);
    const countries = (process.env.STRIPE_SHIPPING_COUNTRIES || 'AU')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    countries.forEach((country, index) => {
      params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
    });

    const session = await stripePost('/checkout/sessions', params, {
      idempotencyKey: `wall-order-${order.id}`,
    });
    if (!session?.id || !session?.url) throw new Error('Stripe did not return a Checkout URL.');
    await pool.query(
      `update commerce_orders
          set stripe_checkout_session_id = $2, updated_at = now()
        where id = $1`,
      [order.id, session.id],
    );
    return session;
  } catch (error) {
    await pool.query(
      `update commerce_orders set status = 'cancelled', updated_at = now()
        where id = $1 and status = 'pending'`,
      [order.id],
    );
    throw error;
  }
}

function shopPage({ error = '', cancelled = false } = {}) {
  const configured = stripeConfigured();
  const displayPrice = clean(process.env.WALL_PLAQUE_DISPLAY_PRICE) || 'Price shown securely at checkout';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Buy a Wall</title><style>
    *{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shade{min-height:100vh;background:rgba(235,225,205,.72);padding:28px 16px}.card{max-width:520px;margin:3vh auto;background:rgba(252,248,240,.96);border:1px solid #c9bdab;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(25,20,15,.18)}.wall{display:block;width:min(290px,82%);margin:0 auto 22px;border-radius:20px}.eyebrow{text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:950;color:#756d62}.card h1{text-align:center;font-size:34px;line-height:1;margin:8px 0}.lead{text-align:center;font-size:17px;line-height:1.5;color:#5f584f}.price{text-align:center;font-weight:900;margin:18px 0}.field{display:flex;flex-direction:column;gap:6px;margin:13px 0}.field label{font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input{width:100%;min-height:50px;padding:11px 12px;border:1px solid #9b8f7e;border-radius:9px;background:#fffdf8;font:inherit}.button{width:100%;min-height:52px;border:0;border-radius:9px;background:#171411;color:#fff;font-weight:950;letter-spacing:.8px;text-transform:uppercase;cursor:pointer}.error,.notice{padding:12px 14px;border-radius:9px;margin-bottom:12px;font-weight:750}.error{background:#f0d8d3}.notice{background:#f4e5bc}.help{color:#756d62;line-height:1.55;font-size:13px}
  </style></head><body><div class="shade"><main class="card"><img class="wall" src="/plaque.png" alt="The Wall"><div class="eyebrow">Own the place</div><h1>Buy a Wall</h1><p class="lead">A physical NFC Wall connected to its own anonymous conversation. You control the Wall details and moderation while posts remain anonymous.</p>${cancelled ? '<div class="notice">Checkout was cancelled. Nothing was charged.</div>' : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<div class="price">${escapeHtml(displayPrice)}</div>${configured ? `<form method="post" action="/shop/checkout"><div class="field"><label>Purchase email</label><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>Quantity</label><input name="quantity" type="number" inputmode="numeric" min="1" max="10" step="1" value="1" required></div><button class="button" type="submit">Continue to secure checkout</button></form>` : '<div class="notice">Online checkout is being configured.</div>'}<p class="help">After payment, your order appears under My Walls. When the Wall arrives, its first NFC scan lets you choose the Wall name.</p></main></div></body></html>`;
}

export function mountCommerce(app) {
  app.get('/shop', (req, res) => {
    return res.type('html').send(shopPage({ cancelled: clean(req.query?.cancelled) === '1' }));
  });

  app.post('/shop/checkout', async (req, res) => {
    try {
      const session = await createCheckout(req.body?.email, req.body?.quantity);
      return res.redirect(303, session.url);
    } catch (error) {
      console.error('[shop/checkout]', error);
      return res.status(400).type('html').send(shopPage({ error: error?.message || 'Could not start checkout.' }));
    }
  });
}