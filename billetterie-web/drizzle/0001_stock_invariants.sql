-- Atomic inventory transitions. D1 batch rolls back every statement on failure.
CREATE TRIGGER reserve_inventory BEFORE INSERT ON order_items
BEGIN
 SELECT RAISE(ABORT,'STOCK_UNAVAILABLE') WHERE NOT EXISTS(
  SELECT 1 FROM orders o JOIN ticket_types t ON t.event_id=o.event_id JOIN events e ON e.id=o.event_id
  WHERE o.id=NEW.order_id AND t.id=NEW.type_id AND o.status='pending'
  AND e.status='on_sale' AND e.doors_at>o.created_at AND t.capacity-t.held-t.sold>=NEW.quantity
 );
 SELECT RAISE(ABORT,'STOCK_WAITLIST_PRIORITY') WHERE EXISTS(SELECT 1 FROM waitlist WHERE type_id=NEW.type_id AND status='waiting')
 AND NOT EXISTS(SELECT 1 FROM waitlist WHERE type_id=NEW.type_id AND order_id=NEW.order_id AND status='offered')
 ;
 UPDATE ticket_types SET held=held+NEW.quantity WHERE id=NEW.type_id;
END;
--> statement-breakpoint
CREATE TRIGGER release_inventory AFTER UPDATE OF status ON orders
WHEN OLD.status='pending' AND NEW.status IN ('expired','cancelled')
BEGIN
 UPDATE ticket_types SET held=held-(SELECT coalesce(sum(quantity),0) FROM order_items WHERE order_id=NEW.id AND type_id=ticket_types.id)
 WHERE id IN (SELECT type_id FROM order_items WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER pay_inventory BEFORE UPDATE OF status ON orders
WHEN NEW.status='paid' AND OLD.status IN ('pending','expired')
BEGIN
 SELECT RAISE(ABORT,'STOCK_UNAVAILABLE') WHERE EXISTS(
  SELECT 1 FROM order_items i JOIN ticket_types t ON t.id=i.type_id
  WHERE i.order_id=NEW.id AND
  (t.capacity-t.sold-t.held+(OLD.status='pending')*i.quantity)<i.quantity
 );
 UPDATE ticket_types SET sold=sold+(SELECT sum(quantity) FROM order_items WHERE order_id=NEW.id AND type_id=ticket_types.id),
 held=held-(OLD.status='pending')*(SELECT sum(quantity) FROM order_items WHERE order_id=NEW.id AND type_id=ticket_types.id)
 WHERE id IN (SELECT type_id FROM order_items WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER payment_order_guard BEFORE INSERT ON payments
WHEN NEW.status='paid'
BEGIN
 SELECT RAISE(ABORT,'PAYMENT_DUPLICATE') WHERE EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND payment_id IS NOT NULL AND payment_id<>NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER ticket_limit BEFORE INSERT ON tickets
BEGIN
 SELECT RAISE(ABORT,'TICKET_LIMIT') WHERE NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='paid')
 OR (SELECT count(*) FROM tickets WHERE order_id=NEW.order_id AND type_id=NEW.type_id)>=(SELECT quantity FROM order_items WHERE order_id=NEW.order_id AND type_id=NEW.type_id)
 ;
END;
--> statement-breakpoint
CREATE TRIGGER cancel_inventory AFTER UPDATE OF status ON tickets
WHEN OLD.status='valid' AND NEW.status='cancelled'
BEGIN
 UPDATE ticket_types SET sold=sold-1 WHERE id=NEW.type_id;
END;
--> statement-breakpoint
CREATE UNIQUE INDEX items_type_once ON order_items(order_id,type_id);
--> statement-breakpoint
CREATE UNIQUE INDEX waitlist_active_email ON waitlist(type_id,email) WHERE status IN ('waiting','offered');
