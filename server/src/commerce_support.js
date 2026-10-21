import nodemailer from 'nodemailer';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';

const CLAIM_DAYS = 7;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function baseUrl() {
  return (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stripeId(value) {
  if (typeof value === 'string') return value;
  return value && typeof value.id === 'string' ? value.id : null;
}

function shippingFromSession(session) {
  const shipping = session?.collected_information?.shipping_details || session?.shipping_details || {};
  const customer = session?.customer_details || {};
  return {
    name: clean(shipping.name || customer.name),
    address: shipping.address || customer.address || {},
  };
}

function addressLines(address) {
  const value = address || {};
  return [
    value.line1,
    value.line2,
    [value.city, value.state, value.postal_code].filter(Boolean).join(' '),
    value.country,
  ].filter(Boolean);
}

function money(amount, currency = 'aud') {
  if (!Number.isFinite(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: String(currency || 'aud').toUpperCase(),
    }).format(Number(amount) / 100);
  } catch (_) {
    return `$${(Number(amount) / 100).toFixed(2)} ${String(currency || 'AUD').toUpperCase()}`;
  }
}

function smtpSettings() {
  return {
    host: clean(process.env.SMTP_HOST) || 'mail-au.smtp2go.com',
    port: Number(process.env.SMTP_PORT || 587),
    user: clean(process.env.SMTP_USERNAME),
    pass: process.env.SMTP_PASSWORD || '',
    from: process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>',
  };
}

export function commerceEmailStatus() {
  const settings = smtpSettings();
  return {
    configured: Boolean(settings.user && settings.pass),
    host: settings.host,
    port: settings.port,
    from: settings.from,
  };
}

function smtpTransport() {
  const settings = smtpSettings();
  if (!settings.user || !settings.pass) return null;
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
  });
}

async function sendMail(message) {
  const transport = smtpTransport();
  if (!transport) {
    return { sent: false, reason: 'SMTP_USERNAME/SMTP_PASSWORD are not configured in Render.' };
  }
  try {
    const info = await transport.sendMail(message);
    return { sent: true, messageId: info.messageId || '' };
  } catch (error) {
    return { sent: false, reason: String(error?.message || error).slice(0, 900) };
  } finally {
    try { transport?.close(); } catch (_) {}
  }
}

