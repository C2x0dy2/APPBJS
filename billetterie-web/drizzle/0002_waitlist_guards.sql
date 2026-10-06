-- Keep every active request physically fulfillable, even during concurrent edits.
CREATE TRIGGER waitlist_quantity_insert BEFORE INSERT ON waitlist
WHEN NEW.status IN ('waiting','offered')
BEGIN
 SELECT RAISE(ABORT,'WAITLIST_QUANTITY') WHERE NEW.quantity<1
 OR NEW.quantity>(SELECT capacity FROM ticket_types WHERE id=NEW.type_id);
END;
--> statement-breakpoint
CREATE TRIGGER waitlist_quantity_update BEFORE UPDATE OF type_id,quantity,status ON waitlist
WHEN NEW.status IN ('waiting','offered')
BEGIN
 SELECT RAISE(ABORT,'WAITLIST_QUANTITY') WHERE NEW.quantity<1
 OR NEW.quantity>(SELECT capacity FROM ticket_types WHERE id=NEW.type_id);
END;
--> statement-breakpoint
CREATE TRIGGER ticket_type_waitlist_capacity BEFORE UPDATE OF capacity ON ticket_types
BEGIN
 SELECT RAISE(ABORT,'WAITLIST_CAPACITY') WHERE EXISTS(
  SELECT 1 FROM waitlist WHERE type_id=NEW.id AND status IN ('waiting','offered') AND quantity>NEW.capacity
 );
END;
