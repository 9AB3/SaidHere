create extension if not exists pgcrypto;

create table if not exists visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists walls (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  location_hint text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists wall_tags (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references walls(id) on delete cascade,
  token_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists wall_visits (
  session_id uuid not null references visitor_sessions(id) on delete cascade,
  wall_id uuid not null references walls(id) on delete cascade,
  first_discovered_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now(),
  write_access_until timestamptz,
  primary key (session_id, wall_id)
);

create table if not exists wall_posts (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references walls(id) on delete cascade,
  parent_id uuid references wall_posts(id) on delete cascade,
  author_session_id uuid not null references visitor_sessions(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  hidden_at timestamptz
);

create table if not exists post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references wall_posts(id) on delete cascade,
  reporter_session_id uuid not null references visitor_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_session_id)
);

create index if not exists idx_wall_tags_token_hash on wall_tags(token_hash) where active = true;
create index if not exists idx_wall_visits_session on wall_visits(session_id, last_visited_at desc);
create index if not exists idx_wall_posts_wall_created on wall_posts(wall_id, created_at);
create index if not exists idx_wall_posts_author_recent on wall_posts(author_session_id, created_at desc);
create index if not exists idx_wall_posts_parent on wall_posts(parent_id) where parent_id is not null;
create index if not exists idx_post_reports_post on post_reports(post_id);
