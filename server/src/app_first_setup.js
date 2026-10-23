import express from 'express';

import { hashToken, requireSession } from './auth.js';
import {
  hashAdminPassword as hashPassword,
  validateAdminPassword as validatePassword,
  verifyAdminPassword as verifyPassword,
} from './admin_auth.js';
import { pool } from './db.js';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validToken(value) {
  return value.length >= 20 && value.length <= 200;
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

async function setupRecord(client, token, { forUpdate = false } = {}) {
  const lock = forUpdate ? 'for update of w, c' : '';
  const result = await client.query(
    `select w.id, w.slug, w.display_name, w.location_hint, w.setup_required,
            c.id as customer_id, c.email as customer_email,
            c.password_hash as customer_password_hash, c.active as customer_active,
            p.serial_code
       from wall_tags t
       join walls w on w.id = t.wall_id
       join wall_ownerships o on o.wall_id = w.id and o.ended_at is null
       join customer_accounts c on c.id = o.customer_id
       left join plaques p on p.wall_tag_id = t.id
      where t.token_hash = $1
        and t.active = true
        and w.active = true
      limit 1
      ${lock}`,
    [hashToken(token)],
  );
  return result.rows[0] || null;
}

async function grantVisit(client, sessionId, wall) {
  const visit = await client.query(
    `insert into wall_visits
       (session_id, wall_id, first_discovered_at, last_visited_at, write_access_until)
     values ($1, $2, now(), now(), now() + interval '15 minutes')
     on conflict (session_id, wall_id) do update
       set last_visited_at = now(),
           write_access_until = now() + interval '15 minutes'
     returning first_discovered_at, last_visited_at, write_access_until`,
    [sessionId, wall.id],
  );
  return wallJson({ ...wall, ...visit.rows[0] });
}

export function mountAppFirstSetup(app) {
  const router = express.Router();

  router.post('/status', requireSession, async (req, res, next) => {
    try {
      const token = clean(req.body?.token);
      if (!validToken(token)) return res.status(400).json({ error: 'Invalid Wall token.' });
      const record = await setupRecord(pool, token);
      if (!record || !record.customer_active) {
        return res.status(404).json({ error: 'This Wall is not available for setup.' });
      }
      return res.json({
        setup_required: Boolean(record.setup_required),
        account_active: Boolean(record.customer_password_hash),
        serial_code: record.serial_code || null,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', requireSession, async (req, res, next) => {
    const token = clean(req.body?.token);
    const displayName = clean(req.body?.display_name);
    const location = clean(req.body?.location_hint);
    const email = clean(req.body?.email).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!validToken(token)) return res.status(400).json({ error: 'Invalid Wall token.' });
    if (!displayName || displayName.length > 80) {
      return res.status(400).json({ error: 'Wall name must be between 1 and 80 characters.' });
    }
    if (!location || location.length > 120) {
      return res.status(400).json({ error: 'Location must be between 1 and 120 characters.' });
    }
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Enter the email used to purchase this Wall.' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const record = await setupRecord(client, token, { forUpdate: true });
      if (!record || !record.customer_active) {
        await client.query('rollback');
        return res.status(404).json({ error: 'This Wall is not available for setup.' });
      }

      if (!record.setup_required) {
        const wall = await grantVisit(client, req.sessionId, record);
        await client.query('commit');
        return res.json(wall);
      }

      if (email !== String(record.customer_email || '').trim().toLowerCase()) {
        await client.query('rollback');
        return res.status(403).json({ error: 'The purchase email does not match this Wall.' });
      }

      if (record.customer_password_hash) {
        if (!verifyPassword(password, record.customer_password_hash)) {
          await client.query('rollback');
          return res.status(403).json({ error: 'Incorrect owner account password.' });
        }
      } else {
        try {
          validatePassword(password);
        } catch (error) {
          await client.query('rollback');
          return res.status(400).json({ error: error?.message || 'Choose a valid password.' });
        }
        await client.query(
          `update customer_accounts
              set password_hash = $2, updated_at = now()
            where id = $1 and password_hash is null`,
          [record.customer_id, hashPassword(password)],
        );
        await client.query(
          `update customer_claim_tokens
              set used_at = coalesce(used_at, now())
            where customer_id = $1 and used_at is null`,
          [record.customer_id],
        );
      }

      const updated = await client.query(
        `update walls
            set display_name = $2,
                location_hint = $3,
                setup_required = false,
                setup_completed_at = now()
          where id = $1
          returning id, slug, display_name, location_hint`,
        [record.id, displayName, location],
      );
      const wall = updated.rows[0];

      await client.query(
        `insert into customer_audit_log
           (customer_id, email_snapshot, action, wall_id, wall_name, details)
         values ($1, $2, 'wall.first_setup', $3, $4, $5::jsonb)`,
        [
          record.customer_id,
          record.customer_email,
          wall.id,
          wall.display_name,
          JSON.stringify({ location_hint: wall.location_hint, source: 'app_physical_scan' }),
        ],
      );

      const result = await grantVisit(client, req.sessionId, wall);
      await client.query('commit');
      return res.json(result);
    } catch (error) {
      try { await client.query('rollback'); } catch (_) {}
      return next(error);
    } finally {
      client.release();
    }
  });

  app.use('/api/tags/setup', router);
}
