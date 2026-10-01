CREATE TABLE `spotify_contexts` (
	`uri` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`image_url` text,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_likes` (
	`track_id` text PRIMARY KEY NOT NULL,
	`added_at` integer NOT NULL,
	`date` text NOT NULL,
	`track_name` text NOT NULL,
	`artists` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spotify_likes_date_idx` ON `spotify_likes` (`date`);--> statement-breakpoint
CREATE TABLE `spotify_plays` (
	`played_at` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`track_id` text NOT NULL,
	`track_name` text NOT NULL,
	`artists` text NOT NULL,
	`album` text NOT NULL,
	`image_url` text,
	`duration_ms` integer NOT NULL,
	`context_type` text,
	`context_uri` text
);
--> statement-breakpoint
CREATE INDEX `spotify_plays_date_idx` ON `spotify_plays` (`date`);