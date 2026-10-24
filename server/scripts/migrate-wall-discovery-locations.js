import { pool } from '../src/db.js';

try {
  await pool.query(`
    create table if not exists wall_scan_locations (
      id uuid primary key default gen_random_uuid(),
      session_id uuid not null references visitor_sessions(id) on delete cascade,
      wall_id uuid not null references walls(id) on delete cascade,
      latitude double precision not null check (latitude between -90 and 90),
      longitude double precision not null check (longitude between -180 and 180),
      accuracy_metres double precision check (accuracy_metres is null or accuracy_metres between 0 and 5000),
      suburb text not null default '',
      scanned_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    alter table wall_scan_locations
      add column if not exists suburb text not null default ''
  `);
  await pool.query(`
    create index if not exists idx_wall_scan_locations_session_wall_time
      on wall_scan_locations(session_id, wall_id, scanned_at)
  `);
  await pool.query(`
    create index if not exists idx_wall_scan_locations_wall_time
      on wall_scan_locations(wall_id, scanned_at desc)
  `);
  console.log('Wall discovery location schema is up to date.');
} finally {
  await pool.end();
}
