import { pool } from '../src/db.js';

try {
  await pool.query(`alter table walls add column if not exists setup_required boolean not null default false`);
  await pool.query(`alter table walls add column if not exists setup_completed_at timestamptz`);
  await pool.query(`alter table commerce_order_items add column if not exists nfc_assigned_at timestamptz`);
  await pool.query(`alter table commerce_order_items add column if not exists shipped_at timestamptz`);
  console.log('Plaque first-scan setup and shipping fields are up to date.');
} finally {
  await pool.end();
}
