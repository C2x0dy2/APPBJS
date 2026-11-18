-- Deux manques du cahier des charges, identifiés en comparant le code à l'énoncé du client :
--   1. "À l'entrée, on vérifie les billets sur une liste papier... on a déjà eu des billets présentés deux fois."
--      -> aucune fonction de scan n'existait ; reserve_seats_multi et le reste ne couvrent que la vente.
--   2. Annuler un événement entier (pas juste une commande) ne cascadait nulle part : places à libérer, billets à
--      invalider, remboursements à déclencher pour les commandes déjà payées.

-- ====================================================================================== scan à l'entrée
-- Même réponse ('invalid') pour un code inconnu, d'un autre événement ou d'un autre collectif : rien n'est révélé.
create or replace function validate_ticket_entry(p_event_id uuid, p_code uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_organizer boolean;
  v_ticket tickets%rowtype;
  v_ticket_type_name text;
begin
  select exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = p_event_id and m.user_id = auth.uid()
  ) into v_is_organizer;

  if not v_is_organizer then
    raise exception 'not_authorized';
  end if;

  select t.* into v_ticket
  from tickets t
  join order_items oi on oi.id = t.order_item_id
  join orders o on o.id = oi.order_id
  where t.qr_code = p_code and o.event_id = p_event_id
  for update;

  if v_ticket is null then
    return jsonb_build_object('result', 'invalid');
  end if;

  select tt.name into v_ticket_type_name
  from order_items oi join ticket_types tt on tt.id = oi.ticket_type_id
  where oi.id = v_ticket.order_item_id;

  if v_ticket.status = 'used' then
    return jsonb_build_object('result', 'already_used', 'ticketType', v_ticket_type_name);
  end if;

  if v_ticket.status <> 'valid' then
    return jsonb_build_object('result', 'invalid', 'ticketType', v_ticket_type_name);
  end if;

  update tickets set status = 'used', used_at = now(), scanned_by = auth.uid() where id = v_ticket.id;
  return jsonb_build_object('result', 'ok', 'ticketType', v_ticket_type_name);
end;
$$;

grant execute on function validate_ticket_entry(uuid, uuid) to authenticated;

-- ====================================================================================== annulation d'un événement
alter table orders add column refund_pending boolean not null default false;

-- Annule l'événement entier (pas une commande) : plus aucune vente, réservations en attente libérées, billets
-- invalidés, commandes payées marquées à rembourser. Ne parle jamais à Stripe elle-même (voir Edge Function
-- cancel-event) ; renvoie la liste des commandes à rembourser pour qu'elle le fasse ensuite. Idempotent.
create or replace function cancel_event(p_event_id uuid)
returns table (order_id uuid, payment_intent_id text, refund_amount_cents integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_organizer boolean;
  v_order orders%rowtype;
begin
  select exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = p_event_id and m.user_id = auth.uid()
  ) into v_is_organizer;

  if not v_is_organizer then
    raise exception 'not_authorized';
  end if;

  update events set status = 'cancelled' where id = p_event_id and status <> 'cancelled';

  -- Réservations en attente : annulées, rien à rembourser (jamais payées).
  update orders set status = 'cancelled', cancelled_at = now()
  where event_id = p_event_id and status = 'pending';

  -- Commandes payées : à rembourser (le paiement carte a un payment_intent ; un virement se rend manuellement).
  update orders set refund_pending = true
  where event_id = p_event_id and status = 'paid';

  -- Billets : tous invalidés, qu'ils soient scannés ou non (section 5 du cahier des charges).
  update tickets set status = 'cancelled'
  where status = 'valid'
    and order_item_id in (
      select oi.id from order_items oi join orders o on o.id = oi.order_id where o.event_id = p_event_id
    );

  -- Liste d'attente : plus aucune place à offrir sur un événement annulé.
  update waitlist_entries set status = 'removed'
  where status in ('waiting', 'offered')
    and ticket_type_id in (select id from ticket_types where event_id = p_event_id);

  return query
  select o.id, o.payment_intent_id, o.total_cents - o.refunded_cents
  from orders o
  where o.event_id = p_event_id and o.refund_pending = true and o.payment_method = 'card';
end;
$$;

grant execute on function cancel_event(uuid) to authenticated;

-- Lecture de la liste des participants pour l'export (organisateur uniquement) : l'app construit le CSV elle-même.
create or replace function get_event_participants(p_event_id uuid)
returns table (email text, ticket_type_name text, ticket_number bigint, ticket_status ticket_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_organizer boolean;
begin
  select exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = p_event_id and m.user_id = auth.uid()
  ) into v_is_organizer;

  if not v_is_organizer then
    raise exception 'not_authorized';
  end if;

  return query
  select o.buyer_email, tt.name, row_number() over (partition by o.id order by t.created_at), t.status
  from tickets t
  join order_items oi on oi.id = t.order_item_id
  join orders o on o.id = oi.order_id
  join ticket_types tt on tt.id = oi.ticket_type_id
  where o.event_id = p_event_id
  order by o.created_at, t.created_at;
end;
$$;

grant execute on function get_event_participants(uuid) to authenticated;
