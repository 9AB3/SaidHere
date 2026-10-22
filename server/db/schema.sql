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
  setup_required boolean not null default false,
  setup_completed_at timestamptz,
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

-- Platform administration. Customer Wall owners do not use this table.
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null default '',
  password_hash text not null,
  role text not null default 'moderator' check (role in ('owner', 'moderator')),
  wall_id uuid references walls(id) on delete set null,
  active boolean not null default true,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text not null default ''
);

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references admin_users(id) on delete set null,
  username_snapshot text not null,
  action text not null,
  wall_id uuid,
  wall_name text,
  target_admin_user_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Customer accounts are separate from platform administrators. A customer can
-- own any number of Walls through wall_ownerships.
create table if not exists customer_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null default '',
  password_hash text,
  active boolean not null default true,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists idx_customer_accounts_email_lower
  on customer_accounts (lower(email));
create unique index if not exists idx_customer_accounts_stripe_customer
  on customer_accounts(stripe_customer_id)
  where stripe_customer_id is not null;

create table if not exists customer_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text not null default ''
);

-- One order represents one Stripe Checkout Session. quantity is the number of
-- physical Wall plaques purchased in that checkout.
create table if not exists commerce_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customer_accounts(id) on delete set null,
  purchaser_email text not null,
  customer_name text,
  shipping_address jsonb,
  status text not null default 'pending' check (status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  quantity integer not null default 1 check (quantity between 1 and 10),
  amount_total integer,
  currency text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  customer_confirmation_sent_at timestamptz,
  customer_confirmation_last_attempt_at timestamptz,
  customer_confirmation_error text,
  customer_confirmation_message_id text,
  customer_confirmation_attempts integer not null default 0,
  owner_notification_sent_at timestamptz,
  owner_notification_last_attempt_at timestamptz,
  owner_notification_error text,
  owner_notification_message_id text,
  owner_notification_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Stripe retries webhook deliveries, sometimes more than once. This ledger lets
-- the backend acknowledge duplicates without processing the same event twice.
-- Only Stripe IDs/types are stored here; the full payment payload is not retained.
create table if not exists stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_object_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create table if not exists commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references commerce_orders(id) on delete cascade,
  ordinal integer not null,
  status text not null default 'awaiting_fulfillment' check (status in ('awaiting_fulfillment', 'fulfilled', 'cancelled')),
  wall_id uuid references walls(id) on delete set null,
  created_at timestamptz not null default now(),
  nfc_assigned_at timestamptz,
  shipped_at timestamptz,
  fulfilled_at timestamptz,
  unique(order_id, ordinal)
);

-- The serial code is printed/engraved on the physical plaque or its packing
-- label. The NFC URL itself remains represented by the hashed wall_tags token.
create table if not exists plaques (
  id uuid primary key default gen_random_uuid(),
  serial_code text not null unique,
  order_item_id uuid unique references commerce_order_items(id) on delete set null,
  wall_id uuid unique references walls(id) on delete set null,
  wall_tag_id uuid unique references wall_tags(id) on delete set null,
  status text not null default 'stock' check (status in ('stock', 'assigned', 'retired')),
  created_at timestamptz not null default now(),
  assigned_at timestamptz
);

-- Ownership is the authority boundary for the customer portal. ended_at lets us
-- retain transfer history while allowing only one current owner per Wall.
create table if not exists wall_ownerships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_accounts(id) on delete cascade,
  wall_id uuid not null references walls(id) on delete cascade,
  order_id uuid references commerce_orders(id) on delete set null,
  plaque_id uuid references plaques(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create unique index if not exists idx_wall_ownerships_current_wall
  on wall_ownerships(wall_id) where ended_at is null;
create index if not exists idx_wall_ownerships_customer_current
  on wall_ownerships(customer_id, started_at desc) where ended_at is null;

-- A paid checkout creates a short-lived one-time account claim link. Once used,
-- the customer sets a password and subsequently signs in at /my-walls.
create table if not exists customer_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer_accounts(id) on delete cascade,
  order_id uuid references commerce_orders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists customer_audit_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customer_accounts(id) on delete set null,
  email_snapshot text not null,
  action text not null,
  wall_id uuid,
  wall_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Deliberately omit indexes already supplied by UNIQUE/PRIMARY KEY constraints.
create index if not exists idx_wall_visits_session on wall_visits(session_id, last_visited_at desc);
create index if not exists idx_wall_posts_wall_created on wall_posts(wall_id, created_at);
create index if not exists idx_wall_posts_author_recent on wall_posts(author_session_id, created_at desc);
create index if not exists idx_wall_posts_parent on wall_posts(parent_id) where parent_id is not null;
create index if not exists idx_post_reports_created on post_reports(created_at desc);
create index if not exists idx_post_reports_reporter_recent on post_reports(reporter_session_id, created_at desc);
create index if not exists idx_admin_users_wall on admin_users(wall_id) where role = 'moderator';
create index if not exists idx_admin_sessions_expiry on admin_sessions(expires_at);
create index if not exists idx_admin_audit_created on admin_audit_log(created_at desc);
create index if not exists idx_admin_audit_user on admin_audit_log(admin_user_id, created_at desc);
create index if not exists idx_customer_sessions_expiry on customer_sessions(expires_at);
create index if not exists idx_commerce_orders_customer on commerce_orders(customer_id, created_at desc);
create index if not exists idx_commerce_orders_status on commerce_orders(status, created_at desc);
create index if not exists idx_stripe_webhook_events_received on stripe_webhook_events(received_at desc);
create index if not exists idx_stripe_webhook_events_unprocessed on stripe_webhook_events(received_at) where processed_at is null;
create index if not exists idx_customer_claim_tokens_customer on customer_claim_tokens(customer_id, created_at desc);
create index if not exists idx_customer_audit_customer on customer_audit_log(customer_id, created_at desc);
