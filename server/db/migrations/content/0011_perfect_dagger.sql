CREATE TABLE `board_items` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`row` real NOT NULL,
	`position` real NOT NULL,
	`file` text NOT NULL,
	`thumb` text,
	`mime` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `board_items_day_idx` ON `board_items` (`date`,`row`,`position`);