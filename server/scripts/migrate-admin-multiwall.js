import { pool } from '../src/db.js';

try {
  await pool.query(`
    create table if not exists admin_wall_assignments (
      admin_user_id uuid not null references admin_users(id) on delete cascade,
      wall_id uuid not null references walls(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (admin_user_id, wall_id)
    )
  `);
  await pool.query(`
    create index if not exists idx_admin_wall_assignments_wall
      on admin_wall_assignments(wall_id, admin_user_id)
  `);

  // Preserve the assignment every existing Moderator already has. admin_users.wall_id
  // remains populated as a legacy/compatibility primary Wall while access control uses
  // the many-to-many assignment table.
  await pool.query(`
    insert into admin_wall_assignments (admin_user_id, wall_id)
    select id, wall_id
      from admin_users
     where role = 'moderator' and wall_id is not null
    on conflict (admin_user_id, wall_id) do nothing
  `);

  // Main Admins always have global access and should not carry scoped assignments.
  await pool.query(`
    delete from admin_wall_assignments a
    using admin_users u
    where u.id = a.admin_user_id and u.role = 'owner'
  `);

  console.log('Moderator multi-Wall assignments are up to date.');
} finally {
  await pool.end();
}
