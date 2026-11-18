-- The reservation/payment engine (lot Diaby). Two guarantees live entirely in these functions,
-- not in app code, because only a single transaction can make them hold under concurrency:
--   1. reserve_seats()   -> never oversell, whatever the number of simultaneous buyers.
--   2. confirm_payment() -> a payment notification delivered twice still issues one ticket batch.

-- Applicable unit price right now, respecting the early tariff cutoff (section 2).
create or replace function current_unit_price(p_ticket_type_id uuid)
returns integer
language plpgsql
as $$
declare
  v_price integer;
  v_early_price integer;
  v_early_ends_at timestamptz;
begin
  select price_cents, early_price_cents, early_ends_at
    into v_price, v_early_price, v_early_ends_at
  from ticket_types
  where id = p_ticket_type_id;

  if v_early_price is not null and v_early_ends_at is not null and now() < v_early_ends_at then
    return v_early_price;
  end if;

  return v_price;
end;
$$;

-- The anti-oversell core (section 3). Attributes p_quantity seats of p_ticket_type_id to a new
-- pending order, or raises 'sold_out' if not enough are free.
--
-- "for update" locks the ticket_type row for the rest of the transaction: every concurrent call
-- for the SAME ticket type queues behind this lock, one at a time, until this transaction commits
-- or rolls back. That serialization — not a check done earlier in app code — is what makes the
-- count-then-insert atomic even at 300 simultaneous clicks on the same "Réserver" button.
create or replace function reserve_seats(
  p_ticket_type_id uuid,
  p_quantity integer,
  p_buyer_email text,
  p_payment_method payment_method
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_type ticket_types%rowtype;
  v_event events%rowtype;
  v_sold integer;
  v_held integer;
  v_available integer;
  v_unit_price integer;
  v_order orders%rowtype;
  v_expires_at timestamptz;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select * into v_ticket_type from ticket_types where id = p_ticket_type_id for update;
  if v_ticket_type is null then
    raise exception 'ticket_type_not_found';
  end if;

  select * into v_event from events where id = v_ticket_type.event_id;
  if v_event.status <> 'on_sale' then
    raise exception 'event_not_on_sale';
  end if;

  if p_payment_method = 'transfer' and v_event.starts_at - now() < interval '7 days' then
    raise exception 'transfer_not_available_this_close';
  end if;

  select coalesce(sum(oi.quantity), 0) into v_sold
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.ticket_type_id = p_ticket_type_id and o.status = 'paid';

  select coalesce(sum(oi.quantity), 0) into v_held
  from order_items oi
  join orders o on o.id = oi.order_id
  where oi.ticket_type_id = p_ticket_type_id
    and o.status = 'pending'
    and o.expires_at > now();

  v_available := v_ticket_type.quantity - v_sold - v_held;

  if v_available < p_quantity then
    raise exception 'sold_out';
  end if;

  v_unit_price := current_unit_price(p_ticket_type_id);
  v_expires_at := case p_payment_method
    when 'card' then now() + interval '15 minutes'
    when 'transfer' then now() + interval '48 hours'
  end;

  insert into orders (event_id, buyer_email, payment_method, status, total_cents, currency, expires_at)
  values (v_ticket_type.event_id, p_buyer_email, p_payment_method, 'pending',
          v_unit_price * p_quantity, v_ticket_type.currency, v_expires_at)
  returning * into v_order;

  insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents)
  values (v_order.id, p_ticket_type_id, p_quantity, v_unit_price);

  return v_order;
end;
$$;

grant execute on function reserve_seats(uuid, integer, text, payment_method) to anon, authenticated;
grant execute on function current_unit_price(uuid) to anon, authenticated;

-- Idempotent payment confirmation (section 5), called from the webhook Edge Function with the
-- provider's own notification id. The unique primary key on payment_events makes a replayed
-- notification a no-op: it never reaches the "issue tickets" step a second time.
create or replace function confirm_payment(
  p_provider_event_id text,
  p_order_id uuid,
  p_payload jsonb
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_inserted integer;
begin
  insert into payment_events (provider_event_id, order_id, payload)
  values (p_provider_event_id, p_order_id, p_payload)
  on conflict (provider_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- This exact notification was already processed: stop here, before touching the order,
    -- so a duplicate webhook delivery never issues a second batch of tickets.
    select * into v_order from orders where id = p_order_id;
    return v_order;
  end if;

  select * into v_order from orders where id = p_order_id for update;

  if v_order.status = 'paid' then
    return v_order; -- paid through another path already; nothing left to do
  end if;

  if v_order.status <> 'pending' then
    raise exception 'order_not_payable: %', v_order.status;
  end if;

  update orders set status = 'paid', paid_at = now()
  where id = p_order_id
  returning * into v_order;

  for v_item in select * from order_items where order_id = p_order_id loop
    insert into tickets (order_item_id)
    select v_item.id from generate_series(1, v_item.quantity);
  end loop;

  return v_order;
end;
$$;

-- Only the service role (the webhook Edge Function, never the mobile app) may confirm a
-- payment — buyers and organizers have no path to mark their own order paid.
revoke all on function confirm_payment(text, uuid, jsonb) from anon, authenticated;

-- Manual virement confirmation by an organizer (section 5: "Marquer comme payé"), kept
-- separate from confirm_payment so the trace of who clicked it is explicit and auditable.
create or replace function mark_order_paid_by_transfer(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_is_organizer boolean;
begin
  select exists (
    select 1 from orders o
    join events e on e.id = o.event_id
    join collective_members m on m.collective_id = e.collective_id
    where o.id = p_order_id and m.user_id = auth.uid()
  ) into v_is_organizer;

  if not v_is_organizer then
    raise exception 'not_authorized';
  end if;

  select * into v_order from orders where id = p_order_id for update;

  if v_order.payment_method <> 'transfer' then
    raise exception 'not_a_transfer_order';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'order_not_payable: %', v_order.status;
  end if;

  update orders
  set status = 'paid', paid_at = now(), marked_paid_by = auth.uid(), marked_paid_at = now()
  where id = p_order_id
  returning * into v_order;

  for v_item in select * from order_items where order_id = p_order_id loop
    insert into tickets (order_item_id)
    select v_item.id from generate_series(1, v_item.quantity);
  end loop;

  return v_order;
end;
$$;

grant execute on function mark_order_paid_by_transfer(uuid) to authenticated;

-- Frees seats held by pending orders whose reservation window passed (section 4). Run this on
-- a schedule — see supabase/README.md — not from the app.
create or replace function expire_stale_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update orders
  set status = 'expired'
  where status = 'pending' and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function expire_stale_reservations() from anon, authenticated;

-- Buyer self-service without an account: the order's access_token (in their email link) is the
-- only credential. This function is the sole read path for it, so RLS on orders/tickets never
-- has to trust a client-supplied filter.
create or replace function get_order_by_token(p_access_token uuid)
returns table (
  order_id uuid,
  event_id uuid,
  status order_status,
  total_cents integer,
  currency text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, event_id, status, total_cents, currency, expires_at
  from orders
  where access_token = p_access_token;
$$;

grant execute on function get_order_by_token(uuid) to anon, authenticated;

-- TODO (lot Diaby, à la suite) : annulation acheteur (libère les places vers la liste
-- d'attente) et l'offre automatique à la liste d'attente quand une place se libère — pas
-- encore câblées ici, pour garder ce premier commit concentré sur anti-survente + paiement.
