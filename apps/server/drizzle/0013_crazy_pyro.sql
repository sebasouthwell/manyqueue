CREATE TABLE `banned_tracks` (
	`room_id` text NOT NULL,
	`track_uri` text NOT NULL,
	`vote_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `track_uri`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE no action
);
