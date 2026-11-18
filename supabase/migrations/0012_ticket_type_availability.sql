-- Lets the test screen show real remaining seats next to the total stock, instead of just the
-- fixed quantity (which was confusing: "2 places au total" looked available even when both
-- were already taken by a paid order + a pending reservation).
create or replace function get_event_ticket_availability(p_event_id uuid)
returns table (ticket_type_id uuid, available integer)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.quantity
      - coalesce(sum(oi.quantity) filter (where o.status = 'paid'), 0)
      - coalesce(sum(oi.quantity) filter (where o.status = 'pending' and o.expires_at > now()), 0)
  from ticket_types t
  left join order_items oi on oi.ticket_type_id = t.id
  left join orders o on o.id = oi.order_id
  where t.event_id = p_event_id
  group by t.id, t.quantity;
$$;

grant execute on function get_event_ticket_availability(uuid) to anon, authenticated;
