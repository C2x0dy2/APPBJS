-- Bascule vers un modèle de compte obligatoire (décision du 2026-11-18) : l'app React de Divine exige une
-- connexion acheteur ET organisateur (Supabase Auth gère nativement inscription/connexion/vérification email/mot de
-- passe oublié, donc rien à écrire côté serveur pour ça). Ce fichier adapte le moteur de Bintou en conséquence :
--   1. rôles organisateur à trois niveaux (admin/manager/controller), au lieu d'un rôle texte libre
--   2. les commandes sont liées à un compte (user_id), plus seulement à un access_token anonyme
--   3. reserve_seats() accepte plusieurs types de place dans UNE commande (l'app en envoie plusieurs à la fois)
--   4. RPC pour "mes billets" / "mes réservations" par compte, et pour le tableau de bord organisateur (chiffres
--      réels, demandés par le cahier des charges : "on ne sait jamais en temps réel combien on a vendu")

-- ====================================================================================== rôles organisateur
create type collective_role as enum ('admin', 'manager', 'controller');

alter table collective_members
  alter column role drop default,
  alter column role type collective_role using (case role when 'organizer' then 'manager' else 'manager' end)::collective_role,
  alter column role set default 'manager';

-- ====================================================================================== comptes acheteurs
alter table orders
  add column user_id uuid references auth.users(id);

create index orders_user_id_idx on orders(user_id);

alter table events
  add column slug text;

update events set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 8)
where slug is null;

alter table events
  alter column slug set not null,
  add constraint events_slug_unique unique (slug);

-- ====================================================================================== réservation multi-types
-- Remplace reserve_seats (un seul type de place par appel) : l'app envoie maintenant plusieurs lignes dans une
-- seule commande ("items": [{ticketTypeId, quantity}, ...]), comme pour n'importe quel panier. Le tri par id évite
-- les blocages (deadlocks) entre deux commandes concurrentes qui demandent les mêmes types dans un ordre différent.
create or replace function reserve_seats_multi(
  p_event_id uuid,
  p_items jsonb, -- [{"ticket_type_id": "...", "quantity": 2}, ...]
  p_payment_method payment_method
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_buyer_email text;
  v_event events%rowtype;
  v_ticket_type ticket_types%rowtype;
  v_item jsonb;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_sold integer;
  v_held integer;
  v_available integer;
  v_unit_price integer;
  v_order orders%rowtype;
  v_expires_at timestamptz;
  v_total integer := 0;
  v_sorted_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select email into v_buyer_email from auth.users where id = v_user_id;

  select * into v_event from events where id = p_event_id;
  if v_event is null or v_event.status <> 'on_sale' then
    raise exception 'event_not_on_sale';
  end if;

  if p_payment_method = 'transfer' and v_event.starts_at - now() < interval '7 days' then
    raise exception 'transfer_not_available_this_close';
  end if;

  v_expires_at := case p_payment_method
    when 'card' then now() + interval '15 minutes'
    when 'transfer' then now() + interval '48 hours'
  end;

  insert into orders (event_id, buyer_email, payment_method, status, total_cents, currency, expires_at, user_id)
  values (p_event_id, v_buyer_email, p_payment_method, 'pending', 0, v_event.timezone, v_expires_at, v_user_id)
  returning * into v_order;

  -- Tri fixe des types de place demandés : deux commandes concurrentes qui veulent les mêmes catégories dans un
  -- ordre différent se mettent en file l'une derrière l'autre au lieu de se bloquer mutuellement (deadlock).
  select array_agg(distinct (item->>'ticket_type_id')::uuid order by (item->>'ticket_type_id')::uuid)
    into v_sorted_ids
  from jsonb_array_elements(p_items) as item;

  for v_ticket_type_id in select unnest(v_sorted_ids) loop
    v_item := (select item from jsonb_array_elements(p_items) as item where (item->>'ticket_type_id')::uuid = v_ticket_type_id limit 1);
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'invalid_quantity';
    end if;

    select * into v_ticket_type from ticket_types where id = v_ticket_type_id and event_id = p_event_id for update;
    if v_ticket_type is null then
      raise exception 'ticket_type_not_found';
    end if;

    select coalesce(sum(oi.quantity), 0) into v_sold
    from order_items oi join orders o on o.id = oi.order_id
    where oi.ticket_type_id = v_ticket_type_id and o.status = 'paid';

    select coalesce(sum(oi.quantity), 0) into v_held
    from order_items oi join orders o on o.id = oi.order_id
    where oi.ticket_type_id = v_ticket_type_id and o.status = 'pending' and o.expires_at > now();

    v_available := v_ticket_type.quantity - v_sold - v_held;
    if v_available < v_quantity then
      raise exception 'sold_out: %', v_ticket_type_id;
    end if;

    v_unit_price := current_unit_price(v_ticket_type_id);
    insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents)
    values (v_order.id, v_ticket_type_id, v_quantity, v_unit_price);
    v_total := v_total + v_unit_price * v_quantity;
  end loop;

  update orders set total_cents = v_total, currency = v_ticket_type.currency where id = v_order.id returning * into v_order;
  return v_order;
end;
$$;

grant execute on function reserve_seats_multi(uuid, jsonb, payment_method) to authenticated;

-- ====================================================================================== mes billets / réservations
create or replace function get_my_tickets()
returns table (ticket_id uuid, qr_code uuid, ticket_status ticket_status, used_at timestamptz,
               event_id uuid, ticket_type_id uuid, order_id uuid)
