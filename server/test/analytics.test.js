import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://localhost/saidhere_analytics_test';
const { normalizeAnalyticsDays, fetchAnalytics } = await import('../src/admin_analytics_dashboard.js');
const { normalizeSource, sourceFromRequest } = await import('../src/site_analytics.js');

test('analytics range is allowlisted to 7, 30 and 90 days', () => {
  assert.equal(normalizeAnalyticsDays('7'), 7);
  assert.equal(normalizeAnalyticsDays('30'), 30);
  assert.equal(normalizeAnalyticsDays('90'), 90);
  assert.equal(normalizeAnalyticsDays('365;drop table walls'), 30);
  assert.equal(normalizeAnalyticsDays(-1), 30);
});

test('marketing sources are coarse and do not retain arbitrary user text', () => {
  assert.equal(normalizeSource('reddit'), 'reddit');
  assert.equal(normalizeSource('www.google.com'), 'google');
  assert.equal(normalizeSource('someone@example.org'), 'other');
  assert.equal(normalizeSource(''), 'direct');
  const request = {
    query: { utm_source: 'reddit-abc-campaign' },
    get: () => 'https://example.com/random',
  };
  assert.equal(sourceFromRequest(request), 'reddit');
});

test('overview queries are aggregated, scoped and preserve zero values', async () => {
  const results = [
    [{ scans: 12, visitors: 5 }],
    [{ active_sessions: 6 }],
    [{ posts: 3, posters: 2 }],
    [{ first_opens: 4, ios: 3, android: 1 }],
    [{ paid_orders: 2, revenue_cents: '3000', other_currency_orders: 0 }],
    [{ home_views: 15, nfc_views: 8, store_clicks: 5, shop_views: 4, checkouts: 3 }],
    [{ source: 'reddit', views: 8 }],
    [{ name: 'Test Wall', scans: 12, visitors: 5, posts: 3 }],
    [{ day: '2026-11-11', metric: 'scans', value: '12' }],
  ];
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: results[queries.length - 1] };
    },
  };
  const payload = await fetchAnalytics(30, db);
  assert.equal(queries.length, 9);
  assert.ok(queries.every((q) => q.params.length === 1 && q.params[0] === 30));
  assert.ok(queries.every((q) => q.sql.includes('Australia/Sydney')));
  assert.equal(payload.metrics.scans, 12);
  assert.equal(payload.metrics.active_sessions, 6);
  assert.equal(payload.metrics.revenue_cents, 3000);
  assert.equal(payload.platforms.ios, 3);
  assert.equal(payload.top_walls[0].name, 'Test Wall');
  assert.equal(payload.trend[0].day, '2026-11-11');
  assert.ok(!JSON.stringify(payload).includes('session_id'));
});

test('unsupported day inputs cannot be inserted into SQL', async () => {
  const db = { query: async (sql, params) => {
    assert.deepEqual(params, [30]);
    assert.ok(!sql.includes('DROP TABLE'));
    return { rows: [{}] };
  } };
  const result = await fetchAnalytics('30); DROP TABLE walls;', db);
  assert.equal(result.days, 30);
});
