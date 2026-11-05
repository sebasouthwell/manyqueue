CREATE TABLE `contest_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`queue_item_id` text NOT NULL,
	`entered_by` text NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`queue_item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entered_by`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
