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
const ORDER_STATUSES = new Set(['pending', 'paid', 'fulfilled', 'cancelled', 'refunded']);

function clean(value) { return typeof value === 'string' ? value.trim() : ''; }
function validUuid(value) { return UUID_RE.test(String(value || '')); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
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
        where s.token_hash = $1 and s.expires_at > now() and u.active = true limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    const user = result.rows[0];
    if (user.role !== 'owner') return res.status(403).send('Main Admin access required.');
    req.orderAdmin = { ...user, raw, csrf: hashToken(`admin-csrf:${raw}`) };
    return next();
  } catch (error) { return next(error); }
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
  } catch (error) { console.error('[orders-audit]', error); }
}
function money(amount, currency = 'aud') {
  if (!Number.isFinite(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: String(currency || 'aud').toUpperCase() }).format(Number(amount) / 100);
  } catch (_) { return `$${(Number(amount) / 100).toFixed(2)}`; }
}
function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
function shortId(value) {
  const text = clean(value);
  if (!text) return '—';
  return text.length > 18 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
}
function addressLines(address) {
  const value = address || {};
  return [value.line1, value.line2, [value.city, value.state, value.postal_code].filter(Boolean).join(' '), value.country].filter(Boolean);
}
function statusLabel(status) {
  return ({ pending: 'Pending', paid: 'Paid', fulfilled: 'Fulfilled', cancelled: 'Cancelled', refunded: 'Refunded' })[status] || status;
}
function statusClass(status) {
  if (status === 'fulfilled') return 'good';
  if (status === 'paid') return 'warn';
  if (status === 'cancelled' || status === 'refunded') return 'bad';
  return 'muted';
}

const orderSelect = `select o.*,
  count(i.id)::int as item_count,
  count(i.id) filter (where i.wall_id is not null)::int as nfc_assigned_count,
  count(i.id) filter (where i.status = 'fulfilled')::int as shipped_count,
  count(i.id) filter (where i.status = 'awaiting_fulfillment')::int as outstanding_count,
  coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'ordinal', i.ordinal, 'status', i.status, 'wall_id', i.wall_id,
    'wall_name', w.display_name, 'setup_required', w.setup_required,
    'serial_code', p.serial_code, 'nfc_assigned_at', i.nfc_assigned_at,
    'shipped_at', i.shipped_at
  ) order by i.ordinal) filter (where i.id is not null), '[]'::jsonb) as items
from commerce_orders o
left join commerce_order_items i on i.order_id = o.id
left join walls w on w.id = i.wall_id
left join plaques p on p.order_item_id = i.id`;

async function listOutstandingOrders(search = '') {
  const q = clean(search);
  const params = [];
  let searchSql = '';
  if (q) {
    params.push(`%${q}%`);
    searchSql = `and (o.purchaser_email ilike $${params.length} or o.id::text ilike $${params.length} or coalesce(o.stripe_checkout_session_id,'') ilike $${params.length})`;
  }
  const result = await pool.query(
    `${orderSelect}
      where o.status = 'paid'
        and exists (select 1 from commerce_order_items x where x.order_id = o.id and x.status = 'awaiting_fulfillment')
        ${searchSql}
      group by o.id
      order by o.created_at asc
      limit 250`, params,
  );
  return result.rows;
}

