import crypto from 'node:crypto';
import express from 'express';
import nodemailer from 'nodemailer';

import { pool } from './db.js';

const WEB_BASE = (process.env.PUBLIC_WEB_URL || 'https://saidhere.app').replace(/\/$/, '');
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{4}-[0-9a-f]{12}/i;
let emailPatchInstalled = false;
let priceCache = null;

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

function orderReference(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return compact ? `TW-${compact.slice(0, 10)}` : 'TW-ORDER';
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

function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_WALL_PLAQUE);
}

async function stripeRequest(path, { method = 'GET', params = null, idempotencyKey = '' } = {}) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe is not configured.');
  const headers = { authorization: `Bearer ${secret}` };
  const options = { method, headers };
  if (params) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    options.body = params;
  }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://api.stripe.com/v1${path}`, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Stripe took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function wallPrice() {
  if (priceCache && Date.now() - priceCache.loadedAt < 5 * 60 * 1000) return priceCache;
  if (!stripeConfigured()) return { unitAmount: 1500, currency: 'aud', loadedAt: Date.now() };
  const price = await stripeRequest(`/prices/${encodeURIComponent(process.env.STRIPE_PRICE_WALL_PLAQUE)}`);
  const unitAmount = Number(price?.unit_amount);
  if (!Number.isInteger(unitAmount) || unitAmount < 0) throw new Error('The Wall Stripe price is not a fixed amount.');
  priceCache = { unitAmount, currency: clean(price.currency).toLowerCase() || 'aud', loadedAt: Date.now() };
  return priceCache;
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
    params.set('managed_payments[enabled]', 'false');
    params.set('line_items[0][price]', process.env.STRIPE_PRICE_WALL_PLAQUE);
    params.set('line_items[0][quantity]', String(qty));
    params.set('customer_email', normalized);
    params.set('customer_creation', 'always');
    params.set('client_reference_id', order.id);
    params.set('metadata[order_id]', order.id);
    params.set('success_url', `${WEB_BASE}/purchase/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${WEB_BASE}/shop?cancelled=1`);
    const countries = (process.env.STRIPE_SHIPPING_COUNTRIES || 'AU')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    countries.forEach((country, index) => {
      params.set(`shipping_address_collection[allowed_countries][${index}]`, country);
    });

    const session = await stripeRequest('/checkout/sessions', {
      method: 'POST',
      params,
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

function checkoutPage({ unitAmount, currency, error = '', cancelled = false }) {
  const configured = stripeConfigured();
  const unitLabel = money(unitAmount, currency);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Checkout · The Wall</title><style>
    :root{--ink:#171411;--paper:#fffaf1;--muted:#756d62;--line:#c9bdab;--soft:#eee7db}*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:var(--ink);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.shade{min-height:100vh;background:rgba(235,225,205,.76);padding:24px 16px 70px}.shell{width:min(980px,100%);margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.brand{display:flex;align-items:center;gap:11px;font-weight:950;letter-spacing:.12em}.brand img{width:46px;height:46px;border-radius:9px}.secure{font-size:12px;color:var(--muted);font-weight:750}.checkout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr);gap:18px;align-items:start}.panel{background:rgba(255,251,243,.98);border:1px solid var(--line);border-radius:16px;padding:22px;box-shadow:0 14px 38px rgba(25,20,15,.13)}.product{display:grid;grid-template-columns:126px 1fr;gap:18px;align-items:center;padding-bottom:20px;border-bottom:1px solid #ddd3c4}.product img{width:126px;height:126px;object-fit:cover;border-radius:16px}.eyebrow{font-size:9px;letter-spacing:1.6px;text-transform:uppercase;font-weight:950;color:var(--muted)}h1{font-size:30px;letter-spacing:-.7px;margin:6px 0 8px}.lead{margin:0;color:#625a50;line-height:1.5}.unit{margin-top:10px;font-size:14px;font-weight:900}.field{margin-top:20px}.field label{display:block;margin-bottom:7px;font-size:10px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.field input{width:100%;height:50px;border:1px solid #9b8f7e;border-radius:9px;background:#fffdf8;padding:0 13px;font:inherit}.qtyrow{display:flex;align-items:center;gap:8px}.qtyrow button{width:46px;height:46px;border:1px solid #9b8f7e;border-radius:9px;background:#fffdf8;font-size:22px;cursor:pointer}.qtyrow input{width:76px;text-align:center}.summary{position:sticky;top:18px}.summary h2{font-size:22px;margin:0 0 18px}.row{display:flex;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid #e1d8cb}.row span:first-child{color:#5f584f}.row strong{text-align:right}.row.total{font-size:20px;border-bottom:0;padding-top:18px}.shipping{font-size:12px;color:#4e6847;font-weight:850}.button{width:100%;min-height:54px;border:0;border-radius:9px;background:#171411;color:#fff;font-weight:950;letter-spacing:.5px;margin-top:14px;cursor:pointer}.button:disabled{opacity:.5;cursor:not-allowed}.fine{font-size:12px;line-height:1.45;color:var(--muted);margin:12px 0 0}.error,.notice{padding:12px 14px;border-radius:9px;margin-bottom:14px;font-weight:750}.error{background:#f0d8d3}.notice{background:#f4e5bc}@media(max-width:760px){.shade{padding:14px 10px 55px}.checkout{grid-template-columns:1fr}.summary{position:static}.panel{padding:18px}.product{grid-template-columns:96px 1fr}.product img{width:96px;height:96px}h1{font-size:25px}.secure{display:none}}
  </style></head><body><div class="shade"><main class="shell"><header class="top"><div class="brand"><img src="/plaque.png" alt="The Wall"><span>THE WALL</span></div><div class="secure">Secure checkout powered by Stripe</div></header>${cancelled ? '<div class="notice">Checkout was cancelled. Nothing was charged.</div>' : ''}${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}<form method="post" action="/shop/checkout" id="checkoutForm"><div class="checkout"><section class="panel"><div class="product"><img src="/plaque.png" alt="The Wall"><div><div class="eyebrow">Physical NFC Wall</div><h1>Your Wall</h1><p class="lead">A physical place for an anonymous conversation. Name and location are set on the first scan.</p><div class="unit">${escapeHtml(unitLabel)} each · shipping included</div></div></div><div class="field"><label>Purchase email</label><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>Quantity</label><div class="qtyrow"><button type="button" id="minus" aria-label="Decrease quantity">−</button><input id="quantity" name="quantity" type="number" inputmode="numeric" min="1" max="10" step="1" value="1" required><button type="button" id="plus" aria-label="Increase quantity">+</button></div></div></section><aside class="panel summary"><h2>Order summary</h2><div class="row"><span>The Wall × <b id="qtyLabel">1</b></span><strong id="subtotal">${escapeHtml(unitLabel)}</strong></div><div class="row"><span>Shipping</span><strong class="shipping">Included</strong></div><div class="row total"><span><strong>Total</strong></span><strong id="total">${escapeHtml(unitLabel)}</strong></div>${configured ? '<button class="button" type="submit" id="payButton">Continue to secure checkout</button>' : '<div class="notice">Online checkout is being configured.</div>'}<p class="fine">Your shipping address and payment details are collected securely by Stripe. You won’t be charged until you confirm payment there.</p></aside></div></form></main></div><script>(()=>{const q=document.getElementById('quantity'),minus=document.getElementById('minus'),plus=document.getElementById('plus'),qtyLabel=document.getElementById('qtyLabel'),subtotal=document.getElementById('subtotal'),total=document.getElementById('total');const unit=${Number(unitAmount)};const currency=${JSON.stringify(String(currency || 'aud').toUpperCase())};const fmt=new Intl.NumberFormat('en-AU',{style:'currency',currency});function update(){let n=parseInt(q.value,10)||1;n=Math.max(1,Math.min(10,n));q.value=n;qtyLabel.textContent=n;const label=fmt.format((unit*n)/100);subtotal.textContent=label;total.textContent=label}minus.onclick=()=>{q.value=(parseInt(q.value,10)||1)-1;update()};plus.onclick=()=>{q.value=(parseInt(q.value,10)||1)+1;update()};q.addEventListener('input',update);update()})();</script></body></html>`;
}

async function orderBySession(sessionId) {
  if (!clean(sessionId).startsWith('cs_')) return null;
  const result = await pool.query(
    `select o.id, o.status, o.quantity, o.amount_total, o.currency,
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

function successPage(order, sessionId) {
  if (!order) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order · The Wall</title></head><body style="font-family:system-ui;padding:32px"><h2>We could not find that order.</h2><p><a href="/shop">Back to shop</a></p></body></html>`;
  }
  const paid = ['paid', 'fulfilled'].includes(order.status);
  if (!paid) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment processing · The Wall</title><style>body{margin:0;background:#e5dac5;font-family:system-ui;color:#171411}.card{max-width:460px;margin:12vh auto;background:#fffaf1;border:1px solid #c9bdab;border-radius:16px;padding:28px;text-align:center}p{color:#6c6358;line-height:1.5}</style></head><body><main class="card"><img src="/plaque.png" alt="The Wall" style="width:82px;border-radius:12px"><h2>Confirming your payment…</h2><p>Stripe has returned you to The Wall. We’re waiting for its secure payment confirmation.</p></main><script>let tries=0;const timer=setInterval(async()=>{tries++;try{const r=await fetch('/purchase/status?session_id=${encodeURIComponent(sessionId)}',{cache:'no-store'});const j=await r.json();if(j.paid){clearInterval(timer);location.reload()}}catch(e){}if(tries>15)clearInterval(timer)},1000)</script></body></html>`;
  }
  const ref = orderReference(order.id);
  const emailState = order.customer_confirmation_sent_at
    ? 'Confirmation email sent.'
    : clean(order.customer_confirmation_error)
      ? 'Order confirmed. Email delivery had a problem, but your order is safe.'
      : 'Order confirmed.';
  const accountActive = Boolean(order.password_hash);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(ref)} confirmed · The Wall</title><style>*{box-sizing:border-box}body{margin:0;background:#d6cab4 url('/wall-background.png') center/cover fixed;color:#171411;font-family:Inter,system-ui,sans-serif}.shade{min-height:100vh;background:rgba(237,227,208,.8);padding:18px}.card{max-width:500px;margin:7vh auto;background:#fffaf1;border:1px solid #cabfaa;border-radius:17px;padding:24px;box-shadow:0 18px 50px rgba(25,20,15,.18)}.head{display:flex;align-items:center;gap:13px;padding-bottom:17px;border-bottom:1px solid #ddd3c4}.head img{width:64px;height:64px;border-radius:10px}.kicker{font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:#5b724f;font-weight:950}.head h1{font-size:22px;margin:3px 0 0}.ref{font-size:12px;color:#746b5f;margin-top:4px}.row{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #e2d9cc}.row.total{font-size:18px;border-bottom:0}.state{margin:17px 0;padding:11px 12px;border-radius:9px;background:#e5efe1;color:#3e5c39;font-size:12px;font-weight:800}.button{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:8px;background:#171411;color:#fff;text-decoration:none;font-weight:900}.help{font-size:12px;color:#746b5f;line-height:1.5;margin-bottom:0}</style></head><body><div class="shade"><main class="card"><header class="head"><img src="/plaque.png" alt="The Wall"><div><div class="kicker">Payment confirmed</div><h1>Thanks — your order is in.</h1><div class="ref">Order ${escapeHtml(ref)}</div></div></header><div class="state">✓ ${escapeHtml(emailState)}</div><div class="row"><span>The Wall</span><strong>× ${escapeHtml(order.quantity)}</strong></div><div class="row"><span>Shipping</span><strong>Included</strong></div><div class="row total"><strong>Total</strong><strong>${escapeHtml(money(order.amount_total, order.currency))}</strong></div><a class="button" href="${WEB_BASE}/my-walls${accountActive ? '' : '/login'}">${accountActive ? 'Open My Walls' : 'Manage My Walls'}</a><p class="help">We’ll link each NFC before shipping. On the first scan you choose the Wall name and location.</p></main></div></body></html>`;
}

export function installCommerceEmailPolish() {
  if (emailPatchInstalled) return;
  emailPatchInstalled = true;
  const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = (...args) => {
    const transport = originalCreateTransport(...args);
    const originalSendMail = transport.sendMail.bind(transport);
    transport.sendMail = async (message = {}) => {
      const subject = String(message.subject || '');
      const uuid = subject.match(UUID_RE)?.[0] || '';
      const ref = uuid ? orderReference(uuid) : '';

      if (subject.startsWith('The Wall order confirmed')) {
        if (uuid && ref) {
          message.subject = `Order ${ref} confirmed`;
          if (typeof message.text === 'string') message.text = message.text.replaceAll(uuid, ref);
          if (typeof message.html === 'string') message.html = message.html.replaceAll(uuid, ref);
        }
        if (typeof message.text === 'string') {
          message.text = message.text.replaceAll('https://nfc.saidhere.app/my-walls', `${WEB_BASE}/my-walls`);
        }
        if (typeof message.html === 'string') {
          message.html = message.html
            .replaceAll('https://nfc.saidhere.app/my-walls', `${WEB_BASE}/my-walls`)
            .replace(
              '<div style="background:#171411;color:#f7f0e5;padding:28px;border-radius:14px 14px 0 0"><div style="font-size:11px;letter-spacing:3px;font-weight:700">THE WALL</div><h1 style="margin:8px 0 0;font-size:30px">Order confirmed.</h1></div>',
              '<div style="background:#171411;color:#f7f0e5;padding:15px 20px;border-radius:14px 14px 0 0;font-size:11px;letter-spacing:2px;font-weight:800">THE WALL · ORDER CONFIRMED</div>',
            );
        }
      }

      if (subject.startsWith('New The Wall order')) {
        const purchaser = typeof message.text === 'string'
          ? clean(message.text.match(/^Email:\s*(.+)$/m)?.[1]).toLowerCase()
          : '';
        const recipients = String(message.to || '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        const filtered = purchaser
          ? recipients.filter((value) => value.toLowerCase() !== purchaser)
          : recipients;
        if (filtered.length === 0 && recipients.length > 0) {
          return { messageId: `skipped-owner-copy-${ref || crypto.randomUUID()}`, accepted: [], rejected: [] };
        }
        if (filtered.length > 0) message.to = filtered.join(',');
        if (uuid && ref) {
          message.subject = message.subject.replaceAll(uuid, ref);
          if (typeof message.text === 'string') message.text = message.text.replaceAll(uuid, ref);
        }
        if (typeof message.text === 'string') {
          message.text = message.text.replaceAll('https://nfc.saidhere.app/admin', `${WEB_BASE}/admin`);
        }
      }

      return originalSendMail(message);
    };
    return transport;
  };
}

export function mountCommercePolish(app) {
  app.get('/shop', async (req, res) => {
    try {
      const price = await wallPrice();
      return res.type('html').send(checkoutPage({
        unitAmount: price.unitAmount,
        currency: price.currency,
        cancelled: clean(req.query?.cancelled) === '1',
      }));
    } catch (error) {
      console.error('[shop-v2]', error);
      return res.status(500).type('html').send(checkoutPage({ unitAmount: 1500, currency: 'aud', error: 'Could not load checkout just now. Please refresh.' }));
    }
  });

  app.post('/shop/checkout', async (req, res) => {
    try {
      const session = await createCheckout(req.body?.email, req.body?.quantity);
      return res.redirect(303, session.url);
    } catch (error) {
      console.error('[shop/checkout-v2]', error);
      let price = { unitAmount: 1500, currency: 'aud' };
      try { price = await wallPrice(); } catch (_) {}
      return res.status(400).type('html').send(checkoutPage({ unitAmount: price.unitAmount, currency: price.currency, error: error?.message || 'Could not start checkout.' }));
    }
  });

  app.get('/purchase/status', async (req, res, next) => {
    try {
      const order = await orderBySession(clean(req.query?.session_id));
      return res.set('Cache-Control', 'no-store').json({ paid: Boolean(order && ['paid', 'fulfilled'].includes(order.status)) });
    } catch (error) { return next(error); }
  });

  app.get('/purchase/success', async (req, res, next) => {
    try {
      const sessionId = clean(req.query?.session_id);
      const order = await orderBySession(sessionId);
      return res.set('Cache-Control', 'no-store').type('html').send(successPage(order, sessionId));
    } catch (error) { return next(error); }
  });
}
