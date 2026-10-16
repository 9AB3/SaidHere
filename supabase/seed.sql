-- Optional local/demo data. Do not use these tokens on a production plaque.
insert into public.walls (id, slug, display_name, location_hint)
values ('11111111-1111-1111-1111-111111111111', 'DEMO2026', 'THE WALL', 'Somewhere in Newcastle')
on conflict (id) do nothing;

insert into public.wall_tags (wall_id, tag_token)
values ('11111111-1111-1111-1111-111111111111', 'demo-newcastle-wall-2026')
on conflict (tag_token) do nothing;
