import express from 'express';

import { requireSession } from './auth.js';
import { pool } from './db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let mounted = false;

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function normalizedForSafety(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A deliberately conservative pre-publication filter for content that is very
// likely to be abusive or unsafe. Reports and owner/platform moderation remain
// available for context-dependent content that should not be auto-rejected.
const hardBlockPatterns = [
  /\bkill yourself\b/,
  /\bkys\b/,
  /\b(?:kill|murder|shoot|stab|rape) (?:you|him|her|them)\b/,
  /\bi(?: am|'m|m) going to (?:kill|murder|shoot|stab|rape)\b/,
  /\bchild porn(?:ography)?\b/,
  /\b(?:nigg(?:er|a)|fagg?ot|chink|kike|spic)\b/,
];

export function objectionableContentReason(value) {
  const normalized = normalizedForSafety(value);
  if (!normalized) return null;
  if (hardBlockPatterns.some((pattern) => pattern.test(normalized))) {
    return 'That message cannot be posted because it contains abusive or unsafe content.';
  }
  return null;
}

async function discoveredWall(sessionId, wallId) {
  const result = await pool.query(
    `select w.id
       from wall_visits v
       join walls w on w.id = v.wall_id
      where v.session_id = $1
        and w.id = $2
        and w.active = true
      limit 1`,
    [sessionId, wallId],
  );
  return result.rows[0] || null;
}

export function mountUgcSafety(app) {
  if (mounted) return;
  mounted = true;
  const router = express.Router();

  // This replaces the legacy post listing route with the same response shape,
  // while hiding content from anonymous authors this visitor has blocked.
  router.get('/walls/:wallId/posts', requireSession, async (req, res, next) => {
    if (!validUuid(req.params.wallId)) {
      return res.status(400).json({ error: 'Invalid Wall ID.' });
    }
    try {
      const wall = await discoveredWall(req.sessionId, req.params.wallId);
      if (!wall) return res.status(404).json({ error: 'Wall not found.' });

      const result = await pool.query(
        `select p.id, p.wall_id, p.parent_id, p.body, p.created_at,
                count(r.id) filter (
                  where not exists (
                    select 1
                      from visitor_blocks rb
                     where rb.blocker_session_id = $2
                       and rb.blocked_session_id = r.author_session_id
                  )
                )::int as reply_count
           from wall_posts p
           left join wall_posts r
             on r.parent_id = p.id
            and r.hidden_at is null
          where p.wall_id = $1
            and p.hidden_at is null
            and not exists (
              select 1
                from visitor_blocks b
               where b.blocker_session_id = $2
                 and b.blocked_session_id = p.author_session_id
            )
          group by p.id
          order by p.created_at asc`,
        [wall.id, req.sessionId],
      );
      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  });

  // This replaces the legacy create-post route so objectionable material is
  // rejected server-side before it is published, not merely hidden in the app.
  router.post('/walls/:wallId/posts', requireSession, async (req, res, next) => {
    const wallId = req.params.wallId;
    const body = clean(req.body?.body);
    const parentId = clean(req.body?.parent_id) || null;
    if (!validUuid(wallId)) return res.status(400).json({ error: 'Invalid Wall ID.' });
    if (parentId && !validUuid(parentId)) {
      return res.status(400).json({ error: 'Invalid reply target.' });
    }
    if (body.length === 0 || body.length > 300) {
      return res.status(400).json({ error: 'Messages must be between 1 and 300 characters.' });
    }
    const safetyReason = objectionableContentReason(body);
    if (safetyReason) return res.status(400).json({ error: safetyReason });

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
          `select p.id
             from wall_posts p
            where p.id = $1
              and p.wall_id = $2
              and p.parent_id is null
              and p.hidden_at is null
              and not exists (
                select 1
                  from visitor_blocks b
                 where b.blocker_session_id = $3
                   and b.blocked_session_id = p.author_session_id
              )`,
          [parentId, wallId, req.sessionId],
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

  router.post('/posts/:postId/block', requireSession, async (req, res, next) => {
    if (!validUuid(req.params.postId)) {
      return res.status(400).json({ error: 'Invalid message ID.' });
    }
    try {
      const result = await pool.query(
        `select p.author_session_id
           from wall_posts p
           join wall_visits v
             on v.wall_id = p.wall_id
            and v.session_id = $1
           join walls w on w.id = p.wall_id and w.active = true
          where p.id = $2
          limit 1`,
        [req.sessionId, req.params.postId],
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Message not found.' });
      const blockedSessionId = result.rows[0].author_session_id;
      if (blockedSessionId === req.sessionId) {
        return res.status(400).json({ error: 'You cannot block your own anonymous session.' });
      }
      await pool.query(
        `insert into visitor_blocks (blocker_session_id, blocked_session_id)
         values ($1, $2)
         on conflict (blocker_session_id, blocked_session_id) do nothing`,
        [req.sessionId, blockedSessionId],
      );
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  // Deletes this anonymous identity and all data connected by cascading foreign
  // keys: visits, scan locations, posts/replies, reports and blocking records.
  router.delete('/session', requireSession, async (req, res, next) => {
    try {
      await pool.query(`delete from visitor_sessions where id = $1`, [req.sessionId]);
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', router);
}