async function stripeGet(path, params = {}) {
  const secret = process.env.STRIPE_SECRET_KEY || '';
  if (!secret) throw new Error('Stripe is not configured.');
  const query = new URLSearchParams(params);
  const suffix = query.size ? `?${query.toString()}` : '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.stripe.com/v1${path}${suffix}`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `Stripe request failed (${response.status}).`);
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Stripe took too long to respond.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
      `update customer_accounts
          set stripe_customer_id = $2, updated_at = now()
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

export async function ensureOrderCustomerLink(client, order) {
  if (order.customer_id) return order.customer_id;
  if (!['paid', 'fulfilled'].includes(order.status)) {
    throw new Error('Only paid orders can be linked to a customer account.');
  }
  const customer = await ensureCustomer(client, order.purchaser_email, order.stripe_customer_id || null);
  await client.query(
    `update commerce_orders
        set customer_id = $2,
            purchaser_email = $3,
            updated_at = now()
      where id = $1`,
    [order.id, customer.id, customer.email],
  );
  return customer.id;
}

async function recordEmailAttempt(orderId, kind) {
  const customer = kind === 'customer';
  const prefix = customer ? 'customer_confirmation' : 'owner_notification';
  await pool.query(
    `update commerce_orders
        set ${prefix}_last_attempt_at = now(),
            ${prefix}_attempts = coalesce(${prefix}_attempts, 0) + 1,
            ${prefix}_error = null,
            updated_at = now()
      where id = $1`,
    [orderId],
  );
}

async function recordEmailResult(orderId, kind, result) {
  const customer = kind === 'customer';
  const prefix = customer ? 'customer_confirmation' : 'owner_notification';
  if (result.sent) {
    await pool.query(
      `update commerce_orders
          set ${prefix}_sent_at = now(),
              ${prefix}_message_id = $2,
              ${prefix}_error = null,
              updated_at = now()
        where id = $1`,
      [orderId, result.messageId || null],
    );
  } else {
    await pool.query(
      `update commerce_orders
          set ${prefix}_error = $2,
              updated_at = now()
        where id = $1`,
      [orderId, clean(result.reason) || 'Email provider did not accept the message.'],
    );
  }
}

async function sendCustomerConfirmation(order, activationUrl, { force = false } = {}) {
  if (!order.purchaser_email) return { sent: false, reason: 'Order has no purchaser email.' };
  if (order.customer_confirmation_sent_at && !force) return { sent: true, skipped: true };
  await recordEmailAttempt(order.id, 'customer');

  const lines = addressLines(order.shipping_address);
  const shippingHtml = lines.length
    ? `<h3 style="margin:24px 0 6px">Shipping to</h3><p style="line-height:1.5;margin:0">${lines.map(escapeHtml).join('<br>')}</p>`
    : '';
  const shippingText = lines.length ? `\n\nShipping to:\n${lines.join('\n')}` : '';
  const qty = Number(order.quantity || 1);
  const total = money(order.amount_total, order.currency);
  const from = process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>';
  const result = await sendMail({
    from,
    to: order.purchaser_email,
    replyTo: clean(process.env.CUSTOMER_REPLY_TO) || undefined,
    subject: `The Wall order confirmed — ${order.id}`,
    text: `Thanks for your The Wall order.\n\nOrder: ${order.id}\nPlaques: ${qty}\nTotal: ${total}${shippingText}\n\nSet up or manage your Wall account: ${activationUrl}\n\nWe'll prepare your physical plaque and link it to your account when it is assigned.`,
    html: `<div style="max-width:620px;margin:auto;font-family:Arial,sans-serif;color:#171411;background:#f5efe5;padding:24px"><div style="background:#171411;color:#f7f0e5;padding:28px;border-radius:14px 14px 0 0"><div style="font-size:11px;letter-spacing:3px;font-weight:700">THE WALL</div><h1 style="margin:8px 0 0;font-size:30px">Order confirmed.</h1></div><div style="padding:28px;border:1px solid #d8cdbc;border-top:0;background:#fffaf1;border-radius:0 0 14px 14px"><p style="font-size:16px;line-height:1.55">Thanks${order.customer_name ? ` ${escapeHtml(order.customer_name)}` : ''}. Your payment is confirmed and your plaque order is now in our queue.</p><p style="font-size:13px;color:#6f675d">Order <b>${escapeHtml(order.id)}</b></p><table style="width:100%;border-collapse:collapse;margin-top:18px"><tr><td style="padding:10px 0">The Wall plaque</td><td style="text-align:right;font-weight:700">× ${qty}</td></tr><tr><td style="padding-top:16px;border-top:1px solid #ddd"><b>Total</b></td><td style="padding-top:16px;border-top:1px solid #ddd;text-align:right"><b>${escapeHtml(total)}</b></td></tr></table>${shippingHtml}<p style="margin:28px 0 18px"><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:15px 20px;background:#171411;color:#fff;text-decoration:none;font-weight:800;border-radius:8px">${order.customer_has_password ? 'Manage My Walls' : 'Activate My Walls'}</a></p><p style="color:#6f675d;font-size:13px;line-height:1.55">Your Wall appears in My Walls when its physical plaque is packed and assigned. If the button does not work, paste this address into your browser:<br><span style="word-break:break-all">${escapeHtml(activationUrl)}</span></p><p style="margin-top:26px"><b>Every place has something to say.</b><br>The Wall</p></div></div>`,
  });
  await recordEmailResult(order.id, 'customer', result);
  return result;
}

async function sendOwnerNotification(order, { force = false } = {}) {
  if (order.owner_notification_sent_at && !force) return { sent: true, skipped: true };
  const recipients = clean(process.env.ORDER_NOTIFICATION_EMAIL)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    const result = { sent: false, reason: 'ORDER_NOTIFICATION_EMAIL is not configured in Render.' };
    await recordEmailAttempt(order.id, 'owner');
    await recordEmailResult(order.id, 'owner', result);
    return result;
  }
  await recordEmailAttempt(order.id, 'owner');
  const from = process.env.ORDER_EMAIL_FROM || process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>';
  const lines = addressLines(order.shipping_address);
  const qty = Number(order.quantity || 1);
  const result = await sendMail({
    from,
    to: recipients.join(','),
    subject: `New The Wall order — ${order.id} — ${qty} plaque${qty === 1 ? '' : 's'}`,
    text: `New paid The Wall order\n\nOrder: ${order.id}\nCustomer: ${order.customer_name || ''}\nEmail: ${order.purchaser_email}\nPlaques: ${qty}\nTotal: ${money(order.amount_total, order.currency)}\n\nShipping:\n${lines.join('\n') || 'Not supplied'}\n\nAdmin: ${baseUrl()}/admin/orders`,
  });
  await recordEmailResult(order.id, 'owner', result);
  return result;
}

