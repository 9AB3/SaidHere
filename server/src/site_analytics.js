import rateLimit from 'express-rate-limit';
import { pool } from './db.js';

const eventTypes = new Set(['landing_view', 'store_click', 'shop_view', 'checkout_started']);
const sources = new Set(['reddit', 'google', 'instagram', 'facebook', 'tiktok', 'youtube', 'email', 'direct', 'other']);
const landingTypes = new Set(['home', 'nfc']);
const platforms = new Set(['ios', 'android']);

export function normalizeSource(source) {
  const value = String(source || '').toLowerCase().trim().slice(0, 80);
  if (!value) return 'direct';
  if (sources.has(value)) return value;
  if (/reddit/.test(value)) return 'reddit';
  if (/google/.test(value)) return 'google';
  if (/instagram/.test(value)) return 'instagram';
  if (/facebook|fb\./.test(value)) return 'facebook';
  if (/tiktok/.test(value)) return 'tiktok';
  if (/youtube|youtu\./.test(value)) return 'youtube';
  return 'other';
}

export function sourceFromRequest(req) {
  const utm = typeof req.query?.utm_source === 'string' ? req.query.utm_source : '';
  if (utm) return normalizeSource(utm);
  const ref = String(req.get('referer') || '');
  try { return normalizeSource(new URL(ref).hostname); }
  catch (_) { return 'direct'; }
}

export async function recordSiteEvent({ event, platform = null, landing = null, source = 'direct' }) {
  if (!eventTypes.has(event)) throw new Error('Invalid analytics event');
  await pool.query(
    `insert into site_analytics_events (event_type, platform, landing, source)
     values ($1, $2, $3, $4)`,
    [event, platforms.has(platform) ? platform : null,
      landingTypes.has(landing) ? landing : null, normalizeSource(source)],
  );
}

export function mountSiteAnalytics(app) {
  const limiter = rateLimit({
    windowMs: 60 * 1000, limit: 20,
    standardHeaders: 'draft-8', legacyHeaders: false,
  });
  // Public anonymous event ingress. No IPs, device IDs, or message content are retained.
  app.post('/api/analytics/event', limiter, async (req, res, next) => {
    const event = req.body?.event;
    if (!['landing_view', 'store_click'].includes(event)) return res.sendStatus(400);
    const platform = req.body?.platform;
    const landing = req.body?.landing;
    if (event === 'store_click' && !platforms.has(platform)) return res.sendStatus(400);
    if (event === 'landing_view' && !landingTypes.has(landing)) return res.sendStatus(400);
    try {
      await recordSiteEvent({ event, platform, landing, source: req.body?.source });
      return res.sendStatus(204);
    } catch (error) { return next(error); }
  });

  // Capture checkout-page visits as server requests; never capture customer details.
  app.get('/shop', (req, _res, next) => {
    void recordSiteEvent({ event: 'shop_view', source: sourceFromRequest(req) })
      .catch((error) => console.error('[analytics] shop view:', error));
    next();
  });
}
