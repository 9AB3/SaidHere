import crypto from 'node:crypto';
import express from 'express';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';
const CLAIM_DAYS = 7;

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
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers,
    body: params,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
  }
  return data;
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

async function ensureCustomer(client, email, stripeCustomerId = null) {
  const normalized = clean(email).toLowerCase();
  if (!normalized || !normalized.includes('@')) throw new Error('A valid purchaser email is required.');
  let result = await client.query(
    `select id, email, display_name, password_hash, stripe_customer_id
       from customer_accounts
      where lower(email) = $1
      limit 1`,
    [normalized],
  );
  if (result.rowCount === 0) {
    result = await client.query(
      `insert into customer_accounts (email, stripe_customer_id)
       values ($1, $2)
       returning id, email, display_name, password_hash, stripe_customer_id`,
      [normalized, stripeCustomerId],
    );
  } else if (stripeCustomerId && !result.rows[0].stripe_customer_id) {
    result = await client.query(
      `update customer_accounts set stripe_customer_id = $2, updated_at = now()
        where id = $1
        returning id, email, display_name, password_hash, stripe_customer_id`,
      [result.rows[0].id, stripeCustomerId],
    );
  }
  return result.rows[0];
}

async function issueClaimToken(client, customerId, orderId) {
  await client.query(
    `update customer_claim_tokens
        set used_at = coalesce(used_at, now())
      where customer_id = $1 and order_id = $2 and used_at is null`,
    [customerId, orderId],
  );
  const raw = makeToken(32);
  await client.query(
    `insert into customer_claim_tokens (customer_id, order_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '${CLAIM_DAYS} days')`,
    [customerId, orderId, hashToken(raw)],
  );
  return `${baseUrl()}/my-walls/claim/${raw}`;
}

async function sendClaimEmail({ email, claimUrl, quantity }) {
  const apiKey = process.env.RESEND_API_KEY || '';
  const from = process.env.CUSTOMER_EMAIL_FROM || 'The Wall <noreply@saidhere.app>';
  if (!apiKey) {
    console.warn(`[commerce] RESEND_API_KEY not configured; activation email not sent to ${email}.`);
    return false;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Activate your The Wall plaque account',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>The Wall</h1><p>Your payment for ${quantity} plaque${quantity === 1 ? '' : 's'} has been received.</p><p>Create your Wall owner account now. Your purchased Wall${quantity === 1 ? '' : 's'} will appear here as each physical plaque is packed and assigned to your order.</p><p><a href="${claimUrl}" style="display:inline-block;padding:14px 18px;background:#171411;color:#fff;text-decoration:none;font-weight:700">Activate My Walls</a></p><p>This activation link expires in ${CLAIM_DAYS} days.</p></div>`,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[commerce] Could not send activation email:', response.status, text.slice(0, 500));
    return false;
  }
  return true;
}

