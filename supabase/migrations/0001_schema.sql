-- Core schema: collectives, events, ticket types, orders, tickets, payment dedup, waitlist.
-- Multi-tenant isolation (section 8 du cahier des charges) is enforced by Postgres RLS below,
-- not by application code, so a bug in one screen can't leak another collective's numbers.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create type event_status as enum ('draft', 'on_sale', 'sold_out', 'completed', 'cancelled');
create type order_status as enum ('pending', 'paid', 'expired', 'cancelled', 'refunded');
create type payment_method as enum ('card', 'transfer');
create type ticket_status as enum ('valid', 'cancelled', 'used');
create type waitlist_status as enum ('waiting', 'offered', 'expired', 'converted', 'removed');

create table collectives (
  
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Links a Supabase auth user to a collective as an organizer (role "organisateur" / "admin").
create table collective_members (
  collective_id uuid not null references collectives(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'organizer',
  created_at timestamptz not null default now(),
  primary key (collective_id, user_id)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  collective_id uuid not null references collectives(id) on delete cascade,
  name text not null,
  venue text,
  is_online boolean not null default false,
  timezone text not null default 'Europe/Paris',
  starts_at timestamptz not null,
  doors_at timestamptz,
  cancel_deadline_at timestamptz,
  status event_status not null default 'draft',
  created_at timestamptz not null default now()
);

create index events_collective_id_idx on events(collective_id);

create table ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  quantity integer not null check (quantity >= 0),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR',
  early_price_cents integer check (early_price_cents >= 0),
  early_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index ticket_types_event_id_idx on ticket_types(event_id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  access_token uuid not null default gen_random_uuid(), -- the buyer's personal link, never the primary key
  event_id uuid not null references events(id),
  buyer_email text not null,
  payment_method payment_method not null,
  status order_status not null default 'pending',
  total_cents integer not null default 0,
  currency text not null default 'EUR',
  payment_provider_id text unique, -- set once the provider confirms payment
  marked_paid_by uuid references auth.users(id), -- virement confirmé manuellement par un organisateur
  marked_paid_at timestamptz,
  expires_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index orders_access_token_idx on orders(access_token);
create index orders_event_id_idx on orders(event_id);
create index orders_status_expires_idx on orders(status, expires_at); -- scanned by the expiry sweep

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  ticket_type_id uuid not null references ticket_types(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0), -- price snapshot at reservation time
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on order_items(order_id);
create index order_items_ticket_type_id_idx on order_items(ticket_type_id);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  qr_code uuid not null default gen_random_uuid(),
  status ticket_status not null default 'valid',
  used_at timestamptz,
  scanned_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index tickets_qr_code_idx on tickets(qr_code);
create index tickets_order_item_id_idx on tickets(order_item_id);

-- Idempotency ledger for the payment provider's webhook: one row per notification id, so a
-- notification delivered twice is a no-op the second time (see confirm_payment in the next migration).
create table payment_events (
  provider_event_id text primary key,
  order_id uuid references orders(id),
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  ticket_type_id uuid not null references ticket_types(id),
  email text not null,
  quantity_requested integer not null check (quantity_requested > 0),
  status waitlist_status not null default 'waiting',
  position integer not null, -- insertion order within (ticket_type_id)
  offered_order_id uuid references orders(id),
  response_deadline_at timestamptz,
  created_at timestamptz not null default now()
);

create index waitlist_ticket_type_position_idx on waitlist_entries(ticket_type_id, position);

-- Row Level Security: a collective never sees another collective's events, buyers, or money.
alter table events enable row level security;
alter table ticket_types enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table tickets enable row level security;
alter table waitlist_entries enable row level security;
alter table collective_members enable row level security;

-- Anyone (anon) can browse published events and their ticket types, to buy.
create policy "public can read published events"
  on events for select
  using (status in ('on_sale', 'sold_out', 'completed'));

create policy "public can read ticket types of published events"
  on ticket_types for select
  using (exists (
    select 1 from events e
    where e.id = ticket_types.event_id
      and e.status in ('on_sale', 'sold_out', 'completed')
  ));

-- Organizers manage only their own collective's data.
create policy "organizers manage their events"
  on events for all
  using (exists (
    select 1 from collective_members m
    where m.collective_id = events.collective_id and m.user_id = auth.uid()
  ));

create policy "organizers manage their ticket types"
  on ticket_types for all
  using (exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = ticket_types.event_id and m.user_id = auth.uid()
  ));

create policy "organizers read their orders"
  on orders for select
  using (exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = orders.event_id and m.user_id = auth.uid()
  ));

create policy "organizers update their orders"
  on orders for update
  using (exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = orders.event_id and m.user_id = auth.uid()
  ));

create policy "organizers read their order items"
  on order_items for select
  using (exists (
    select 1 from orders o
    join events e on e.id = o.event_id
    join collective_members m on m.collective_id = e.collective_id
    where o.id = order_items.order_id and m.user_id = auth.uid()
  ));

create policy "organizers read their tickets"
  on tickets for select
  using (exists (
    select 1 from order_items oi
    join orders o on o.id = oi.order_id
    join events e on e.id = o.event_id
    join collective_members m on m.collective_id = e.collective_id
    where oi.id = tickets.order_item_id and m.user_id = auth.uid()
  ));

create policy "organizers manage their waitlist"
  on waitlist_entries for all
  using (exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = waitlist_entries.event_id and m.user_id = auth.uid()
  ));

create policy "members see their own membership"
  on collective_members for select
  using (user_id = auth.uid());

-- No insert/update policy is defined for orders/order_items/tickets beyond the above on purpose:
-- RLS defaults to deny, so the only way to create them is through the security-definer functions
-- in 0002_reservation_engine.sql. The app never inserts an order directly.