async function listOrderHistory(search = '') {
  const q = clean(search);
  const params = [];
  let searchSql = '';
  if (q) {
    params.push(`%${q}%`);
    searchSql = `where (o.purchaser_email ilike $1 or o.id::text ilike $1 or coalesce(o.stripe_checkout_session_id,'') ilike $1 or coalesce(o.stripe_payment_intent_id,'') ilike $1)`;
  }
  const result = await pool.query(
    `${orderSelect}
      ${searchSql}
      group by o.id
      order by o.created_at desc
      limit 250`, params,
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
      `select * from commerce_order_items where order_id = $1 and status = 'awaiting_fulfillment' and wall_id is null order by ordinal limit 1 for update`,
      [order.id],
    );
    if (itemResult.rowCount === 0) throw new Error('Every outstanding Wall already has an NFC assigned.');
    const item = itemResult.rows[0];
    const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
    const rawNfc = makeToken(36);
    const serial = `TW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint, setup_required) values ($1, 'Set up your Wall', '', true) returning id, slug, display_name`, [slug],
    );
    const wall = wallResult.rows[0];
    const tagResult = await client.query(`insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true) returning id`, [wall.id, hashToken(rawNfc)]);
    const physicalResult = await client.query(
      `insert into plaques (serial_code, order_item_id, wall_id, wall_tag_id, status, assigned_at)
       values ($1, $2, $3, $4, 'assigned', now()) returning id, serial_code`,
      [serial, item.id, wall.id, tagResult.rows[0].id],
    );
    await client.query(`insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id) values ($1, $2, $3, $4)`, [customerId, wall.id, order.id, physicalResult.rows[0].id]);
    await client.query(`update commerce_order_items set wall_id = $2, nfc_assigned_at = now() where id = $1`, [item.id, wall.id]);
    await client.query('commit');
    const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
    return { wallId: wall.id, wallName: wall.display_name, ordinal: item.ordinal, serial: physicalResult.rows[0].serial_code, nfcUrl: `${appBase}/t/${rawNfc}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

async function replaceUnshippedNfc(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select i.id, i.wall_id, i.status, i.ordinal, w.display_name, p.id as physical_id, p.serial_code
         from commerce_order_items i join commerce_orders o on o.id = i.order_id join walls w on w.id = i.wall_id join plaques p on p.order_item_id = i.id
        where i.id = $1 and i.order_id = $2 and o.status = 'paid' for update of i, w, p`, [itemId, orderId],
    );
    if (result.rowCount === 0) throw new Error('Assigned Wall not found on this paid order.');
    const item = result.rows[0];
    if (item.status !== 'awaiting_fulfillment') throw new Error('A shipped Wall cannot be reprogrammed from Orders.');
    const rawNfc = makeToken(36);
    await client.query(`update wall_tags set active = false where wall_id = $1 and active = true`, [item.wall_id]);
    const tag = await client.query(`insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true) returning id`, [item.wall_id, hashToken(rawNfc)]);
    await client.query(`update plaques set wall_tag_id = $2, assigned_at = now() where id = $1`, [item.physical_id, tag.rows[0].id]);
    await client.query(`update commerce_order_items set nfc_assigned_at = now() where id = $1`, [item.id]);
    await client.query('commit');
    const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
    return { wallId: item.wall_id, wallName: item.display_name, ordinal: item.ordinal, serial: item.serial_code, nfcUrl: `${appBase}/t/${rawNfc}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

async function markItemShipped(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const itemResult = await client.query(
      `select i.*, o.status as order_status, w.display_name from commerce_order_items i join commerce_orders o on o.id = i.order_id left join walls w on w.id = i.wall_id
        where i.id = $1 and i.order_id = $2 for update of i, o`, [itemId, orderId],
    );
    if (itemResult.rowCount === 0) throw new Error('Wall item not found.');
    const item = itemResult.rows[0];
    if (!['paid', 'fulfilled'].includes(item.order_status)) throw new Error('Payment must be confirmed before shipping.');
    if (!item.wall_id) throw new Error('Program the NFC before marking this Wall shipped.');
    if (item.status === 'fulfilled') { await client.query('commit'); return { wallId: item.wall_id, wallName: item.display_name, alreadyDone: true }; }
    if (item.status !== 'awaiting_fulfillment') throw new Error('This Wall is not available to ship.');
    await client.query(`update commerce_order_items set status = 'fulfilled', shipped_at = now(), fulfilled_at = now() where id = $1`, [item.id]);
    const remaining = await client.query(`select count(*)::int as count from commerce_order_items where order_id = $1 and status = 'awaiting_fulfillment'`, [orderId]);
    if (remaining.rows[0].count === 0) {
      await client.query(`update commerce_orders set status = 'fulfilled', fulfilled_at = coalesce(fulfilled_at, now()), updated_at = now() where id = $1`, [orderId]);
    }
    await client.query('commit');
    return { wallId: item.wall_id, wallName: item.display_name, alreadyDone: false };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

async function updateOrderStatus(orderId, status) {
  if (!validUuid(orderId)) throw new Error('Invalid order ID.');
  if (!ORDER_STATUSES.has(status)) throw new Error('Invalid order status.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select id, status from commerce_orders where id = $1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    const before = orderResult.rows[0].status;
    if (status === 'fulfilled') {
      const pending = await client.query(`select count(*)::int as count from commerce_order_items where order_id = $1 and status = 'awaiting_fulfillment'`, [orderId]);
      if (pending.rows[0].count > 0) throw new Error('Ship all order items before marking the order Fulfilled.');
    }
    const result = await client.query(
      `update commerce_orders
          set status = $2,
              paid_at = case when $2 = 'paid' then coalesce(paid_at, now()) else paid_at end,
              fulfilled_at = case when $2 = 'fulfilled' then coalesce(fulfilled_at, now()) when $2 <> 'fulfilled' then null else fulfilled_at end,
              updated_at = now()
        where id = $1 returning id, status`,
      [orderId, status],
    );
    await client.query('commit');
    return { before, after: result.rows[0].status };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

function nextAction(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.some((item) => item.status === 'awaiting_fulfillment' && !item.wall_id)) return 'Program NFC';
  if (items.some((item) => item.status === 'awaiting_fulfillment' && item.wall_id)) return 'Ship';
  return 'Complete';
}

function outstandingRow(order, csrf) {
  const items = Array.isArray(order.items) ? order.items : [];
  const outstanding = items.filter((item) => item.status === 'awaiting_fulfillment');
  const shipping = addressLines(order.shipping_address);
  const unprogrammed = outstanding.filter((item) => !item.wall_id);
  const progress = `${order.shipped_count || 0}/${order.quantity} shipped`;
  const itemRows = outstanding.map((item) => {
    if (!item.wall_id) {
      return `<div class="fulfilment-item"><div><b>Wall ${escapeHtml(item.ordinal)}</b><span>Needs NFC programming</span></div><span class="step-badge program">Program NFC</span><span class="item-placeholder">Program from the order action above</span></div>`;
    }
    return `<div class="fulfilment-item"><div><b>Wall ${escapeHtml(item.ordinal)}</b><span>${escapeHtml(item.serial_code || 'NFC assigned')}</span></div><span class="step-badge ship">Ready to ship</span><div class="item-actions"><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/ship"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button good" type="submit">Mark shipped</button></form><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/replace-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button secondary" type="submit">Replace NFC</button></form></div></div>`;
  }).join('');
  return `<details class="fulfilment-order"><summary><div class="order-person"><b>${escapeHtml(order.purchaser_email)}</b><span>${escapeHtml(fmt(order.created_at))}</span></div><div><b>${escapeHtml(shortId(order.id))}</b><span>${escapeHtml(order.quantity)} Wall${Number(order.quantity) === 1 ? '' : 's'}</span></div><div><span class="step-badge ${nextAction(order) === 'Program NFC' ? 'program' : 'ship'}">${escapeHtml(nextAction(order))}</span></div><div><b>${escapeHtml(progress)}</b></div><div><b>${escapeHtml(money(order.amount_total, order.currency))}</b></div><div class="chev">›</div></summary><div class="fulfilment-body"><div class="order-detail-grid"><div><span>Shipping</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Not captured'}</b></div><div><span>Outstanding</span><b>${escapeHtml(outstanding.length)}</b></div><div><span>NFC remaining</span><b>${escapeHtml(unprogrammed.length)}</b></div></div>${unprogrammed.length ? `<form class="program-action" method="post" action="/admin/orders/${encodeURIComponent(order.id)}/assign-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="button" type="submit">Program next NFC</button></form>` : ''}<div class="fulfilment-items">${itemRows}</div></div></details>`;
}

