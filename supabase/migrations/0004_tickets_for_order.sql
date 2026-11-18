-- Lets a buyer (via their order's access_token, no account needed) see the tickets a paid order
-- produced. Used for now by the test screen to prove reserve_seats -> confirm_payment -> tickets
-- really runs end to end; the PDF/QR display itself is lot Mohammed, not built here.
create or replace function get_tickets_by_order_token(p_access_token uuid)
returns table (
  ticket_id uuid,
  qr_code uuid,
  status ticket_status
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.qr_code, t.status
  from tickets t
  join order_items oi on oi.id = t.order_item_id
  join orders o on o.id = oi.order_id
  where o.access_token = p_access_token;
$$;

grant execute on function get_tickets_by_order_token(uuid) to anon, authenticated;
