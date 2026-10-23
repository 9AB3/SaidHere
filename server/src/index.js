import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { hashToken, issueAnonymousSession, requireSession } from './auth.js';
import { pool } from './db.js';
import { mountAdminSecurity } from './admin_security.js';
import { mountAdminPortal } from './admin_portal.js';
import { mountAdminBrand } from './admin_brand.js';
import { mountOwnershipAdminNav } from './admin_ownership_nav.js';
import { mountCommerce, mountStripeWebhook } from './commerce.js';
import { mountPurchaseActivation } from './purchase_activation.js';
import { mountCustomerSecurity } from './customer_security.js';
import { mountAppFirstSetup } from './app_first_setup.js';
import { mountPlaqueSetup } from './plaque_setup.js';
import { mountSetupGuard } from './setup_guard.js';
import { mountCustomerPortal } from './customer_portal.runtime.js';
import { mountCanonicalWebRedirect, mountPublicSite } from './public_site.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.set('trust proxy', 1);

// Stripe must receive the untouched request body for signature verification.
mountStripeWebhook(app);

const csp = helmet.contentSecurityPolicy.getDefaultDirectives();
csp['form-action'] = ["'self'", 'https://checkout.stripe.com'];
app.use(helmet({ contentSecurityPolicy: { directives: csp } }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const apiCors = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  },
});
app.use('/api', apiCors);

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

function cleanBody(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function wallJson(row) {
  return {
    id: row.id,
    slug: row.slug,
    display_name: row.display_name,
    location_hint: row.location_hint || '',
    first_discovered_at: row.first_discovered_at || null,
    last_visited_at: row.last_visited_at || null,
    write_access_until: row.write_access_until || null,
  };
}

async function discoveredWall(sessionId, wallId) {
  if (!validUuid(wallId)) return null;
  const result = await pool.query(
    `select w.id, w.slug, w.display_name, w.location_hint,
            v.first_discovered_at, v.last_visited_at, v.write_access_until
       from wall_visits v
       join walls w on w.id = v.wall_id
      where v.session_id = $1 and w.id = $2 and w.active = true`,
    [sessionId, wallId],
  );
  return result.rows[0] || null;
}

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('select 1');
    return res.json({ ok: true, service: 'saidhere-api' });
  } catch (error) {
    return next(error);
  }
});

// Account/admin/commerce pages are mounted before the core app routes.
mountCanonicalWebRedirect(app);
mountAdminSecurity(app);
mountAdminBrand(app);
mountOwnershipAdminNav(app);
mountPurchaseActivation(app);
mountCommerce(app);
mountCustomerSecurity(app);
// The native app completes first-scan setup without handing the user to a browser.
mountAppFirstSetup(app);
// Browser first-scan setup and the setup-required guard remain as a fallback for users without the app.
mountPlaqueSetup(app);
mountSetupGuard(app);
mountCustomerPortal(app);
mountAdminPortal(app);
mountPublicSite(app);

