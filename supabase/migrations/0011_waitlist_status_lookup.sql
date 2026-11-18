-- Lets a waitlisted buyer (via the entry id they got when joining, no account needed) check
-- whether they've been offered a seat yet, and get the link to pay for it if so — used by the
-- test screen to show the waitlist flow visually instead of only through SQL/curl.
create or replace function get_waitlist_entry(p_entry_id uuid)
returns table (
  status waitlist_status,
  queue_position integer,
  offered_order_access_token uuid,
  response_deadline_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select w.status, w.position, o.access_token, w.response_deadline_at
  from waitlist_entries w
  left join orders o on o.id = w.offered_order_id
  where w.id = p_entry_id;
$$;

grant execute on function get_waitlist_entry(uuid) to anon, authenticated;
