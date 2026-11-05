CREATE TABLE `action_log` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `queue_items` ADD `approval_lock_at` integer;--> statement-breakpoint
ALTER TABLE `queue_items` ADD `approved_by` text;