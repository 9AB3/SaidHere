import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashToken } from './auth.js';
import { pool } from './db.js';

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const period = "(date_trunc('day', now() AT TIME ZONE 'Australia/Sydney') - ($1::integer - 1) * interval '1 day') AT TIME ZONE 'Australia/Sydney'";
const day = (column) => "to_char((" + column + " AT TIME ZONE 'Australia/Sydney')::date, 'YYYY-MM-DD')";

export function normalizeAnalyticsDays(value) {
  const days = Number(value);
  return [7, 30, 90].includes(days) ? days : 30;
}

function adminCookie(req) {
  for (const part of String(req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== 'the_wall_admin') continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ''; }
  }
  return '';
}

async function requireOwner(req, res, next) {
  try {
    const token = adminCookie(req);
    if (!token) return res.redirect(303, '/admin/login?next=%2Fadmin%2Fanalytics');
    const result = await pool.query(
      "select u.id, u.username, u.role from admin_sessions s join admin_users u on u.id = s.admin_user_id " +
      "where s.token_hash = $1 and s.expires_at > now() and u.active = true limit 1",
      [hashToken(token)],
    );
    if (!result.rowCount) return res.redirect(303, '/admin/login?next=%2Fadmin%2Fanalytics');
    if (result.rows[0].role !== 'owner') return res.sendStatus(403);
    res.set('Cache-Control', 'no-store, private');
    next();
  } catch (error) { next(error); }
}

export async function fetchAnalytics(days, db = pool) {
  const range = normalizeAnalyticsDays(days);
  const queries = [
    "select count(*)::integer as scans, count(distinct session_id)::integer as visitors from wall_visit_events where visited_at >= " + period,
    "select count(*)::integer as active_sessions from visitor_sessions where last_seen_at >= " + period,
    "select count(*)::integer as posts, count(distinct author_session_id)::integer as posters from wall_posts where hidden_at is null and created_at >= " + period,
    "select count(*)::integer as first_opens, count(*) filter (where platform = 'ios')::integer as ios, count(*) filter (where platform = 'android')::integer as android from app_first_opens where first_opened_at >= " + period,
    "select count(*)::integer as paid_orders, coalesce(sum(amount_total) filter (where lower(currency) = 'aud'),0)::bigint as revenue_cents, count(*) filter (where currency is not null and lower(currency) <> 'aud')::integer as other_currency_orders from commerce_orders where status in ('paid','fulfilled') and paid_at >= " + period,
    "select count(*) filter (where event_type = 'landing_view' and landing = 'home')::integer as home_views, count(*) filter (where event_type = 'landing_view' and landing = 'nfc')::integer as nfc_views, count(*) filter (where event_type = 'store_click')::integer as store_clicks, count(*) filter (where event_type = 'store_click' and platform = 'ios')::integer as ios_clicks, count(*) filter (where event_type = 'store_click' and platform = 'android')::integer as android_clicks, count(*) filter (where event_type = 'shop_view')::integer as shop_views, count(*) filter (where event_type = 'checkout_started')::integer as checkouts from site_analytics_events where occurred_at >= " + period,
    "select source, count(*)::integer as views from site_analytics_events where occurred_at >= " + period + " and event_type = 'landing_view' group by source order by views desc, source asc limit 8",
    "select w.display_name as name, " +
      "(select count(*)::integer from wall_visit_events e where e.wall_id = w.id and e.visited_at >= " + period + ") as scans, " +
      "(select count(distinct e.session_id)::integer from wall_visit_events e where e.wall_id = w.id and e.visited_at >= " + period + ") as visitors, " +
      "(select count(*)::integer from wall_posts p where p.wall_id = w.id and p.hidden_at is null and p.created_at >= " + period + ") as posts " +
      "from walls w order by scans desc, posts desc, w.display_name asc limit 12",
    "select metric, day, sum(value)::numeric as value from (" +
      "select " + day('visited_at') + " as day, 'scans' as metric, count(*)::numeric as value from wall_visit_events where visited_at >= " + period + " group by 1 union all " +
      "select " + day('created_at') + ", 'posts', count(*)::numeric from wall_posts where hidden_at is null and created_at >= " + period + " group by 1 union all " +
      "select " + day('first_opened_at') + ", 'first_opens', count(*)::numeric from app_first_opens where first_opened_at >= " + period + " group by 1 union all " +
      "select " + day('paid_at') + ", 'paid_orders', count(*)::numeric from commerce_orders where status in ('paid','fulfilled') and paid_at >= " + period + " group by 1 union all " +
      "select " + day('paid_at') + ", 'revenue', coalesce(sum(amount_total) filter (where lower(currency) = 'aud'),0)::numeric/100 from commerce_orders where status in ('paid','fulfilled') and paid_at >= " + period + " group by 1 union all " +
      "select " + day('occurred_at') + ", event_type, count(*)::numeric from site_analytics_events where occurred_at >= " + period + " group by 1,2 " +
      ") t group by metric, day order by day asc",
  ];
  const [scans, active, posts, opens, orders, web, sources, walls, trend] =
    await Promise.all(queries.map((sql) => db.query(sql, [range])));
  return {
    days: range, timezone: 'Australia/Sydney',
    metrics: {
      scans: scans.rows[0]?.scans || 0,
      active_sessions: active.rows[0]?.active_sessions || 0,
      visitors: scans.rows[0]?.visitors || 0,
      posts: posts.rows[0]?.posts || 0,
      posters: posts.rows[0]?.posters || 0,
      first_opens: opens.rows[0]?.first_opens || 0,
      paid_orders: orders.rows[0]?.paid_orders || 0,
      revenue_cents: Number(orders.rows[0]?.revenue_cents || 0),
      other_currency_orders: orders.rows[0]?.other_currency_orders || 0,
    },
    platforms: { ios: opens.rows[0]?.ios || 0, android: opens.rows[0]?.android || 0 },
    web: web.rows[0] || {},
    sources: sources.rows, top_walls: walls.rows, trend: trend.rows,
  };
}

function dailyCsv(data) {
  const byDay = new Map();
  for (const point of data.trend) {
    const date = String(point.day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!byDay.has(date)) byDay.set(date, {});
    byDay.get(date)[point.metric] = Number(point.value) || 0;
  }
  const result = [['date_sydney','nfc_opens','posts','first_opens','paid_orders','gross_revenue_aud','store_clicks']];
  for (const [date, v] of [...byDay.entries()].sort(([a],[b]) => a.localeCompare(b))) {
    result.push([date, v.scans || 0, v.posts || 0, v.first_opens || 0,
      v.paid_orders || 0, v.revenue || 0, v.store_click || 0]);
  }
  return result.map((row) => row.join(',')).join('\n') + '\n';
}

export function mountAdminAnalyticsDashboard(app) {
  app.get('/admin/analytics-client.js', requireOwner, (_req, res) => {
    res.type('application/javascript').sendFile(path.join(publicRoot, 'admin-analytics-client.js'));
  });
  app.get('/admin/analytics', requireOwner, (_req, res) => {
    res.type('html').sendFile(path.join(publicRoot, 'admin-analytics.html'));
  });
  app.get('/admin/analytics/data', requireOwner, async (req, res, next) => {
    try { res.json(await fetchAnalytics(req.query?.days)); }
    catch (error) { next(error); }
  });
  app.get('/admin/analytics/export.csv', requireOwner, async (req, res, next) => {
    try {
      const data = await fetchAnalytics(req.query?.days);
      res.set('Content-Disposition', 'attachment; filename="saidhere-analytics.csv"');
      res.type('text/csv').send(dailyCsv(data));
    } catch (error) { next(error); }
  });
}
