import crypto from 'node:crypto';

import { hashToken, makeToken } from './auth.js';
import { ensureOrderCustomerLink } from './commerce_support.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_BASE = (process.env.PUBLIC_APP_URL || 'https://nfc.saidhere.app').replace(/\/$/, '');
const APP_HOST = APP_BASE.replace(/^https?:\/\//i, '');

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
  } catch (error) { console.error('[orders-v3-audit]', error); }
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
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
function orderRef(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return compact ? `TW-${compact.slice(0, 10)}` : 'TW-ORDER';
}
function addressLines(address) {
  const value = address || {};
  return [value.line1, value.line2, [value.city, value.state, value.postal_code].filter(Boolean).join(' '), value.country].filter(Boolean);
}
function writeValue(rawToken) { return `${APP_HOST}/t/${rawToken}`; }

async function prepareOrderNfcs(orderId) {
  if (!validUuid(orderId)) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    const order = orderResult.rows[0];
    if (order.status !== 'paid') { await client.query('commit'); return; }
    const customerId = await ensureOrderCustomerLink(client, order);
    const items = await client.query(
      `select * from commerce_order_items
        where order_id = $1 and status = 'awaiting_fulfillment'
        order by ordinal for update`,
      [order.id],
    );
    for (const item of items.rows) {
      if (item.wall_id) continue;
      const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
      const rawNfc = makeToken(36);
      const serial = `TW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const wallResult = await client.query(
        `insert into walls (slug, display_name, location_hint, setup_required)
         values ($1, 'Set up your Wall', '', true)
         returning id, display_name`,
        [slug],
      );
      const wall = wallResult.rows[0];
      const tag = await client.query(
        `insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true) returning id`,
        [wall.id, hashToken(rawNfc)],
      );
      const plaque = await client.query(
        `insert into plaques (serial_code, order_item_id, wall_id, wall_tag_id, status, assigned_at)
         values ($1, $2, $3, $4, 'assigned', now()) returning id`,
        [serial, item.id, wall.id, tag.rows[0].id],
      );
      await client.query(
        `insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id)
         values ($1, $2, $3, $4)`,
        [customerId, wall.id, order.id, plaque.rows[0].id],
      );
      await client.query(
        `update commerce_order_items
            set wall_id = $2, nfc_assigned_at = now(), nfc_write_value = $3, tagged_at = null
          where id = $1`,
        [item.id, wall.id, writeValue(rawNfc)],
      );
    }
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

async function autoPrepareOutstanding() {
  const result = await pool.query(
    `select distinct o.id
       from commerce_orders o
       join commerce_order_items i on i.order_id = o.id
      where o.status = 'paid' and i.status = 'awaiting_fulfillment' and i.wall_id is null
      order by o.id`,
  );
  for (const row of result.rows) await prepareOrderNfcs(row.id);
}

const orderSelect = `select o.*,
  count(i.id)::int as item_count,
  count(i.id) filter (where i.tagged_at is not null)::int as tagged_count,
  coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'ordinal', i.ordinal, 'status', i.status, 'wall_id', i.wall_id,
    'wall_name', w.display_name, 'serial_code', p.serial_code,
    'nfc_write_value', i.nfc_write_value, 'nfc_assigned_at', i.nfc_assigned_at,
    'tagged_at', i.tagged_at, 'shipped_at', i.shipped_at
  ) order by i.ordinal) filter (where i.id is not null), '[]'::jsonb) as items
