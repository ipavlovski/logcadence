CREATE TABLE `gps_trips` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`date`) REFERENCES `gps_days`(`date`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gps_trips_date_idx` ON `gps_trips` (`date`);