async function sendOrderEmails(order, activationUrl) {
  const results = {};
  try {
    results.customer = await sendCustomerConfirmation(order, activationUrl);
  } catch (error) {
    console.error('[commerce] Customer confirmation email failed:', error?.message || error);
    results.customer = { sent: false, reason: String(error?.message || error) };
  }
  try {
    results.owner = await sendOwnerNotification(order);
  } catch (error) {
    console.error('[commerce] Owner order email failed:', error?.message || error);
    results.owner = { sent: false, reason: String(error?.message || error) };
  }
  return results;
}

function orderIdFromSession(session) {
  return clean(session?.client_reference_id || session?.metadata?.order_id);
}

function verifyCheckoutSession(session, order) {
  if (!session?.id) throw new Error('Stripe Checkout Session is missing an ID.');
  if (session.mode !== 'payment') throw new Error('Stripe Checkout Session is not a payment session.');
  if (session.payment_status !== 'paid') throw new Error('Stripe has not marked this Checkout Session as paid.');
  if (order.stripe_checkout_session_id && order.stripe_checkout_session_id !== session.id) {
    throw new Error('Stripe Checkout Session does not match this order.');
  }
  if (orderIdFromSession(session) !== order.id) throw new Error('Stripe Checkout Session references a different order.');

  const items = Array.isArray(session?.line_items?.data) ? session.line_items.data : [];
  if (items.length !== 1) throw new Error('Stripe Checkout Session has an unexpected line-item count.');
  const item = items[0];
  const priceId = stripeId(item?.price);
  if (!priceId || priceId !== process.env.STRIPE_PRICE_WALL_PLAQUE) {
    throw new Error('Stripe Checkout Session used an unexpected plaque Price ID.');
  }
  if (Number(item.quantity) !== Number(order.quantity)) {
    throw new Error('Stripe Checkout Session quantity does not match this order.');
  }
  if (Number.isInteger(item.amount_total) && Number.isInteger(session.amount_total) && item.amount_total !== session.amount_total) {
    throw new Error('Stripe Checkout Session total does not match its line item.');
  }
  if (order.amount_total != null && Number(order.amount_total) !== Number(session.amount_total)) {
    throw new Error('Stripe Checkout Session total does not match the stored order total.');
  }
  return true;
}

async function loadCheckoutSession(sessionId) {
  const id = clean(sessionId);
  if (!id || !id.startsWith('cs_')) throw new Error('Invalid Stripe Checkout Session ID.');
  return stripeGet(`/checkout/sessions/${encodeURIComponent(id)}`, { 'expand[]': 'line_items' });
}

