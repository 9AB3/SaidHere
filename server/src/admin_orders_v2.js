import crypto from 'node:crypto';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';
import {
  commerceEmailStatus,
  ensureOrderCustomerLink,
  manualClaimLinkForOrder,
  reconcileCheckoutSessionById,
  resendCustomerConfirmation,
  resendOwnerNotification,
} from './commerce_support.js';

const ADMIN_COOKIE = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
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

async function requireOwner(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const result = await pool.query(
      `select s.id as session_id, u.id, u.username, u.display_name, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1
          and s.expires_at > now()
          and u.active = true
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const user = result.rows[0];
    if (user.role !== 'owner') return res.status(403).send('Main Admin access required.');
    req.orderAdmin = { ...user, raw, csrf: hashToken(`admin-csrf:${raw}`) };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.orderAdmin?.csrf || clean(req.body?._csrf) !== req.orderAdmin.csrf) {
    return res.status(403).send('Request expired. Refresh Orders and try again.');
  }
  return next();
}

async function writeAudit(admin, action, { wallId = null, wallName = null, details = {} } = {}) {
  try {
    await pool.query(
      `insert into admin_audit_log
         (admin_user_id, username_snapshot, action, wall_id, wall_name, details)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [admin.id, admin.username, action, wallId, wallName, JSON.stringify(details)],
    );
  } catch (error) {
    console.error('[orders-audit]', error);
  }
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

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function shortId(value) {
  const text = clean(value);
  if (!text) return '—';
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
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

async function listOrders() {
  const result = await pool.query(
    `select o.*,
            c.password_hash is not null as customer_active,
            count(i.id)::int as item_count,
            count(i.id) filter (where i.wall_id is not null)::int as nfc_assigned_count,
            count(i.id) filter (where i.status = 'fulfilled')::int as shipped_count,
            coalesce(jsonb_agg(
              jsonb_build_object(
                'id', i.id,
                'ordinal', i.ordinal,
                'status', i.status,
                'wall_id', i.wall_id,
                'wall_name', w.display_name,
                'setup_required', w.setup_required,
                'serial_code', p.serial_code,
                'nfc_assigned_at', i.nfc_assigned_at,
                'shipped_at', i.shipped_at
              ) order by i.ordinal
            ) filter (where i.id is not null), '[]'::jsonb) as items
       from commerce_orders o
       left join customer_accounts c on c.id = o.customer_id
       left join commerce_order_items i on i.order_id = o.id
       left join walls w on w.id = i.wall_id
       left join plaques p on p.order_item_id = i.id
      group by o.id, c.password_hash
      order by
        case
          when o.status = 'paid' then 0
          when o.customer_confirmation_error is not null then 1
          when o.status = 'pending' then 2
          when o.status = 'fulfilled' then 3
          else 4
        end,
        o.created_at desc
      limit 250`,
  );
  return result.rows;
}

async function assignNextNfc(orderId) {
  if (!validUuid(orderId)) throw new Error('Invalid order ID.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    const order = orderResult.rows[0];
    if (order.status !== 'paid') throw new Error('Payment must be confirmed before assigning an NFC.');
    const customerId = await ensureOrderCustomerLink(client, order);

    const itemResult = await client.query(
      `select * from commerce_order_items
        where order_id = $1
          and status = 'awaiting_fulfillment'
          and wall_id is null
        order by ordinal
        limit 1
        for update`,
      [order.id],
    );
    if (itemResult.rowCount === 0) throw new Error('Every Wall in this order already has an NFC assigned.');
    const item = itemResult.rows[0];

    const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
    const rawNfc = makeToken(36);
    const serial = `TW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint, setup_required)
       values ($1, 'Set up your Wall', '', true)
       returning id, slug, display_name`,
      [slug],
    );
    const wall = wallResult.rows[0];
    const tagResult = await client.query(
      `insert into wall_tags (wall_id, token_hash, active)
       values ($1, $2, true)
       returning id`,
      [wall.id, hashToken(rawNfc)],
    );
    const physicalResult = await client.query(
      `insert into plaques (serial_code, order_item_id, wall_id, wall_tag_id, status, assigned_at)
       values ($1, $2, $3, $4, 'assigned', now())
       returning id, serial_code`,
      [serial, item.id, wall.id, tagResult.rows[0].id],
    );
    await client.query(
      `insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id)
       values ($1, $2, $3, $4)`,
      [customerId, wall.id, order.id, physicalResult.rows[0].id],
    );
    await client.query(
      `update commerce_order_items
          set wall_id = $2,
              nfc_assigned_at = now()
        where id = $1`,
      [item.id, wall.id],
    );
    await client.query('commit');

    const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
    return {
      wallId: wall.id,
      wallName: wall.display_name,
      ordinal: item.ordinal,
      serial: physicalResult.rows[0].serial_code,
      nfcUrl: `${appBase}/t/${rawNfc}`,
    };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function replaceUnshippedNfc(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select i.id, i.wall_id, i.status, i.ordinal, w.display_name,
              p.id as physical_id, p.serial_code
         from commerce_order_items i
         join commerce_orders o on o.id = i.order_id
         join walls w on w.id = i.wall_id
         join plaques p on p.order_item_id = i.id
        where i.id = $1 and i.order_id = $2 and o.status = 'paid'
        for update of i, w, p`,
      [itemId, orderId],
    );
    if (result.rowCount === 0) throw new Error('Assigned Wall not found on this paid order.');
    const item = result.rows[0];
    if (item.status !== 'awaiting_fulfillment') throw new Error('A shipped Wall cannot be reprogrammed from Orders. Use Wall management for a replacement.');

    const rawNfc = makeToken(36);
    await client.query(`update wall_tags set active = false where wall_id = $1 and active = true`, [item.wall_id]);
    const tag = await client.query(
      `insert into wall_tags (wall_id, token_hash, active)
       values ($1, $2, true)
       returning id`,
      [item.wall_id, hashToken(rawNfc)],
    );
    await client.query(
      `update plaques set wall_tag_id = $2, assigned_at = now() where id = $1`,
      [item.physical_id, tag.rows[0].id],
    );
    await client.query(`update commerce_order_items set nfc_assigned_at = now() where id = $1`, [item.id]);
    await client.query('commit');

    const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
    return {
      wallId: item.wall_id,
      wallName: item.display_name,
      ordinal: item.ordinal,
      serial: item.serial_code,
      nfcUrl: `${appBase}/t/${rawNfc}`,
    };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function markItemShipped(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const itemResult = await client.query(
      `select i.*, o.status as order_status, w.display_name
         from commerce_order_items i
         join commerce_orders o on o.id = i.order_id
         left join walls w on w.id = i.wall_id
        where i.id = $1 and i.order_id = $2
        for update of i, o`,
      [itemId, orderId],
    );
    if (itemResult.rowCount === 0) throw new Error('Wall item not found.');
    const item = itemResult.rows[0];
    if (!['paid', 'fulfilled'].includes(item.order_status)) throw new Error('Payment must be confirmed before shipping.');
    if (!item.wall_id) throw new Error('Assign the NFC before marking this Wall shipped.');
    if (item.status === 'fulfilled') {
      await client.query('commit');
      return { wallId: item.wall_id, wallName: item.display_name, alreadyDone: true };
    }
    if (item.status !== 'awaiting_fulfillment') throw new Error('This Wall is not available to ship.');

    await client.query(
      `update commerce_order_items
          set status = 'fulfilled', shipped_at = now(), fulfilled_at = now()
        where id = $1`,
      [item.id],
    );
    const remaining = await client.query(
      `select count(*)::int as count
         from commerce_order_items
        where order_id = $1 and status = 'awaiting_fulfillment'`,
      [orderId],
    );
    if (remaining.rows[0].count === 0) {
      await client.query(
        `update commerce_orders
            set status = 'fulfilled', fulfilled_at = coalesce(fulfilled_at, now()), updated_at = now()
          where id = $1`,
        [orderId],
      );
    }
    await client.query('commit');
    return { wallId: item.wall_id, wallName: item.display_name, alreadyDone: false };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function itemState(item) {
  if (item.status === 'fulfilled') return { text: 'Shipped', cls: 'good' };
  if (item.wall_id) return { text: 'NFC assigned · ready to ship', cls: 'warn' };
  return { text: 'Awaiting NFC', cls: 'muted' };
}

function matchesView(order, view) {
  if (view === 'all') return true;
  if (view === 'action') {
    return order.status === 'paid'
      || (['paid', 'fulfilled'].includes(order.status)
        && (!order.customer_confirmation_sent_at || order.customer_confirmation_error));
  }
  return order.status === view;
}

function orderCard(order, csrf) {
  const items = Array.isArray(order.items) ? order.items : [];
  const shipping = addressLines(order.shipping_address);
  const canAssign = order.status === 'paid'
    && items.some((item) => item.status === 'awaiting_fulfillment' && !item.wall_id);
  const assignedWaiting = items.filter((item) => item.status === 'awaiting_fulfillment' && item.wall_id);
  const emailState = order.customer_confirmation_error
    ? `<div class="email bad"><b>Customer email failed</b><span>${escapeHtml(order.customer_confirmation_error)}</span></div>`
    : order.customer_confirmation_sent_at
      ? `<div class="email good"><b>Customer confirmation sent</b><span>${escapeHtml(fmt(order.customer_confirmation_sent_at))}</span></div>`
      : ['paid', 'fulfilled'].includes(order.status)
        ? '<div class="email warn"><b>Customer confirmation not recorded</b><span>Use Order controls to send or retry it.</span></div>'
        : '';

  const rows = items.map((item) => {
    const state = itemState(item);
    const setupText = item.wall_id
      ? item.setup_required ? 'Customer setup pending' : 'Customer setup complete'
      : '—';
    const ship = item.status === 'awaiting_fulfillment' && item.wall_id
      ? `<div class="item-actions"><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/replace-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">Replace NFC</button></form><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/ship"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button good" type="submit">Mark shipped</button></form></div>`
      : '<span></span>';
    return `<div class="item-row"><div><b>Wall ${escapeHtml(item.ordinal)}</b><span>${escapeHtml(item.serial_code || 'Serial assigned with NFC')}</span></div><div><span class="pill ${state.cls}">${escapeHtml(state.text)}</span><small>${escapeHtml(setupText)}</small></div>${ship}</div>`;
  }).join('');

  const operational = `
    ${canAssign ? `<form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/assign-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button" type="submit">Assign next NFC</button></form>` : ''}
    ${assignedWaiting.length > 0 ? `<span class="ready-note">${assignedWaiting.length} Wall${assignedWaiting.length === 1 ? '' : 's'} ready to ship</span>` : ''}`;

  const paidControls = ['paid', 'fulfilled'].includes(order.status) ? `
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/email/customer"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">${order.customer_confirmation_sent_at ? 'Resend customer email' : 'Send customer email'}</button></form>
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/email/owner"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">Resend admin notice</button></form>
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/claim-link"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="link-action" type="submit">Recovery activation link</button></form>` : '';
  const pendingControl = order.status === 'pending' && order.stripe_checkout_session_id
    ? `<form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/reconcile"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">Recheck payment with Stripe</button></form>`
    : '';

  return `<article class="order-card"><div class="head"><div><span class="eyebrow">Order ${escapeHtml(shortId(order.id))}</span><h3>${escapeHtml(order.purchaser_email)}</h3><p>${escapeHtml(fmt(order.created_at))} · ${escapeHtml(order.quantity)} Wall${Number(order.quantity) === 1 ? '' : 's'} · ${escapeHtml(money(order.amount_total, order.currency))}</p></div><div class="badges"><span class="pill ${order.status === 'fulfilled' ? 'good' : order.status === 'paid' ? 'warn' : 'muted'}">${escapeHtml(order.status === 'fulfilled' ? 'Shipped' : order.status)}</span></div></div>
    <div class="facts"><div><span>Shipping</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Not captured'}</b></div><div><span>Customer</span><b>${order.customer_active ? 'Account active' : ['paid', 'fulfilled'].includes(order.status) ? 'Activation pending' : 'Not created'}</b></div><div><span>Progress</span><b>${escapeHtml(order.nfc_assigned_count || 0)}/${escapeHtml(order.quantity)} NFC · ${escapeHtml(order.shipped_count || 0)}/${escapeHtml(order.quantity)} shipped</b></div></div>
    ${emailState}
    <div class="primary-actions">${operational}</div>
    <details class="drawer" open><summary>Walls <span>${items.length}</span></summary><div class="items">${rows}</div></details>
    <details class="drawer"><summary>Order controls <span>›</span></summary><div class="controls">${pendingControl}${paidControls}</div></details>
    <details class="drawer"><summary>Technical details <span>›</span></summary><div class="tech"><div><span>Order ID</span><code>${escapeHtml(order.id)}</code></div><div><span>Checkout</span><code>${escapeHtml(order.stripe_checkout_session_id || '—')}</code></div><div><span>Payment</span><code>${escapeHtml(order.stripe_payment_intent_id || '—')}</code></div></div></details>
  </article>`;
}

