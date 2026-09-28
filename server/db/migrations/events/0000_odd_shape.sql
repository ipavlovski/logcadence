CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`entity` text NOT NULL,
	`node_id` text NOT NULL,
	`op` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_node_idx` ON `events` (`node_id`);--> statement-breakpoint
CREATE INDEX `events_ts_idx` ON `events` (`ts`);