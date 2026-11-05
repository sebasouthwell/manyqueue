CREATE TABLE `ballot_entries` (
	`ballot_id` text NOT NULL,
	`queue_item_id` text NOT NULL,
	`owner_id` text,
	`seq` integer NOT NULL,
	`is_mystery` integer DEFAULT false NOT NULL,
	`is_wildcard` integer DEFAULT false NOT NULL,
	`lost_rounds` integer DEFAULT 0 NOT NULL,
	`waiting_since` integer NOT NULL,
	`pulled` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`ballot_id`, `queue_item_id`),
	FOREIGN KEY (`ballot_id`) REFERENCES `ballots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ballot_votes` (
	`ballot_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`queue_item_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`ballot_id`, `guest_id`),
	FOREIGN KEY (`ballot_id`) REFERENCES `ballots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`status` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`winner_item_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `rotation_state` ADD `lost_rounds` integer DEFAULT 0 NOT NULL;