language sql
security definer
set search_path = public
as $$
  select t.id, t.qr_code, t.status, t.used_at, o.event_id, oi.ticket_type_id, o.id
  from tickets t
  join order_items oi on oi.id = t.order_item_id
  join orders o on o.id = oi.order_id
  where o.user_id = auth.uid()
  order by o.created_at desc;
$$;

grant execute on function get_my_tickets() to authenticated;

create or replace function get_my_pending_orders()
returns table (order_id uuid, event_id uuid, expires_at timestamptz, payment_method payment_method,
               currency text, total_cents integer, ticket_type_id uuid, quantity integer, unit_price_cents integer)
language sql
security definer
set search_path = public
as $$
  select o.id, o.event_id, o.expires_at, o.payment_method, o.currency, o.total_cents,
         oi.ticket_type_id, oi.quantity, oi.unit_price_cents
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.user_id = auth.uid() and o.status = 'pending' and o.expires_at > now()
  order by o.expires_at asc;
$$;

grant execute on function get_my_pending_orders() to authenticated;

-- ====================================================================================== tableau de bord organisateur
-- Un seul aller-retour : l'app affiche vente/encaissement en temps réel par type de place (cahier des charges).
create or replace function get_event_stats(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_organizer boolean;
  v_result jsonb;
begin
  select exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = p_event_id and m.user_id = auth.uid()
  ) into v_is_organizer;

  if not v_is_organizer then
    raise exception 'not_authorized';
  end if;

  with par_type as (
    select
      tt.id as ticket_type_id,
      coalesce(sum(oi.quantity) filter (where o.status = 'paid' and o.refunded_cents < o.total_cents), 0) as sold,
      coalesce(sum(oi.quantity) filter (where o.status = 'pending' and o.expires_at > now()), 0) as held,
      coalesce(sum(oi.quantity * oi.unit_price_cents) filter (where o.status = 'paid' and o.refunded_cents < o.total_cents), 0) as revenue,
      tt.quantity as capacity
    from ticket_types tt
    left join order_items oi on oi.ticket_type_id = tt.id
    left join orders o on o.id = oi.order_id
    where tt.event_id = p_event_id
    group by tt.id, tt.quantity
  ),
  refunds as (
    select count(*) as n, coalesce(sum(refunded_cents), 0) as amount
    from orders where event_id = p_event_id and refunded_cents > 0
  ),
  daily as (
    select to_char(d::date, 'YYYY-MM-DD') as date, coalesce(sum(oi.quantity), 0) as tickets
    from generate_series(current_date - interval '13 days', current_date, interval '1 day') d
    left join orders o on o.event_id = p_event_id and o.status = 'paid' and o.paid_at::date = d::date
    left join order_items oi on oi.order_id = o.id
    group by d
    order by d
  )
  select jsonb_build_object(
    'types', (select jsonb_agg(jsonb_build_object(
      'ticketTypeId', ticket_type_id, 'sold', sold, 'held', held,
      'free', greatest(capacity - sold - held, 0), 'revenue', revenue
    )) from par_type),
    'totals', (select jsonb_build_object(
      'capacity', coalesce(sum(capacity), 0), 'sold', coalesce(sum(sold), 0),
      'held', coalesce(sum(held), 0), 'free', coalesce(sum(greatest(capacity - sold - held, 0)), 0),
      'revenue', coalesce(sum(revenue), 0)
    ) from par_type),
    'refunds', (select jsonb_build_object('count', n, 'amount', amount) from refunds),
    'entriesScanned', (select count(*) from tickets t join order_items oi on oi.id = t.order_item_id
                        join orders o on o.id = oi.order_id where o.event_id = p_event_id and t.status = 'used'),
    'daily', (select jsonb_agg(jsonb_build_object('date', date, 'tickets', tickets)) from daily)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function get_event_stats(uuid) to authenticated;

-- Le total du collectif, une ligne par monnaie (jamais additionner deux devises différentes).
create or replace function get_collective_summary(p_collective_id uuid)
returns table (currency text, revenue bigint, sold bigint, refund_count bigint, refund_amount bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
begin
  select exists (select 1 from collective_members where collective_id = p_collective_id and user_id = auth.uid())
    into v_is_member;
  if not v_is_member then
    raise exception 'not_authorized';
  end if;

  return query
  select o.currency,
         coalesce(sum(oi.quantity * oi.unit_price_cents) filter (where o.status = 'paid'), 0)::bigint,
         coalesce(sum(oi.quantity) filter (where o.status = 'paid'), 0)::bigint,
         count(distinct o.id) filter (where o.refunded_cents > 0)::bigint,
         coalesce(sum(o.refunded_cents) filter (where o.refunded_cents > 0), 0)::bigint
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.event_id in (select id from events where collective_id = p_collective_id)
  group by o.currency;
end;
$$;

grant execute on function get_collective_summary(uuid) to authenticated;

-- ====================================================================================== infos du site (public)
create table site_settings (
  id integer primary key default 1 check (id = 1), -- une seule ligne (singleton)
  name text,
  contact_email text,
  contact_phone text,
  max_tickets_per_order integer not null default 10,
  default_currency text not null default 'EUR',
  default_timezone text not null default 'Europe/Paris'
);
insert into site_settings (id) values (1);
alter table site_settings enable row level security;
create policy "public reads site settings" on site_settings for select using (true);

create table legal_pages (
  slug text primary key,
  title text not null,
  content text not null default '',
  published boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table legal_pages enable row level security;
create policy "public reads published legal pages" on legal_pages for select using (published);
