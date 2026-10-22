import crypto from 'node:crypto';

import { hashToken, makeToken } from './auth.js';
import { pool } from './db.js';
import {
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

async function listOutstandingOrders() {
  const result = await pool.query(
    `select o.*,
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
       left join commerce_order_items i on i.order_id = o.id
       left join walls w on w.id = i.wall_id
       left join plaques p on p.order_item_id = i.id
      where o.status = 'paid'
        and exists (
          select 1
            from commerce_order_items pending_item
           where pending_item.order_id = o.id
             and pending_item.status = 'awaiting_fulfillment'
        )
      group by o.id
      order by o.created_at asc
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
    if (itemResult.rowCount === 0) throw new Error('Every outstanding Wall in this order already has an NFC assigned.');
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
    if (item.status !== 'awaiting_fulfillment') throw new Error('A shipped Wall cannot be reprogrammed from Orders.');

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
    if (!item.wall_id) throw new Error('Program the NFC before marking this Wall shipped.');
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

function nextAction(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.some((item) => item.status === 'awaiting_fulfillment' && !item.wall_id)) return 'Program NFC';
  if (items.some((item) => item.status === 'awaiting_fulfillment' && item.wall_id)) return 'Ship';
  return 'Complete';
}

function orderRow(order, csrf) {
  const items = Array.isArray(order.items) ? order.items : [];
  const outstanding = items.filter((item) => item.status === 'awaiting_fulfillment');
  const shipping = addressLines(order.shipping_address);
  const unprogrammed = outstanding.filter((item) => !item.wall_id);
  const readyToShip = outstanding.filter((item) => item.wall_id);
  const progress = `${order.shipped_count || 0}/${order.quantity} shipped`;

  const itemRows = outstanding.map((item) => {
    if (!item.wall_id) {
      return `<div class="fulfilment-item"><div><b>Wall ${escapeHtml(item.ordinal)}</b><span>Needs NFC programming</span></div><span class="step-badge program">Program NFC</span><span class="item-placeholder">Use the Program NFC button above</span></div>`;
    }
    return `<div class="fulfilment-item"><div><b>Wall ${escapeHtml(item.ordinal)}</b><span>${escapeHtml(item.serial_code || 'NFC assigned')}</span></div><span class="step-badge ship">Ready to ship</span><div class="item-actions"><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/ship"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button good" type="submit">Mark shipped</button></form><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/replace-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary quiet" type="submit">Replace NFC</button></form></div></div>`;
  }).join('');

  const programButton = unprogrammed.length
    ? `<form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/assign-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button" type="submit">Program NFC</button></form>`
    : '';

  return `<details class="fulfilment-row"><summary class="fulfilment-summary"><div class="fulfilment-customer"><b>${escapeHtml(order.purchaser_email)}</b><small>${escapeHtml(fmt(order.created_at))}</small></div><div class="fulfilment-order"><b>${escapeHtml(shortId(order.id))}</b><small>${escapeHtml(order.quantity)} Wall${Number(order.quantity) === 1 ? '' : 's'}</small></div><div><span class="step-badge ${unprogrammed.length ? 'program' : 'ship'}">${escapeHtml(nextAction(order))}</span></div><div class="fulfilment-progress"><b>${escapeHtml(progress)}</b><small>${escapeHtml(order.nfc_assigned_count || 0)}/${escapeHtml(order.quantity)} NFC programmed</small></div><div class="fulfilment-total">${escapeHtml(money(order.amount_total, order.currency))}</div><div class="fulfilment-chevron">›</div></summary><div class="fulfilment-body"><div class="fulfilment-meta"><div><span>Ship to</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Shipping address not captured'}</b></div><div><span>Remaining</span><b>${outstanding.length} Wall${outstanding.length === 1 ? '' : 's'} · ${unprogrammed.length} to program · ${readyToShip.length} to ship</b></div></div>${programButton ? `<div class="fulfilment-primary">${programButton}<span>Creates the Wall and shows the one-time NFC URL.</span></div>` : ''}<div class="fulfilment-items">${itemRows}</div></div></details>`;
}

