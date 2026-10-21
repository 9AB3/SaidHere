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
    return res.status(403).send('Request expired. Refresh the Orders page and try again.');
  }
  return next();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function money(amount, currency = 'aud') {
  if (!Number.isFinite(Number(amount))) return '—';
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: String(currency || 'aud').toUpperCase(),
    }).format(Number(amount) / 100);
  } catch (_) {
    return `$${(Number(amount) / 100).toFixed(2)}`;
  }
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

function statusLabel(status) {
  return ({
    pending: 'Pending checkout',
    paid: 'Paid · fulfilment due',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  })[status] || status;
}

function statusClass(status) {
  if (status === 'fulfilled') return 'good';
  if (status === 'paid') return 'warn';
  if (status === 'pending') return 'pending';
  return 'muted';
}

function emailBadge(order) {
  if (order.customer_confirmation_error) return `<span class="pill bad">Email failed</span>`;
  if (order.customer_confirmation_sent_at) return `<span class="pill good">Email sent</span>`;
  if (['paid', 'fulfilled'].includes(order.status)) return `<span class="pill warn">Email not sent</span>`;
  return `<span class="pill muted">Email waits for payment</span>`;
}

function matchesView(order, view) {
  if (view === 'all') return true;
  if (view === 'action') {
    return order.status === 'paid'
      || (['paid', 'fulfilled'].includes(order.status) && (!order.customer_confirmation_sent_at || order.customer_confirmation_error));
  }
  return order.status === view;
}

