-- Every item becomes an entry (shared/entryTypes.ts) with a type, a subtype, one category and the one tag set.
-- Videos, captures and board items each get an entry with an id made from theirs ('yt:', 'cap:', 'media:'); AI chats'
-- entries are typed. YouTube and bookmark tags join the journal's under youtube/ and bookmark/, kept apart until
-- they are sorted out by hand. An entry's category is its primary (first) tag's root, when that is a category;
-- the tag stays. The ai/<source> tags give way to the subtype.
-- Done with ALTERs only: rebuilding a table would cascade-delete the rows that reference it.
CREATE TABLE `categories` (
	`name` text PRIMARY KEY NOT NULL,
	`position` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `position`, `created_at`) VALUES ('design', 1, 0), ('build', 2, 0), ('fabrication', 3, 0), ('dev', 4, 0), ('notes', 5, 0);--> statement-breakpoint
ALTER TABLE `entries` ADD `type` text DEFAULT 'journal' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `subtype` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `category` text REFERENCES categories(name) ON UPDATE cascade ON DELETE set null;--> statement-breakpoint
CREATE INDEX `entries_type_idx` ON `entries` (`type`,`subtype`);--> statement-breakpoint
CREATE INDEX `entries_category_idx` ON `entries` (`category`);--> statement-breakpoint
ALTER TABLE `yt_videos` ADD `entry_id` text REFERENCES entries(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `captures` ADD `entry_id` text REFERENCES entries(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `board_items` ADD `entry_id` text REFERENCES entries(id) ON DELETE cascade;--> statement-breakpoint
-- AI chats: the subtype from the source; the source tag goes from chat entries (a journal entry tagged by hand keeps it).
UPDATE `entries` SET `type` = 'ai', `subtype` = (
  SELECT CASE c.`source` WHEN 'claude' THEN 'claude-chat' WHEN 'claude-code' THEN 'claude-code' WHEN 'gemini' THEN 'gemini-chat' WHEN 'antigravity' THEN 'gemini-code' END
  FROM `chats` c WHERE c.`entry_id` = `entries`.`id`
) WHERE `id` IN (SELECT `entry_id` FROM `chats` WHERE `entry_id` IS NOT NULL);--> statement-breakpoint
DELETE FROM `entry_tags` WHERE `entry_id` IN (SELECT `id` FROM `entries` WHERE `type` = 'ai')
  AND `tag_id` IN (SELECT `id` FROM `tags` WHERE `path` IN ('ai/claude', 'ai/claude-code', 'ai/gemini', 'ai/antigravity'));--> statement-breakpoint
-- Journal and AI entries: the category from the primary tag's root.
UPDATE `entries` SET `category` = (
  SELECT cat.`name` FROM `entry_tags` et JOIN `tags` t ON t.`id` = et.`tag_id`
  JOIN `categories` cat ON cat.`name` = (CASE WHEN instr(t.`path`, '/') > 0 THEN substr(t.`path`, 1, instr(t.`path`, '/') - 1) ELSE t.`path` END)
  WHERE et.`entry_id` = `entries`.`id` AND et.`position` = (SELECT min(`position`) FROM `entry_tags` WHERE `entry_id` = `entries`.`id`)
);--> statement-breakpoint
-- Videos: an entry on the day each was added, ordered by when.
INSERT INTO `entries` (`id`, `type`, `subtype`, `date`, `title`, `position`, `archived`, `created_at`, `updated_at`, `category`)
SELECT 'yt:' || v.`id`, 'video', 'youtube', v.`added_date`, v.`title`, v.`added_at`, 0,
  CASE WHEN v.`imported_at` > 0 THEN v.`imported_at` ELSE v.`added_at` END, v.`updated_at`,
  (SELECT cat.`name` FROM `yt_video_tags` vt JOIN `yt_tags` t ON t.`id` = vt.`tag_id`
    JOIN `categories` cat ON cat.`name` = (CASE WHEN instr(t.`path`, '/') > 0 THEN substr(t.`path`, 1, instr(t.`path`, '/') - 1) ELSE t.`path` END)
    WHERE vt.`video_id` = v.`id` AND vt.`position` = (SELECT min(`position`) FROM `yt_video_tags` WHERE `video_id` = v.`id`))
FROM `yt_videos` v;--> statement-breakpoint
UPDATE `yt_videos` SET `entry_id` = 'yt:' || `id`;--> statement-breakpoint
INSERT OR IGNORE INTO `tags` (`path`, `created_at`) SELECT 'youtube/' || `path`, `created_at` FROM `yt_tags`;--> statement-breakpoint
INSERT OR IGNORE INTO `entry_tags` (`entry_id`, `tag_id`, `position`)
SELECT 'yt:' || vt.`video_id`, t.`id`, vt.`position` FROM `yt_video_tags` vt JOIN `yt_tags` yt ON yt.`id` = vt.`tag_id` JOIN `tags` t ON t.`path` = 'youtube/' || yt.`path`;--> statement-breakpoint
-- Captures: an entry on the day each was first captured.
INSERT INTO `entries` (`id`, `type`, `subtype`, `date`, `title`, `position`, `archived`, `created_at`, `updated_at`, `category`)
SELECT 'cap:' || c.`id`, 'bookmark', c.`handler`, c.`captured_date`, c.`title`, c.`captured_at`, 0, c.`captured_at`, c.`updated_at`,
  (SELECT cat.`name` FROM `capture_item_tags` ct JOIN `capture_tags` t ON t.`id` = ct.`tag_id`
    JOIN `categories` cat ON cat.`name` = (CASE WHEN instr(t.`path`, '/') > 0 THEN substr(t.`path`, 1, instr(t.`path`, '/') - 1) ELSE t.`path` END)
    WHERE ct.`capture_id` = c.`id` AND ct.`position` = (SELECT min(`position`) FROM `capture_item_tags` WHERE `capture_id` = c.`id`))
FROM `captures` c;--> statement-breakpoint
UPDATE `captures` SET `entry_id` = 'cap:' || `id`;--> statement-breakpoint
INSERT OR IGNORE INTO `tags` (`path`, `created_at`) SELECT 'bookmark/' || `path`, `created_at` FROM `capture_tags`;--> statement-breakpoint
INSERT OR IGNORE INTO `entry_tags` (`entry_id`, `tag_id`, `position`)
SELECT 'cap:' || ct.`capture_id`, t.`id`, ct.`position` FROM `capture_item_tags` ct JOIN `capture_tags` c ON c.`id` = ct.`tag_id` JOIN `tags` t ON t.`path` = 'bookmark/' || c.`path`;--> statement-breakpoint
-- Board items: media/video for videos and gifs (stored as mp4), media/image for the rest.
INSERT INTO `entries` (`id`, `type`, `subtype`, `date`, `title`, `position`, `archived`, `created_at`, `updated_at`)
SELECT 'media:' || `id`, 'media', CASE WHEN `mime` LIKE 'video/%' THEN 'video' ELSE 'image' END, `date`, '', `created_at`, 0, `created_at`, `created_at` FROM `board_items`;--> statement-breakpoint
UPDATE `board_items` SET `entry_id` = 'media:' || `id`;--> statement-breakpoint
DROP TABLE `yt_video_tags`;--> statement-breakpoint
DROP TABLE `yt_tags`;--> statement-breakpoint
DROP TABLE `capture_item_tags`;--> statement-breakpoint
DROP TABLE `capture_tags`;--> statement-breakpoint
DELETE FROM `tags` WHERE `id` NOT IN (SELECT `tag_id` FROM `entry_tags`);--> statement-breakpoint
CREATE UNIQUE INDEX `yt_videos_entry_idx` ON `yt_videos` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `captures_entry_idx` ON `captures` (`entry_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_items_entry_idx` ON `board_items` (`entry_id`);