from commerce_orders o
left join commerce_order_items i on i.order_id = o.id
left join walls w on w.id = i.wall_id
left join plaques p on p.order_item_id = i.id`;

async function listOrders(tab, search = '') {
  if (tab === 'outstanding') await autoPrepareOutstanding();
  const q = clean(search);
  const params = [];
  let searchSql = '';
  if (q) {
    params.push(`%${q}%`);
    searchSql = `and (o.purchaser_email ilike $${params.length} or o.id::text ilike $${params.length})`;
  }
  const statusSql = tab === 'history'
    ? `o.status in ('fulfilled','cancelled','refunded')`
    : `o.status = 'paid'`;
  const result = await pool.query(
    `${orderSelect}
      where ${statusSql} ${searchSql}
      group by o.id
      order by ${tab === 'history' ? 'coalesce(o.fulfilled_at,o.updated_at,o.created_at) desc' : 'o.created_at asc'}
      limit 250`,
    params,
  );
  return result.rows;
}

async function setTagged(orderId, itemId, tagged) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const result = await pool.query(
    `update commerce_order_items i
        set tagged_at = case when $3 then now() else null end
       from commerce_orders o
      where i.id = $1 and i.order_id = $2 and o.id = i.order_id
        and o.status = 'paid' and i.status = 'awaiting_fulfillment' and i.wall_id is not null
      returning i.id, i.wall_id, i.ordinal`,
    [itemId, orderId, tagged],
  );
  if (result.rowCount === 0) throw new Error('This Wall cannot be updated.');
  return result.rows[0];
}

async function replaceNfc(orderId, itemId) {
  if (!validUuid(orderId) || !validUuid(itemId)) throw new Error('Invalid order item.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select i.id, i.wall_id, i.ordinal, i.status, w.display_name, p.id as plaque_id, p.serial_code
         from commerce_order_items i
         join commerce_orders o on o.id = i.order_id
         join walls w on w.id = i.wall_id
         join plaques p on p.order_item_id = i.id
        where i.id = $1 and i.order_id = $2 and o.status = 'paid'
        for update of i, p`,
      [itemId, orderId],
    );
    if (result.rowCount === 0) throw new Error('Wall not found on this paid order.');
    const item = result.rows[0];
    if (item.status !== 'awaiting_fulfillment') throw new Error('A shipped Wall cannot have its NFC replaced here.');
    const rawNfc = makeToken(36);
    await client.query(`update wall_tags set active = false where wall_id = $1 and active = true`, [item.wall_id]);
    const tag = await client.query(
      `insert into wall_tags (wall_id, token_hash, active) values ($1, $2, true) returning id`,
      [item.wall_id, hashToken(rawNfc)],
    );
    await client.query(`update plaques set wall_tag_id = $2, assigned_at = now() where id = $1`, [item.plaque_id, tag.rows[0].id]);
    await client.query(
      `update commerce_order_items
          set nfc_write_value = $2, nfc_assigned_at = now(), tagged_at = null
        where id = $1`,
      [item.id, writeValue(rawNfc)],
    );
    await client.query('commit');
    return { ...item, nfcWriteValue: writeValue(rawNfc) };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

