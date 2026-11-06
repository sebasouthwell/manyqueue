ALTER TABLE `guests` ADD `glitch_duration_sec` integer;--> statement-breakpoint
ALTER TABLE `guests` ADD `glitch_armed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `guests` ADD `glitch_started_at` integer;