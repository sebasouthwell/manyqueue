CREATE TABLE `__old_vote_ballots` AS SELECT `vote_id`, `guest_id`, `cast_at` FROM `vote_ballots`;--> statement-breakpoint
DROP TABLE `vote_ballots`;--> statement-breakpoint
CREATE TABLE `__new_votes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`type` text NOT NULL,
	`target_queue_item_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`title` text,
	`instruction` text,
	`options` text,
	`deadline_at` integer,
	`result` text,
	`meta` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_queue_item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_votes`("id", "room_id", "type", "target_queue_item_id", "status", "opened_at", "closed_at") SELECT "id", "room_id", "type", "target_queue_item_id", "status", "opened_at", "closed_at" FROM `votes`;--> statement-breakpoint
DROP TABLE `votes`;--> statement-breakpoint
ALTER TABLE `__new_votes` RENAME TO `votes`;--> statement-breakpoint
CREATE TABLE `vote_ballots` (
	`vote_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`option_id` text,
	`cast_at` integer NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `vote_ballots`(`vote_id`, `guest_id`, `option_id`, `cast_at`) SELECT `vote_id`, `guest_id`, NULL, `cast_at` * 1000 FROM `__old_vote_ballots`;--> statement-breakpoint
DROP TABLE `__old_vote_ballots`;--> statement-breakpoint
CREATE UNIQUE INDEX `vote_ballots_vote_guest` ON `vote_ballots` (`vote_id`,`guest_id`);
