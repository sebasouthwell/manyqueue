CREATE TABLE `guest_labels` (
	`room_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`label_key` text NOT NULL,
	`name` text NOT NULL,
	`emoji` text NOT NULL,
	`earned_at` integer NOT NULL,
	PRIMARY KEY(`guest_id`, `label_key`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
