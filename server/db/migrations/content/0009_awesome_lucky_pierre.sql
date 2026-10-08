CREATE TABLE `capture_images` (
	`id` text PRIMARY KEY NOT NULL,
	`capture_id` text NOT NULL,
	`section` text NOT NULL,
	`file` text NOT NULL,
	`mime` text NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capture_images_capture_idx` ON `capture_images` (`capture_id`,`position`);--> statement-breakpoint
CREATE TABLE `capture_item_tags` (
	`capture_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`capture_id`, `tag_id`),
	FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `capture_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capture_item_tags_tag_idx` ON `capture_item_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `capture_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capture_tags_kind_path_idx` ON `capture_tags` (`kind`,`path`);--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`site` text DEFAULT '' NOT NULL,
	`icon` text,
	`screenshot` text NOT NULL,
	`screenshot_width` integer,
	`screenshot_height` integer,
	`thumb` text,
	`author` text,
	`score` integer,
	`comment_count` integer,
	`posted_at` integer,
	`captured_at` integer NOT NULL,
	`captured_date` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`active_image_id` text,
	`comments` text DEFAULT '' NOT NULL,
	`comments_active_image_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `captures_kind_key_idx` ON `captures` (`kind`,`key`);--> statement-breakpoint
CREATE INDEX `captures_date_idx` ON `captures` (`kind`,`captured_date`,`captured_at`);