CREATE TABLE `yt_images` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`file` text NOT NULL,
	`mime` text NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `yt_videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `yt_images_video_idx` ON `yt_images` (`video_id`,`position`);--> statement-breakpoint
CREATE TABLE `yt_playlist_videos` (
	`playlist_id` text NOT NULL,
	`video_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`playlist_id`, `video_id`),
	FOREIGN KEY (`playlist_id`) REFERENCES `yt_playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `yt_videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `yt_playlist_videos_video_idx` ON `yt_playlist_videos` (`video_id`);--> statement-breakpoint
CREATE TABLE `yt_playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel` text,
	`created_at` integer NOT NULL,
	`last_import_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `yt_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yt_tags_path_unique` ON `yt_tags` (`path`);--> statement-breakpoint
CREATE TABLE `yt_video_tags` (
	`video_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`video_id`, `tag_id`),
	FOREIGN KEY (`video_id`) REFERENCES `yt_videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `yt_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `yt_video_tags_tag_idx` ON `yt_video_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `yt_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`channel_url` text,
	`channel_avatar` text,
	`duration` text,
	`views` text,
	`published` text,
	`added_at` integer NOT NULL,
	`added_date` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active_image_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `yt_videos_added_idx` ON `yt_videos` (`added_date`,`added_at`);