import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { hashAdminPassword } from '../src/admin_auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

try {
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);

  const existing = await pool.query(`select id from admin_users limit 1`);
  if (existing.rowCount === 0) {
    const passwordHash = hashAdminPassword('password');
    await pool.query(
      `insert into admin_users
         (username, display_name, password_hash, role, active, must_change_password)
       values ('admin', 'Administrator', $1, 'owner', true, true)`,
      [passwordHash],
    );
    console.log('Created the default Owner admin account.');
  }

  await pool.query(`delete from admin_sessions where expires_at <= now()`);
  console.log('SaidHere database schema is up to date.');
} finally {
  await pool.end();
}
