-- Fix: revoking execute from specific roles (anon, authenticated) in 0002 left the functions
-- callable anyway, because Postgres grants execute on new functions to PUBLIC by default, and a
-- grant to PUBLIC applies to every role regardless of a later per-role revoke. Only revoking from
-- PUBLIC itself actually locks these down to "nobody except the function owner / service role".
revoke execute on function confirm_payment(text, uuid, jsonb) from public;
revoke execute on function expire_stale_reservations() from public;
