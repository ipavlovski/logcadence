CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`entry_id` text,
	`title` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`turns` integer NOT NULL,
	`messages` text NOT NULL,
	`meta` text NOT NULL,
	`node_ids` text NOT NULL,
	`source_stamp` text,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chats_started_idx` ON `chats` (`started_at`);--> statement-breakpoint
CREATE INDEX `chats_entry_idx` ON `chats` (`entry_id`);