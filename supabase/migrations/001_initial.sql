-- SaidHere MVP schema
-- Apply this migration to a Supabase project, then enable Anonymous Sign-Ins.

create extension if not exists pgcrypto;

create table if not exists public.walls (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null default 'THE WALL',
  location_hint text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wall_tags (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references public.walls(id) on delete cascade,
  tag_token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.wall_discoveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  wall_id uuid not null references public.walls(id) on delete cascade,
  first_discovered_at timestamptz not null default now(),
  last_visited_at timestamptz not null default now(),
  primary key (user_id, wall_id)
);

create table if not exists public.wall_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wall_id uuid not null references public.walls(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > started_at)
);

create table if not exists public.wall_posts (
  id uuid primary key default gen_random_uuid(),
  wall_id uuid not null references public.walls(id) on delete cascade,
  parent_id uuid references public.wall_posts(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  constraint wall_posts_body_length check (char_length(btrim(body)) between 1 and 300)
);

create table if not exists public.post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.wall_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);

create index if not exists wall_tags_token_idx on public.wall_tags(tag_token);
create index if not exists wall_discoveries_user_idx on public.wall_discoveries(user_id, last_visited_at desc);
create index if not exists wall_visits_user_wall_idx on public.wall_visits(user_id, wall_id, expires_at desc);
create index if not exists wall_posts_wall_created_idx on public.wall_posts(wall_id, created_at);
create index if not exists wall_posts_parent_idx on public.wall_posts(parent_id);
create index if not exists post_reports_post_idx on public.post_reports(post_id);

alter table public.walls enable row level security;
alter table public.wall_tags enable row level security;
alter table public.wall_discoveries enable row level security;
alter table public.wall_visits enable row level security;
alter table public.wall_posts enable row level security;
alter table public.post_reports enable row level security;

create policy "discovered walls are readable"
on public.walls for select to authenticated
using (exists (select 1 from public.wall_discoveries d where d.wall_id = walls.id and d.user_id = auth.uid()));

create policy "own discoveries are readable"
on public.wall_discoveries for select to authenticated
using (user_id = auth.uid());

create policy "own visits are readable"
on public.wall_visits for select to authenticated
using (user_id = auth.uid());

create policy "discovered visible posts are readable"
on public.wall_posts for select to authenticated
using (
  hidden = false
  and exists (select 1 from public.wall_discoveries d where d.wall_id = wall_posts.wall_id and d.user_id = auth.uid())
);

create policy "own reports are readable"
on public.post_reports for select to authenticated
using (reporter_id = auth.uid());

-- Clients use only curated RPCs and the public post projection.
revoke all on table public.wall_tags from anon, authenticated;
revoke all on table public.walls from anon, authenticated;
revoke all on table public.wall_discoveries from anon, authenticated;
revoke all on table public.wall_visits from anon, authenticated;
revoke all on table public.wall_posts from anon, authenticated;
revoke all on table public.post_reports from anon, authenticated;

create or replace view public.visible_wall_posts
with (security_barrier = true)
as
select
  p.id,
  p.wall_id,
  p.parent_id,
  p.body,
  p.created_at,
  (select count(*)::integer from public.wall_posts child where child.parent_id = p.id and child.hidden = false) as reply_count
from public.wall_posts p
where p.hidden = false
  and exists (
    select 1 from public.wall_discoveries d
    where d.wall_id = p.wall_id and d.user_id = auth.uid()
  );

revoke all on public.visible_wall_posts from anon;
grant select on public.visible_wall_posts to authenticated;

