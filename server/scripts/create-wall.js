import crypto from 'node:crypto';
import { hashToken, makeToken } from '../src/auth.js';
import { pool } from '../src/db.js';

const displayName = (process.argv[2] || '').trim();
const locationHint = (process.argv[3] || '').trim();

if (!displayName) {
  console.error('Usage: npm run create-wall -- "Wall name" "Location hint"');
  process.exitCode = 1;
} else {
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

    console.log('');
    console.log('Wall created');
    console.log(`Name: ${displayName}`);
    console.log(`Public Wall ID: ${slug}`);
    console.log(`NFC URL: ${appBase}/t/${tagToken}`);
    console.log('');
    console.log('Write the NFC URL to the tag, test it, then permanently lock the tag.');
    console.log('The raw NFC token is intentionally not stored in the database.');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
