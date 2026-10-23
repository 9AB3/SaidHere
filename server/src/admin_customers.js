import { hashToken } from './auth.js';
import { pool } from './db.js';

const ADMIN_COOKIE = 'the_wall_admin';

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
      `select u.id, u.username, u.display_name, u.role
         from admin_sessions s
         join admin_users u on u.id = s.admin_user_id
        where s.token_hash = $1
          and s.expires_at > now()
          and u.active = true
        limit 1`,
      [hashToken(raw)],
    );
    if (result.rowCount === 0) return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (result.rows[0].role !== 'owner') return res.sendStatus(403);
    req.customerAdmin = result.rows[0];
    req.customerAdminCsrf = hashToken(`admin-csrf:${raw}`);
    return next();
  } catch (error) { return next(error); }
}

function fmt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function addressLines(address) {
  const value = address && typeof address === 'object' ? address : {};
  return [
    value.line1,
    value.line2,
    [value.city, value.state, value.postal_code].filter(Boolean).join(' '),
    value.country,
  ].filter(Boolean);
}

function customerName(row) {
  return String(row.display_name || row.customer_name || '').trim() || row.email;
}

async function listCustomers() {
  const result = await pool.query(`
    select c.id,
           c.email,
           c.display_name,
           c.password_hash is not null as login_active,
           c.created_at,
           c.last_login_at,
           coalesce((
             select count(*)::int
               from wall_ownerships wo
              where wo.customer_id = c.id and wo.ended_at is null
           ), 0) as wall_count,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', w.id,
                      'name', w.display_name,
                      'active', w.active
                    ) order by wo.started_at desc)
               from wall_ownerships wo
               join walls w on w.id = wo.wall_id
              where wo.customer_id = c.id and wo.ended_at is null
           ), '[]'::jsonb) as walls,
           coalesce((
             select count(*)::int
               from commerce_orders o
              where o.customer_id = c.id and o.status in ('paid', 'fulfilled')
           ), 0) as order_count,
           latest.customer_name,
           latest.shipping_address,
           latest.created_at as latest_order_at
      from customer_accounts c
      left join lateral (
        select o.customer_name, o.shipping_address, o.created_at
          from commerce_orders o
         where o.customer_id = c.id
           and o.status in ('paid', 'fulfilled')
         order by coalesce(o.paid_at, o.created_at) desc
         limit 1
      ) latest on true
     order by lower(coalesce(nullif(c.display_name, ''), nullif(latest.customer_name, ''), c.email)), c.created_at
  `);
  return result.rows;
}

const clientScript = String.raw`(() => {
  'use strict';
  if (location.pathname !== '/admin/users') return;

  function apply() {
    const heading = document.querySelector('.admin-head h1');
    const subtitle = document.querySelector('.admin-head p');
    if (heading) heading.textContent = 'Users';
    if (subtitle) subtitle.textContent = 'Customers, Wall ownership and contact details';

    const input = document.querySelector('#customerSearch');
    if (input && !input.dataset.bound) {
      input.dataset.bound = '1';
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        document.querySelectorAll('.cu-row[data-search]').forEach((row) => {
          row.hidden = q && !row.dataset.search.includes(q);
        });
      });
    }
  }

  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 80);
  setTimeout(apply, 250);
})();`;

