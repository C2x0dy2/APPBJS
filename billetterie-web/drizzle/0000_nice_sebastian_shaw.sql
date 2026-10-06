CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`collective_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `challenge_email` ON `challenges` (`email`,`expires_at`);--> statement-breakpoint
CREATE TABLE `collectives` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`stripe_account` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`collective_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`starts_at` integer NOT NULL,
	`doors_at` integer NOT NULL,
	`cancel_until` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`hold_minutes` integer DEFAULT 15 NOT NULL,
	`max_quantity` integer DEFAULT 6 NOT NULL,
	`wait_hours` integer DEFAULT 12 NOT NULL,
	`urgent_wait_hours` integer DEFAULT 2 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`collective_id`) REFERENCES `collectives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_collective` ON `events` (`collective_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quantity_positive" CHECK("order_items"."quantity">0)
);
--> statement-breakpoint
CREATE INDEX `items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `jobs_pending` ON `jobs` (`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`collective_id` text,
	`role` text NOT NULL,
	FOREIGN KEY (`collective_id`) REFERENCES `collectives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_scope` ON `members` (`email`,`collective_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`paid_at` integer,
	`payment_id` text,
	`checkout_id` text,
	`refunded` integer DEFAULT 0 NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_token_unique` ON `orders` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_payment_id_unique` ON `orders` (`payment_id`);--> statement-breakpoint
CREATE INDEX `orders_expiry` ON `orders` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `orders_event` ON `orders` (`event_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scanner_links` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`token` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_until` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scanner_links_token_unique` ON `scanner_links` (`token`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type_id` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'valid' NOT NULL,
	`scanned_at` integer,
	`device_id` text,
	`refund_amount` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_code_unique` ON `tickets` (`code`);--> statement-breakpoint
CREATE INDEX `tickets_order` ON `tickets` (`order_id`);--> statement-breakpoint
CREATE TABLE `ticket_types` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`capacity` integer NOT NULL,
	`held` integer DEFAULT 0 NOT NULL,
	`sold` integer DEFAULT 0 NOT NULL,
	`early_price` integer,
	`early_until` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_bounds" CHECK("ticket_types"."held" >= 0 AND "ticket_types"."sold" >= 0 AND "ticket_types"."capacity" >= "ticket_types"."held" + "ticket_types"."sold"),
	CONSTRAINT "price_positive" CHECK("ticket_types"."price" >= 0)
);
--> statement-breakpoint
CREATE INDEX `types_event` ON `ticket_types` (`event_id`);--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`order_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `ticket_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `waitlist_fifo` ON `waitlist` (`type_id`,`status`,`created_at`);