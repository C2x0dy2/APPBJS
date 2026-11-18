-- Fix: the RETURNS TABLE column "order_id" shadowed the plain "order_id" column reference used
-- inside the function's own queries (order_items.order_id), causing Postgres error 42702
-- ("column reference is ambiguous") every time this ran. Renamed the output column to sidestep
-- the collision entirely rather than qualifying every reference and risking missing one.
drop function if exists confirm_payment(text, uuid, jsonb);

create or replace function confirm_payment(
  p_provider_event_id text,
  p_order_id uuid,
  p_payload jsonb
)
returns table (
  result_order_id uuid,
  status order_status,
  refund_needed boolean,
  payment_intent_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
  v_inserted integer;
  v_paid_amount integer;
  v_ticket_type ticket_types%rowtype;
  v_sold integer;
  v_held integer;
  v_available integer;
  v_payment_intent text;
begin
  v_payment_intent := p_payload #>> '{data,object,payment_intent}';

  insert into payment_events (provider_event_id, order_id, payload)
  values (p_provider_event_id, p_order_id, p_payload)
  on conflict (provider_event_id) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select * into v_order from orders where id = p_order_id;
    if v_order.status = 'expired' then
      return query select v_order.id, v_order.status, true, v_payment_intent;
    else
      return query select v_order.id, v_order.status, false, null::text;
    end if;
    return;
  end if;

  select * into v_order from orders where id = p_order_id for update;

  if v_order.status = 'paid' then
    return query select v_order.id, v_order.status, false, null::text;
    return;
  end if;

  if v_order.status <> 'pending' and v_order.status <> 'expired' then
    raise exception 'order_not_payable: %', v_order.status;
  end if;

  v_paid_amount := (p_payload #>> '{data,object,amount_total}')::integer;
  if v_paid_amount is null or v_paid_amount <> v_order.total_cents then
    raise exception 'amount_mismatch: order expects %, payment reports %',
      v_order.total_cents, v_paid_amount;
  end if;

  if v_order.status = 'expired' then
    for v_item in select * from order_items where order_id = p_order_id loop
      select * into v_ticket_type from ticket_types where id = v_item.ticket_type_id for update;

      select coalesce(sum(oi.quantity), 0) into v_sold
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.ticket_type_id = v_item.ticket_type_id and o.status = 'paid';

      select coalesce(sum(oi.quantity), 0) into v_held
      from order_items oi
      join orders o on o.id = oi.order_id
      where oi.ticket_type_id = v_item.ticket_type_id
        and o.status = 'pending'
        and o.expires_at > now();

      v_available := v_ticket_type.quantity - v_sold - v_held;

      if v_available < v_item.quantity then
        return query select v_order.id, v_order.status, true, v_payment_intent;
        return;
      end if;
    end loop;
  end if;

  update orders set status = 'paid', paid_at = now()
  where id = p_order_id
  returning * into v_order;

  for v_item in select * from order_items where order_id = p_order_id loop
    insert into tickets (order_item_id)
    select v_item.id from generate_series(1, v_item.quantity);
  end loop;

  return query select v_order.id, v_order.status, false, null::text;
end;
$$;

revoke execute on function confirm_payment(text, uuid, jsonb) from public;
