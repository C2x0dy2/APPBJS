-- Durcissement de sécurité (audit du 2026-11-18). Chaque bloc corrige une attaque vérifiée sur une copie locale des
-- migrations 0001 à 0016 (Postgres + rôles et privilèges par défaut de Supabase) :
--   1. droits d'exécution : confirm_payment & co. étaient appelables par n'importe qui -> billets gratuits ;
--   2. tables sans RLS (collectives, payment_events) : lecture/écriture avec la clé publique ;
--   3. rôles organisateur (admin/manager/controller) jamais vérifiés, écritures directes trop larges ;
--   4. reserve_seats_multi sans aucune limite : un seul compte pouvait bloquer tout le stock.
-- À exécuter dans le SQL Editor APRÈS 0016. Ne modifie aucune donnée existante.

-- ====================================================================================== 1. privilèges par défaut
-- Supabase donne EXECUTE à anon et authenticated sur toute fonction créée dans public (privilèges par défaut du
-- projet). Les « revoke ... from public » de 0003 à 0010 ne retiraient donc rien : confirm_payment (recréée par
-- 0008/0009), mark_order_refunded et offer_next_waitlist_entry restaient appelables via /rest/v1/rpc. Désormais une
-- nouvelle fonction n'est ouverte à personne tant qu'un « grant » explicite ne le décide pas.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- ====================================================================================== 2. tables sans RLS
-- collectives : n'importe qui pouvait renommer, créer ou supprimer un collectif (et ses événements en cascade).
-- Les noms restent lisibles par tous (affichés sur chaque événement) ; aucune écriture hors clé de service.
alter table collectives enable row level security;
create policy "public reads collectives" on collectives for select using (true);

-- payment_events : contenu complet des notifications Stripe (e-mails, montants) lisible par tous. Seule
-- confirm_payment (security definer) et la clé de service y accèdent désormais.
alter table payment_events enable row level security;
revoke all on payment_events from anon, authenticated;

-- Écritures directes : l'app n'écrit que dans events et ticket_types (organisateurs). Tout le reste passe par des
-- fonctions (réservation, paiement, annulation, remboursement), qui contrôlent elles-mêmes les droits.
revoke insert, update, delete on collectives, collective_members, orders, order_items, tickets, waitlist_entries,
  site_settings, legal_pages, profiles from anon, authenticated;
revoke insert, update, delete on events, ticket_types from anon;
revoke select on orders, order_items, tickets, waitlist_entries from anon;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

