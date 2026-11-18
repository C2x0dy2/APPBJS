-- Optional cap on how many seats of a ticket type can be held by pending bank-transfer orders
-- at once (section 5: "plafond optionnel du stock réservable par virement"). Null = no cap.
-- An organizer sets it per ticket type when they want to keep most of the stock sellable by
-- card (fast) and limit how much a wave of slow-to-confirm transfers can lock up.
alter table ticket_types
  add column transfer_cap integer check (transfer_cap >= 0);

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
  v_transfer_held integer;
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

  if p_payment_method = 'transfer' and v_ticket_type.transfer_cap is not null then
    select coalesce(sum(oi.quantity), 0) into v_transfer_held
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.ticket_type_id = p_ticket_type_id
      and o.status = 'pending'
      and o.payment_method = 'transfer'
      and o.expires_at > now();

    if v_transfer_held + p_quantity > v_ticket_type.transfer_cap then
      raise exception 'transfer_cap_exceeded';
    end if;
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
