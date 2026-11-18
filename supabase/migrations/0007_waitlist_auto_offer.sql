-- Automatic waitlist offers (section 6): when a seat frees up, offer it to the next person in
-- line instead of just putting it back on sale. "Frees up" means a pending order expiring —
-- either an ordinary reservation, or a previous waitlist offer nobody paid for in time.

-- Offers the next waiting entry for a ticket type, if (and only if) enough seats are free to
-- cover its full requested quantity. Does nothing if nobody is waiting or there isn't enough
-- room yet — partial offers are a product decision not yet made (see cahier des charges §6).
create or replace function offer_next_waitlist_entry(p_ticket_type_id uuid)
returns waitlist_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket_type ticket_types%rowtype;
  v_event events%rowtype;
  v_entry waitlist_entries%rowtype;
  v_sold integer;
  v_held integer;
  v_available integer;
  v_unit_price integer;
  v_order orders%rowtype;
  v_deadline timestamptz;
begin
  select * into v_ticket_type from ticket_types where id = p_ticket_type_id for update;
  if v_ticket_type is null then
    return null;
  end if;

  select * into v_event from events where id = v_ticket_type.event_id;

  select * into v_entry
  from waitlist_entries
  where ticket_type_id = p_ticket_type_id and status = 'waiting'
  order by position asc
  limit 1
  for update;

  if v_entry is null then
    return null;
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

  if v_available < v_entry.quantity_requested then
    return null;
  end if;

  v_unit_price := current_unit_price(p_ticket_type_id);
  -- Délai de réponse : 12h normalement, réduit à 2h dans les 48h avant l'événement.
  v_deadline := case
    when v_event.starts_at - now() < interval '48 hours' then now() + interval '2 hours'
    else now() + interval '12 hours'
  end;

  insert into orders (event_id, buyer_email, payment_method, status, total_cents, currency, expires_at)
  values (v_ticket_type.event_id, v_entry.email, 'card', 'pending',
          v_unit_price * v_entry.quantity_requested, v_ticket_type.currency, v_deadline)
  returning * into v_order;

  insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents)
  values (v_order.id, p_ticket_type_id, v_entry.quantity_requested, v_unit_price);

  update waitlist_entries
  set status = 'offered', offered_order_id = v_order.id, response_deadline_at = v_deadline
  where id = v_entry.id
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke execute on function offer_next_waitlist_entry(uuid) from public;

-- expire_stale_reservations now also: expires waitlist offers nobody paid in time, and triggers
-- the next offer for every ticket type a seat just freed up on (ordinary expiry or offer expiry).
create or replace function expire_stale_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_ticket_type_ids uuid[];
  v_ticket_type_id uuid;
  v_expiring_order_ids uuid[];
begin
  select array_agg(id) into v_expiring_order_ids
  from orders
  where status = 'pending' and expires_at <= now();

  if v_expiring_order_ids is null then
    return 0;
  end if;

  select array_agg(distinct oi.ticket_type_id) into v_ticket_type_ids
  from order_items oi
  where oi.order_id = any(v_expiring_order_ids);

  update waitlist_entries
  set status = 'expired'
  where status = 'offered' and offered_order_id = any(v_expiring_order_ids);

  update orders
  set status = 'expired'
  where id = any(v_expiring_order_ids);

  get diagnostics v_count = row_count;

  foreach v_ticket_type_id in array v_ticket_type_ids loop
    perform offer_next_waitlist_entry(v_ticket_type_id);
  end loop;

  return v_count;
end;
$$;

revoke execute on function expire_stale_reservations() from public;

-- Public (anon) insert for joining a waitlist: position = count of existing entries for that
-- ticket type so far, keeping arrival order.
create or replace function join_waitlist(
  p_ticket_type_id uuid,
  p_email text,
  p_quantity_requested integer
)
returns waitlist_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_position integer;
  v_entry waitlist_entries%rowtype;
  v_ticket_type ticket_types%rowtype;
begin
  select * into v_ticket_type from ticket_types where id = p_ticket_type_id;
  if v_ticket_type is null then
    raise exception 'ticket_type_not_found';
  end if;

  if p_quantity_requested is null or p_quantity_requested <= 0 then
    raise exception 'invalid_quantity';
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position
  from waitlist_entries
  where ticket_type_id = p_ticket_type_id;

  insert into waitlist_entries (event_id, ticket_type_id, email, quantity_requested, position)
  values (v_ticket_type.event_id, p_ticket_type_id, p_email, p_quantity_requested, v_next_position)
  returning * into v_entry;

  return v_entry;
end;
$$;

grant execute on function join_waitlist(uuid, text, integer) to anon, authenticated;