async function orderData() {
  const result = await pool.query(
    `select o.*,
            c.password_hash is not null as customer_active,
            count(i.id) filter (where i.status = 'fulfilled')::int as fulfilled_items,
            coalesce(jsonb_agg(
              jsonb_build_object(
                'ordinal', i.ordinal,
                'status', i.status,
                'wall_id', i.wall_id,
                'wall_name', w.display_name,
                'wall_slug', w.slug,
                'plaque_serial', p.serial_code
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

async function fulfilNextPlaque(orderId, { serialCode, displayName, locationHint }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const orderResult = await client.query(`select * from commerce_orders where id = $1 for update`, [orderId]);
    if (orderResult.rowCount === 0) throw new Error('Order not found.');
    const order = orderResult.rows[0];
    if (!['paid', 'fulfilled'].includes(order.status)) throw new Error('Only paid orders can be fulfilled.');
    const customerId = await ensureOrderCustomerLink(client, order);
    const itemResult = await client.query(
      `select * from commerce_order_items
        where order_id = $1 and status = 'awaiting_fulfillment'
        order by ordinal
        limit 1
        for update`,
      [order.id],
    );
    if (itemResult.rowCount === 0) throw new Error('Every plaque in this order is already fulfilled.');
    const item = itemResult.rows[0];
    const serial = clean(serialCode).toUpperCase() || `TW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const wallName = clean(displayName) || `My Wall ${item.ordinal}`;
    const location = clean(locationHint);
    if (wallName.length > 80) throw new Error('Wall name must be 80 characters or fewer.');
    if (location.length > 120) throw new Error('Location must be 120 characters or fewer.');

    const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
    const rawNfc = makeToken(36);
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint)
       values ($1, $2, $3)
       returning id, slug, display_name`,
      [slug, wallName, location],
    );
    const wall = wallResult.rows[0];
    const tagResult = await client.query(
      `insert into wall_tags (wall_id, token_hash, active)
       values ($1, $2, true)
       returning id`,
      [wall.id, hashToken(rawNfc)],
    );
    const plaqueResult = await client.query(
      `insert into plaques (serial_code, order_item_id, wall_id, wall_tag_id, status, assigned_at)
       values ($1, $2, $3, $4, 'assigned', now())
       returning id, serial_code`,
      [serial, item.id, wall.id, tagResult.rows[0].id],
    );
    const plaque = plaqueResult.rows[0];
    await client.query(
      `insert into wall_ownerships (customer_id, wall_id, order_id, plaque_id)
       values ($1, $2, $3, $4)`,
      [customerId, wall.id, order.id, plaque.id],
    );
    await client.query(
      `update commerce_order_items
          set status = 'fulfilled', wall_id = $2, fulfilled_at = now()
        where id = $1`,
      [item.id, wall.id],
    );
    const remaining = await client.query(
      `select count(*)::int as count
         from commerce_order_items
        where order_id = $1 and status = 'awaiting_fulfillment'`,
      [order.id],
    );
    if (remaining.rows[0].count === 0) {
      await client.query(
        `update commerce_orders
            set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
          where id = $1`,
        [order.id],
      );
    }
    await client.query('commit');
    const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');
    return { wall, plaque, nfcUrl: `${appBase}/t/${rawNfc}` };
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function orderCard(order, csrf) {
  const paid = ['paid', 'fulfilled'].includes(order.status);
  const remaining = Math.max(0, Number(order.quantity) - Number(order.fulfilled_items || 0));
  const shipping = addressLines(order.shipping_address);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemRows = items.map((item) => `
    <div class="item-row">
      <div><b>Plaque ${escapeHtml(item.ordinal)}</b><span>${escapeHtml(item.plaque_serial || 'Not assigned')}</span></div>
      <div>${item.wall_id ? `<a href="/admin/walls/${encodeURIComponent(item.wall_id)}">${escapeHtml(item.wall_name || 'Wall')}</a>` : '<span class="muted-text">Awaiting assignment</span>'}</div>
      <span class="pill ${item.status === 'fulfilled' ? 'good' : 'muted'}">${escapeHtml(item.status)}</span>
    </div>`).join('');

  const emailDetail = order.customer_confirmation_error
    ? `<div class="email-error">${escapeHtml(order.customer_confirmation_error)}</div>`
    : order.customer_confirmation_sent_at
      ? `<div class="email-ok">Last sent ${escapeHtml(formatDate(order.customer_confirmation_sent_at))}</div>`
      : paid ? '<div class="email-warn">No customer confirmation has been recorded.</div>' : '';

  const fulfilForm = order.status === 'paid' && remaining > 0 ? `
    <details class="action-drawer">
      <summary>Assign next plaque <span>›</span></summary>
      <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/fulfil" class="action-form">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <div class="mini-grid">
          <label>Plaque serial <input name="serial_code" placeholder="Auto generated if blank"></label>
          <label>Wall name <input name="display_name" value="My Wall" maxlength="80"></label>
          <label class="wide">Location <input name="location_hint" placeholder="Optional" maxlength="120"></label>
        </div>
        <button class="button good" type="submit">Assign & show NFC URL</button>
      </form>
    </details>` : '';

  const recoveryActions = paid ? `
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/email/customer">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button class="button secondary" type="submit">${order.customer_confirmation_sent_at ? 'Resend customer email' : 'Send customer email'}</button>
    </form>
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/email/owner">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button class="button secondary" type="submit">Resend admin notice</button>
    </form>
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/claim-link">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button class="link-action" type="submit">Generate recovery activation link</button>
    </form>` : '';

  const reconcile = order.status === 'pending' && order.stripe_checkout_session_id ? `
    <form method="post" action="/admin/orders/${encodeURIComponent(order.id)}/reconcile">
      <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
      <button class="button secondary" type="submit">Recheck payment with Stripe</button>
    </form>` : '';

  return `<article class="order-card ${escapeHtml(statusClass(order.status))}" data-order-status="${escapeHtml(order.status)}">
    <div class="order-head">
      <div class="order-title">
        <div class="order-kicker">Order ${escapeHtml(shortId(order.id))}</div>
        <h3>${escapeHtml(order.purchaser_email)}</h3>
        <div class="order-sub">${escapeHtml(formatDate(order.created_at))} · ${escapeHtml(order.quantity)} plaque${Number(order.quantity) === 1 ? '' : 's'} · ${escapeHtml(money(order.amount_total, order.currency))}</div>
      </div>
      <div class="order-badges"><span class="pill ${escapeHtml(statusClass(order.status))}">${escapeHtml(statusLabel(order.status))}</span>${emailBadge(order)}</div>
    </div>

    <div class="progress-wrap"><div class="progress"><span style="width:${Math.min(100, Number(order.fulfilled_items || 0) / Math.max(1, Number(order.quantity)) * 100)}%"></span></div><b>${escapeHtml(order.fulfilled_items || 0)}/${escapeHtml(order.quantity)} fulfilled</b></div>

    <div class="order-facts">
      <div><span>Payment</span><b>${escapeHtml(shortId(order.stripe_payment_intent_id))}</b></div>
      <div><span>Stripe session</span><b>${escapeHtml(shortId(order.stripe_checkout_session_id))}</b></div>
      <div><span>Customer account</span><b>${order.customer_active ? 'Active' : paid ? 'Activation pending' : 'Not created'}</b></div>
      <div><span>Shipping</span><b>${shipping.length ? escapeHtml(shipping.join(', ')) : 'Not captured'}</b></div>
    </div>

    ${emailDetail}
    ${fulfilForm}
    ${itemRows ? `<details class="detail-drawer"><summary>Plaques & Walls <span>${items.length}</span></summary><div class="item-list">${itemRows}</div></details>` : ''}
    <details class="detail-drawer"><summary>Order controls <span>›</span></summary><div class="action-row">${reconcile}${recoveryActions}</div></details>
    <details class="detail-drawer"><summary>Technical details <span>›</span></summary><div class="tech-grid"><div><span>Order ID</span><code>${escapeHtml(order.id)}</code></div><div><span>Checkout</span><code>${escapeHtml(order.stripe_checkout_session_id || '—')}</code></div><div><span>Payment intent</span><code>${escapeHtml(order.stripe_payment_intent_id || '—')}</code></div><div><span>Customer</span><code>${escapeHtml(order.stripe_customer_id || '—')}</code></div></div></details>
  </article>`;
}

function page({ admin, orders, view, search, notice = '', error = '', oneTime = null }) {
  const smtp = commerceEmailStatus();
  const totals = {
    action: orders.filter((o) => matchesView(o, 'action')).length,
    paid: orders.filter((o) => o.status === 'paid').length,
    fulfilled: orders.filter((o) => o.status === 'fulfilled').length,
    pending: orders.filter((o) => o.status === 'pending').length,
    email: orders.filter((o) => ['paid', 'fulfilled'].includes(o.status) && (!o.customer_confirmation_sent_at || o.customer_confirmation_error)).length,
  };
  let shown = orders.filter((order) => matchesView(order, view));
  const term = clean(search).toLowerCase();
  if (term) shown = shown.filter((order) => `${order.id} ${order.purchaser_email} ${order.stripe_checkout_session_id || ''} ${order.stripe_payment_intent_id || ''}`.toLowerCase().includes(term));

  const tabs = [
    ['action', 'Needs action', totals.action],
    ['paid', 'Paid', totals.paid],
    ['fulfilled', 'Fulfilled', totals.fulfilled],
    ['pending', 'Pending', totals.pending],
    ['cancelled', 'Cancelled', orders.filter((o) => o.status === 'cancelled').length],
    ['all', 'All', orders.length],
  ].map(([key, label, count]) => `<a class="tab ${view === key ? 'active' : ''}" href="/admin/orders?view=${key}">${escapeHtml(label)} <span>${count}</span></a>`).join('');

  const cards = shown.length ? shown.map((order) => orderCard(order, admin.csrf)).join('') : '<div class="empty"><b>No orders in this view.</b><span>Try another filter or clear the search.</span></div>';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Orders · The Wall Admin</title><style>
    *{box-sizing:border-box}body{margin:0;background:#eee8de;color:#181512;font-family:Inter,Arial,sans-serif}.shell{max-width:1180px;margin:auto;padding:18px 22px 60px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;background:#171512;color:#fff;border-radius:14px}.brand h1{margin:0;font-size:20px}.brand small{display:block;margin-top:4px;color:#beb5a9;text-transform:uppercase;letter-spacing:1.4px;font-size:9px}.account{display:flex;gap:10px;align-items:center;font-size:11px}.account a{color:#fff}.admin-nav{display:flex;gap:5px;overflow:auto;margin:10px 0 20px;padding:6px;border:1px solid #ddd4c5;border-radius:11px;background:#fbf8f1}.admin-nav a{white-space:nowrap;padding:9px 13px;border-radius:7px;color:#71695e;text-decoration:none;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.55px}.admin-nav a.active{background:#171512;color:#fff}.heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin:10px 0 15px}.heading h2{margin:0;font-size:34px;letter-spacing:-1px}.heading p{margin:6px 0 0;color:#746c61;font-size:13px}.smtp{display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid #d8cdbc;border-radius:9px;background:#fffaf1;font-size:10px;font-weight:800}.dot{width:8px;height:8px;border-radius:50%;background:#9b4137}.dot.ok{background:#52714d}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:15px}.stat{padding:14px;background:#fbf8f1;border:1px solid #ddd4c5;border-radius:11px}.stat b{display:block;font-size:25px}.stat span{display:block;margin-top:5px;color:#746c61;text-transform:uppercase;letter-spacing:.75px;font-size:8px;font-weight:900}.alert{padding:12px 14px;border-radius:9px;margin-bottom:12px;font-size:12px;font-weight:800}.alert.good{background:#e3eee0;border-left:4px solid #52714d}.alert.bad{background:#f2dfdb;border-left:4px solid #9b4137}.nfc-box{padding:14px;margin-bottom:14px;border:2px solid #171512;border-radius:11px;background:#fff}.nfc-box code{display:block;margin:8px 0;padding:10px;background:#f2ede4;border-radius:7px;word-break:break-all;font-size:11px}.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px}.search{flex:1;display:flex;gap:7px}.search input{width:100%;min-height:42px;padding:9px 12px;border:1px solid #c9bead;border-radius:8px;background:#fffdf8;font:inherit}.search button{min-height:42px}.tabs{display:flex;gap:5px;overflow:auto;padding-bottom:7px;margin-bottom:9px}.tab{display:flex;align-items:center;gap:6px;white-space:nowrap;padding:8px 10px;border:1px solid #d6ccbd;border-radius:999px;background:#fffaf1;color:#6d655b;text-decoration:none;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.45px}.tab span{display:grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:#ece5da}.tab.active{background:#171512;color:#fff;border-color:#171512}.tab.active span{background:#39342f}.order-list{display:flex;flex-direction:column;gap:9px}.order-card{position:relative;padding:16px 17px;background:#fffdf9;border:1px solid #ddd4c5;border-radius:12px;box-shadow:0 5px 20px rgba(34,28,23,.04)}.order-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:12px 0 0 12px;background:#8d857a}.order-card.good::before{background:#52714d}.order-card.warn::before{background:#b98222}.order-card.pending::before{background:#8d857a}.order-head{display:flex;justify-content:space-between;gap:18px}.order-title{min-width:0}.order-kicker{font-size:8px;text-transform:uppercase;letter-spacing:1px;color:#81786d;font-weight:950}.order-title h3{margin:5px 0 3px;font-size:16px;overflow-wrap:anywhere}.order-sub{font-size:10px;color:#746c61}.order-badges{display:flex;align-items:flex-start;justify-content:flex-end;gap:5px;flex-wrap:wrap}.pill{display:inline-flex;align-items:center;padding:5px 7px;border-radius:999px;background:#eee8de;color:#645d55;font-size:7px;text-transform:uppercase;letter-spacing:.6px;font-weight:950}.pill.good{background:#dfead9;color:#355230}.pill.warn{background:#f2e4b9;color:#76550e}.pill.bad{background:#f1d9d5;color:#873a33}.pill.pending,.pill.muted{background:#eee8de;color:#6e675f}.progress-wrap{display:flex;align-items:center;gap:9px;margin:13px 0 11px}.progress{height:5px;flex:1;background:#ebe4da;border-radius:99px;overflow:hidden}.progress span{display:block;height:100%;background:#171512}.progress-wrap b{font-size:9px;color:#6f675d}.order-facts{display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:7px;margin-bottom:10px}.order-facts>div{min-width:0;padding:8px 9px;background:#f5f0e8;border-radius:8px}.order-facts span,.tech-grid span{display:block;margin-bottom:4px;color:#81786d;font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}.order-facts b{display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.email-error,.email-warn,.email-ok{margin:9px 0;padding:9px 10px;border-radius:8px;font-size:10px;font-weight:750}.email-error{background:#f2dfdb;color:#7c342f}.email-warn{background:#f5e7bf;color:#76530d}.email-ok{background:#e5efe1;color:#3e5c39}.action-drawer,.detail-drawer{border-top:1px solid #ebe3d7;margin-top:9px}.action-drawer summary,.detail-drawer summary{display:flex;align-items:center;justify-content:space-between;min-height:40px;list-style:none;cursor:pointer;font-size:9px;text-transform:uppercase;letter-spacing:.65px;font-weight:950;color:#645d55}.action-drawer summary::-webkit-details-marker,.detail-drawer summary::-webkit-details-marker{display:none}.action-form{padding:7px 0 12px}.mini-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.mini-grid label{display:flex;flex-direction:column;gap:5px;font-size:8px;text-transform:uppercase;letter-spacing:.5px;font-weight:900;color:#6c645b}.mini-grid label.wide{grid-column:1/-1}.mini-grid input{min-height:40px;padding:8px 10px;border:1px solid #c9bead;border-radius:7px;background:#fff}.button{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:8px 11px;border:1px solid #171512;border-radius:7px;background:#171512;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.55px;font-weight:950;cursor:pointer}.button.secondary{background:#fffdf8;color:#171512;border-color:#c8bdad}.button.good{background:#52714d;border-color:#52714d}.action-row{display:flex;gap:6px;flex-wrap:wrap;padding:5px 0 10px}.action-row form{margin:0}.link-action{min-height:38px;padding:8px;border:0;background:transparent;color:#665e55;text-decoration:underline;font-size:9px;font-weight:800;cursor:pointer}.item-list{padding:3px 0 8px}.item-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eee7dc;font-size:10px}.item-row:last-child{border-bottom:0}.item-row b,.item-row span{display:block}.item-row>div>span{margin-top:2px;color:#81786d;font-size:9px}.item-row a{color:#171512;font-weight:800}.muted-text{color:#81786d}.tech-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:4px 0 10px}.tech-grid>div{min-width:0;padding:8px;background:#f4efe7;border-radius:7px}.tech-grid code{display:block;overflow-wrap:anywhere;font-size:9px}.empty{display:flex;flex-direction:column;gap:5px;padding:34px;text-align:center;background:#fffaf1;border:1px dashed #cfc4b4;border-radius:12px;color:#6f675d}.empty b{color:#171512}.notice-count{color:#9b4137}
    @media(max-width:760px){.shell{padding:12px 12px 48px}.topbar{border-radius:12px}.account span{display:none}.heading{align-items:flex-start;flex-direction:column}.heading h2{font-size:30px}.smtp{width:100%}.stats{grid-template-columns:repeat(2,1fr)}.stat{padding:11px}.stat b{font-size:22px}.toolbar{align-items:stretch;flex-direction:column}.search button{flex:0 0 auto}.order-card{padding:14px 13px}.order-head{display:block}.order-badges{justify-content:flex-start;margin-top:8px}.order-facts{grid-template-columns:1fr 1fr}.order-facts>div:last-child{grid-column:1/-1}.mini-grid{grid-template-columns:1fr}.mini-grid label.wide{grid-column:auto}.item-row{grid-template-columns:1fr auto}.item-row>div:nth-child(2){grid-column:1/-1}.tech-grid{grid-template-columns:1fr}.action-row{flex-direction:column}.action-row form,.action-row .button{width:100%}.admin-nav{margin-bottom:16px}}
  </style></head><body><main class="shell"><header class="topbar"><div class="brand"><h1>The Wall</h1><small>Admin console</small></div><div class="account"><span>${escapeHtml(admin.display_name || admin.username)} · Main Admin</span><form method="post" action="/admin/logout" style="margin:0"><input type="hidden" name="_csrf" value="${escapeHtml(admin.csrf)}"><button class="link-action" style="color:#fff;text-decoration:none" type="submit">Logout</button></form></div></header><nav class="admin-nav"><a href="/admin/walls">Walls</a><a class="active" href="/admin/orders">Orders</a><a href="/admin/users">Users</a><a href="/admin/audit">Audit</a></nav>
    <section class="heading"><div><h2>Orders</h2><p>Payments, customer email, plaque fulfilment and ownership in one place.</p></div><div class="smtp"><span class="dot ${smtp.configured ? 'ok' : ''}"></span>${smtp.configured ? `SMTP ready · ${escapeHtml(smtp.host)}` : '<span class="notice-count">SMTP credentials missing</span>'}</div></section>
    ${notice ? `<div class="alert good">${escapeHtml(notice)}</div>` : ''}${error ? `<div class="alert bad">${escapeHtml(error)}</div>` : ''}
    ${oneTime?.nfcUrl ? `<section class="nfc-box"><b>Plaque ${escapeHtml(oneTime.plaque.serial_code)} assigned.</b><p>Program this exact URL into the physical NFC tag now. The raw token is intentionally shown once.</p><code>${escapeHtml(oneTime.nfcUrl)}</code></section>` : ''}
    ${oneTime?.claimUrl ? `<section class="nfc-box"><b>Recovery activation link generated.</b><p>Use this only if the customer did not receive their email. Generating another link invalidates the previous unused claim link.</p><code>${escapeHtml(oneTime.claimUrl)}</code></section>` : ''}
    <section class="stats"><div class="stat"><b>${totals.action}</b><span>Needs action</span></div><div class="stat"><b>${totals.paid}</b><span>Awaiting fulfilment</span></div><div class="stat"><b class="${totals.email ? 'notice-count' : ''}">${totals.email}</b><span>Email attention</span></div><div class="stat"><b>${totals.fulfilled}</b><span>Fulfilled</span></div></section>
    <div class="toolbar"><form class="search" method="get" action="/admin/orders"><input type="hidden" name="view" value="${escapeHtml(view)}"><input name="q" value="${escapeHtml(search)}" placeholder="Search email, order or Stripe ID"><button class="button secondary" type="submit">Search</button></form></div>
    <nav class="tabs">${tabs}</nav><section class="order-list">${cards}</section>
  </main></body></html>`;
}

