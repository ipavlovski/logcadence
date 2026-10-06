DROP TABLE `yt_playlist_videos`;--> statement-breakpoint
ALTER TABLE `yt_images` ADD `section` text DEFAULT 'notes' NOT NULL;--> statement-breakpoint
ALTER TABLE `yt_playlists` ADD `last_import_count` integer;--> statement-breakpoint
ALTER TABLE `yt_videos` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `yt_videos` ADD `imported_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `yt_videos` ADD `comments` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `yt_videos` ADD `comments_active_image_id` text;--> statement-breakpoint
-- Until now added_at was when an import first saw the video: that is its import date.
UPDATE `yt_videos` SET `imported_at` = `added_at`;