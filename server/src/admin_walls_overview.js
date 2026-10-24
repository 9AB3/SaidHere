import { hashToken } from './auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';

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

async function requireAdmin(req, res, next) {
  try {
    const raw = parseCookies(req)[ADMIN_COOKIE] || '';
    if (!raw) return res.sendStatus(401);
    const result = await pool.query(
      `select u.id, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1
          and s.expires_at > now()
          and u.active = true
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.sendStatus(401);
    req.wallsOverviewAdmin = result.rows[0];
    req.wallsOverviewCsrf = hashToken(`admin-csrf:${raw}`);
    return next();
  } catch (error) { return next(error); }
}

function orderRef(value) {
  const compact = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return compact ? `TW-${compact.slice(0, 10)}` : '';
}

async function summaryFor(admin) {
  let wallSql = `select count(*)::int as total_walls,
                        count(*) filter (where active = true)::int as active_walls
                   from walls`;
  let wallParams = [];
  if (admin.role !== 'owner') {
    wallSql = `select count(*)::int as total_walls,
                      count(*) filter (where w.active = true)::int as active_walls
                 from walls w
                 join admin_wall_assignments a on a.wall_id = w.id
                where a.admin_user_id = $1`;
    wallParams = [admin.id];
  }

  const [walls, sales] = await Promise.all([
    pool.query(wallSql, wallParams),
    admin.role === 'owner'
      ? pool.query(
          `select coalesce(sum(amount_total), 0)::bigint as sold_cents
             from commerce_orders
            where status in ('paid', 'fulfilled')
              and amount_total is not null`,
        )
      : Promise.resolve({ rows: [{ sold_cents: null }] }),
  ]);

  return {
    total_walls: walls.rows[0]?.total_walls ?? 0,
    active_walls: walls.rows[0]?.active_walls ?? 0,
    sold_cents: sales.rows[0]?.sold_cents == null ? null : Number(sales.rows[0].sold_cents),
    currency: 'AUD',
  };
}

async function orderLinksFor(admin) {
  const params = [];
  let accessJoin = '';
  if (admin.role !== 'owner') {
    params.push(admin.id);
    accessJoin = `join admin_wall_assignments awa
                    on awa.wall_id = w.id
                   and awa.admin_user_id = $1`;
  }

  const result = await pool.query(
    `select w.id as wall_id,
            p.serial_code,
            o.id as order_id,
            o.quantity as order_quantity,
            o.purchaser_email,
            item.ordinal as order_item_ordinal
       from walls w
       ${accessJoin}
       left join wall_ownerships wo
         on wo.wall_id = w.id
        and wo.ended_at is null
       left join commerce_orders o on o.id = wo.order_id
       left join lateral (
         select i.id, i.ordinal
           from commerce_order_items i
          where i.order_id = o.id
            and (i.wall_id = w.id or i.reserved_wall_id = w.id)
          order by case when i.wall_id = w.id then 0 else 1 end, i.ordinal
          limit 1
       ) item on true
       left join lateral (
         select pp.serial_code
           from plaques pp
          where pp.wall_id = w.id
             or (item.id is not null and pp.order_item_id = item.id)
          order by case when pp.wall_id = w.id then 0 else 1 end, pp.assigned_at desc nulls last
          limit 1
       ) p on true
      order by w.created_at desc`,
    params,
  );

  return result.rows.map((row) => ({
    wall_id: row.wall_id,
    serial_code: row.serial_code || null,
    order_id: row.order_id || null,
    order_ref: row.order_id ? orderRef(row.order_id) : null,
    order_quantity: row.order_quantity == null ? null : Number(row.order_quantity),
    order_item_ordinal: row.order_item_ordinal == null ? null : Number(row.order_item_ordinal),
    purchaser_email: row.purchaser_email || null,
    can_open_order: admin.role === 'owner',
  }));
}

const clientScript = String.raw`(() => {
  'use strict';
  if (!location.pathname.startsWith('/admin/walls')) return;

  // The shared admin shell identifies Main Admin from a span inside the account
  // block. The new Walls monitor originally rendered plain text here, which made
  // admin_ui.js rebuild a moderator-style sidebar. Normalize it before admin_ui.js
  // runs so Walls uses exactly the same navigation as Orders and the other pages.
  const top = document.querySelector('.shell > .top');
  const identity = top?.lastElementChild;
  if (identity && !identity.querySelector('span')) {
    const value = (identity.textContent || '').trim();
    identity.textContent = '';
    const span = document.createElement('span');
    span.textContent = value;
    identity.append(span);
  }

  function money(cents, currency) {
    if (cents == null) return '—';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency', currency: currency || 'AUD', minimumFractionDigits: 2,
    }).format(Number(cents || 0) / 100);
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function ensureLogout(csrf) {
    const profile = document.querySelector('.admin-profile');
    if (!profile || profile.querySelector('form[action="/admin/logout"]') || !csrf) return;
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/admin/logout';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = '_csrf';
    input.value = csrf;
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = 'Log out';
    form.append(input, button);
    profile.append(form);
  }

  function ensureLinkStyles() {
    if (document.getElementById('wm-order-link-style')) return;
    const style = document.createElement('style');
    style.id = 'wm-order-link-style';
    style.textContent = '.wm-name .wm-idline{display:block;margin-top:4px;color:#7b828c;font-size:7px;font-weight:800;letter-spacing:.25px}.wm-order-detail{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 0}.wm-order-detail>div{padding:10px;border:1px solid #e6e9ed;border-radius:8px;background:#fafbfc;min-width:0}.wm-order-detail span{display:block;color:#7b828c;font-size:7px;text-transform:uppercase;letter-spacing:.55px;font-weight:900}.wm-order-detail b,.wm-order-detail a{display:block;margin-top:4px;color:#20242a;font-size:10px;font-weight:850;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wm-order-detail a:hover{text-decoration:underline}@media(max-width:620px){.wm-order-detail{grid-template-columns:1fr}.wm-name .wm-idline{white-space:normal}}';
    document.head.append(style);
  }

  function wallIdFromHref(href) {
    const match = String(href || '').match(/\/admin\/walls\/([0-9a-f-]{36})(?:$|[?#])/i);
    return match ? match[1].toLowerCase() : '';
  }

  function addListLinks(byWall) {
    document.querySelectorAll('.wm-row[href]').forEach((row) => {
      const wallId = wallIdFromHref(row.getAttribute('href'));
      const meta = byWall.get(wallId);
      if (!meta) return;
      const name = row.querySelector('.wm-name');
      if (!name || name.querySelector('.wm-idline')) return;
      const bits = [];
      if (meta.serial_code) bits.push('Wall ID ' + meta.serial_code);
      if (meta.order_ref) bits.push('Order ' + meta.order_ref);
      if (bits.length) {
        const line = document.createElement('span');
        line.className = 'wm-idline';
        line.textContent = bits.join(' · ');
        name.append(line);
      }
      const existing = row.dataset.search || '';
      row.dataset.search = [existing, meta.serial_code, meta.order_ref, meta.purchaser_email]
        .filter(Boolean).join(' ').toLowerCase();
    });
  }

  function addDetailLink(byWall) {
    const match = location.pathname.match(/^\/admin\/walls\/([0-9a-f-]{36})\/?$/i);
    if (!match) return;
    const meta = byWall.get(match[1].toLowerCase());
    if (!meta) return;
    const card = document.querySelector('.wm-card');
    const title = card?.querySelector('.wm-title');
    if (!card || !title || card.querySelector('.wm-order-detail')) return;

    const itemText = meta.order_item_ordinal && meta.order_quantity
      ? meta.order_item_ordinal + ' of ' + meta.order_quantity
      : '—';
    const orderValue = meta.order_ref || 'No purchase order';
    const orderHtml = meta.order_id && meta.can_open_order
      ? '<a href="/admin/orders?q=' + encodeURIComponent(meta.order_id) + '">' + esc(orderValue) + '</a>'
      : '<b>' + esc(orderValue) + '</b>';
    const detail = document.createElement('div');
    detail.className = 'wm-order-detail';
    detail.innerHTML = '<div><span>Wall ID</span><b>' + esc(meta.serial_code || '—') + '</b></div>' +
      '<div><span>Purchase order</span>' + orderHtml + '</div>' +
      '<div><span>Wall in order</span><b>' + esc(itemText) + '</b></div>';
    title.insertAdjacentElement('afterend', detail);
  }

  async function addOrderLinks() {
    if (!document.querySelector('.wm')) return;
    try {
      const response = await fetch('/admin/walls/order-links', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      const byWall = new Map((data.links || []).map((row) => [String(row.wall_id || '').toLowerCase(), row]));
      ensureLinkStyles();
      addListLinks(byWall);
      addDetailLink(byWall);
    } catch (_) {}
  }

  async function addOverview() {
    if (!document.querySelector('.wm')) return;
    try {
      const response = await fetch('/admin/walls/overview-data', { credentials: 'same-origin' });
      if (!response.ok) return;
      const data = await response.json();
      ensureLogout(data.csrf);
      if (document.querySelector('.wm-overview-kpis')) return;
      const host = document.querySelector('.admin-content .wm') || document.querySelector('.wm');
      if (!host) return;
      const row = document.createElement('div');
      row.className = 'wm-overview-kpis';
      row.innerHTML = [
        ['Total Walls', String(data.total_walls ?? 0)],
        ['Active Walls', String(data.active_walls ?? 0)],
        ['$ Sold', money(data.sold_cents, data.currency)],
      ].map(([label, value]) => '<div class="wm-overview-kpi"><b>'+value+'</b><span>'+label+'</span></div>').join('');
      host.prepend(row);

      if (!document.getElementById('wm-overview-style')) {
        const style = document.createElement('style');
        style.id = 'wm-overview-style';
        style.textContent = '.wm-overview-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 13px}.wm-overview-kpi{padding:13px 14px;background:#fff;border:1px solid #e2e5e9;border-radius:10px}.wm-overview-kpi b{display:block;font-size:21px;line-height:1.1;color:#17191d}.wm-overview-kpi span{display:block;margin-top:5px;color:#6b7280;font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}@media(max-width:520px){.wm-overview-kpi{padding:11px 9px}.wm-overview-kpi b{font-size:17px}.wm-overview-kpi span{font-size:6px}}';
        document.head.append(style);
      }
    } catch (_) {}
  }

  function boot() {
    addOverview();
    addOrderLinks();
  }

  window.addEventListener('DOMContentLoaded', boot, { once: true });
  requestAnimationFrame(() => setTimeout(boot, 0));
  setTimeout(boot, 120);
})();`;

export function mountAdminWallsOverview(app) {
  app.get('/admin/walls-overview.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(clientScript);
  });

  app.get('/admin/walls/overview-data', requireAdmin, async (req, res, next) => {
    try {
      return res.json({
        ...(await summaryFor(req.wallsOverviewAdmin)),
        csrf: req.wallsOverviewCsrf,
      });
    } catch (error) { return next(error); }
  });

  app.get('/admin/walls/order-links', requireAdmin, async (req, res, next) => {
    try {
      return res.json({ links: await orderLinksFor(req.wallsOverviewAdmin) });
    } catch (error) { return next(error); }
  });
}
