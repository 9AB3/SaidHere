import express from 'express';

import { requireSession } from './auth.js';
import { pool } from './db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mountWallDiscoveryLocations(app) {
  const router = express.Router();

  router.post('/walls/:wallId/location', requireSession, async (req, res, next) => {
    try {
      if (!validUuid(req.params.wallId)) {
        return res.status(400).json({ error: 'Invalid Wall ID.' });
      }
      const latitude = number(req.body?.latitude);
      const longitude = number(req.body?.longitude);
      const accuracy = number(req.body?.accuracy_metres);
      if (latitude == null || latitude < -90 || latitude > 90 ||
          longitude == null || longitude < -180 || longitude > 180 ||
          accuracy == null || accuracy < 0 || accuracy > 5000) {
        return res.status(400).json({ error: 'Invalid discovery location.' });
      }

      // A location can only be attached immediately after this same anonymous
      // visitor has physically opened the Wall. This prevents arbitrary map pins.
      const visit = await pool.query(
        `select v.wall_id
           from wall_visits v
           join walls w on w.id = v.wall_id and w.active = true
          where v.session_id = $1
            and v.wall_id = $2
            and v.last_visited_at > now() - interval '5 minutes'
          limit 1`,
        [req.sessionId, req.params.wallId],
      );
      if (visit.rowCount === 0) {
        return res.status(403).json({ error: 'Scan this Wall again before saving its location.' });
      }

      await pool.query(
        `insert into wall_scan_locations
           (session_id, wall_id, latitude, longitude, accuracy_metres)
         values ($1, $2, $3, $4, $5)`,
        [req.sessionId, req.params.wallId, latitude, longitude, accuracy],
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/discovery-locations', requireSession, async (req, res, next) => {
    try {
      // The map intentionally returns only this anonymous visitor's discoveries.
      // The first recorded location is the place they originally found each Wall;
      // scan_count preserves later re-scans for future journey/history features.
      const result = await pool.query(
        `select distinct on (l.wall_id)
                l.wall_id,
                l.latitude,
                l.longitude,
                l.accuracy_metres,
                l.scanned_at,
                counts.scan_count
           from wall_scan_locations l
           join walls w on w.id = l.wall_id
           join lateral (
             select count(*)::int as scan_count
               from wall_scan_locations c
              where c.session_id = $1 and c.wall_id = l.wall_id
           ) counts on true
          where l.session_id = $1
          order by l.wall_id, l.scanned_at asc`,
        [req.sessionId],
      );
      return res.json(result.rows);
    } catch (error) {
      return next(error);
    }
  });

  app.use('/api', router);
}
