CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`position` real NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entries_date_idx` ON `entries` (`date`,`position`);--> statement-breakpoint
CREATE TABLE `entry_tags` (
	`entry_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `tag_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_tags_tag_idx` ON `entry_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`file` text NOT NULL,
	`mime` text NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `images_node_idx` ON `images` (`node_id`,`position`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`position` real NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`active_image_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `nodes_entry_idx` ON `nodes` (`entry_id`,`position`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_path_unique` ON `tags` (`path`);