-- Late payment (section 4): a card payment can arrive after the 15-minute hold already expired.
-- confirm_payment now re-checks availability instead of just failing: issue the ticket if a seat
-- is still free, otherwise flag that a refund is needed. The actual Stripe refund call can only
-- happen in the Edge Function (Deno), so this returns what it decided rather than doing it itself.
drop function if exists confirm_payment(text, uuid, jsonb);

create or replace function confirm_payment(
  p_provider_event_id text,
  p_order_id uuid,
  p_payload jsonb
)
returns table (
  order_id uuid,
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
    -- Replayed notification. If the first delivery never finished refunding (e.g. the Edge
    -- Function crashed mid-way), say so again so Stripe's retry can complete it.
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
    -- The hold lapsed before payment arrived: only honor it if a seat is still free for every
    -- item on this order (checked per item — an order usually has one, but never assume).
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
        -- No room left: this payment can't be honored. Hand back to the caller so it can
        -- refund via Stripe, then call mark_order_refunded() to finish the job.
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

-- Finishes the refund path above, called by the webhook Edge Function only after the actual
-- Stripe refund succeeded. The "status = 'expired'" guard keeps this from ever double-refunding
-- or overwriting a status it shouldn't touch.
create or replace function mark_order_refunded(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  update orders set status = 'refunded', cancelled_at = now()
  where id = p_order_id and status = 'expired'
  returning * into v_order;

  return v_order;
end;
$$;

revoke execute on function mark_order_refunded(uuid) from public;