async function shipOrder(orderId) {
  if (!validUuid(orderId)) throw new Error('Invalid order ID.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select id, status from commerce_orders where id = $1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    if (orderResult.rows[0].status !== 'paid') throw new Error('Only paid orders can be shipped.');
    const items = await client.query(
      `select id, wall_id, tagged_at, status from commerce_order_items where order_id = $1 order by ordinal for update`,
      [orderId],
    );
    if (items.rowCount === 0) throw new Error('This order has no Wall items.');
    if (items.rows.some((item) => !item.wall_id)) throw new Error('Every Wall needs an NFC assignment before shipping.');
    if (items.rows.some((item) => !item.tagged_at)) throw new Error('Tick Tagged for every Wall before shipping the order.');
    if (items.rows.some((item) => item.status !== 'awaiting_fulfillment')) throw new Error('One or more Walls are not available to ship.');
    await client.query(
      `update commerce_order_items
          set status = 'fulfilled', shipped_at = now(), fulfilled_at = now()
        where order_id = $1 and status = 'awaiting_fulfillment'`,
      [orderId],
    );
    await client.query(
      `update commerce_orders
          set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
        where id = $1`,
      [orderId],
    );
    await client.query('commit');
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally { client.release(); }
}

function orderCard(order, csrf) {
  const items = Array.isArray(order.items) ? order.items : [];
  const tagged = Number(order.tagged_count || 0);
  const ready = items.length > 0 && items.every((item) => Boolean(item.wall_id) && Boolean(item.tagged_at));
  const shipping = addressLines(order.shipping_address);
  const itemRows = items.map((item) => {
    const value = clean(item.nfc_write_value);
    const valueHtml = value
      ? `<div class="ov3-tag"><code>${escapeHtml(value)}</code><button type="button" class="ov3-copy" data-copy="${escapeHtml(value)}">Copy</button></div>`
      : `<div class="ov3-missing">Legacy tag value not stored. Generate a replacement to continue.</div>`;
    return `<div class="ov3-item" data-item="${escapeHtml(item.id)}"><div class="ov3-wall"><b>Wall ${escapeHtml(item.ordinal)}</b><span>${escapeHtml(item.serial_code || 'NFC preparing')}</span></div><div>${valueHtml}</div><div class="ov3-item-actions">${!value ? `<form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/replace-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="ov3-small" type="submit">Generate NFC</button></form>` : `<form class="ov3-tag-form" method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/tagged"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="tagged" value="${item.tagged_at ? 'false' : 'true'}"><label class="ov3-check"><input type="checkbox" ${item.tagged_at ? 'checked' : ''}><span>Tagged</span></label><noscript><button class="ov3-small" type="submit">Save</button></noscript></form>`}${value ? `<form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/items/${encodeURIComponent(item.id)}/replace-nfc"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="ov3-link" type="submit">Replace</button></form>` : ''}</div></div>`;
  }).join('');
  return `<details class="ov3-order"><summary><div class="ov3-ref"><b>${escapeHtml(orderRef(order.id))}</b><span>${escapeHtml(order.purchaser_email)}</span></div><div class="ov3-summary-cell"><b>${escapeHtml(order.quantity)}</b><span>Walls</span></div><div class="ov3-summary-cell"><b>${tagged}/${escapeHtml(order.quantity)}</b><span>Tagged</span></div><div class="ov3-summary-cell ov3-total"><b>${escapeHtml(money(order.amount_total, order.currency))}</b><span>${escapeHtml(fmt(order.created_at))}</span></div><div class="ov3-chevron">›</div></summary><div class="ov3-body"><div class="ov3-order-meta"><div><span>Ship to</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Not captured'}</b></div><div><span>Order</span><b>${escapeHtml(orderRef(order.id))}</b></div></div><div class="ov3-items">${itemRows}</div><div class="ov3-ship"><div><b>${ready ? 'Ready to ship' : `${tagged} of ${order.quantity} tagged`}</b><span>${ready ? 'All NFC tags are confirmed. Ship the complete order together.' : 'Tick each Wall after you physically write its NFC tag.'}</span></div><form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/ship-order"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="ov3-ship-button" type="submit" ${ready ? '' : 'disabled'}>Mark order shipped</button></form></div></div></details>`;
}

function historyCard(order) {
  const shipping = addressLines(order.shipping_address);
  return `<details class="ov3-history"><summary><div><b>${escapeHtml(orderRef(order.id))}</b><span>${escapeHtml(order.purchaser_email)}</span></div><div><b>${escapeHtml(order.quantity)} Wall${Number(order.quantity) === 1 ? '' : 's'}</b><span>${escapeHtml(fmt(order.created_at))}</span></div><div><b>${escapeHtml(money(order.amount_total, order.currency))}</b><span>${escapeHtml(order.status)}</span></div><div class="ov3-chevron">›</div></summary><div class="ov3-history-body"><div><span>Shipping</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Not captured'}</b></div><div><span>Completed</span><b>${escapeHtml(fmt(order.fulfilled_at || order.updated_at))}</b></div></div></details>`;
}

function page({ admin, tab, orders, search, notice = '', error = '' }) {
  const history = tab === 'history';
  const body = orders.length
    ? orders.map((order) => history ? historyCard(order) : orderCard(order, admin.csrf)).join('')
    : `<div class="ov3-empty">${history ? 'No completed orders yet.' : 'No orders waiting for fulfilment.'}</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Orders · SaidHere Admin</title><style>
  *{box-sizing:border-box}.ov3-wrap{max-width:1160px;margin:auto}.ov3-toolbar{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:12px}.ov3-toolbar h2{margin:0;font-size:22px}.ov3-toolbar p{margin:4px 0 0;color:#6b7280;font-size:10px}.ov3-tabs{display:flex;gap:6px}.ov3-tabs a{padding:9px 12px;border:1px solid #dfe3e8;border-radius:8px;background:#fff;color:#5d6470;text-decoration:none;font-size:9px;font-weight:900}.ov3-tabs a.active{background:#17191d;color:#fff}.ov3-search{display:flex;gap:7px;margin:0 0 11px}.ov3-search input{flex:1;min-height:40px;padding:9px 10px;border:1px solid #d1d5db;border-radius:8px}.ov3-search button,.ov3-small,.ov3-ship-button{border:1px solid #17191d;border-radius:8px;background:#17191d;color:#fff;font-size:8px;text-transform:uppercase;font-weight:900;cursor:pointer}.ov3-search button{padding:8px 12px}.ov3-alert{padding:10px 12px;margin-bottom:10px;border:1px solid #e1e5e9;border-left:4px solid #356d48;border-radius:8px;background:#edf7ef;font-size:10px;font-weight:750}.ov3-alert.bad{border-left-color:#a13e35;background:#faecea}.ov3-list{border:1px solid #dfe3e8;border-radius:11px;background:#fff;overflow:hidden}.ov3-order,.ov3-history{border-bottom:1px solid #edf0f2}.ov3-order:last-child,.ov3-history:last-child{border-bottom:0}.ov3-order>summary,.ov3-history>summary{list-style:none;display:grid;align-items:center;gap:12px;min-height:62px;padding:10px 13px;cursor:pointer}.ov3-order>summary{grid-template-columns:minmax(220px,1.6fr) 70px 80px 120px 20px}.ov3-history>summary{grid-template-columns:minmax(220px,1.5fr) 140px 120px 20px}.ov3-order>summary::-webkit-details-marker,.ov3-history>summary::-webkit-details-marker{display:none}.ov3-order[open]>summary,.ov3-history[open]>summary{background:#f8fafb}.ov3-ref b,.ov3-history summary b,.ov3-summary-cell b{display:block;font-size:10px}.ov3-ref span,.ov3-history summary span,.ov3-summary-cell span{display:block;margin-top:3px;color:#6b7280;font-size:8px}.ov3-summary-cell{text-align:left}.ov3-total{text-align:right}.ov3-chevron{font-size:18px;color:#999;transition:.15s}.ov3-order[open] .ov3-chevron,.ov3-history[open] .ov3-chevron{transform:rotate(90deg)}.ov3-body{padding:12px 13px 13px;border-top:1px solid #edf0f2}.ov3-order-meta{display:grid;grid-template-columns:1fr 160px;gap:7px;margin-bottom:10px}.ov3-order-meta>div,.ov3-history-body>div{padding:9px;background:#f7f8fa;border-radius:7px}.ov3-order-meta span,.ov3-history-body span{display:block;color:#737982;font-size:7px;text-transform:uppercase;font-weight:900}.ov3-order-meta b,.ov3-history-body b{display:block;margin-top:4px;font-size:9px}.ov3-items{border:1px solid #e6e9ed;border-radius:9px;overflow:hidden}.ov3-item{display:grid;grid-template-columns:130px minmax(220px,1fr) 160px;gap:10px;align-items:center;min-height:58px;padding:9px 10px;border-bottom:1px solid #edf0f2}.ov3-item:last-child{border-bottom:0}.ov3-wall b{display:block;font-size:10px}.ov3-wall span{display:block;margin-top:3px;color:#7c828b;font-size:8px}.ov3-tag{display:flex;align-items:center;gap:6px;min-width:0}.ov3-tag code{flex:1;min-width:0;padding:7px 8px;border-radius:6px;background:#f2f4f6;color:#333;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ov3-copy,.ov3-link{border:0;background:transparent;color:#345f8c;font-size:8px;font-weight:900;cursor:pointer}.ov3-copy{padding:6px}.ov3-copy.copied{color:#356d48}.ov3-item-actions{display:flex;justify-content:flex-end;align-items:center;gap:7px}.ov3-item-actions form{margin:0}.ov3-check{display:flex;align-items:center;gap:6px;font-size:9px;font-weight:850;cursor:pointer}.ov3-check input{width:19px;height:19px;accent-color:#356d48}.ov3-small{padding:7px 9px}.ov3-link{padding:5px}.ov3-missing{color:#8b651b;font-size:8px}.ov3-ship{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:10px;padding:11px 12px;border-radius:8px;background:#f7f8fa}.ov3-ship b{display:block;font-size:10px}.ov3-ship span{display:block;margin-top:3px;color:#6b7280;font-size:8px}.ov3-ship form{margin:0}.ov3-ship-button{min-height:38px;padding:8px 12px;background:#356d48;border-color:#356d48}.ov3-ship-button:disabled{opacity:.35;cursor:not-allowed}.ov3-history-body{display:grid;grid-template-columns:1fr 140px;gap:7px;padding:12px 13px;border-top:1px solid #edf0f2}.ov3-empty{padding:28px;text-align:center;color:#6b7280;background:#fff}.ov3-toast{position:fixed;left:50%;bottom:24px;z-index:1000;transform:translateX(-50%);padding:9px 12px;border-radius:8px;background:#17191d;color:#fff;font-size:9px;font-weight:800;opacity:0;pointer-events:none;transition:.15s}.ov3-toast.show{opacity:1}
  @media(max-width:760px){.ov3-toolbar{align-items:flex-start;flex-direction:column}.ov3-tabs{width:100%}.ov3-tabs a{flex:1;text-align:center}.ov3-order>summary{grid-template-columns:minmax(0,1fr) 64px 20px}.ov3-order>summary>.ov3-summary-cell:nth-child(2),.ov3-order>summary>.ov3-total{display:none}.ov3-history>summary{grid-template-columns:minmax(0,1fr) 92px 20px}.ov3-history>summary>div:nth-child(2){display:none}.ov3-order-meta,.ov3-history-body{grid-template-columns:1fr}.ov3-item{grid-template-columns:1fr;gap:7px}.ov3-item-actions{justify-content:flex-start}.ov3-ship{align-items:stretch;flex-direction:column}.ov3-ship-button{width:100%}.ov3-search{flex-wrap:wrap}.ov3-search input{min-width:0}.ov3-tag code{font-size:7px}}
  </style><script src="/admin/orders-v3.js" defer></script></head><body><main class="shell"><header class="top"><div><h1>SaidHere</h1><small>Admin console</small></div><div>${escapeHtml(admin.display_name || admin.username)} · Main Admin <form method="post" action="/admin/logout" style="display:inline"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="link-action" type="submit">Logout</button></form></div></header><nav class="nav"><a href="/admin/walls">Walls</a><a class="active" href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Activity</a></nav><section class="ov3-wrap">${notice ? `<div class="ov3-alert">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="ov3-alert bad">${escapeHtml(error)}</div>` : ''}<div class="ov3-toolbar"><div><h2>${history ? 'Completed orders' : 'Orders to fulfil'}</h2><p>${history ? 'Shipped, cancelled and refunded orders.' : 'Expand an order, write each NFC tag, tick Tagged, then ship the order together.'}</p></div><div class="ov3-tabs"><a class="${history ? '' : 'active'}" href="/admin/orders">To fulfil</a><a class="${history ? 'active' : ''}" href="/admin/orders?tab=history">Completed</a></div></div><form class="ov3-search" method="get" action="/admin/orders"><input type="hidden" name="tab" value="${history ? 'history' : 'outstanding'}"><input name="q" value="${escapeHtml(search)}" placeholder="Search email or order"><button type="submit">Search</button></form><div class="ov3-list">${body}</div></section><div class="ov3-toast" id="ov3Toast">Copied NFC value</div></main></body></html>`;
}

async function renderOrders(req, res, { notice = '', error = '', forceTab = null } = {}) {
  const tab = forceTab || (clean(req.query?.tab) === 'history' ? 'history' : 'outstanding');
  const search = clean(req.query?.q);
  const orders = await listOrders(tab, search);
  return res.type('html').send(page({ admin: req.orderAdmin, tab, orders, search, notice, error }));
}

const clientScript = String.raw`(() => {
  const toast = document.getElementById('ov3Toast');
  const showToast = (text) => {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1200);
  };
  const copy = async (value) => {
    try { await navigator.clipboard.writeText(value); return true; }
    catch (_) {
      const input = document.createElement('textarea');
      input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.appendChild(input); input.select();
      const ok = document.execCommand('copy'); input.remove(); return ok;
    }
  };
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('.ov3-copy');
    if (!button) return;
    const ok = await copy(button.dataset.copy || '');
    if (ok) { button.classList.add('copied'); button.textContent = 'Copied'; showToast('Copied NFC value'); setTimeout(() => { button.classList.remove('copied'); button.textContent = 'Copy'; }, 1200); }
  });
  document.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.ov3-tag-form input[type="checkbox"]');
    if (!checkbox) return;
    const form = checkbox.closest('form');
    if (form) form.requestSubmit();
  });
})();`;

export function mountAdminOrdersV3(app) {
  app.get('/admin/orders-v3.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(clientScript);
  });
  app.get('/admin/fulfillment', requireOwner, (_req, res) => res.redirect(303, '/admin/orders'));
  app.get('/admin/orders', requireOwner, (req, res, next) => renderOrders(req, res).catch(next));

  app.post('/admin/orders/:orderId/items/:itemId/tagged', requireOwner, requireCsrf, async (req, res) => {
    try {
      const tagged = clean(req.body?.tagged) === 'true';
      const item = await setTagged(req.params.orderId, req.params.itemId, tagged);
      await writeAudit(req.orderAdmin, tagged ? 'order.wall_tagged' : 'order.wall_untagged', { wallId: item.wall_id, details: { order_id: req.params.orderId, item_id: item.id, ordinal: item.ordinal } });
      return res.redirect(303, '/admin/orders');
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not update tag status.' }); }
  });

  app.post('/admin/orders/:orderId/items/:itemId/replace-nfc', requireOwner, requireCsrf, async (req, res) => {
    try {
      const item = await replaceNfc(req.params.orderId, req.params.itemId);
      await writeAudit(req.orderAdmin, 'order.nfc_replaced_before_shipping', { wallId: item.wall_id, wallName: item.display_name, details: { order_id: req.params.orderId, item_id: item.id, ordinal: item.ordinal } });
      return renderOrders(req, res, { notice: `Wall ${item.ordinal} NFC regenerated. Copy the new value and write the tag.` });
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not replace NFC.' }); }
  });

  app.post('/admin/orders/:orderId/ship-order', requireOwner, requireCsrf, async (req, res) => {
    try {
      await shipOrder(req.params.orderId);
      await writeAudit(req.orderAdmin, 'order.shipped', { details: { order_id: req.params.orderId } });
      return renderOrders(req, res, { notice: 'Order marked shipped and moved to Completed.' });
    } catch (error) { return renderOrders(req, res, { error: error?.message || 'Could not ship order.' }); }
  });
}
