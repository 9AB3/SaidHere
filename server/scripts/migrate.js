import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashAdminPassword } from '../src/admin_auth.js';
import { pool } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'db', 'schema.sql');

try {
  // Existing databases predate moderator Wall ownership and automatic purchase
  // reservations. Add columns referenced by schema indexes before loading schema.sql.
  await pool.query(`alter table if exists admin_users add column if not exists wall_id uuid`);
  await pool.query(`alter table if exists commerce_order_items add column if not exists reserved_wall_id uuid`);

  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);

  // Keep upgrades idempotent for existing Render databases. These columns also
  // live in schema.sql so new databases and upgraded databases share one model.
  await pool.query(`alter table walls add column if not exists setup_required boolean not null default false`);
  await pool.query(`alter table walls add column if not exists setup_completed_at timestamptz`);

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

  await pool.query(`alter table commerce_order_items add column if not exists nfc_assigned_at timestamptz`);
  await pool.query(`alter table commerce_order_items add column if not exists shipped_at timestamptz`);
  // Fulfilment needs to remember the exact NDEF value until the physical tag is
  // written, and track that physical tagging separately from shipping.
  await pool.query(`alter table commerce_order_items add column if not exists nfc_write_value text`);
  await pool.query(`alter table commerce_order_items add column if not exists tagged_at timestamptz`);

  // Normalize the old admin role and, importantly, fix the legacy default of
  // 'admin', which conflicts with the current owner/moderator check constraint.
  await pool.query(`update admin_users set role = 'moderator' where role = 'admin'`);
  await pool.query(`alter table admin_users alter column role set default 'moderator'`);
  await pool.query(`alter table admin_users drop constraint if exists admin_users_role_check`);
  await pool.query(`alter table admin_users add constraint admin_users_role_check check (role in ('owner', 'moderator'))`);
  await pool.query(`alter table admin_users drop constraint if exists admin_users_wall_id_fkey`);
  await pool.query(`alter table admin_users add constraint admin_users_wall_id_fkey foreign key (wall_id) references walls(id) on delete set null`);

  // Checkout only permits 1-10 physical Walls. Tighten the database constraint
  // when historical data already fits the current rule. If legacy data is outside
  // that range, leave its existing constraint untouched so old orders remain editable.
  const oversizedOrders = await pool.query(`select count(*)::int as count from commerce_orders where quantity < 1 or quantity > 10`);
  if (oversizedOrders.rows[0].count === 0) {
    await pool.query(`alter table commerce_orders drop constraint if exists commerce_orders_quantity_check`);
    await pool.query(`alter table commerce_orders add constraint commerce_orders_quantity_check check (quantity between 1 and 10)`);
  } else {
    console.warn(`Found ${oversizedOrders.rows[0].count} historical order(s) outside the current 1-10 quantity rule; their existing quantity constraint was left unchanged so those orders remain editable.`);
  }

  // Remove indexes that duplicate PRIMARY KEY/UNIQUE indexes and add the index
  // actually needed by the per-reporter moderation rate-limit query.
  await pool.query(`drop index if exists idx_wall_tags_token_hash`);
  await pool.query(`drop index if exists idx_post_reports_post`);
  await pool.query(`drop index if exists idx_admin_sessions_token_hash`);
  await pool.query(`drop index if exists idx_customer_sessions_token_hash`);
  await pool.query(`drop index if exists idx_commerce_order_items_order`);
  await pool.query(`create index if not exists idx_post_reports_reporter_recent on post_reports(reporter_session_id, created_at desc)`);

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

  // Keep long-running production databases from accumulating expired auth and
  // one-time fulfilment state.
  await pool.query(`delete from admin_sessions where expires_at <= now()`);
  await pool.query(`delete from customer_sessions where expires_at <= now()`);
  await pool.query(`delete from customer_claim_tokens where expires_at <= now()`);
  await pool.query(`delete from customer_password_reset_tokens where expires_at <= now()`);
  await pool.query(`delete from nfc_write_receipts where expires_at <= now()`);
  console.log('SaidHere database schema is up to date.');
} finally {
  await pool.end();
}