async function markCheckoutPaid(session) {
  const orderId = clean(session.client_reference_id || session.metadata?.order_id);
  if (!orderId) return;
  const email = clean(session.customer_details?.email || session.customer_email).toLowerCase();
  const stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null;

  const client = await pool.connect();
  let activation = null;
  try {
    await client.query('begin');
    const locked = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (locked.rowCount === 0) {
      await client.query('rollback');
      return;
    }
    const order = locked.rows[0];
    if (order.status !== 'pending') {
      await client.query('commit');
      return;
    }
    const customer = await ensureCustomer(client, email || order.purchaser_email, stripeCustomerId);
    await client.query(
      `update commerce_orders
          set customer_id = $2,
              purchaser_email = $3,
              status = 'paid',
              amount_total = $4,
              currency = $5,
              stripe_checkout_session_id = coalesce(stripe_checkout_session_id, $6),
              stripe_payment_intent_id = $7,
              stripe_customer_id = $8,
              paid_at = now(),
              updated_at = now()
        where id = $1`,
      [order.id, customer.id, customer.email, session.amount_total ?? null, session.currency || null, session.id, paymentIntentId, stripeCustomerId],
    );
    const claimUrl = await issueClaimToken(client, customer.id, order.id);
    activation = { email: customer.email, claimUrl, quantity: Number(order.quantity) };
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
  if (activation) await sendClaimEmail(activation);
}

async function markCheckoutExpired(session) {
  const orderId = clean(session.client_reference_id || session.metadata?.order_id);
  if (!orderId) return;
  await pool.query(
    `update commerce_orders set status = 'cancelled', updated_at = now()
      where id = $1 and status = 'pending'`,
    [orderId],
  );
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
        `update stripe_webhook_events
            set last_error = $2
          where stripe_event_id = $1`,
        [ledger.eventId, String(error?.message || error).slice(0, 1000)],
      );
    } else {
      await client.query(
        `update stripe_webhook_events
            set processed_at = now(), last_error = null
          where stripe_event_id = $1`,
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
      if (ledger.busy) {
        return res.status(409).send('Stripe event is already being processed.');
      }
      if (ledger.duplicate) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object || {};
        if (session.payment_status === 'paid') await markCheckoutPaid(session);
      } else if (event.type === 'checkout.session.async_payment_succeeded') {
        await markCheckoutPaid(event.data?.object || {});
      } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired') {
        await markCheckoutExpired(event.data?.object || {});
      }

      await finishStripeEvent(ledger);
      return res.status(200).json({ received: true });
    } catch (error) {
      try {
        await finishStripeEvent(ledger, error);
      } catch (ledgerError) {
        console.error('[stripe-webhook-ledger]', ledgerError);
      }
      console.error('[stripe-webhook]', error);
      return res.status(500).send('Webhook processing failed.');
    }
  });
}

async function createCheckout(email, quantity) {
  if (!stripeConfigured()) throw new Error('Online plaque purchasing is not configured yet.');
  const normalized = clean(email).toLowerCase();
  if (!normalized || !normalized.includes('@')) throw new Error('Enter a valid email address.');
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error('Choose between 1 and 10 plaques.');

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
    countries.forEach((country, index) => params.set(`shipping_address_collection[allowed_countries][${index}]`, country));
    const session = await stripePost('/checkout/sessions', params, {
      idempotencyKey: `wall-order-${order.id}`,
    });
    await pool.query(
      `update commerce_orders set stripe_checkout_session_id = $2, updated_at = now() where id = $1`,
      [order.id, session.id],
    );
    return session;
  } catch (error) {
    await pool.query(`update commerce_orders set status = 'cancelled', updated_at = now() where id = $1 and status='pending'`, [order.id]);
    throw error;
  }
}

