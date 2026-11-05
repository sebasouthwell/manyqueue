CREATE TABLE `blocked_devices` (
	`room_id` text NOT NULL,
	`device_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `guests` ADD `muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guests` ADD `kicked_at` integer;