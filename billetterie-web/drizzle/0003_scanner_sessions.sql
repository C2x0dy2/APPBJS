CREATE TABLE `scanner_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`device_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`prepared_at` integer NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`sync_until` integer NOT NULL,
	`ticket_ids` text NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `scanner_links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scanner_session_window" CHECK("scanner_sessions"."valid_from" <= "scanner_sessions"."prepared_at" AND "scanner_sessions"."prepared_at" < "scanner_sessions"."valid_until" AND "scanner_sessions"."sync_until" = "scanner_sessions"."valid_until" + 86400000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scanner_sessions_token_hash_unique` ON `scanner_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `scanner_sessions_link` ON `scanner_sessions` (`link_id`,`sync_until`);--> statement-breakpoint
CREATE INDEX `scanner_sessions_expiry` ON `scanner_sessions` (`sync_until`);