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

  window.addEventListener('DOMContentLoaded', addOverview, { once: true });
  requestAnimationFrame(() => setTimeout(addOverview, 0));
  setTimeout(addOverview, 120);
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
}