function page({ admin, orders, view, search, notice = '', error = '', oneTime = null }) {
  const smtp = commerceEmailStatus();
  const counts = {
    action: orders.filter((order) => matchesView(order, 'action')).length,
    paid: orders.filter((order) => order.status === 'paid').length,
    fulfilled: orders.filter((order) => order.status === 'fulfilled').length,
    pending: orders.filter((order) => order.status === 'pending').length,
    email: orders.filter((order) => ['paid', 'fulfilled'].includes(order.status)
      && (!order.customer_confirmation_sent_at || order.customer_confirmation_error)).length,
  };
  let filtered = orders.filter((order) => matchesView(order, view));
  const q = clean(search).toLowerCase();
  if (q) {
    filtered = filtered.filter((order) => `${order.id} ${order.purchaser_email} ${order.stripe_checkout_session_id || ''} ${order.stripe_payment_intent_id || ''}`.toLowerCase().includes(q));
  }
  const tabs = [
    ['action', 'Needs action', counts.action],
    ['paid', 'Paid', counts.paid],
    ['fulfilled', 'Shipped', counts.fulfilled],
    ['pending', 'Pending', counts.pending],
    ['cancelled', 'Cancelled', orders.filter((order) => order.status === 'cancelled').length],
    ['all', 'All', orders.length],
  ].map(([key, label, count]) => `<a class="tab ${view === key ? 'active' : ''}" href="/admin/orders?view=${key}">${label}<span>${count}</span></a>`).join('');
  const cards = filtered.length
    ? filtered.map((order) => orderCard(order, admin.csrf)).join('')
    : '<div class="empty">No orders in this view.</div>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Orders · The Wall Admin</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif}.shell{max-width:1120px;margin:auto;padding:18px 20px 60px}.top{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;background:#171512;color:#fff;border-radius:14px}.top h1{margin:0;font-size:20px}.top small{display:block;margin-top:3px;color:#beb5a9;font-size:9px;text-transform:uppercase;letter-spacing:1.3px}.top form{margin:0}.nav{display:flex;gap:5px;overflow:auto;margin:10px 0 20px;padding:6px;background:#fbf8f1;border:1px solid #ddd4c5;border-radius:11px}.nav a{padding:9px 13px;border-radius:7px;color:#71695e;text-decoration:none;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}.nav a.active{background:#171512;color:#fff}.pagehead{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin:8px 0 14px}.pagehead h2{margin:0;font-size:34px;letter-spacing:-1px}.pagehead p{margin:6px 0 0;color:#746c61;font-size:13px}.smtp{display:flex;align-items:center;gap:7px;padding:9px 11px;background:#fffaf1;border:1px solid #d8cdbc;border-radius:9px;font-size:10px;font-weight:850}.dot{width:8px;height:8px;border-radius:50%;background:#9b4137}.dot.ok{background:#52714d}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:13px}.stat{padding:13px;background:#fbf8f1;border:1px solid #ddd4c5;border-radius:10px}.stat b{display:block;font-size:23px}.stat span{display:block;margin-top:4px;color:#746c61;font-size:8px;text-transform:uppercase;letter-spacing:.7px;font-weight:900}.alert{padding:12px 14px;border-radius:9px;margin-bottom:12px;font-size:12px;font-weight:800}.alert.good{background:#e3eee0;border-left:4px solid #52714d}.alert.bad{background:#f2dfdb;border-left:4px solid #9b4137}.nfc{padding:15px;margin-bottom:14px;background:#fff;border:2px solid #171512;border-radius:11px}.nfc code{display:block;margin:9px 0;padding:10px;background:#f2ede4;border-radius:7px;word-break:break-all;font-size:11px}.nfc p{color:#665e55;font-size:12px}.search{display:flex;gap:7px;margin-bottom:9px}.search input{flex:1;min-height:42px;padding:9px 11px;border:1px solid #c9bead;border-radius:8px;background:#fff}.tabs{display:flex;gap:5px;overflow:auto;margin-bottom:10px}.tab{display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid #d6ccbd;border-radius:999px;background:#fffaf1;color:#6d655b;text-decoration:none;font-size:9px;font-weight:900;text-transform:uppercase;white-space:nowrap}.tab span{display:grid;place-items:center;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#ece5da}.tab.active{background:#171512;color:#fff}.tab.active span{background:#39342f}.orders{display:flex;flex-direction:column;gap:9px}.order-card{padding:16px;background:#fffdf9;border:1px solid #ddd4c5;border-radius:12px;box-shadow:0 5px 18px rgba(34,28,23,.04)}.head{display:flex;justify-content:space-between;gap:16px}.eyebrow{display:block;color:#81786d;font-size:8px;text-transform:uppercase;letter-spacing:1px;font-weight:950}.head h3{margin:5px 0 3px;font-size:16px;overflow-wrap:anywhere}.head p{margin:0;color:#746c61;font-size:10px}.badges{display:flex;gap:5px}.pill{display:inline-flex;align-items:center;width:max-content;padding:5px 7px;border-radius:999px;background:#eee8de;color:#645d55;font-size:7px;text-transform:uppercase;letter-spacing:.55px;font-weight:950}.pill.good{background:#dfead9;color:#355230}.pill.warn{background:#f2e4b9;color:#76550e}.pill.bad{background:#f1d9d5;color:#873a33}.pill.muted{background:#eee8de;color:#6e675f}.facts{display:grid;grid-template-columns:2fr 1fr 1fr;gap:7px;margin:12px 0}.facts>div{min-width:0;padding:8px 9px;background:#f5f0e8;border-radius:8px}.facts span,.tech span{display:block;margin-bottom:4px;color:#81786d;font-size:7px;text-transform:uppercase;letter-spacing:.6px;font-weight:900}.facts b{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.email{display:flex;justify-content:space-between;gap:10px;padding:9px 10px;margin:9px 0;border-radius:8px;font-size:10px}.email span{overflow-wrap:anywhere}.email.good{background:#e5efe1;color:#3e5c39}.email.warn{background:#f5e7bf;color:#76530d}.email.bad{background:#f2dfdb;color:#7c342f}.primary-actions{display:flex;align-items:center;gap:9px;margin:11px 0}.ready-note{color:#6e665d;font-size:9px;font-weight:800}.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:8px 11px;border:1px solid #171512;border-radius:7px;background:#171512;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.55px;font-weight:950;cursor:pointer}.button.secondary{background:#fffdf8;color:#171512;border-color:#c8bdad}.button.good{background:#52714d;border-color:#52714d}.drawer{border-top:1px solid #ebe3d7;margin-top:8px}.drawer summary{display:flex;align-items:center;justify-content:space-between;min-height:40px;list-style:none;cursor:pointer;color:#645d55;font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:950}.drawer summary::-webkit-details-marker{display:none}.items{padding:2px 0 7px}.item-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #eee7dc}.item-row:last-child{border-bottom:0}.item-row b{display:block;font-size:11px}.item-row span{display:block;margin-top:2px;color:#81786d;font-size:9px}.item-row small{display:block;margin-top:4px;color:#81786d;font-size:8px}.item-actions{display:flex;gap:6px}.item-actions form{margin:0}.controls{display:flex;gap:6px;flex-wrap:wrap;padding:5px 0 10px}.controls form{margin:0}.link-action{min-height:38px;padding:8px;border:0;background:transparent;color:#665e55;text-decoration:underline;font-size:9px;font-weight:800;cursor:pointer}.tech{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;padding:4px 0 10px}.tech>div{min-width:0;padding:8px;background:#f4efe7;border-radius:7px}.tech code{display:block;overflow-wrap:anywhere;font-size:9px}.empty{padding:35px;text-align:center;background:#fffaf1;border:1px dashed #cfc4b4;border-radius:12px;color:#6f675d}@media(max-width:720px){.shell{padding:12px 12px 48px}.pagehead{align-items:flex-start;flex-direction:column}.pagehead h2{font-size:30px}.smtp{width:100%}.stats{grid-template-columns:repeat(2,1fr)}.head{display:block}.badges{margin-top:8px}.facts{grid-template-columns:1fr 1fr}.facts>div:first-child{grid-column:1/-1}.item-row{grid-template-columns:1fr}.item-actions{display:grid;grid-template-columns:1fr 1fr}.item-actions .button{width:100%}.tech{grid-template-columns:1fr}.controls{flex-direction:column}.controls form,.controls .button{width:100%}.top span{display:none}}
  </style></head><body><main class="shell"><header class="top"><div><h1>The Wall</h1><small>Admin console</small></div><div><span>${escapeHtml(admin.display_name || admin.username)} · Main Admin</span><form method="post" action="/admin/logout" style="display:inline"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="link-action" style="color:#fff;text-decoration:none" type="submit">Logout</button></form></div></header><nav class="nav"><a href="/admin/walls">Walls</a><a class="active" href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Audit</a></nav>
    <section class="pagehead"><div><h2>Orders</h2><p>After payment: assign the NFC, pack the Wall, then mark it shipped. The customer names and locates it on first scan.</p></div><div class="smtp"><span class="dot ${smtp.configured ? 'ok' : ''}"></span>${smtp.configured ? `SMTP ready · ${escapeHtml(smtp.host)}` : 'SMTP credentials missing'}</div></section>
    ${notice ? `<div class="alert good">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="alert bad">${escapeHtml(error)}</div>` : ''}
    ${oneTime?.nfcUrl ? `<section class="nfc"><b>Wall ${escapeHtml(oneTime.ordinal)} · ${escapeHtml(oneTime.serial)}</b><p>Write this exact URL to the physical NFC tag now. The raw token is intentionally shown once. If you lose it before shipping, use Replace NFC for that Wall.</p><code>${escapeHtml(oneTime.nfcUrl)}</code></section>` : ''}
    ${oneTime?.claimUrl ? `<section class="nfc"><b>Recovery activation link</b><p>Use only if the purchaser cannot access their account.</p><code>${escapeHtml(oneTime.claimUrl)}</code></section>` : ''}
    <section class="stats"><div class="stat"><b>${counts.action}</b><span>Needs action</span></div><div class="stat"><b>${counts.paid}</b><span>Paid / packing</span></div><div class="stat"><b>${counts.email}</b><span>Email attention</span></div><div class="stat"><b>${counts.fulfilled}</b><span>Shipped</span></div></section>
    <form class="search" method="get" action="/admin/orders"><input type="hidden" name="view" value="${escapeHtml(view)}"><input name="q" value="${escapeHtml(search)}" placeholder="Search email, order or Stripe ID"><button class="button secondary" type="submit">Search</button></form><nav class="tabs">${tabs}</nav><section class="orders">${cards}</section>
  </main></body></html>`;
}

async function renderOrders(req, res, { notice = '', error = '', oneTime = null } = {}) {
  const orders = await listOrders();
  const valid = new Set(['action', 'paid', 'fulfilled', 'pending', 'cancelled', 'refunded', 'all']);
  const view = valid.has(clean(req.query?.view)) ? clean(req.query.view) : 'action';
  return res.type('html').send(page({
    admin: req.orderAdmin,
    orders,
    view,
    search: clean(req.query?.q),
    notice,
    error,
    oneTime,
  }));
}

export function mountAdminOrdersV2(app) {
  app.get('/admin/fulfillment', requireOwner, (_req, res) => res.redirect(303, '/admin/orders'));
  app.get('/admin/orders', requireOwner, (req, res, next) => renderOrders(req, res).catch(next));

  app.post('/admin/orders/:orderId/assign-nfc', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await assignNextNfc(req.params.orderId);
      await writeAudit(req.orderAdmin, 'order.nfc_assigned', {
        wallId: result.wallId,
        wallName: result.wallName,
        details: { order_id: req.params.orderId, ordinal: result.ordinal, serial_code: result.serial },
      });
      return renderOrders(req, res, { notice: 'NFC assigned. Program the Wall using the one-time URL below.', oneTime: result });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not assign NFC.' });
    }
  });

  app.post('/admin/orders/:orderId/items/:itemId/replace-nfc', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await replaceUnshippedNfc(req.params.orderId, req.params.itemId);
      await writeAudit(req.orderAdmin, 'order.nfc_replaced_before_shipping', {
        wallId: result.wallId,
        wallName: result.wallName,
        details: { order_id: req.params.orderId, item_id: req.params.itemId, ordinal: result.ordinal },
      });
      return renderOrders(req, res, { notice: 'Previous NFC disabled. Program the replacement URL below.', oneTime: result });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not replace NFC.' });
    }
  });

  app.post('/admin/orders/:orderId/items/:itemId/ship', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await markItemShipped(req.params.orderId, req.params.itemId);
      if (!result.alreadyDone) {
        await writeAudit(req.orderAdmin, 'order.wall_shipped', {
          wallId: result.wallId,
          wallName: result.wallName,
          details: { order_id: req.params.orderId, item_id: req.params.itemId },
        });
      }
      return renderOrders(req, res, { notice: 'Wall marked shipped. The customer will choose name and location on first scan.' });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not mark Wall shipped.' });
    }
  });

  app.post('/admin/orders/:orderId/reconcile', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      const result = await pool.query(`select stripe_checkout_session_id from commerce_orders where id = $1 limit 1`, [req.params.orderId]);
      const sessionId = result.rows[0]?.stripe_checkout_session_id;
      if (!sessionId) throw new Error('This order does not have a Stripe Checkout Session to check.');
      await reconcileCheckoutSessionById(sessionId);
      return renderOrders(req, res, { notice: 'Stripe payment status rechecked.' });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not recheck payment.' });
    }
  });

  app.post('/admin/orders/:orderId/email/customer', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      await resendCustomerConfirmation(req.params.orderId);
      return renderOrders(req, res, { notice: 'Customer order confirmation sent.' });
    } catch (error) {
      return renderOrders(req, res, { error: `Customer email failed: ${error?.message || error}` });
    }
  });

  app.post('/admin/orders/:orderId/email/owner', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      await resendOwnerNotification(req.params.orderId);
      return renderOrders(req, res, { notice: 'Admin order notification sent.' });
    } catch (error) {
      return renderOrders(req, res, { error: `Admin email failed: ${error?.message || error}` });
    }
  });

  app.post('/admin/orders/:orderId/claim-link', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      const claimUrl = await manualClaimLinkForOrder(req.params.orderId);
      return renderOrders(req, res, { oneTime: { claimUrl } });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not create recovery link.' });
    }
  });
}