async function reconcileVerifiedPaidSession(session) {
  const orderId = orderIdFromSession(session);
  if (!orderId) throw new Error('Stripe Checkout Session is missing the SaidHere order reference.');
  const email = clean(session?.customer_details?.email || session?.customer_email).toLowerCase();
  const stripeCustomerId = stripeId(session?.customer);
  const paymentIntentId = stripeId(session?.payment_intent);
  const shipping = shippingFromSession(session);

  const client = await pool.connect();
  let notification = null;
  try {
    await client.query('begin');
    const locked = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (locked.rowCount === 0) throw new Error('SaidHere order was not found.');
    const order = locked.rows[0];
    if (order.status === 'refunded') throw new Error('This order has been refunded.');
    verifyCheckoutSession(session, order);

    const customer = await ensureCustomer(client, email || order.purchaser_email, stripeCustomerId);
    const updated = await client.query(
      `update commerce_orders
          set customer_id = $2,
              purchaser_email = $3,
              status = case when status = 'fulfilled' then status else 'paid' end,
              amount_total = $4,
              currency = $5,
              stripe_checkout_session_id = $6,
              stripe_payment_intent_id = coalesce($7, stripe_payment_intent_id),
              stripe_customer_id = coalesce($8, stripe_customer_id),
              customer_name = coalesce(nullif($9, ''), customer_name),
              shipping_address = case when $10::jsonb = '{}'::jsonb then shipping_address else $10::jsonb end,
              paid_at = coalesce(paid_at, now()),
              updated_at = now()
        where id = $1
        returning *`,
      [
        order.id,
        customer.id,
        customer.email,
        session.amount_total,
        clean(session.currency).toLowerCase() || null,
        session.id,
        paymentIntentId,
        stripeCustomerId,
        shipping.name,
        JSON.stringify(shipping.address || {}),
      ],
    );
    const paidOrder = updated.rows[0];
    let activationUrl = `${baseUrl()}/my-walls/login`;
    if (!customer.password_hash && !paidOrder.customer_confirmation_sent_at) {
      activationUrl = await issueClaimToken(client, customer.id, order.id);
    }
    notification = {
      ...paidOrder,
      customer_has_password: Boolean(customer.password_hash),
      activationUrl,
    };
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }

  const emailResults = notification ? await sendOrderEmails(notification, notification.activationUrl) : {};
  return { order: notification, emailResults };
}

export async function reconcileCheckoutSessionById(sessionId) {
  const session = await loadCheckoutSession(sessionId);
  return reconcileVerifiedPaidSession(session);
}

export async function reconcilePaidCheckout(session) {
  const sessionId = clean(session?.id);
  if (!sessionId) throw new Error('Stripe webhook did not include a Checkout Session ID.');
  return reconcileCheckoutSessionById(sessionId);
}

export async function resendCustomerConfirmation(orderId) {
  const client = await pool.connect();
  let order;
  let activationUrl;
  try {
    await client.query('begin');
    const result = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (result.rowCount === 0) throw new Error('Order not found.');
    order = result.rows[0];
    if (!['paid', 'fulfilled'].includes(order.status)) throw new Error('Only paid orders can receive a confirmation email.');
    const customerId = await ensureOrderCustomerLink(client, order);
    const customerResult = await client.query(`select * from customer_accounts where id = $1 limit 1`, [customerId]);
    const customer = customerResult.rows[0];
    if (!customer) throw new Error('Customer account could not be loaded.');
    activationUrl = customer.password_hash
      ? `${baseUrl()}/my-walls/login`
      : await issueClaimToken(client, customer.id, order.id);
    const refreshed = await client.query(`select * from commerce_orders where id = $1`, [order.id]);
    order = { ...refreshed.rows[0], customer_has_password: Boolean(customer.password_hash) };
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
  const result = await sendCustomerConfirmation(order, activationUrl, { force: true });
  if (!result.sent) throw new Error(result.reason || 'Customer confirmation email failed.');
  return result;
}

export async function resendOwnerNotification(orderId) {
  const result = await pool.query(`select * from commerce_orders where id = $1 limit 1`, [orderId]);
  if (result.rowCount === 0) throw new Error('Order not found.');
  const order = result.rows[0];
  if (!['paid', 'fulfilled'].includes(order.status)) throw new Error('Only paid orders can send an owner notification.');
  const sent = await sendOwnerNotification(order, { force: true });
  if (!sent.sent) throw new Error(sent.reason || 'Owner notification email failed.');
  return sent;
}

export async function manualClaimLinkForOrder(orderId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (result.rowCount === 0) throw new Error('Order not found.');
    const order = result.rows[0];
    if (!['paid', 'fulfilled'].includes(order.status)) throw new Error('Only paid orders can generate an activation link.');
    const customerId = await ensureOrderCustomerLink(client, order);
    const customer = await client.query(`select id, password_hash from customer_accounts where id = $1 limit 1`, [customerId]);
    if (customer.rowCount === 0) throw new Error('Customer account could not be created for this order.');
    const url = customer.rows[0].password_hash
      ? `${baseUrl()}/my-walls/login`
      : await issueClaimToken(client, customerId, order.id);
    await client.query('commit');
    return url;
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}
