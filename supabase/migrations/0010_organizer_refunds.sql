-- Organizer-initiated refunds (section 5), total or partial, with a trace of who did it and
-- when. Two things this depends on that aren't built yet:
--   - Organizer accounts (lot Dioulo) — refund_order() already checks collective_members, same
--     pattern as mark_order_paid_by_transfer(), so it's ready the moment those accounts exist.
--   - The refund-order Edge Function must be called with the ORGANIZER'S OWN auth token (not
--     the service role key), so auth.uid() below actually resolves to them.

alter table orders
  add column payment_intent_id text,
  add column refunded_cents integer not null default 0 check (refunded_cents >= 0),
  add column refunded_by uuid references auth.users(id),
  add column refunded_at timestamptz;

-- Card payments now remember their Stripe payment_intent when confirmed, so a later refund
-- (automatic or organizer-initiated) always has it on hand without re-parsing webhook payloads.
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

  update orders set status = 'paid', paid_at = now(), payment_intent_id = v_payment_intent
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

-- Computes and records a refund (full by default, or p_amount_cents for a partial one).
-- Card orders: returns requires_stripe_call = true + the payment_intent so the Edge Function
-- can call Stripe; this function itself never talks to Stripe. Transfer orders have no Stripe
-- payment to refund (the organizer sends the money back manually), so it just records it.
create or replace function refund_order(p_order_id uuid, p_amount_cents integer default null)
returns table (
  refund_amount_cents integer,
  requires_stripe_call boolean,
  payment_intent_id text,
  new_status order_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_is_organizer boolean;
  v_amount integer;
  v_new_status order_status;
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

  if v_order.status <> 'paid' then
    raise exception 'order_not_refundable: %', v_order.status;
  end if;

  v_amount := coalesce(p_amount_cents, v_order.total_cents - v_order.refunded_cents);

  if v_amount <= 0 or v_amount > (v_order.total_cents - v_order.refunded_cents) then
    raise exception 'invalid_refund_amount';
  end if;

  v_new_status := case
    when v_order.refunded_cents + v_amount >= v_order.total_cents then 'refunded'
    else 'paid'
  end;

  update orders
  set refunded_cents = refunded_cents + v_amount,
      status = v_new_status,
      refunded_by = auth.uid(),
      refunded_at = now()
  where id = p_order_id;

  return query select
    v_amount,
    (v_order.payment_method = 'card'),
    v_order.payment_intent_id,
    v_new_status;
end;
$$;

grant execute on function refund_order(uuid, integer) to authenticated;
