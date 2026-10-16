import crypto from 'node:crypto';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { issueAnonymousSession, hashToken, makeToken, requireSession } from './auth.js';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 10000);

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const apiCors = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
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

const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

function cleanBody(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function safeEqual(left, right) {
  const a = Buffer.from(left || '', 'utf8');
  const b = Buffer.from(right || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function suppliedAdminKey(req) {
  const headerKey = cleanBody(req.get('x-admin-key'));
  const auth = cleanBody(req.get('authorization'));
  if (headerKey) return headerKey;
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return cleanBody(req.body?.admin_key);
}

function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_KEY || '';
  if (!configuredKey) {
    return res.status(503).json({ error: 'Admin access is not configured.' });
  }
  if (!safeEqual(suppliedAdminKey(req), configuredKey)) {
    return res.status(401).json({ error: 'Invalid admin key.' });
  }
  return next();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function adminPage(result = null, error = null) {
  const resultHtml = result
    ? `<hr><h2>Wall created</h2>
       <p><strong>Name:</strong> ${escapeHtml(result.display_name)}</p>
       <p><strong>Public Wall ID:</strong> ${escapeHtml(result.slug)}</p>
       <p><strong>NFC URL:</strong></p>
       <p><a href="${escapeHtml(result.nfc_url)}">${escapeHtml(result.nfc_url)}</a></p>
       <p>Write that exact URL to the NFC tag. Test it before permanently write-locking the tag.</p>`
    : '';
  const errorHtml = error ? `<p><strong>Error:</strong> ${escapeHtml(error)}</p>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SaidHere Admin</title>
</head>
<body>
  <main>
    <h1>SaidHere Admin</h1>
    <p>Create a physical Wall and generate the secret URL to program into its NFC tag.</p>
    ${errorHtml}
    <form method="post" action="/admin/create">
      <p><label>Admin key<br><input name="admin_key" type="password" required autocomplete="current-password" size="50"></label></p>
      <p><label>Wall name<br><input name="display_name" required maxlength="80" placeholder="The Royal Hotel — Men's Bathroom" size="50"></label></p>
      <p><label>Location hint<br><input name="location_hint" maxlength="120" placeholder="Singleton NSW" size="50"></label></p>
      <button type="submit">Create Wall</button>
    </form>
    ${resultHtml}
  </main>
</body>
</html>`;
}

async function createWall(displayName, locationHint) {
  if (!displayName || displayName.length > 80) {
    throw new Error('Wall name must be between 1 and 80 characters.');
  }
  if (locationHint.length > 120) {
    throw new Error('Location hint must be 120 characters or fewer.');
  }

  const slug = crypto.randomBytes(5).toString('hex').toUpperCase();
  const tagToken = makeToken(36);
  const tagHash = hashToken(tagToken);
  const appBase = (process.env.PUBLIC_APP_URL || 'https://saidhere.app').replace(/\/$/, '');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const wallResult = await client.query(
      `insert into walls (slug, display_name, location_hint)
       values ($1, $2, $3)
       returning id, slug, display_name, location_hint`,
      [slug, displayName, locationHint],
    );
    await client.query(
      `insert into wall_tags (wall_id, token_hash) values ($1, $2)`,
      [wallResult.rows[0].id, tagHash],
    );
    await client.query('commit');

    return {
      ...wallResult.rows[0],
      nfc_url: `${appBase}/t/${tagToken}`,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function discoveredWall(sessionId, wallId) {
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
    res.json({ ok: true, service: 'saidhere-api' });
  } catch (error) {
    next(error);
  }
});

app.get('/admin', (_req, res) => {
  res.type('html').send(adminPage());
});

app.post('/admin/create', adminLimiter, requireAdmin, async (req, res) => {
  const displayName = cleanBody(req.body?.display_name);
  const locationHint = cleanBody(req.body?.location_hint);
  try {
    const wall = await createWall(displayName, locationHint);
    return res.type('html').status(201).send(adminPage(wall));
  } catch (error) {
    console.error('[admin/create]', error);
    return res.type('html').status(400).send(adminPage(null, error?.message || 'Could not create Wall.'));
  }
});

app.post('/api/admin/walls', adminLimiter, requireAdmin, async (req, res, next) => {
  try {
    const wall = await createWall(
      cleanBody(req.body?.display_name),
      cleanBody(req.body?.location_hint),
    );
    return res.status(201).json(wall);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/admin/walls', adminLimiter, requireAdmin, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `select w.id, w.slug, w.display_name, w.location_hint, w.active, w.created_at,
              count(distinct v.session_id)::int as discovered_by,
              count(distinct p.id)::int as post_count
         from walls w
         left join wall_visits v on v.wall_id = w.id
         left join wall_posts p on p.wall_id = w.id and p.hidden_at is null
        group by w.id
        order by w.created_at desc`,
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/session', sessionLimiter, async (_req, res, next) => {
  try {
    const token = await issueAnonymousSession();
    res.status(201).json({ token });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tags/open', requireSession, async (req, res, next) => {
  const tagToken = cleanBody(req.body?.token);
  if (tagToken.length < 20 || tagToken.length > 200) {
    return res.status(400).json({ error: 'Invalid plaque token.' });
  }

  try {
    const tagHash = hashToken(tagToken);
    const client = await pool.connect();
    try {
      await client.query('begin');
      const tagResult = await client.query(
        `select w.id, w.slug, w.display_name, w.location_hint
           from wall_tags t
           join walls w on w.id = t.wall_id
          where t.token_hash = $1 and t.active = true and w.active = true
          limit 1`,
        [tagHash],
      );

      if (tagResult.rowCount === 0) {
        await client.query('rollback');
        return res.status(404).json({ error: 'This plaque is not active.' });
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
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
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
    res.json(result.rows.map(wallJson));
  } catch (error) {
    next(error);
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
        error: 'You have not discovered this Wall yet. Tap its plaque in person first.',
      });
    }
    return res.json(wallJson(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/walls/:wallId/posts', requireSession, async (req, res, next) => {
  try {
    const wall = await discoveredWall(req.sessionId, req.params.wallId);
    if (!wall) {
      return res.status(404).json({ error: 'Wall not found.' });
    }

    const result = await pool.query(
      `select p.id, p.wall_id, p.parent_id, p.body, p.created_at,
              count(r.id)::int as reply_count
         from wall_posts p
         left join wall_posts r
           on r.parent_id = p.id and r.hidden_at is null
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
  const body = cleanBody(req.body?.body);
  const parentId = req.body?.parent_id || null;

  if (body.length === 0 || body.length > 300) {
    return res.status(400).json({ error: 'Messages must be between 1 and 300 characters.' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const visitResult = await client.query(
        `select write_access_until
           from wall_visits
          where session_id = $1 and wall_id = $2
          for update`,
        [req.sessionId, req.params.wallId],
      );

      if (visitResult.rowCount === 0) {
        await client.query('rollback');
        return res.status(404).json({ error: 'Wall not found.' });
      }
      if (!visitResult.rows[0].write_access_until ||
          new Date(visitResult.rows[0].write_access_until) <= new Date()) {
        await client.query('rollback');
        return res.status(403).json({
          error: 'Writing time has expired. Tap this Wall again in person to write.',
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
          [parentId, req.params.wallId],
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
        [req.params.wallId, parentId, req.sessionId, body],
      );
      await client.query('commit');
      return res.status(201).json(insertResult.rows[0]);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

app.post('/api/posts/:postId/report', requireSession, async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const postResult = await client.query(
        `select p.id, p.wall_id
           from wall_posts p
           join wall_visits v
             on v.wall_id = p.wall_id and v.session_id = $1
          where p.id = $2
          limit 1`,
        [req.sessionId, req.params.postId],
      );
      if (postResult.rowCount === 0) {
        await client.query('rollback');
        return res.status(404).json({ error: 'Message not found.' });
      }

      await client.query(
        `insert into post_reports (post_id, reporter_session_id)
         values ($1, $2)
         on conflict (post_id, reporter_session_id) do nothing`,
        [req.params.postId, req.sessionId],
      );
      const countResult = await client.query(
        `select count(*)::int as count from post_reports where post_id = $1`,
        [req.params.postId],
      );
      if (countResult.rows[0].count >= 3) {
        await client.query(
          `update wall_posts set hidden_at = coalesce(hidden_at, now()) where id = $1`,
          [req.params.postId],
        );
      }
      await client.query('commit');
      return res.status(204).send();
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('SaidHere API');
});

app.use((error, req, res, _next) => {
  const requestId = crypto.randomUUID();
  console.error(`[${requestId}]`, error);
  if (req.path.startsWith('/admin')) {
    return res.type('html').status(500).send(adminPage(null, `${error?.message || 'Something went wrong.'} (request ${requestId})`));
  }
  return res.status(500).json({ error: 'Something went wrong.', request_id: requestId });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`SaidHere API listening on ${port}`);
});