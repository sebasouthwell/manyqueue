CREATE TABLE `rotation_state` (
	`room_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`last_turn_at` integer,
	`joined_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`room_id`, `guest_id`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `queue_items` ADD `mine_position` integer;--> statement-breakpoint
ALTER TABLE `queue_items` ADD `drafted_at` integer;--> statement-breakpoint
ALTER TABLE `queue_items` ADD `drafted_by` text;