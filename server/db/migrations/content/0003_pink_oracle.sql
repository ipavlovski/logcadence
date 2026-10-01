CREATE TABLE `gps_days` (
	`date` text PRIMARY KEY NOT NULL,
	`source_stamp` text NOT NULL,
	`day_start` integer NOT NULL,
	`homebase_id` text,
	`homebase_override` integer DEFAULT false NOT NULL,
	`point_count` integer NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gps_places` (
	`id` text PRIMARY KEY NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `gps_segments` (
	`date` text NOT NULL,
	`idx` integer NOT NULL,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`place_id` text,
	`from_place_id` text,
	`to_place_id` text,
	`distance_m` integer NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`date`, `idx`),
	FOREIGN KEY (`date`) REFERENCES `gps_days`(`date`) ON UPDATE no action ON DELETE cascade
);
