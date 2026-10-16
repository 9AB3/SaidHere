import crypto from 'node:crypto';
import { pool } from './db.js';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function makeToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export async function issueAnonymousSession() {
  const token = makeToken();
  const tokenHash = hashToken(token);
  await pool.query(
    `insert into visitor_sessions (token_hash) values ($1)`,
    [tokenHash],
  );
  return token;
}

export async function requireSession(req, res, next) {
  try {
    const auth = req.get('authorization') || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Missing anonymous session token.' });
    }

    const tokenHash = hashToken(match[1]);
    const result = await pool.query(
      `update visitor_sessions
       set last_seen_at = now()
       where token_hash = $1
       returning id`,
      [tokenHash],
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Anonymous session is no longer valid.' });
    }

    req.sessionId = result.rows[0].id;
    return next();
  } catch (error) {
    return next(error);
  }
}