async function renderOrders(req, res, { notice = '', error = '', oneTime = null } = {}) {
  const orders = await orderData();
  const validViews = new Set(['action', 'paid', 'fulfilled', 'pending', 'cancelled', 'refunded', 'all']);
  const requested = clean(req.query?.view);
  const view = validViews.has(requested) ? requested : 'action';
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

export function mountAdminOrders(app) {
  app.get('/admin/fulfillment', requireOwner, (_req, res) => res.redirect(303, '/admin/orders'));
  app.get('/admin/orders', requireOwner, (req, res, next) => renderOrders(req, res).catch(next));

  app.post('/admin/orders/:orderId/reconcile', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await pool.query(`select stripe_checkout_session_id from commerce_orders where id = $1 limit 1`, [req.params.orderId]);
      const sessionId = result.rows[0]?.stripe_checkout_session_id;
      if (!sessionId) throw new Error('This order does not have a Stripe Checkout Session to check.');
      await reconcileCheckoutSessionById(sessionId);
      return renderOrders(req, res, { notice: 'Stripe payment status rechecked. Order and email status are now up to date.' });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not recheck payment.' });
    }
  });

  app.post('/admin/orders/:orderId/email/customer', requireOwner, requireCsrf, async (req, res) => {
    try {
      await resendCustomerConfirmation(req.params.orderId);
      return renderOrders(req, res, { notice: 'Customer order confirmation sent successfully.' });
    } catch (error) {
      return renderOrders(req, res, { error: `Customer email failed: ${error?.message || error}` });
    }
  });

  app.post('/admin/orders/:orderId/email/owner', requireOwner, requireCsrf, async (req, res) => {
    try {
      await resendOwnerNotification(req.params.orderId);
      return renderOrders(req, res, { notice: 'Admin order notification sent successfully.' });
    } catch (error) {
      return renderOrders(req, res, { error: `Admin email failed: ${error?.message || error}` });
    }
  });

  app.post('/admin/orders/:orderId/claim-link', requireOwner, requireCsrf, async (req, res) => {
    try {
      const claimUrl = await manualClaimLinkForOrder(req.params.orderId);
      return renderOrders(req, res, { oneTime: { claimUrl } });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not create recovery activation link.' });
    }
  });

  app.post('/admin/orders/:orderId/fulfil', requireOwner, requireCsrf, async (req, res) => {
    try {
      const result = await fulfilNextPlaque(req.params.orderId, {
        serialCode: req.body?.serial_code,
        displayName: req.body?.display_name,
        locationHint: req.body?.location_hint,
      });
      return renderOrders(req, res, { notice: 'Plaque assigned to the customer account.', oneTime: result });
    } catch (error) {
      return renderOrders(req, res, { error: error?.message || 'Could not assign plaque.' });
    }
  });
}
