import { pool } from '../src/db.js';

try {
  await pool.query(`
    create table if not exists wall_visit_events (
      id uuid primary key default gen_random_uuid(),
      wall_id uuid not null references walls(id) on delete cascade,
      session_id uuid references visitor_sessions(id) on delete set null,
      visited_at timestamptz not null default now()
    )
  `);
  await pool.query(`
    create index if not exists idx_wall_visit_events_wall_time
      on wall_visit_events(wall_id, visited_at desc)
  `);

  // wall_visits is inserted or updated every time a valid NFC tag is opened. A
  // trigger gives analytics a true scan/event history without changing the app API
  // transaction or the existing per-session visit summary table.
  await pool.query(`
    create or replace function log_wall_visit_event()
    returns trigger
    language plpgsql
    as $$
    begin
      insert into wall_visit_events (wall_id, session_id, visited_at)
      values (new.wall_id, new.session_id, new.last_visited_at);
      return new;
    end;
    $$
  `);
  await pool.query(`drop trigger if exists trg_log_wall_visit_event on wall_visits`);
  await pool.query(`
    create trigger trg_log_wall_visit_event
    after insert or update of last_visited_at on wall_visits
    for each row execute function log_wall_visit_event()
  `);

  console.log('Wall analytics scan tracking is ready.');
} finally {
  await pool.end();
}