-- ====================================================================================== 3. rôles organisateur
-- admin / manager : gèrent les événements, l'argent et les données des acheteurs.
-- controller : scanne les billets et voit les chiffres, rien d'autre.
-- security definer : lit collective_members sans dépendre de sa RLS (et sans boucle entre politiques).
create or replace function is_collective_member(p_collective_id uuid, p_roles collective_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from collective_members m
    where m.collective_id = p_collective_id
      and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create or replace function is_event_member(p_event_id uuid, p_roles collective_role[] default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from events e
    join collective_members m on m.collective_id = e.collective_id
    where e.id = p_event_id
      and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

-- events : lecture pour tout membre ; écriture pour admin/manager ; suppression des seuls brouillons (comme l'app).
drop policy if exists "organizers manage their events" on events;
create policy "members read their events" on events for select
  using (is_collective_member(collective_id));
create policy "managers create events" on events for insert
  with check (is_collective_member(collective_id, array['admin', 'manager']::collective_role[]));
create policy "managers update events" on events for update
  using (is_collective_member(collective_id, array['admin', 'manager']::collective_role[]))
  with check (is_collective_member(collective_id, array['admin', 'manager']::collective_role[]));
create policy "managers delete draft events" on events for delete
  using (status = 'draft' and is_collective_member(collective_id, array['admin', 'manager']::collective_role[]));

drop policy if exists "organizers manage their ticket types" on ticket_types;
create policy "members read their ticket types" on ticket_types for select
  using (is_event_member(event_id));
create policy "managers create ticket types" on ticket_types for insert
  with check (is_event_member(event_id, array['admin', 'manager']::collective_role[]));
create policy "managers update ticket types" on ticket_types for update
  using (is_event_member(event_id, array['admin', 'manager']::collective_role[]))
  with check (is_event_member(event_id, array['admin', 'manager']::collective_role[]));
create policy "managers delete ticket types" on ticket_types for delete
  using (is_event_member(event_id, array['admin', 'manager']::collective_role[]));

-- orders : plus aucune modification directe (un organisateur pouvait passer une commande en « payée » sans
-- paiement, sans trace). Lecture des commandes, lignes et billets (e-mails des acheteurs) : admin/manager.
drop policy if exists "organizers update their orders" on orders;
drop policy if exists "organizers read their orders" on orders;
create policy "managers read their orders" on orders for select
  using (is_event_member(event_id, array['admin', 'manager']::collective_role[]));

drop policy if exists "organizers read their order items" on order_items;
create policy "managers read their order items" on order_items for select
  using (exists (
    select 1 from orders o
    where o.id = order_items.order_id
      and is_event_member(o.event_id, array['admin', 'manager']::collective_role[])
  ));

drop policy if exists "organizers read their tickets" on tickets;
create policy "managers read their tickets" on tickets for select
  using (exists (
    select 1 from order_items oi
    join orders o on o.id = oi.order_id
    where oi.id = tickets.order_item_id
      and is_event_member(o.event_id, array['admin', 'manager']::collective_role[])
  ));

drop policy if exists "organizers manage their waitlist" on waitlist_entries;
create policy "managers read their waitlist" on waitlist_entries for select
  using (is_event_member(event_id, array['admin', 'manager']::collective_role[]));

-- ====================================================================================== 3b. garde-fous d'écriture
-- La RLS dit QUI peut écrire, pas QUOI. Ces déclencheurs ne s'appliquent qu'aux écritures directes de l'API
-- (rôles anon/authenticated) ; les fonctions security definer (cancel_event...) s'exécutent sous leur propriétaire
-- et gardent la main sur les transitions qu'elles gèrent elles-mêmes.
create or replace function guard_event_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'on_sale') then
      raise exception 'invalid_status';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.collective_id <> old.collective_id then
    raise exception 'not_authorized';
  end if;
  -- Un événement annulé ou terminé ne se rouvre pas (les billets ont été invalidés, les remboursements lancés).
  if old.status in ('cancelled', 'completed') then
    raise exception 'event_locked';
  end if;
  -- Annuler passe par cancel_event() : libère les réservations, invalide les billets, rembourse.
  if new.status = 'cancelled' then
    raise exception 'use_cancel_event';
  end if;
  if new.status = 'completed' then
    raise exception 'invalid_status';
  end if;
  -- Repasser en brouillon cacherait un événement pour lequel des gens ont déjà réservé ou payé.
  if new.status = 'draft' and old.status <> 'draft' and exists (select 1 from orders where event_id = new.id) then
    raise exception 'event_has_orders';
  end if;
  return new;
end;
$$;

drop trigger if exists events_guard on events;
create trigger events_guard before insert or update on events
  for each row execute function guard_event_changes();

create or replace function guard_ticket_type_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_taken integer;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.id <> old.id or new.event_id <> old.event_id) then
    raise exception 'not_authorized';
  end if;

  if exists (select 1 from events where id = new.event_id and status in ('cancelled', 'completed')) then
    raise exception 'event_locked';
  end if;

  -- Jamais moins de places que celles déjà vendues ou retenues : sinon l'événement serait en survente.
  if tg_op = 'UPDATE' and new.quantity < old.quantity then
    select coalesce(sum(oi.quantity), 0) into v_taken
    from order_items oi
    join orders o on o.id = oi.order_id
    where oi.ticket_type_id = new.id
      and (o.status = 'paid' or (o.status = 'pending' and o.expires_at > now()));

    if new.quantity < v_taken then
      raise exception 'capacity_below_sold';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ticket_types_guard on ticket_types;
create trigger ticket_types_guard before insert or update on ticket_types
  for each row execute function guard_ticket_type_changes();

-- ====================================================================================== 3c. fonctions réservées admin/manager
-- Mêmes corps que dans 0002 / 0010 / 0016 ; seul le contrôle d'accès change (le rôle est maintenant vérifié).

create or replace function mark_order_paid_by_transfer(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item order_items%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;

  if v_order is null or not is_event_member(v_order.event_id, array['admin', 'manager']::collective_role[]) then
    raise exception 'not_authorized';
  end if;

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
  v_amount integer;
  v_new_status order_status;
begin
  select * into v_order from orders where id = p_order_id for update;

  if v_order is null or not is_event_member(v_order.event_id, array['admin', 'manager']::collective_role[]) then
    raise exception 'not_authorized';
  end if;

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

create or replace function cancel_event(p_event_id uuid)
returns table (order_id uuid, payment_intent_id text, refund_amount_cents integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_event_member(p_event_id, array['admin', 'manager']::collective_role[]) then
    raise exception 'not_authorized';
  end if;

  update events set status = 'cancelled' where id = p_event_id and status <> 'cancelled';

  update orders set status = 'cancelled', cancelled_at = now()
  where event_id = p_event_id and status = 'pending';

  update orders set refund_pending = true
  where event_id = p_event_id and status = 'paid';

  update tickets set status = 'cancelled'
  where status = 'valid'
    and order_item_id in (
      select oi.id from order_items oi join orders o on o.id = oi.order_id where o.event_id = p_event_id
    );

  update waitlist_entries set status = 'removed'
  where status in ('waiting', 'offered')
    and ticket_type_id in (select id from ticket_types where event_id = p_event_id);

  return query
  select o.id, o.payment_intent_id, o.total_cents - o.refunded_cents
  from orders o
  where o.event_id = p_event_id and o.refund_pending = true and o.payment_method = 'card';
end;
$$;

create or replace function get_event_participants(p_event_id uuid)
returns table (email text, ticket_type_name text, ticket_number bigint, ticket_status ticket_status)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_event_member(p_event_id, array['admin', 'manager']::collective_role[]) then
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

-- ====================================================================================== 4. réservation avec limites
-- Avant : aucune limite. Un compte pouvait réserver tout le stock en une commande, enchaîner les réservations,
-- réserver pour un événement passé, sans même avoir vérifié son e-mail.
-- Maintenant :
--   - e-mail vérifié obligatoire (sans effet si le projet Supabase confirme les e-mails automatiquement) ;
--   - au plus site_settings.max_tickets_per_order places par commande, ET en attente par compte sur un événement ;
--   - au plus 3 réservations en attente par compte (tous événements confondus) ;
--   - rien après le début de l'événement ; plafond de virement (transfer_cap, 0006) enfin respecté ;
--   - panier valide : 1 à 20 lignes, pas deux fois le même type, une seule devise ;
--   - un verrou par compte : des requêtes envoyées en parallèle ne contournent pas ces limites.
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
  v_email_confirmed_at timestamptz;
  v_event events%rowtype;
  v_ticket_type ticket_types%rowtype;
  v_item jsonb;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_item_count integer;
  v_distinct_count integer;
  v_requested integer;
  v_max_per_order integer;
  v_pending_orders integer;
  v_pending_tickets integer;
  v_found_types integer;
  v_currency_count integer;
  v_currency text;
  v_sold integer;
  v_held integer;
  v_transfer_held integer;
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

  select email, email_confirmed_at into v_buyer_email, v_email_confirmed_at from auth.users where id = v_user_id;
  if v_buyer_email is null then
    raise exception 'not_authenticated';
  end if;
  if v_email_confirmed_at is null then
    raise exception 'email_not_verified';
  end if;

  -- Une réservation à la fois par compte (jusqu'à la fin de la transaction).
  perform pg_advisory_xact_lock(hashtext('reserve_seats_multi:' || v_user_id::text));

  -- Panier : un tableau de 1 à 20 lignes {ticket_type_id, quantity entière > 0}, chaque type une seule fois.
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_items';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) as item
    where jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or (item->>'ticket_type_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item->>'quantity') !~ '^[0-9]{1,4}$'
  ) then
    raise exception 'invalid_items';
  end if;

  select count(*), count(distinct (item->>'ticket_type_id')::uuid), coalesce(sum((item->>'quantity')::integer), 0)
    into v_item_count, v_distinct_count, v_requested
  from jsonb_array_elements(p_items) as item;

  if v_item_count = 0 or v_item_count > 20 or v_distinct_count <> v_item_count then
    raise exception 'invalid_items';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) as item where (item->>'quantity')::integer <= 0) then
    raise exception 'invalid_quantity';
  end if;

  select max_tickets_per_order into v_max_per_order from site_settings where id = 1;
  v_max_per_order := coalesce(v_max_per_order, 10);
  if v_requested > v_max_per_order then
    raise exception 'too_many_tickets';
  end if;

  select * into v_event from events where id = p_event_id;
  if v_event is null or v_event.status <> 'on_sale' then
    raise exception 'event_not_on_sale';
  end if;
  if v_event.starts_at <= now() then
    raise exception 'event_over';
  end if;
  if p_payment_method = 'transfer' and v_event.starts_at - now() < interval '7 days' then
    raise exception 'transfer_not_available_this_close';
  end if;

  select count(*) into v_pending_orders
  from orders
  where user_id = v_user_id and status = 'pending' and expires_at > now();
  if v_pending_orders >= 3 then
    raise exception 'too_many_pending';
  end if;

  select coalesce(sum(oi.quantity), 0) into v_pending_tickets
  from orders o
  join order_items oi on oi.order_id = o.id
  where o.user_id = v_user_id and o.event_id = p_event_id and o.status = 'pending' and o.expires_at > now();
  if v_pending_tickets + v_requested > v_max_per_order then
    raise exception 'too_many_tickets';
  end if;

  select array_agg(distinct (item->>'ticket_type_id')::uuid order by (item->>'ticket_type_id')::uuid)
    into v_sorted_ids
  from jsonb_array_elements(p_items) as item;

  select count(*), count(distinct currency), min(currency)
    into v_found_types, v_currency_count, v_currency
  from ticket_types
  where id = any (v_sorted_ids) and event_id = p_event_id;

  if v_found_types <> array_length(v_sorted_ids, 1) then
    raise exception 'ticket_type_not_found';
  end if;
  if v_currency_count <> 1 then
    raise exception 'mixed_currencies';
  end if;

  v_expires_at := case p_payment_method
    when 'card' then now() + interval '15 minutes'
    when 'transfer' then now() + interval '48 hours'
  end;

  insert into orders (event_id, buyer_email, payment_method, status, total_cents, currency, expires_at, user_id)
  values (p_event_id, v_buyer_email, p_payment_method, 'pending', 0, v_currency, v_expires_at, v_user_id)
  returning * into v_order;

  -- Verrous pris dans un ordre fixe (tri par id) : pas de blocage mutuel entre commandes concurrentes.
  foreach v_ticket_type_id in array v_sorted_ids loop
    v_item := (select item from jsonb_array_elements(p_items) as item
               where (item->>'ticket_type_id')::uuid = v_ticket_type_id limit 1);
    v_quantity := (v_item->>'quantity')::integer;

    select * into v_ticket_type from ticket_types where id = v_ticket_type_id and event_id = p_event_id for update;

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

    if p_payment_method = 'transfer' and v_ticket_type.transfer_cap is not null then
      select coalesce(sum(oi.quantity), 0) into v_transfer_held
      from order_items oi join orders o on o.id = oi.order_id
      where oi.ticket_type_id = v_ticket_type_id
        and o.status = 'pending' and o.payment_method = 'transfer' and o.expires_at > now();

      if v_transfer_held + v_quantity > v_ticket_type.transfer_cap then
        raise exception 'transfer_cap_exceeded';
      end if;
    end if;

    v_unit_price := current_unit_price(v_ticket_type_id);
    insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents)
    values (v_order.id, v_ticket_type_id, v_quantity, v_unit_price);
    v_total := v_total + v_unit_price * v_quantity;
  end loop;

  update orders set total_cents = v_total where id = v_order.id returning * into v_order;
  return v_order;
end;
$$;

-- ====================================================================================== 5. liste blanche des fonctions
-- On retire EXECUTE à anon/authenticated/PUBLIC sur TOUTES les fonctions du schéma public (sauf celles des
-- extensions), puis on rouvre explicitement ce que l'app et les Edge Functions appellent. La clé de service
-- (service_role : webhook Stripe, tâches planifiées) garde ses droits.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- Utilisées par les politiques RLS (évaluées avec les droits de l'appelant, visiteur compris).
grant execute on function is_collective_member(uuid, collective_role[]) to anon, authenticated;
grant execute on function is_event_member(uuid, collective_role[]) to anon, authenticated;

-- Visiteurs et comptes.
grant execute on function get_event_ticket_availability(uuid) to anon, authenticated;
grant execute on function create_profile(uuid, text) to anon, authenticated; -- inscription (revue en 0018)
-- Lien personnel d'une commande (e-mail de billet, Edge Function cancel-order) : le jeton est la seule preuve.
grant execute on function get_order_by_token(uuid) to anon, authenticated;
grant execute on function get_tickets_by_order_token(uuid) to anon, authenticated;
grant execute on function cancel_order_by_token(uuid) to anon, authenticated;
grant execute on function get_waitlist_entry(uuid) to anon, authenticated;

-- Acheteur connecté.
grant execute on function reserve_seats_multi(uuid, jsonb, payment_method) to authenticated;
grant execute on function get_my_tickets() to authenticated;
grant execute on function get_my_pending_orders() to authenticated;

-- Organisateurs (le rôle exact est vérifié dans chaque fonction).
grant execute on function get_event_stats(uuid) to authenticated;
grant execute on function get_collective_summary(uuid) to authenticated;
grant execute on function validate_ticket_entry(uuid, uuid) to authenticated;
grant execute on function cancel_event(uuid) to authenticated;
grant execute on function get_event_participants(uuid) to authenticated;
grant execute on function refund_order(uuid, integer) to authenticated;
grant execute on function mark_order_paid_by_transfer(uuid) to authenticated;

-- Volontairement NON rouvertes (clé de service ou tâche planifiée uniquement) :
--   confirm_payment, mark_order_refunded, expire_stale_reservations, offer_next_waitlist_entry,
--   current_unit_price (interne), reserve_seats (ancienne réservation sans compte, remplacée par
--   reserve_seats_multi), join_waitlist (sans compte ni limite ; rouverte en 0018 avec des garde-fous).
