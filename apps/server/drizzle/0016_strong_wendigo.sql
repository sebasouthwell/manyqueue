CREATE TABLE `ai_nicknames` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`nickname` text NOT NULL,
	`why` text NOT NULL,
	`generated_at` integer NOT NULL,
	`status` text NOT NULL,
	`at_finished` integer DEFAULT 0 NOT NULL,
	`announced_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`room_id` text PRIMARY KEY NOT NULL,
	`nickname_calls` integer DEFAULT 0 NOT NULL,
	`genre_calls` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `genre_cache` (
	`artist_key` text PRIMARY KEY NOT NULL,
	`genres` text NOT NULL,
	`fetched_at` integer NOT NULL
);
