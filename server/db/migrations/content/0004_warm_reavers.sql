CREATE TABLE `activity_spans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device` text NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_spans_end_idx` ON `activity_spans` (`end_at`);