function shopPage({ error = '', cancelled = false } = {}) {
  const configured = stripeConfigured();
  const displayPrice = clean(process.env.WALL_PLAQUE_DISPLAY_PRICE) || 'Price shown securely at checkout';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Buy The Wall plaque</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shade{min-height:100vh;background:rgba(235,225,205,.72);padding:28px 16px}.card{max-width:520px;margin:3vh auto;background:rgba(252,248,240,.96);border:1px solid #c9bdab;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(25,20,15,.18)}.plaque{display:block;width:min(290px,82%);margin:0 auto 22px;border-radius:20px}.eyebrow{text-align:center;font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:950;color:#756d62}.card h1{text-align:center;font-size:34px;line-height:1;margin:8px 0}.lead{text-align:center;font-size:17px;line-height:1.5;color:#5f584f}.price{text-align:center;font-weight:900;margin:18px 0}.field{display:flex;flex-direction:column;gap:6px;margin:13px 0}.field label{font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input,.field select{min-height:50px;padding:11px 12px;border:1px solid #9b8f7e;border-radius:9px;background:#fffdf8;font:inherit}.button{width:100%;min-height:52px;border:0;border-radius:9px;background:#171411;color:#fff;font-weight:950;letter-spacing:.8px;text-transform:uppercase}.error,.notice{padding:12px 14px;border-radius:9px;margin-bottom:12px;font-weight:750}.error{background:#f0d8d3}.notice{background:#f4e5bc}.help{color:#756d62;line-height:1.55;font-size:13px}</style></head><body><div class="shade"><main class="card"><img class="plaque" src="/plaque.png" alt="The Wall NFC plaque"><div class="eyebrow">Own the place</div><h1>Buy a Wall plaque</h1><p class="lead">A physical NFC plaque connected to its own anonymous Wall. The purchaser controls the Wall details and moderation.</p>${cancelled ? '<div class="notice">Checkout was cancelled. Nothing was charged.</div>' : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<div class="price">${escapeHtml(displayPrice)}</div>${configured ? `<form method="post" action="/shop/checkout"><div class="field"><label>Purchase email</label><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>Quantity</label><select name="quantity"><option value="1">1 plaque</option><option value="2">2 plaques</option><option value="3">3 plaques</option><option value="4">4 plaques</option><option value="5">5 plaques</option><option value="6">6 plaques</option><option value="7">7 plaques</option><option value="8">8 plaques</option><option value="9">9 plaques</option><option value="10">10 plaques</option></select></div><button class="button" type="submit">Continue to secure checkout</button></form>` : '<div class="notice">Online checkout is being configured. The purchase workflow is ready but Stripe keys and the plaque Price ID still need to be added to Render.</div>'}<p class="help">After payment, you activate your Wall owner account. Your Wall appears under <strong>My Walls</strong> when its physical plaque is assigned while your order is packed.</p></main></div></body></html>`;
}

function purchaseSuccessPage(order) {
  const paid = order?.status === 'paid' || order?.status === 'fulfilled';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order received · The Wall</title><style>body{margin:0;background:#eee5d5;color:#171411;font-family:Arial,sans-serif}.card{max-width:540px;margin:10vh auto;padding:28px;background:#fffaf1;border:1px solid #cabfab;border-radius:16px}a{color:inherit;font-weight:800}</style></head><body><main class="card"><h1>${paid ? 'Payment received.' : 'Payment is processing.'}</h1><p>${paid ? 'We have your Wall plaque order. Check your purchase email for the activation link to My Walls.' : 'Your order exists, but payment confirmation has not reached us yet. Refresh this page shortly.'}</p><p>Your physical plaque will be linked to your account when it is packed. You can then rename it, set its location, deactivate it and review reported posts.</p><p><a href="/my-walls">Go to My Walls</a></p></main></body></html>`;
}

async function requirePlatformOwner(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `select s.id as session_id, u.id, u.username, u.display_name, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1 and s.expires_at > now() and u.active = true and u.role = 'owner'
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.status(403).send('Main Admin access required.');
    req.platformAdmin = { ...result.rows[0], raw, csrf: hashToken(`admin-csrf:${raw}`) };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdminCsrf(req, res, next) {
  if (!req.platformAdmin?.csrf || clean(req.body?._csrf) !== req.platformAdmin.csrf) return res.status(403).send('Request expired.');
  return next();
}

async function fulfilNextPlaque(orderId, { serialCode, displayName, locationHint }) {
  const appBase = baseUrl();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select * from commerce_orders where id=$1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    const order = orderResult.rows[0];
    if (!['paid', 'fulfilled'].includes(order.status)) throw new Error('This order has not been paid.');
    if (!order.customer_id) throw new Error('This paid order has no customer account attached.');
    const itemResult = await client.query(
      `select * from commerce_order_items where order_id=$1 and status='awaiting_fulfillment' order by ordinal limit 1 for update`,
      [order.id],
    );
    if (itemResult.rowCount === 0) throw new Error('All plaques in this order are already fulfilled.');
    const item = itemResult.rows[0];
    const serial = clean(serialCode).toUpperCase() || `TW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const wallName = clean(displayName) || 'My Wall';
    const location = clean(locationHint);
    if (wallName.length > 80) throw new Error('Wall name must be 80 characters or fewer.');
    if (location.length > 120) throw new Error('Location must be 120 characters or fewer.');

    const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
    const rawNfc = makeToken(36);
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint) values ($1,$2,$3)
       returning id, slug, display_name, location_hint`,
      [slug, wallName, location],
    );
    const wall = wallResult.rows[0];
    const tagResult = await client.query(
      `insert into wall_tags (wall_id, token_hash, active) values ($1,$2,true) returning id`,
      [wall.id, hashToken(rawNfc)],
    );
    const plaqueResult = await client.query(
      `insert into plaques (serial_code, order_item_id, wall_id, wall_tag_id, status, assigned_at)
       values ($1,$2,$3,$4,'assigned',now()) returning id, serial_code`,
      [serial, item.id, wall.id, tagResult.rows[0].id],
    );
    const plaque = plaqueResult.rows[0];
    await client.query(
      `insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id)
       values ($1,$2,$3,$4)`,
      [order.customer_id, wall.id, order.id, plaque.id],
    );
    await client.query(
      `update commerce_order_items set status='fulfilled', wall_id=$2, fulfilled_at=now() where id=$1`,
      [item.id, wall.id],
    );
    const remaining = await client.query(
      `select count(*)::int as count from commerce_order_items where order_id=$1 and status='awaiting_fulfillment'`,
      [order.id],
    );
    if (remaining.rows[0].count === 0) {
      await client.query(`update commerce_orders set status='fulfilled', fulfilled_at=now(), updated_at=now() where id=$1`, [order.id]);
    }
    await client.query('commit');
    return { wall, plaque, nfc_url: `${appBase}/t/${rawNfc}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function fulfillmentPage({ admin, orders, customers, result = null, error = '' }) {
  const orderCards = orders.length ? orders.map((order) => `<article class="order"><div><strong>${escapeHtml(order.purchaser_email)}</strong><span>${escapeHtml(order.status)} · ${escapeHtml(order.fulfilled_items)}/${escapeHtml(order.quantity)} plaques fulfilled</span></div>${order.status === 'paid' && Number(order.fulfilled_items) < Number(order.quantity) ? `<form method="post" action="/admin/fulfillment/${encodeURIComponent(order.id)}/next"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><input name="serial_code" placeholder="Plaque serial (optional)"><input name="display_name" placeholder="Initial Wall name" value="My Wall"><input name="location_hint" placeholder="Initial location (optional)"><button type="submit">Assign next plaque</button></form>` : ''}<form method="post" action="/admin/fulfillment/${encodeURIComponent(order.id)}/claim-link"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="secondary" type="submit">Generate activation link</button></form></article>`).join('') : '<p>No purchase orders yet.</p>';
  const customerRows = customers.length ? customers.map((customer) => `<tr><td>${escapeHtml(customer.email)}</td><td>${escapeHtml(customer.wall_count)}</td><td>${escapeHtml(customer.last_login_at ? new Date(customer.last_login_at).toLocaleDateString('en-AU') : 'Never')}</td></tr>`).join('') : '<tr><td colspan="3">No customers yet.</td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders · The Wall Admin</title><style>*{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif}.shell{max-width:1050px;margin:auto;padding:22px}.top{display:flex;justify-content:space-between;align-items:center;background:#181512;color:#fff;padding:15px 18px;border-radius:14px}.top a{color:#fff}.grid{display:grid;grid-template-columns:1.3fr .7fr;gap:16px;margin-top:18px}.panel{background:#fffaf1;border:1px solid #d4c9b8;border-radius:14px;padding:18px}.order{padding:14px 0;border-bottom:1px solid #e2d8ca}.order:last-child{border:0}.order>div{display:flex;justify-content:space-between;gap:10px;margin-bottom:10px}.order span{color:#756d62;font-size:12px}.order form{display:flex;gap:7px;flex-wrap:wrap;margin:7px 0}.order input{min-height:40px;padding:8px;border:1px solid #b8ac9b;border-radius:7px;flex:1 1 150px}button{min-height:40px;padding:9px 12px;border:0;border-radius:7px;background:#181512;color:#fff;font-weight:800}.secondary{background:#fff;color:#181512;border:1px solid #b8ac9b}.result,.error{padding:12px 14px;border-radius:9px;margin:15px 0}.result{background:#dfeada}.error{background:#f0d7d2}.nfc{overflow-wrap:anywhere;font-family:monospace;background:#f1eadf;padding:10px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px;border-bottom:1px solid #e1d8ca;font-size:12px}@media(max-width:760px){.shell{padding:12px}.grid{grid-template-columns:1fr}.order>div{flex-direction:column}}</style></head><body><main class="shell"><header class="top"><div><strong>The Wall Admin</strong><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#bfb6aa">Orders & fulfilment</div></div><a href="/admin/walls">Walls</a></header>${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}${result ? `<div class="result"><strong>Plaque assigned: ${escapeHtml(result.plaque.serial_code)}</strong><p>Program this exact URL onto the physical NFC chip now. It cannot be shown again later.</p><div class="nfc">${escapeHtml(result.nfc_url)}</div></div>` : ''}<div class="grid"><section class="panel"><h1>Orders</h1>${orderCards}</section><section class="panel"><h1>Customers</h1><table><thead><tr><th>Email</th><th>Walls</th><th>Last login</th></tr></thead><tbody>${customerRows}</tbody></table></section></div></main></body></html>`;
}

async function fulfillmentData() {
  const [orders, customers] = await Promise.all([
    pool.query(
      `select o.*, count(i.id) filter (where i.status='fulfilled')::int as fulfilled_items
         from commerce_orders o
         left join commerce_order_items i on i.order_id=o.id
        group by o.id
        order by o.created_at desc
        limit 100`,
    ),
    pool.query(
      `select c.id, c.email, c.last_login_at,
              count(o.id) filter (where o.ended_at is null)::int as wall_count
         from customer_accounts c
         left join wall_ownerships o on o.customer_id=c.id
        group by c.id
        order by c.created_at desc
        limit 100`,
    ),
  ]);
  return { orders: orders.rows, customers: customers.rows };
}

async function manualClaimLink(orderId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select id, customer_id from commerce_orders where id=$1 for update`, [orderId]);
    if (result.rowCount === 0 || !result.rows[0].customer_id) throw new Error('Paid customer account not found for this order.');
    const url = await issueClaimToken(client, result.rows[0].customer_id, orderId);
    await client.query('commit');
    return url;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

export function mountCommerce(app) {
  app.get('/shop', (req, res) => res.type('html').send(shopPage({ cancelled: clean(req.query?.cancelled) === '1' })));

  app.post('/shop/checkout', async (req, res) => {
    try {
      const session = await createCheckout(req.body?.email, req.body?.quantity);
      return res.redirect(303, session.url);
    } catch (error) {
      return res.status(400).type('html').send(shopPage({ error: error?.message || 'Could not start checkout.' }));
    }
  });

  app.post('/api/store/checkout', async (req, res, next) => {
    try {
      const session = await createCheckout(req.body?.email, req.body?.quantity);
      return res.status(201).json({ checkout_url: session.url, session_id: session.id });
    } catch (error) {
      return next(error);
    }
  });

  app.get('/purchase/success', async (req, res) => {
    const sessionId = clean(req.query?.session_id);
    const result = sessionId
      ? await pool.query(`select status, quantity from commerce_orders where stripe_checkout_session_id=$1 limit 1`, [sessionId])
      : { rowCount: 0, rows: [] };
    return res.type('html').send(purchaseSuccessPage(result.rows[0] || null));
  });

  app.get('/admin/fulfillment', requirePlatformOwner, async (req, res, next) => {
    try {
      const data = await fulfillmentData();
      return res.type('html').send(fulfillmentPage({ admin: req.platformAdmin, ...data }));
    } catch (error) {
      return next(error);
    }
  });

  app.post('/admin/fulfillment/:orderId/next', requirePlatformOwner, requireAdminCsrf, async (req, res) => {
    try {
      const result = await fulfilNextPlaque(req.params.orderId, {
        serialCode: req.body?.serial_code,
        displayName: req.body?.display_name,
        locationHint: req.body?.location_hint,
      });
      const data = await fulfillmentData();
      return res.type('html').send(fulfillmentPage({ admin: req.platformAdmin, ...data, result }));
    } catch (error) {
      const data = await fulfillmentData();
      return res.status(400).type('html').send(fulfillmentPage({ admin: req.platformAdmin, ...data, error: error?.message || 'Could not assign plaque.' }));
    }
  });

  app.post('/admin/fulfillment/:orderId/claim-link', requirePlatformOwner, requireAdminCsrf, async (req, res) => {
    try {
      const url = await manualClaimLink(req.params.orderId);
      const data = await fulfillmentData();
      return res.type('html').send(fulfillmentPage({ admin: req.platformAdmin, ...data, result: { plaque: { serial_code: 'Activation link' }, nfc_url: url } }));
    } catch (error) {
      const data = await fulfillmentData();
      return res.status(400).type('html').send(fulfillmentPage({ admin: req.platformAdmin, ...data, error: error?.message || 'Could not create activation link.' }));
    }
  });
}
