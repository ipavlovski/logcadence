CREATE TABLE `checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`checklist_id` text NOT NULL,
	`label` text NOT NULL,
	`target` integer DEFAULT 1 NOT NULL,
	`source` text,
	`position` real NOT NULL,
	`added_date` text NOT NULL,
	`removed_date` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`checklist_id`) REFERENCES `checklists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_items_list_idx` ON `checklist_items` (`checklist_id`,`position`);--> statement-breakpoint
CREATE TABLE `checklist_marks` (
	`item_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`item_id`, `date`),
	FOREIGN KEY (`item_id`) REFERENCES `checklist_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_marks_date_idx` ON `checklist_marks` (`date`);--> statement-breakpoint
CREATE TABLE `checklists` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`position` real NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`weekdays` integer DEFAULT 127 NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
