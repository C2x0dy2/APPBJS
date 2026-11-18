-- Adds an amount check to confirm_payment: a valid Stripe signature only proves the
-- notification came from Stripe, not that it's reporting the right amount for THIS order.
-- Checked here, in the function that actually marks orders paid, rather than only in the
-- webhook caller, so it holds even if confirm_payment is ever invoked another way.
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
  v_paid_amount integer;
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

  -- The amount Stripe says it collected (Checkout Session's amount_total, in cents) must match
  -- what this order was priced at — a signed notification for the wrong amount is still wrong.
  v_paid_amount := (p_payload #>> '{data,object,amount_total}')::integer;
  if v_paid_amount is null or v_paid_amount <> v_order.total_cents then
    raise exception 'amount_mismatch: order expects %, payment reports %',
      v_order.total_cents, v_paid_amount;
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

revoke execute on function confirm_payment(text, uuid, jsonb) from public;
