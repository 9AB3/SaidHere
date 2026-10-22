import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashAdminPassword } from '../src/admin_auth.js';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

try {
  // Existing databases predate moderator Wall ownership. Add the column before
  // loading schema.sql so indexes that reference it can be created safely.
  await pool.query(`alter table if exists admin_users add column if not exists wall_id uuid`);

  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);

  // Keep upgrades idempotent for existing Render databases.
  await pool.query(`alter table commerce_orders add column if not exists customer_name text`);
  await pool.query(`alter table commerce_orders add column if not exists shipping_address jsonb`);
  await pool.query(`alter table commerce_orders add column if not exists customer_confirmation_sent_at timestamptz`);
  await pool.query(`alter table commerce_orders add column if not exists customer_confirmation_last_attempt_at timestamptz`);
  await pool.query(`alter table commerce_orders add column if not exists customer_confirmation_error text`);
  await pool.query(`alter table commerce_orders add column if not exists customer_confirmation_message_id text`);
  await pool.query(`alter table commerce_orders add column if not exists customer_confirmation_attempts integer not null default 0`);
  await pool.query(`alter table commerce_orders add column if not exists owner_notification_sent_at timestamptz`);
  await pool.query(`alter table commerce_orders add column if not exists owner_notification_last_attempt_at timestamptz`);
  await pool.query(`alter table commerce_orders add column if not exists owner_notification_error text`);
  await pool.query(`alter table commerce_orders add column if not exists owner_notification_message_id text`);
  await pool.query(`alter table commerce_orders add column if not exists owner_notification_attempts integer not null default 0`);

  await pool.query(`update admin_users set role = 'moderator' where role = 'admin'`);
  await pool.query(`alter table admin_users drop constraint if exists admin_users_role_check`);
  await pool.query(`alter table admin_users add constraint admin_users_role_check check (role in ('owner', 'moderator'))`);
  await pool.query(`alter table admin_users drop constraint if exists admin_users_wall_id_fkey`);
  await pool.query(`alter table admin_users add constraint admin_users_wall_id_fkey foreign key (wall_id) references walls(id) on delete set null`);

  const existing = await pool.query(`select id from admin_users limit 1`);
  if (existing.rowCount === 0) {
    const configuredInitial = process.env.INITIAL_ADMIN_PASSWORD || '';
    const temporaryPassword = configuredInitial || (process.env.NODE_ENV === 'production'
      ? crypto.randomBytes(18).toString('base64url')
      : 'password');
    await pool.query(
      `insert into admin_users
         (username, display_name, password_hash, role, wall_id, active, must_change_password)
       values ('admin', 'Administrator', $1, 'owner', null, true, true)`,
      [hashAdminPassword(temporaryPassword)],
    );
    if (configuredInitial) {
      console.log('Created the default Main Admin account using INITIAL_ADMIN_PASSWORD. Change it at first login.');
    } else if (process.env.NODE_ENV === 'production') {
      console.log(`Created the default Main Admin account. Temporary password: ${temporaryPassword}`);
      console.log('Change this password immediately after first login.');
    } else {
      console.log('Created the local default Main Admin account (admin/password).');
    }
  }

  // Keep long-running production databases from accumulating expired bearer sessions.
  await pool.query(`delete from admin_sessions where expires_at <= now()`);
  await pool.query(`delete from customer_sessions where expires_at <= now()`);
  await pool.query(`delete from customer_claim_tokens where expires_at <= now() and used_at is not null`);
  console.log('SaidHere database schema is up to date.');
} finally {
  await pool.end();
}