create or replace function public.claim_wall_visit(p_tag_token text)
returns table (
  id uuid,
  slug text,
  display_name text,
  location_hint text,
  first_discovered_at timestamptz,
  last_visited_at timestamptz,
  write_access_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wall public.walls%rowtype;
  v_expiry timestamptz := now() + interval '15 minutes';
  v_first timestamptz;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select w.* into v_wall
  from public.wall_tags t
  join public.walls w on w.id = t.wall_id
  where t.tag_token = p_tag_token and t.is_active = true and w.is_active = true
  limit 1;

  if v_wall.id is null then raise exception 'Plaque not found or inactive'; end if;

  insert into public.wall_discoveries(user_id, wall_id)
  values (v_uid, v_wall.id)
  on conflict (user_id, wall_id) do update set last_visited_at = now();

  select d.first_discovered_at into v_first
  from public.wall_discoveries d
  where d.user_id = v_uid and d.wall_id = v_wall.id;

  delete from public.wall_visits
  where user_id = v_uid and wall_id = v_wall.id and expires_at < now() - interval '1 day';

  insert into public.wall_visits(user_id, wall_id, expires_at)
  values (v_uid, v_wall.id, v_expiry);

  return query
  select v_wall.id, v_wall.slug, v_wall.display_name, v_wall.location_hint, v_first, now(), v_expiry;
end;
$$;

create or replace function public.get_discovered_wall(p_slug text)
returns table (
  id uuid,
  slug text,
  display_name text,
  location_hint text,
  first_discovered_at timestamptz,
  last_visited_at timestamptz,
  write_access_until timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    w.id, w.slug, w.display_name, w.location_hint,
    d.first_discovered_at, d.last_visited_at,
    (select max(v.expires_at) from public.wall_visits v where v.user_id = auth.uid() and v.wall_id = w.id and v.expires_at > now())
  from public.walls w
  join public.wall_discoveries d on d.wall_id = w.id and d.user_id = auth.uid()
  where w.slug = p_slug and w.is_active = true
  limit 1;
$$;

create or replace function public.get_my_walls()
returns table (
  id uuid,
  slug text,
  display_name text,
  location_hint text,
  first_discovered_at timestamptz,
  last_visited_at timestamptz,
  write_access_until timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    w.id, w.slug, w.display_name, w.location_hint,
    d.first_discovered_at, d.last_visited_at,
    (select max(v.expires_at) from public.wall_visits v where v.user_id = auth.uid() and v.wall_id = w.id and v.expires_at > now())
  from public.wall_discoveries d
  join public.walls w on w.id = d.wall_id
  where d.user_id = auth.uid() and w.is_active = true
  order by d.last_visited_at desc;
$$;

create or replace function public.create_wall_post(
  p_wall_id uuid,
  p_body text,
  p_parent_id uuid default null
)
returns table (
  id uuid,
  wall_id uuid,
  parent_id uuid,
  body text,
  created_at timestamptz,
  reply_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(p_body);
  v_post public.wall_posts%rowtype;
  v_parent public.wall_posts%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 300 then
    raise exception 'Messages must be between 1 and 300 characters';
  end if;

  if (select count(*) from public.wall_posts p where p.author_id = v_uid and p.created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many messages. Try again in a minute.';
  end if;
  if (select count(*) from public.wall_posts p where p.author_id = v_uid and p.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Posting limit reached. Try again later.';
  end if;

  if not exists (select 1 from public.wall_discoveries d where d.user_id = v_uid and d.wall_id = p_wall_id) then
    raise exception 'Wall has not been discovered';
  end if;

  if not exists (
    select 1 from public.wall_visits v
    where v.user_id = v_uid and v.wall_id = p_wall_id and v.expires_at > now()
  ) then
    raise exception 'Writing access has expired. Tap the plaque again in person.';
  end if;

  if p_parent_id is not null then
    select p.* into v_parent
    from public.wall_posts p
    where p.id = p_parent_id and p.wall_id = p_wall_id and p.hidden = false;
    if v_parent.id is null then raise exception 'Reply target was not found'; end if;
    if v_parent.parent_id is not null then raise exception 'Replies are limited to one level'; end if;
  end if;

  insert into public.wall_posts(wall_id, parent_id, author_id, body)
  values (p_wall_id, p_parent_id, v_uid, v_body)
  returning * into v_post;

  return query select v_post.id, v_post.wall_id, v_post.parent_id, v_post.body, v_post.created_at, 0::integer;
end;
$$;

create or replace function public.report_wall_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_wall_id uuid;
  v_reports integer;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select p.wall_id into v_wall_id
  from public.wall_posts p
  where p.id = p_post_id and p.hidden = false;
  if v_wall_id is null then return; end if;

  if not exists (select 1 from public.wall_discoveries d where d.user_id = v_uid and d.wall_id = v_wall_id) then
    raise exception 'Wall has not been discovered';
  end if;

  insert into public.post_reports(post_id, reporter_id)
  values (p_post_id, v_uid)
  on conflict (post_id, reporter_id) do nothing;

  select count(*)::integer into v_reports from public.post_reports r where r.post_id = p_post_id;
  if v_reports >= 3 then update public.wall_posts set hidden = true where id = p_post_id; end if;
end;
$$;

create or replace function public.admin_create_wall(
  p_display_name text,
  p_location_hint text default '',
  p_host text default 'saidhere.app'
)
returns table (wall_id uuid, slug text, tag_token text, nfc_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wall_id uuid := gen_random_uuid();
  v_slug text := substring(upper(replace(gen_random_uuid()::text, '-', '')) from 1 for 8);
  v_token text := encode(gen_random_bytes(24), 'hex');
begin
  insert into public.walls(id, slug, display_name, location_hint)
  values (v_wall_id, v_slug, coalesce(nullif(btrim(p_display_name), ''), 'THE WALL'), coalesce(p_location_hint, ''));
  insert into public.wall_tags(wall_id, tag_token) values (v_wall_id, v_token);
  return query select v_wall_id, v_slug, v_token, 'https://' || p_host || '/t/' || v_token;
end;
$$;

revoke all on function public.claim_wall_visit(text) from public;
revoke all on function public.get_discovered_wall(text) from public;
revoke all on function public.get_my_walls() from public;
revoke all on function public.create_wall_post(uuid, text, uuid) from public;
revoke all on function public.report_wall_post(uuid) from public;
revoke all on function public.admin_create_wall(text, text, text) from public, anon, authenticated;

grant execute on function public.claim_wall_visit(text) to authenticated;
grant execute on function public.get_discovered_wall(text) to authenticated;
grant execute on function public.get_my_walls() to authenticated;
grant execute on function public.create_wall_post(uuid, text, uuid) to authenticated;
grant execute on function public.report_wall_post(uuid) to authenticated;
