-- Reddit merges into Bookmarks: a capture's kind becomes its handler (shared/handlers.ts), what Reddit showed moves
-- to `fields`, and the two tag sets become one (same paths merge). Done with ALTERs only: rebuilding `captures` or
-- `capture_tags` would cascade-delete their tags and images, since migrations run with foreign keys on.
DROP INDEX `captures_kind_key_idx`;--> statement-breakpoint
DROP INDEX `captures_date_idx`;--> statement-breakpoint
ALTER TABLE `captures` RENAME COLUMN `kind` TO `handler`;--> statement-breakpoint
UPDATE `captures` SET `handler` = 'page' WHERE `handler` = 'bookmark';--> statement-breakpoint
ALTER TABLE `captures` ADD `fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `captures` ADD `published_at` integer;--> statement-breakpoint
-- json_patch leaves out the nulls.
UPDATE `captures` SET `fields` = json_patch('{}', json_object('author', `author`, 'score', `score`, 'commentCount', `comment_count`)), `published_at` = `posted_at` WHERE `handler` = 'reddit';--> statement-breakpoint
ALTER TABLE `captures` DROP COLUMN `author`;--> statement-breakpoint
ALTER TABLE `captures` DROP COLUMN `score`;--> statement-breakpoint
ALTER TABLE `captures` DROP COLUMN `comment_count`;--> statement-breakpoint
ALTER TABLE `captures` DROP COLUMN `posted_at`;--> statement-breakpoint
CREATE UNIQUE INDEX `captures_handler_key_idx` ON `captures` (`handler`,`key`);--> statement-breakpoint
CREATE INDEX `captures_date_idx` ON `captures` (`captured_date`,`captured_at`);--> statement-breakpoint
-- A Reddit tag a bookmark tag has too: its posts take the bookmark one (a post only had Reddit tags, so none has both).
UPDATE `capture_item_tags` SET `tag_id` = (
  SELECT b.`id` FROM `capture_tags` r JOIN `capture_tags` b ON b.`kind` = 'bookmark' AND b.`path` = r.`path` WHERE r.`id` = `capture_item_tags`.`tag_id`
) WHERE `tag_id` IN (SELECT r.`id` FROM `capture_tags` r JOIN `capture_tags` b ON b.`kind` = 'bookmark' AND b.`path` = r.`path` WHERE r.`kind` = 'reddit');--> statement-breakpoint
DELETE FROM `capture_tags` WHERE `kind` = 'reddit' AND `path` IN (SELECT `path` FROM `capture_tags` WHERE `kind` = 'bookmark');--> statement-breakpoint
DROP INDEX `capture_tags_kind_path_idx`;--> statement-breakpoint
ALTER TABLE `capture_tags` DROP COLUMN `kind`;--> statement-breakpoint
CREATE UNIQUE INDEX `capture_tags_path_idx` ON `capture_tags` (`path`);
