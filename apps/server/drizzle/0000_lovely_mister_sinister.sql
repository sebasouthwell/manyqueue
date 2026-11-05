CREATE TABLE `guests` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`nickname` text NOT NULL,
	`emoji` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hearts` (
	`queue_item_id` text NOT NULL,
	`guest_id` text NOT NULL,
	FOREIGN KEY (`queue_item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`spotify_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`refresh_token_enc` text NOT NULL,
	`token_iv` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_spotify_user_id_unique` ON `hosts` (`spotify_user_id`);--> statement-breakpoint
CREATE TABLE `queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`track_uri` text NOT NULL,
	`track_name` text NOT NULL,
	`artist_name` text NOT NULL,
	`album_art_url` text,
	`duration_ms` integer NOT NULL,
	`added_by` text,
	`source` text DEFAULT 'queue' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	`locked_at` integer,
	`started_at` integer,
	`ended_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`device_id` text,
	`device_name` text,
	`fallback_playlist_uri` text,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	`export_playlist_id` text,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE TABLE `vote_ballots` (
	`vote_id` text NOT NULL,
	`guest_id` text NOT NULL,
	`cast_at` integer NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`type` text NOT NULL,
	`target_queue_item_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_queue_item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
