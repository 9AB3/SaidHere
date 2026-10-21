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

async function resend(body) {
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY is not configured.' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Resend ${response.status}: ${text.slice(0, 500)}`);
  }
  return { sent: true };
}

async function sendCustomerConfirmation(order, activationUrl) {
  if (!order.purchaser_email || order.customer_confirmation_sent_at) return false;
  const from = process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>';
  const lines = addressLines(order.shipping_address);
  const shippingHtml = lines.length
    ? `<h3 style="margin:24px 0 6px">Shipping to</h3><p style="line-height:1.5;margin:0">${lines.map(escapeHtml).join('<br>')}</p>`
    : '';
  const shippingText = lines.length ? `\n\nShipping to:\n${lines.join('\n')}` : '';
  const qty = Number(order.quantity || 1);
  const total = money(order.amount_total, order.currency);
  const result = await resend({
    from,
    to: [order.purchaser_email],
    subject: `The Wall order confirmed — ${order.id}`,
    text: `Thanks for your The Wall order.\n\nOrder: ${order.id}\nPlaques: ${qty}\nTotal: ${total}${shippingText}\n\nSet up or manage your Wall account: ${activationUrl}\n\nWe'll prepare your physical plaque and link it to your account when it is assigned.`,
    html: `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;color:#171411"><div style="background:#171411;color:#f7f0e5;padding:28px"><div style="font-size:12px;letter-spacing:3px">THE WALL</div><h1 style="margin:8px 0 0">Order confirmed.</h1></div><div style="padding:28px;border:1px solid #d8cdbc;border-top:0;background:#fffaf1"><p>Thanks${order.customer_name ? ` ${escapeHtml(order.customer_name)}` : ''}. We've received your order.</p><p><b>Order ${escapeHtml(order.id)}</b></p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:8px 0">The Wall plaque</td><td style="text-align:right">× ${qty}</td></tr><tr><td style="padding-top:16px;border-top:1px solid #ddd"><b>Total</b></td><td style="padding-top:16px;border-top:1px solid #ddd;text-align:right"><b>${escapeHtml(total)}</b></td></tr></table>${shippingHtml}<p style="margin:26px 0"><a href="${escapeHtml(activationUrl)}" style="display:inline-block;padding:14px 18px;background:#171411;color:#fff;text-decoration:none;font-weight:700">${order.customer_has_password ? 'Manage My Walls' : 'Activate My Walls'}</a></p><p style="color:#6f675d">Your physical plaque will appear in My Walls when it is packed and assigned to your order.</p><p><b>Every place has something to say.</b><br>The Wall</p></div></div>`,
  });
  if (result.sent) {
    await pool.query(`update commerce_orders set customer_confirmation_sent_at = coalesce(customer_confirmation_sent_at, now()) where id = $1`, [order.id]);
  }
  return result.sent;
}

async function sendOwnerNotification(order) {
  if (order.owner_notification_sent_at) return false;
  const recipients = clean(process.env.ORDER_NOTIFICATION_EMAIL)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (recipients.length === 0) return false;
  const from = process.env.ORDER_EMAIL_FROM || process.env.CUSTOMER_EMAIL_FROM || 'The Wall <orders@saidhere.app>';
  const lines = addressLines(order.shipping_address);
  const qty = Number(order.quantity || 1);
  const result = await resend({
    from,
    to: recipients,
    subject: `New The Wall order — ${order.id} — ${qty} plaque${qty === 1 ? '' : 's'}`,
    text: `New paid The Wall order\n\nOrder: ${order.id}\nCustomer: ${order.customer_name || ''}\nEmail: ${order.purchaser_email}\nPlaques: ${qty}\nTotal: ${money(order.amount_total, order.currency)}\n\nShipping:\n${lines.join('\n') || 'Not supplied'}`,
  });
  if (result.sent) {
    await pool.query(`update commerce_orders set owner_notification_sent_at = coalesce(owner_notification_sent_at, now()) where id = $1`, [order.id]);
  }
  return result.sent;
}

async function sendOrderEmails(order, activationUrl) {
  try {
    await sendCustomerConfirmation(order, activationUrl);
  } catch (error) {
    console.error('[commerce] Customer confirmation email failed:', error?.message || error);
  }
  try {
    await sendOwnerNotification(order);
  } catch (error) {
    console.error('[commerce] Owner order email failed:', error?.message || error);
  }
}

export async function reconcilePaidCheckout(session) {
  const orderId = clean(session?.client_reference_id || session?.metadata?.order_id);
  if (!orderId) return;
  const email = clean(session?.customer_details?.email || session?.customer_email).toLowerCase();
  const stripeCustomerId = stripeId(session?.customer);
  const paymentIntentId = stripeId(session?.payment_intent);
  const shipping = shippingFromSession(session);

  const client = await pool.connect();
  let notification = null;
  try {
    await client.query('begin');
    const locked = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (locked.rowCount === 0) {
      await client.query('rollback');
      return;
    }
    const order = locked.rows[0];
    if (order.status === 'cancelled' || order.status === 'refunded') {
      await client.query('commit');
      return;
    }
    const customer = await ensureCustomer(client, email || order.purchaser_email, stripeCustomerId);
    const updated = await client.query(
      `update commerce_orders
          set customer_id = $2,
              purchaser_email = $3,
              status = case when status = 'fulfilled' then status else 'paid' end,
              amount_total = coalesce($4, amount_total),
              currency = coalesce($5, currency),
              stripe_checkout_session_id = coalesce(stripe_checkout_session_id, $6),
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
        Number.isInteger(session?.amount_total) ? session.amount_total : null,
        clean(session?.currency).toLowerCase() || null,
        clean(session?.id) || null,
        paymentIntentId,
        stripeCustomerId,
        shipping.name,
        JSON.stringify(shipping.address || {}),
      ],
    );
    const paidOrder = updated.rows[0];
    let activationUrl = `${baseUrl()}/my-walls/login`;
    if (!customer.password_hash) activationUrl = await issueClaimToken(client, customer.id, order.id);
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
  if (notification) await sendOrderEmails(notification, notification.activationUrl);
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
