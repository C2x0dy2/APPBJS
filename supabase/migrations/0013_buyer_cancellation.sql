-- Annulation acheteur (lot Diaby, suite du TODO laissé dans 0002_reservation_engine.sql) :
-- libère la place vers la liste d'attente, sans compte acheteur — l'access_token du lien
-- personnel est la seule autorisation nécessaire, comme get_order_by_token.
--
-- Commande "pending" : annulée tout de suite, rien n'a été payé.
-- Commande "paid" : cette fonction calcule le remboursement (même principe que refund_order en
-- 0010) mais ne parle jamais à Stripe elle-même ; c'est l'Edge Function cancel-order qui appelle
-- Stripe ensuite avec le résultat renvoyé ici.
create or replace function cancel_order_by_token(p_access_token uuid)
returns table (
  result_order_id uuid,
  new_status order_status,
  refund_amount_cents integer,
  requires_stripe_call boolean,
  payment_intent_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_event events%rowtype;
  v_ticket_type_ids uuid[];
  v_ticket_type_id uuid;
  v_used_count integer;
  v_new_status order_status;
  v_refund_amount integer := 0;
  v_requires_stripe boolean := false;
begin
  select * into v_order from orders where access_token = p_access_token for update;
  if v_order is null then
    raise exception 'order_not_found';
  end if;

  if v_order.status not in ('pending', 'paid') then
    raise exception 'order_not_cancellable: %', v_order.status;
  end if;

  select * into v_event from events where id = v_order.event_id;
  if v_event.cancel_deadline_at is not null and now() > v_event.cancel_deadline_at then
    raise exception 'cancellation_deadline_passed';
  end if;

  -- Un billet déjà scanné à l'entrée ne peut plus être rendu.
  select count(*) into v_used_count
  from tickets t
  join order_items oi on oi.id = t.order_item_id
  where oi.order_id = v_order.id and t.status = 'used';

  if v_used_count > 0 then
    raise exception 'ticket_already_used';
  end if;

  select array_agg(distinct ticket_type_id) into v_ticket_type_ids
  from order_items where order_id = v_order.id;

  if v_order.status = 'paid' then
    v_refund_amount := v_order.total_cents - v_order.refunded_cents;
    v_requires_stripe := (v_order.payment_method = 'card');
    v_new_status := 'refunded';

    update tickets set status = 'cancelled'
    where status = 'valid'
      and order_item_id in (select id from order_items where order_id = v_order.id);
  else
    v_new_status := 'cancelled';
  end if;

  update orders
  set status = v_new_status,
      refunded_cents = case when v_order.status = 'paid' then total_cents else refunded_cents end,
      refunded_at = case when v_order.status = 'paid' then now() else refunded_at end,
      cancelled_at = now()
  where id = v_order.id;

  -- La place vient de se libérer (le statut n'est plus 'paid'/'pending', donc elle ne compte
  -- plus dans available) : on l'offre tout de suite à la liste d'attente, même principe que
  -- l'expiration dans 0012_ticket_type_availability.sql.
  foreach v_ticket_type_id in array coalesce(v_ticket_type_ids, array[]::uuid[]) loop
    perform offer_next_waitlist_entry(v_ticket_type_id);
  end loop;

  return query select v_order.id, v_new_status, v_refund_amount, v_requires_stripe, v_order.payment_intent_id;
end;
$$;

grant execute on function cancel_order_by_token(uuid) to anon, authenticated;
