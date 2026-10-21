import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
import { hashAdminPassword } from '../src/admin_auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

try {
  // Existing databases predate moderator Wall ownership. Add the column before
  // loading schema.sql so indexes that reference it can be created safely.
  await pool.query(`alter table if exists admin_users add column if not exists wall_id uuid`);

  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);

  // Commerce evolved after the first order table was created. Keep the upgrade
  // path idempotent so existing Render Postgres databases gain the fields used
  // by Stripe shipping details, customer confirmations and operational email diagnostics.
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

  // Collapse the old Owner/Admin/Moderator model into Main Admin + Moderator.
  // Any legacy full Admin becomes a Moderator and must be assigned a Wall by the Owner.
  await pool.query(`update admin_users set role = 'moderator' where role = 'admin'`);
  await pool.query(`alter table admin_users drop constraint if exists admin_users_role_check`);
  await pool.query(`alter table admin_users add constraint admin_users_role_check check (role in ('owner', 'moderator'))`);

  // Ensure the ownership column has the same foreign-key behaviour on upgraded DBs.
  await pool.query(`alter table admin_users drop constraint if exists admin_users_wall_id_fkey`);
  await pool.query(`alter table admin_users add constraint admin_users_wall_id_fkey foreign key (wall_id) references walls(id) on delete set null`);

  const existing = await pool.query(`select id from admin_users limit 1`);
  if (existing.rowCount === 0) {
    const passwordHash = hashAdminPassword('password');
    await pool.query(
      `insert into admin_users
         (username, display_name, password_hash, role, wall_id, active, must_change_password)
       values ('admin', 'Administrator', $1, 'owner', null, true, true)`,
      [passwordHash],
    );
    console.log('Created the default Main Admin account.');
  }

  await pool.query(`delete from admin_sessions where expires_at <= now()`);
  console.log('SaidHere database schema is up to date.');
} finally {
  await pool.end();
}