function historyRow(order, csrf) {
  const progress = `${order.shipped_count || 0}/${order.quantity} shipped`;
  const options = [...ORDER_STATUSES].map((status) => `<option value="${status}" ${status === order.status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('');
  return `<tr><td><strong>${escapeHtml(order.purchaser_email)}</strong><div class="code">${escapeHtml(shortId(order.id))}</div></td><td>${escapeHtml(fmt(order.created_at))}</td><td>${escapeHtml(order.quantity)}</td><td>${escapeHtml(money(order.amount_total, order.currency))}</td><td><span class="pill ${statusClass(order.status)}">${escapeHtml(statusLabel(order.status))}</span></td><td>${escapeHtml(progress)}</td><td><form class="status-edit" method="post" action="/admin/orders/${encodeURIComponent(order.id)}/status"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="return_tab" value="history"><select name="status">${options}</select><button class="button secondary" type="submit">Save</button></form></td></tr>`;
}

function page({ admin, tab, outstanding, history, search, notice = '', error = '', oneTime = null }) {
  const isHistory = tab === 'history';
  const tabs = `<div class="order-tabs"><a class="${!isHistory ? 'active' : ''}" href="/admin/orders">Outstanding <span>${outstanding.length}</span></a><a class="${isHistory ? 'active' : ''}" href="/admin/orders?tab=history">Order History</a></div>`;
  const searchForm = `<form class="search" method="get" action="/admin/orders"><input type="hidden" name="tab" value="${isHistory ? 'history' : 'outstanding'}"><input name="q" value="${escapeHtml(search)}" placeholder="Search customer email or order ID"><button class="button secondary" type="submit">Search</button></form>`;
  let body;
  if (isHistory) {
    body = history.length ? `<div class="table-wrap"><table class="table order-history"><thead><tr><th>Customer / Order</th><th>Created</th><th>Qty</th><th>Total</th><th>Status</th><th>Fulfilment</th><th>Edit status</th></tr></thead><tbody>${history.map((order) => historyRow(order, admin.csrf)).join('')}</tbody></table></div>` : '<div class="empty">No orders found.</div>';
  } else {
    body = outstanding.length ? `<div class="fulfilment-list"><div class="fulfilment-head"><span>Customer</span><span>Order</span><span>Next action</span><span>Progress</span><span>Total</span><span></span></div>${outstanding.map((order) => outstandingRow(order, admin.csrf)).join('')}</div>` : '<div class="empty">No outstanding orders. Everything is fulfilled.</div>';
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Orders · SaidHere Admin</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#17191d;font-family:Inter,Arial,sans-serif}.shell{max-width:1160px;margin:auto;padding:18px 20px 60px}.top{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#171717;color:#fff;border-radius:12px}.top h1{margin:0;font-size:19px}.top small{color:#aaa}.nav{display:flex;gap:6px;margin:10px 0 18px}.nav a{padding:8px 10px;text-decoration:none}.pagehead h2{margin:0}.pagehead p{color:#6b7280}.order-tabs{display:flex;gap:6px;margin:0 0 10px}.order-tabs a{display:flex;align-items:center;gap:6px;padding:9px 12px;border:1px solid #dfe3e8;border-radius:8px;background:#fff;color:#5d6470;text-decoration:none;font-size:10px;font-weight:900}.order-tabs a.active{background:#17191d;color:#fff;border-color:#17191d}.order-tabs span{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:99px;background:#eef0f2;color:#4f5660}.order-tabs a.active span{background:#34373d;color:#fff}.search{display:flex;gap:7px;margin-bottom:10px}.search input{flex:1;min-height:40px;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:8px 10px;border:1px solid #17191d;border-radius:8px;background:#17191d;color:#fff;font-size:8px;text-transform:uppercase;font-weight:900;cursor:pointer}.button.secondary{background:#fff;color:#262a30;border-color:#d1d5db}.button.good{background:#356d48;border-color:#356d48}.alert,.nfc{padding:11px 13px;margin-bottom:10px;border-radius:9px;background:#fff;border:1px solid #e2e5e9}.alert.good{border-left:4px solid #356d48}.alert.bad{border-left:4px solid #a13e35}.nfc{border:2px solid #17191d}.nfc code{display:block;margin-top:7px;padding:8px;background:#f3f4f6;border-radius:7px;word-break:break-all}.fulfilment-list{border:1px solid #e2e5e9;border-radius:11px;background:#fff;overflow:hidden}.fulfilment-head,.fulfilment-order>summary{display:grid;grid-template-columns:minmax(230px,1.5fr) 140px 120px 110px 100px 22px;gap:10px;align-items:center}.fulfilment-head{padding:8px 12px;background:#f8f9fa;color:#6b7280;font-size:7px;text-transform:uppercase;font-weight:900}.fulfilment-order{border-top:1px solid #eef0f2}.fulfilment-order:first-of-type{border-top:0}.fulfilment-order>summary{list-style:none;min-height:66px;padding:10px 12px;cursor:pointer}.fulfilment-order>summary::-webkit-details-marker{display:none}.fulfilment-order[open]>summary{background:#f8fafb}.order-person b,.fulfilment-order summary>div>b{display:block;font-size:10px}.order-person span,.fulfilment-order summary>div>span{display:block;margin-top:3px;color:#6b7280;font-size:7px}.step-badge{display:inline-flex!important;width:max-content;padding:5px 7px;border-radius:99px;font-size:7px!important;text-transform:uppercase;font-weight:900}.step-badge.program{background:#fff1c9;color:#8b651b}.step-badge.ship{background:#e8f0fa;color:#345f8c}.chev{font-size:18px;color:#999}.fulfilment-order[open] .chev{transform:rotate(90deg)}.fulfilment-body{padding:12px;border-top:1px solid #eef0f2}.order-detail-grid{display:grid;grid-template-columns:2fr 100px 100px;gap:7px}.order-detail-grid>div{padding:8px;background:#f7f8fa;border-radius:7px}.order-detail-grid span{display:block;color:#6b7280;font-size:7px;text-transform:uppercase;font-weight:900}.order-detail-grid b{display:block;margin-top:4px;font-size:9px}.program-action{margin:10px 0}.fulfilment-items{border-top:1px solid #eef0f2}.fulfilment-item{display:grid;grid-template-columns:1fr 150px auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #eef0f2}.fulfilment-item:last-child{border-bottom:0}.fulfilment-item b{font-size:9px}.fulfilment-item span{display:block;margin-top:3px;color:#6b7280;font-size:7px}.item-actions{display:flex;gap:6px}.item-actions form{margin:0}.item-placeholder{font-size:8px;color:#8a9099}.table-wrap{overflow:auto;border:1px solid #e2e5e9;border-radius:10px;background:#fff}.table{width:100%;border-collapse:collapse}.table th{padding:9px 10px;background:#f7f8fa;color:#6b7280;font-size:7px;text-transform:uppercase;text-align:left}.table td{padding:10px;border-top:1px solid #eef0f2;font-size:9px;vertical-align:middle}.code{margin-top:3px;color:#7b818a;font-family:ui-monospace,monospace;font-size:8px}.pill{display:inline-flex;padding:5px 7px;border-radius:99px;font-size:7px;text-transform:uppercase;font-weight:900}.pill.good{background:#eaf5ed;color:#356d48}.pill.warn{background:#fff1c9;color:#8b651b}.pill.bad{background:#faecea;color:#a13e35}.pill.muted{background:#eef0f2;color:#666}.status-edit{display:flex;gap:6px;align-items:center;margin:0}.status-edit select{min-height:34px;padding:6px 8px;border:1px solid #d1d5db;border-radius:7px;background:#fff;font-size:9px}.empty{padding:30px;text-align:center;background:#fff;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280}.link-action{color:#fff;background:transparent;border:0;cursor:pointer}.nav a.active{font-weight:900}
  @media(max-width:760px){.shell{padding:12px}.fulfilment-head{display:none}.fulfilment-order>summary{grid-template-columns:minmax(0,1fr) 90px 20px}.fulfilment-order>summary>div:nth-child(2),.fulfilment-order>summary>div:nth-child(4),.fulfilment-order>summary>div:nth-child(5){display:none}.order-detail-grid{grid-template-columns:1fr}.fulfilment-item{grid-template-columns:1fr}.item-actions{flex-wrap:wrap}.order-tabs{overflow:auto}.status-edit{min-width:210px}}
  </style></head><body><main class="shell"><header class="top"><div><h1>SaidHere</h1><small>Admin console</small></div><div>${escapeHtml(admin.display_name || admin.username)} · Main Admin <form method="post" action="/admin/logout" style="display:inline"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="link-action" type="submit">Logout</button></form></div></header><nav class="nav"><a href="/admin/walls">Walls</a><a class="active" href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Activity</a></nav><section class="pagehead"><h2>Orders</h2><p>${isHistory ? 'Complete order history and manual status correction.' : 'Paid orders that still need NFC programming or shipping.'}</p></section>${notice ? `<div class="alert good">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="alert bad">${escapeHtml(error)}</div>` : ''}${oneTime?.nfcUrl ? `<section class="nfc"><b>Program Wall ${escapeHtml(oneTime.ordinal)} · ${escapeHtml(oneTime.serial)}</b><p>Write this exact URL to the physical NFC tag now. It is intentionally shown once.</p><code>${escapeHtml(oneTime.nfcUrl)}</code></section>` : ''}${oneTime?.claimUrl ? `<section class="nfc"><b>Recovery activation link</b><code>${escapeHtml(oneTime.claimUrl)}</code></section>` : ''}${tabs}${searchForm}${body}</main></body></html>`;
}

async function renderOrders(req, res, { notice = '', error = '', oneTime = null, forceTab = null } = {}) {
  const tab = forceTab || (clean(req.query?.tab) === 'history' ? 'history' : 'outstanding');
  const search = clean(req.query?.q);
  const [outstanding, history] = await Promise.all([
    listOutstandingOrders(tab === 'outstanding' ? search : ''),
    tab === 'history' ? listOrderHistory(search) : Promise.resolve([]),
  ]);
  return res.type('html').send(page({ admin: req.orderAdmin, tab, outstanding, history, search, notice, error, oneTime }));
}

export function mountAdminOrdersV2(app) {
  app.get('/admin/fulfillment', requireOwner, (_req, res) => res.redirect(303, '/admin/orders'));
  app.get('/admin/orders', requireOwner, (req, res, next) => renderOrders(req, res).catch(next));

  app.post('/admin/orders/:orderId/status', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await updateOrderStatus(req.params.orderId, clean(req.body?.status));
      await writeAudit(req.orderAdmin, 'order.status_changed', { details: { order_id: req.params.orderId, before: result.before, after: result.after } });
      return renderOrders(req, res, { forceTab: 'history', notice: `Order status changed from ${statusLabel(result.before)} to ${statusLabel(result.after)}.` });
    } catch (error) { return renderOrders(req, res, { forceTab: 'history', error: error?.message || 'Could not update order status.' }); }
  });

  app.post('/admin/orders/:orderId/assign-nfc', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await assignNextNfc(req.params.orderId);
      await writeAudit(req.orderAdmin, 'order.nfc_assigned', { wallId: result.wallId, wallName: result.wallName, details: { order_id: req.params.orderId, ordinal: result.ordinal, serial_code: result.serial } });
      return renderOrders(req, res, { notice: 'NFC assigned. Program the physical tag using the one-time URL below.', oneTime: result });
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not assign NFC.' }); }
  });

  app.post('/admin/orders/:orderId/items/:itemId/replace-nfc', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await replaceUnshippedNfc(req.params.orderId, req.params.itemId);
      await writeAudit(req.orderAdmin, 'order.nfc_replaced_before_shipping', { wallId: result.wallId, wallName: result.wallName, details: { order_id: req.params.orderId, item_id: req.params.itemId, ordinal: result.ordinal } });
      return renderOrders(req, res, { notice: 'Previous NFC disabled. Program the replacement URL below.', oneTime: result });
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not replace NFC.' }); }
  });

  app.post('/admin/orders/:orderId/items/:itemId/ship', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await markItemShipped(req.params.orderId, req.params.itemId);
      if (!result.alreadyDone) await writeAudit(req.orderAdmin, 'order.wall_shipped', { wallId: result.wallId, wallName: result.wallName, details: { order_id: req.params.orderId, item_id: req.params.itemId } });
      return renderOrders(req, res, { notice: 'Wall marked shipped.' });
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not mark Wall shipped.' }); }
  });

  app.post('/admin/orders/:orderId/reconcile', requireOwner, requireCsrf, async (req, res) => {
    try {
      if (!validUuid(req.params.orderId)) throw new Error('Invalid order ID.');
      const result = await pool.query(`select stripe_checkout_session_id from commerce_orders where id = $1 limit 1`, [req.params.orderId]);
      const sessionId = result.rows[0]?.stripe_checkout_session_id;
      if (!sessionId) throw new Error('This order has no Stripe Checkout Session.');
      await reconcileCheckoutSessionById(sessionId);
      await writeAudit(req.orderAdmin, 'order.reconciled', { details: { order_id: req.params.orderId } });
      return renderOrders(req, res, { forceTab: 'history', notice: 'Stripe payment status rechecked.' });
    } catch (error) { return renderOrders(req, res, { forceTab: 'history', error: error?.message || 'Could not recheck payment.' }); }
  });
  app.post('/admin/orders/:orderId/email/customer', requireOwner, requireCsrf, async (req, res) => {
    try { await resendCustomerConfirmation(req.params.orderId); await writeAudit(req.orderAdmin, 'order.customer_email_resent', { details: { order_id: req.params.orderId } }); return renderOrders(req, res, { forceTab: 'history', notice: 'Customer confirmation sent.' }); }
    catch (error) { return renderOrders(req, res, { forceTab: 'history', error: `Customer email failed: ${error?.message || error}` }); }
  });
  app.post('/admin/orders/:orderId/email/owner', requireOwner, requireCsrf, async (req, res) => {
    try { await resendOwnerNotification(req.params.orderId); await writeAudit(req.orderAdmin, 'order.owner_email_resent', { details: { order_id: req.params.orderId } }); return renderOrders(req, res, { forceTab: 'history', notice: 'Admin order notification sent.' }); }
    catch (error) { return renderOrders(req, res, { forceTab: 'history', error: `Admin email failed: ${error?.message || error}` }); }
  });
  app.post('/admin/orders/:orderId/claim-link', requireOwner, requireCsrf, async (req, res) => {
    try { const claimUrl = await manualClaimLinkForOrder(req.params.orderId); return renderOrders(req, res, { forceTab: 'history', oneTime: { claimUrl } }); }
    catch (error) { return renderOrders(req, res, { forceTab: 'history', error: error?.message || 'Could not create recovery link.' }); }
  });
}