function page({ admin, orders, search, notice = '', error = '', oneTime = null }) {
  const q = clean(search).toLowerCase();
  const filtered = q
    ? orders.filter((order) => `${order.id} ${order.purchaser_email}`.toLowerCase().includes(q))
    : orders;
  const rows = filtered.length
    ? filtered.map((order) => orderRow(order, admin.csrf)).join('')
    : `<div class="empty">${q ? 'No outstanding orders match that search.' : 'No outstanding orders. Everything paid has been programmed and shipped.'}</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Outstanding Orders · SaidHere Admin</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif}.shell{max-width:1120px;margin:auto;padding:18px 20px 60px}.top{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;background:#171512;color:#fff;border-radius:14px}.top h1{margin:0;font-size:20px}.top small{display:block;margin-top:3px;color:#beb5a9;font-size:9px;text-transform:uppercase;letter-spacing:1.3px}.top form{margin:0}.nav{display:flex;gap:5px;overflow:auto;margin:10px 0 20px;padding:6px;background:#fbf8f1;border:1px solid #ddd4c5;border-radius:11px}.nav a{padding:9px 13px;border-radius:7px;color:#71695e;text-decoration:none;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;white-space:nowrap}.nav a.active{background:#171512;color:#fff}.pagehead{margin:8px 0 14px}.pagehead h2{margin:0;font-size:34px;letter-spacing:-1px}.pagehead p{margin:6px 0 0;color:#746c61;font-size:13px}.alert{padding:12px 14px;border-radius:9px;margin-bottom:12px;font-size:12px;font-weight:800}.alert.good{background:#e3eee0;border-left:4px solid #52714d}.alert.bad{background:#f2dfdb;border-left:4px solid #9b4137}.nfc{padding:15px;margin-bottom:14px;background:#fff;border:2px solid #171512;border-radius:11px}.nfc code{display:block;margin:9px 0;padding:10px;background:#f2ede4;border-radius:7px;word-break:break-all;font-size:11px}.nfc p{color:#665e55;font-size:12px}.search{display:flex;gap:7px;margin-bottom:10px}.search input{flex:1;min-height:42px;padding:9px 11px;border:1px solid #c9bead;border-radius:8px;background:#fff}.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:8px 11px;border:1px solid #171512;border-radius:7px;background:#171512;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.55px;font-weight:950;cursor:pointer}.button.secondary{background:#fffdf8;color:#171512;border-color:#c8bdad}.button.good{background:#52714d;border-color:#52714d}.button.quiet{min-height:32px;padding:6px 9px;color:#68625b}.orders{display:block}.fulfilment-list-head,.fulfilment-summary{display:grid;grid-template-columns:minmax(230px,1.55fr) 140px 105px 165px 90px 22px;align-items:center;gap:10px}.fulfilment-list-head{padding:8px 12px;background:#f8f9fa;border:1px solid #e2e5e9;border-bottom:0;border-radius:11px 11px 0 0;color:#6b7280;font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}.fulfilment-row{background:#fff;border:1px solid #e2e5e9;border-top:0}.fulfilment-row:last-child{border-radius:0 0 11px 11px}.fulfilment-row[open]{margin:7px 0;border:1px solid #cbd1d8;border-radius:10px;box-shadow:0 7px 24px rgba(17,24,39,.06)}.fulfilment-summary{list-style:none;min-height:66px;padding:10px 12px;cursor:pointer}.fulfilment-summary::-webkit-details-marker{display:none}.fulfilment-summary:hover{background:#fafbfc}.fulfilment-row[open]>.fulfilment-summary{background:#f8fafb;border-radius:10px 10px 0 0}.fulfilment-customer,.fulfilment-order{min-width:0}.fulfilment-customer b,.fulfilment-order b,.fulfilment-progress b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}.fulfilment-customer small,.fulfilment-order small,.fulfilment-progress small{display:block;margin-top:3px;color:#6b7280;font-size:7px}.fulfilment-total{font-size:10px;font-weight:850}.fulfilment-chevron{font-size:18px;color:#999;transition:.18s}.fulfilment-row[open] .fulfilment-chevron{transform:rotate(90deg)}.step-badge{display:inline-flex;width:max-content;padding:5px 7px;border-radius:99px;font-size:7px;text-transform:uppercase;letter-spacing:.5px;font-weight:900}.step-badge.program{background:#fff1c9;color:#7a5815}.step-badge.ship{background:#eaf5ed;color:#356d48}.fulfilment-body{padding:13px;border-top:1px solid #eef0f2}.fulfilment-meta{display:grid;grid-template-columns:2fr 1fr;gap:8px}.fulfilment-meta>div{padding:10px;background:#f7f8fa;border-radius:8px}.fulfilment-meta span{display:block;color:#6b7280;font-size:6px;text-transform:uppercase;letter-spacing:.55px;font-weight:900}.fulfilment-meta b{display:block;margin-top:4px;font-size:9px}.fulfilment-primary{display:flex;align-items:center;gap:10px;margin:12px 0;padding:10px;border:1px solid #e2e5e9;border-radius:9px;background:#fbfcfd}.fulfilment-primary span{color:#6b7280;font-size:8px}.fulfilment-items{border-top:1px solid #eef0f2;margin-top:9px}.fulfilment-item{display:grid;grid-template-columns:minmax(170px,1fr) 145px auto;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #eef0f2}.fulfilment-item:last-child{border-bottom:0}.fulfilment-item b{display:block;font-size:9px}.fulfilment-item>div:first-child span,.item-placeholder{display:block;margin-top:3px;color:#6b7280;font-size:7px}.item-actions{display:flex;align-items:center;gap:6px}.item-actions form{margin:0}.empty{padding:35px;text-align:center;background:#fff;border:1px dashed #cfc4b4;border-radius:12px;color:#6f675d;font-size:11px}@media(max-width:850px){.fulfilment-list-head,.fulfilment-summary{grid-template-columns:minmax(180px,1.4fr) 120px 95px 135px 80px 20px}}@media(max-width:720px){.shell{padding:12px 12px 48px}.top span{display:none}.fulfilment-list-head{display:none}.fulfilment-row{border:1px solid #e2e5e9!important;border-radius:10px!important;margin-bottom:8px}.fulfilment-summary{grid-template-columns:minmax(0,1fr) auto 20px}.fulfilment-summary>.fulfilment-order,.fulfilment-summary>.fulfilment-progress,.fulfilment-summary>.fulfilment-total{display:none}.fulfilment-meta{grid-template-columns:1fr}.fulfilment-item{grid-template-columns:1fr}.item-actions{justify-content:flex-start}.fulfilment-primary{align-items:flex-start;flex-direction:column}.search{display:grid;grid-template-columns:1fr auto}}
  </style></head><body><main class="shell"><header class="top"><div><h1>SaidHere</h1><small>Admin console</small></div><div><span>${escapeHtml(admin.display_name || admin.username)} · Main Admin</span><form method="post" action="/admin/logout" style="display:inline"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="button secondary" type="submit">Logout</button></form></div></header><nav class="nav"><a href="/admin/walls">Walls</a><a class="active" href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Activity</a></nav>
    <section class="pagehead"><h2>Outstanding orders</h2><p>Only paid orders that still need an NFC programmed or a Wall shipped appear here.</p></section>
    ${notice ? `<div class="alert good">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="alert bad">${escapeHtml(error)}</div>` : ''}
    ${oneTime?.nfcUrl ? `<section class="nfc"><b>Wall ${escapeHtml(oneTime.ordinal)} · ${escapeHtml(oneTime.serial)}</b><p>Write this exact URL to the NFC tag now. It is intentionally shown once.</p><code>${escapeHtml(oneTime.nfcUrl)}</code></section>` : ''}
    ${oneTime?.claimUrl ? `<section class="nfc"><b>Recovery activation link</b><p>Use only if the purchaser cannot access their account.</p><code>${escapeHtml(oneTime.claimUrl)}</code></section>` : ''}
    <form class="search" method="get" action="/admin/orders"><input name="q" value="${escapeHtml(search)}" placeholder="Search outstanding orders by email or order ID"><button class="button secondary" type="submit">Search</button></form>
    ${filtered.length ? '<div class="fulfilment-list-head"><span>Customer</span><span>Order</span><span>Next action</span><span>Progress</span><span>Total</span><span></span></div>' : ''}<section class="orders">${rows}</section>
  </main></body></html>`;
}

async function renderOrders(req, res, { notice = '', error = '', oneTime = null } = {}) {
  const orders = await listOutstandingOrders();
  return res.type('html').send(page({
    admin: req.orderAdmin,
    orders,
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
      return renderOrders(req, res, { notice: 'NFC created. Program the tag using the one-time URL below.', oneTime: result });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not program NFC.' });
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
      return renderOrders(req, res, { notice: 'Wall marked shipped.' });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not mark Wall shipped.' });
    }
  });

  // Recovery/support endpoints are retained but intentionally not exposed in the normal Orders UI.
  app.post('/admin/orders/:orderId/reconcile', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      const result = await pool.query(`select stripe_checkout_session_id from commerce_orders where id = $1 limit 1`, [req.params.orderId]);
      const sessionId = result.rows[0]?.stripe_checkout_session_id;
      if (!sessionId) throw new Error('This order has no Stripe checkout session.');
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