function page(admin, csrf, customers) {
  const owners = customers.filter((customer) => Number(customer.wall_count || 0) > 0).length;
  const totalWalls = customers.reduce((sum, customer) => sum + Number(customer.wall_count || 0), 0);
  const activated = customers.filter((customer) => customer.login_active).length;

  const rows = customers.map((customer) => {
    const name = customerName(customer);
    const address = addressLines(customer.shipping_address);
    const contact = address.length ? address.join(', ') : 'No delivery address recorded';
    const walls = Array.isArray(customer.walls) ? customer.walls : [];
    const wallList = walls.length
      ? walls.map((wall) => `<span class="cu-wall"><b>${escapeHtml(wall.name)}</b><small>${wall.active ? 'Active' : 'Inactive'}</small></span>`).join('')
      : '<span class="cu-muted">No Walls currently owned.</span>';
    const search = [name, customer.email, contact, ...walls.map((wall) => wall.name)].join(' ').toLowerCase();

    return `<details class="cu-row" data-search="${escapeHtml(search)}">
      <summary>
        <div class="cu-person"><b>${escapeHtml(name)}</b><span>${escapeHtml(customer.email)}</span></div>
        <div class="cu-number"><b>${Number(customer.wall_count || 0)}</b><span>Walls</span></div>
        <div class="cu-contact">${escapeHtml(contact)}</div>
        <div class="cu-chevron">›</div>
      </summary>
      <div class="cu-detail">
        <div class="cu-grid">
          <div><span>Email</span><b>${escapeHtml(customer.email)}</b></div>
          <div><span>My Walls login</span><b>${customer.login_active ? 'Activated' : 'Not activated yet'}</b></div>
          <div><span>Orders</span><b>${Number(customer.order_count || 0)}</b></div>
          <div><span>Customer since</span><b>${escapeHtml(fmt(customer.created_at))}</b></div>
          <div><span>Last login</span><b>${escapeHtml(fmt(customer.last_login_at))}</b></div>
          <div><span>Latest order</span><b>${escapeHtml(fmt(customer.latest_order_at))}</b></div>
        </div>
        <div class="cu-section"><span>Latest delivery address</span><p>${address.length ? address.map(escapeHtml).join('<br>') : 'No delivery address recorded.'}</p></div>
        <div class="cu-section"><span>Walls</span><div class="cu-walls">${wallList}</div></div>
        <p class="cu-note">Customer accounts are read-only in Admin. Customers manage their own login and Wall settings through My Walls.</p>
      </div>
    </details>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Users · SaidHere Admin</title><style>
    .cu{max-width:1080px;margin:auto}.cu-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:13px}.cu-kpi{padding:13px 14px;background:#fff;border:1px solid #e2e5e9;border-radius:10px}.cu-kpi b{display:block;font-size:21px}.cu-kpi span{display:block;margin-top:4px;color:#6b7280;font-size:7px;text-transform:uppercase;letter-spacing:.65px;font-weight:900}.cu-search{width:100%;min-height:42px;margin:0 0 10px;padding:10px 12px;border:1px solid #d1d5db;border-radius:9px;background:#fff;font-size:11px}.cu-list{border:1px solid #e2e5e9;border-radius:11px;background:#fff;overflow:hidden}.cu-row{border-bottom:1px solid #eef0f2}.cu-row:last-child{border-bottom:0}.cu-row>summary{display:grid;grid-template-columns:minmax(220px,1.5fr) 70px minmax(240px,1.4fr) 22px;gap:12px;align-items:center;min-height:66px;padding:10px 13px;cursor:pointer;list-style:none}.cu-row>summary::-webkit-details-marker{display:none}.cu-row>summary:hover{background:#fbfcfd}.cu-person b{display:block;font-size:11px}.cu-person span{display:block;margin-top:3px;color:#6b7280;font-size:8px}.cu-number b{display:block;font-size:15px}.cu-number span{display:block;margin-top:2px;color:#8a9099;font-size:7px;text-transform:uppercase;font-weight:900}.cu-contact{color:#5f6670;font-size:8px;line-height:1.35}.cu-chevron{font-size:19px;color:#9aa0a8;transition:.18s}.cu-row[open] .cu-chevron{transform:rotate(90deg)}.cu-detail{padding:13px;border-top:1px solid #eef0f2;background:#fafbfc}.cu-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.cu-grid>div{padding:9px;background:#fff;border:1px solid #eaedf0;border-radius:8px}.cu-grid span,.cu-section>span{display:block;color:#7b818a;font-size:7px;text-transform:uppercase;letter-spacing:.55px;font-weight:900}.cu-grid b{display:block;margin-top:4px;font-size:9px}.cu-section{margin-top:10px;padding:11px;background:#fff;border:1px solid #eaedf0;border-radius:8px}.cu-section p{margin:6px 0 0;font-size:9px;line-height:1.45}.cu-walls{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.cu-wall{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;background:#f2f4f6}.cu-wall b{font-size:8px}.cu-wall small{color:#727983;font-size:7px}.cu-muted{color:#7b818a;font-size:8px}.cu-note{margin:10px 0 0;color:#7b818a;font-size:8px}.cu-empty{padding:28px;text-align:center;color:#6b7280;font-size:10px}@media(max-width:720px){.cu-kpis{grid-template-columns:repeat(2,1fr)}.cu-row{margin-bottom:8px;border:1px solid #e2e5e9;border-radius:10px;overflow:hidden}.cu-list{border:0;background:transparent;overflow:visible}.cu-row>summary{grid-template-columns:minmax(0,1fr) 54px 18px;gap:8px}.cu-contact{grid-column:1/-1;padding-top:7px;border-top:1px solid #eef0f2}.cu-chevron{grid-column:3;grid-row:1}.cu-number{grid-column:2;grid-row:1}.cu-grid{grid-template-columns:repeat(2,1fr)}}
  </style><script src="/admin/customer-directory.js" defer></script></head><body><main class="shell"><div class="topbar"><div class="brand"><div class="mark">TW</div><div><h1>The Wall Admin</h1><small>Customer directory</small></div></div><div class="account"><span>${escapeHtml(admin.display_name || admin.username)} · Main Admin</span><form method="post" action="/admin/logout"><input type="hidden" name="_csrf" value="${escapeHtml(csrf)}"><button class="link-button" type="submit">Log out</button></form></div></div><nav class="nav"><a href="/admin/walls">Walls</a><a href="/admin/orders">Orders</a><a href="/admin/reports">Moderation</a><a class="active" href="/admin/users">Users</a><a href="/admin/audit">Activity</a><a href="/admin/account/password">Account</a></nav><section class="cu"><div class="cu-kpis"><div class="cu-kpi"><b>${customers.length}</b><span>Customers</span></div><div class="cu-kpi"><b>${owners}</b><span>Wall owners</span></div><div class="cu-kpi"><b>${totalWalls}</b><span>Walls owned</span></div><div class="cu-kpi"><b>${activated}</b><span>Accounts activated</span></div></div><input id="customerSearch" class="cu-search" type="search" placeholder="Search name, email, address or Wall"><div class="cu-list">${rows || '<div class="cu-empty">No customer accounts yet.</div>'}</div></section></main></body></html>`;
}

export function mountAdminCustomers(app) {
  app.get('/admin/customer-directory.js', (_req, res) => {
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.send(clientScript);
  });

  app.get('/admin/users', requireOwner, async (req, res, next) => {
    try {
      return res.type('html').send(page(req.customerAdmin, req.customerAdminCsrf, await listCustomers()));
    } catch (error) { return next(error); }
  });
}