app.post('/api/session', sessionLimiter, async (_req, res, next) => {
  try {
    return res.status(201).json({ token: await issueAnonymousSession() });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/tags/open', requireSession, async (req, res, next) => {
  const tagToken = cleanBody(req.body?.token);
  if (tagToken.length < 20 || tagToken.length > 200) {
    return res.status(400).json({ error: 'Invalid Wall token.' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const tagResult = await client.query(
      `select w.id, w.slug, w.display_name, w.location_hint
         from wall_tags t
         join walls w on w.id = t.wall_id
        where t.token_hash = $1 and t.active = true and w.active = true
        limit 1`,
      [hashToken(tagToken)],
    );
    if (tagResult.rowCount === 0) {
      await client.query('rollback');
      return res.status(404).json({ error: 'This Wall is not active.' });
    }

    const wall = tagResult.rows[0];
    const visitResult = await client.query(
      `insert into wall_visits
         (session_id, wall_id, first_discovered_at, last_visited_at, write_access_until)
       values ($1, $2, now(), now(), now() + interval '15 minutes')
       on conflict (session_id, wall_id) do update
         set last_visited_at = now(),
             write_access_until = now() + interval '15 minutes'
       returning first_discovered_at, last_visited_at, write_access_until`,
      [req.sessionId, wall.id],
    );
    await client.query('commit');
    return res.json(wallJson({ ...wall, ...visitResult.rows[0] }));
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    return next(error);
  } finally {
    client.release();
  }
});

app.get('/api/walls', requireSession, async (req, res, next) => {
  try {
    const result = await pool.query(
      `select w.id, w.slug, w.display_name, w.location_hint,
              v.first_discovered_at, v.last_visited_at, v.write_access_until
         from wall_visits v
         join walls w on w.id = v.wall_id
        where v.session_id = $1 and w.active = true
        order by v.last_visited_at desc`,
      [req.sessionId],
    );
    return res.json(result.rows.map(wallJson));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/walls/:slug', requireSession, async (req, res, next) => {
  try {
    const result = await pool.query(
      `select w.id, w.slug, w.display_name, w.location_hint,
              v.first_discovered_at, v.last_visited_at, v.write_access_until
         from wall_visits v
         join walls w on w.id = v.wall_id
        where v.session_id = $1 and w.slug = $2 and w.active = true
        limit 1`,
      [req.sessionId, req.params.slug],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'You have not discovered this Wall yet. Scan it in person first.',
      });
    }
    return res.json(wallJson(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/walls/:wallId/posts', requireSession, async (req, res, next) => {
  if (!validUuid(req.params.wallId)) return res.status(400).json({ error: 'Invalid Wall ID.' });
  try {
    const wall = await discoveredWall(req.sessionId, req.params.wallId);
    if (!wall) return res.status(404).json({ error: 'Wall not found.' });

    const result = await pool.query(
      `select p.id, p.wall_id, p.parent_id, p.body, p.created_at,
              count(r.id)::int as reply_count
         from wall_posts p
         left join wall_posts r on r.parent_id = p.id and r.hidden_at is null
        where p.wall_id = $1 and p.hidden_at is null
        group by p.id
        order by p.created_at asc`,
      [wall.id],
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/walls/:wallId/posts', requireSession, async (req, res, next) => {
  const wallId = req.params.wallId;
  const body = cleanBody(req.body?.body);
  const parentId = cleanBody(req.body?.parent_id) || null;
  if (!validUuid(wallId)) return res.status(400).json({ error: 'Invalid Wall ID.' });
  if (parentId && !validUuid(parentId)) return res.status(400).json({ error: 'Invalid reply target.' });
  if (body.length === 0 || body.length > 300) {
    return res.status(400).json({ error: 'Messages must be between 1 and 300 characters.' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const visitResult = await client.query(
      `select v.write_access_until
         from wall_visits v
         join walls w on w.id = v.wall_id and w.active = true
        where v.session_id = $1 and v.wall_id = $2
        for update of v`,
      [req.sessionId, wallId],
    );
    if (visitResult.rowCount === 0) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Wall not found or inactive.' });
    }
    if (!visitResult.rows[0].write_access_until ||
        new Date(visitResult.rows[0].write_access_until) <= new Date()) {
      await client.query('rollback');
      return res.status(403).json({
        error: 'Writing time has expired. Scan this Wall again in person to write.',
      });
    }

    const floodResult = await client.query(
      `select count(*)::int as count
         from wall_posts
        where author_session_id = $1
          and created_at > now() - interval '1 minute'`,
      [req.sessionId],
    );
    if (floodResult.rows[0].count >= 6) {
      await client.query('rollback');
      return res.status(429).json({ error: 'Too many messages. Try again shortly.' });
    }

    if (parentId) {
      const parentResult = await client.query(
        `select id from wall_posts
          where id = $1 and wall_id = $2 and parent_id is null and hidden_at is null`,
        [parentId, wallId],
      );
      if (parentResult.rowCount === 0) {
        await client.query('rollback');
        return res.status(400).json({ error: 'Replies can only be made to a visible top-level message.' });
      }
    }

    const insertResult = await client.query(
      `insert into wall_posts (wall_id, parent_id, author_session_id, body)
       values ($1, $2, $3, $4)
       returning id, wall_id, parent_id, body, created_at, 0::int as reply_count`,
      [wallId, parentId, req.sessionId, body],
    );
    await client.query('commit');
    return res.status(201).json(insertResult.rows[0]);
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    return next(error);
  } finally {
    client.release();
  }
});

app.post('/api/posts/:postId/report', requireSession, async (req, res, next) => {
  const postId = req.params.postId;
  if (!validUuid(postId)) return res.status(400).json({ error: 'Invalid message ID.' });

  const client = await pool.connect();
  try {
    await client.query('begin');
    const recentReports = await client.query(
      `select count(*)::int as count
         from post_reports
        where reporter_session_id = $1
          and created_at > now() - interval '1 hour'`,
      [req.sessionId],
    );
    if (recentReports.rows[0].count >= 20) {
      await client.query('rollback');
      return res.status(429).json({ error: 'Too many reports. Try again later.' });
    }

    const postResult = await client.query(
      `select p.id
         from wall_posts p
         join wall_visits v on v.wall_id = p.wall_id and v.session_id = $1
         join walls w on w.id = p.wall_id and w.active = true
        where p.id = $2
        limit 1`,
      [req.sessionId, postId],
    );
    if (postResult.rowCount === 0) {
      await client.query('rollback');
      return res.status(404).json({ error: 'Message not found.' });
    }

    await client.query(
      `insert into post_reports (post_id, reporter_session_id)
       values ($1, $2)
       on conflict (post_id, reporter_session_id) do nothing`,
      [postId, req.sessionId],
    );
    const countResult = await client.query(
      `select count(*)::int as count from post_reports where post_id = $1`,
      [postId],
    );
    if (countResult.rows[0].count >= 3) {
      await client.query(
        `update wall_posts set hidden_at = coalesce(hidden_at, now()) where id = $1`,
        [postId],
      );
    }
    await client.query('commit');
    return res.status(204).send();
  } catch (error) {
    try { await client.query('rollback'); } catch (_) {}
    return next(error);
  } finally {
    client.release();
  }
});

app.use((error, req, res, _next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, error);
  if (req.path.startsWith('/admin') || req.path.startsWith('/shop') || req.path.startsWith('/my-walls') || req.path.startsWith('/purchase')) {
    return res.status(500).type('html').send(`<!doctype html><html><body style="font-family:Arial;padding:32px"><h1>Something went wrong.</h1><p>Request ${requestId}</p><p><a href="/">Back to The Wall</a></p></body></html>`);
  }
  return res.status(500).json({ error: 'Something went wrong.', request_id: requestId });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SaidHere API listening on ${port}`);
});
