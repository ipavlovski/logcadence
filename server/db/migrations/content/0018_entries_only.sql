-- Bookmarks and the image board become plain entries, and entry types go: an entry is a title, a category, tags,
-- a day and its child nodes, which hold all its content. A capture's entry ('cap:<id>') takes the page's url, its
-- key (as `<handler>:<key>`), icon, fields and posted time; its screenshot and notes become its first node, its
-- comments a second one. Reddit posts are tagged reddit/<subreddit>, Marketplace listings marketplace. Each day of
-- the image board becomes one untitled entry ('board:<date>') with a node per row. Entries that were ordered by
-- time go after the day's journal entries. Asset files stay as they are.
ALTER TABLE `entries` ADD `url` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `link_key` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `entries` ADD `fields` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `entries` ADD `published_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_link_key_idx` ON `entries` (`link_key`);--> statement-breakpoint
ALTER TABLE `images` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `images` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `images` ADD `thumb` text;--> statement-breakpoint
-- Captures: the page on the entry.
UPDATE `entries` SET `url` = c.`url`, `link_key` = c.`handler` || ':' || c.`key`, `icon` = c.`icon`, `fields` = c.`fields`, `published_at` = c.`published_at`
  FROM `captures` c WHERE c.`entry_id` = `entries`.`id`;--> statement-breakpoint
-- The screenshot and notes: the first node (after any the entry had).
INSERT INTO `nodes` (`id`, `entry_id`, `content`, `position`, `archived`, `active_image_id`, `created_at`, `updated_at`)
  SELECT c.`id`, c.`entry_id`, c.`notes`, coalesce((SELECT max(n.`position`) FROM `nodes` n WHERE n.`entry_id` = c.`entry_id`), 0) + 1, 0,
    coalesce(c.`active_image_id`, 'shot-' || c.`id`), c.`captured_at`, c.`updated_at`
  FROM `captures` c WHERE c.`entry_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `images` (`id`, `node_id`, `file`, `mime`, `width`, `height`, `thumb`, `position`, `created_at`)
  SELECT 'shot-' || c.`id`, c.`id`, c.`screenshot`,
    CASE WHEN lower(c.`screenshot`) LIKE '%.png' THEN 'image/png' WHEN lower(c.`screenshot`) LIKE '%.webp' THEN 'image/webp' ELSE 'image/jpeg' END,
    c.`screenshot_width`, c.`screenshot_height`, c.`thumb`, 0, c.`captured_at`
  FROM `captures` c WHERE c.`entry_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `images` (`id`, `node_id`, `file`, `mime`, `position`, `created_at`)
  SELECT ci.`id`, ci.`capture_id`, ci.`file`, ci.`mime`, ci.`position`, ci.`created_at`
  FROM `capture_images` ci JOIN `captures` c ON c.`id` = ci.`capture_id` WHERE ci.`section` = 'notes' AND c.`entry_id` IS NOT NULL;--> statement-breakpoint
-- The comments, and their screenshots: a second node.
INSERT INTO `nodes` (`id`, `entry_id`, `content`, `position`, `archived`, `active_image_id`, `created_at`, `updated_at`)
  SELECT c.`id` || '-comments', c.`entry_id`, c.`comments`, (SELECT n.`position` FROM `nodes` n WHERE n.`id` = c.`id`) + 1, 0,
    coalesce(c.`comments_active_image_id`, (SELECT ci.`id` FROM `capture_images` ci WHERE ci.`capture_id` = c.`id` AND ci.`section` = 'comments' ORDER BY ci.`position` LIMIT 1)),
    c.`captured_at`, c.`updated_at`
  FROM `captures` c
  WHERE c.`entry_id` IS NOT NULL AND (trim(c.`comments`) <> '' OR EXISTS (SELECT 1 FROM `capture_images` ci WHERE ci.`capture_id` = c.`id` AND ci.`section` = 'comments'));--> statement-breakpoint
INSERT INTO `images` (`id`, `node_id`, `file`, `mime`, `position`, `created_at`)
  SELECT ci.`id`, ci.`capture_id` || '-comments', ci.`file`, ci.`mime`, ci.`position`, ci.`created_at`
  FROM `capture_images` ci JOIN `nodes` n ON n.`id` = ci.`capture_id` || '-comments' WHERE ci.`section` = 'comments';--> statement-breakpoint
-- What the type told apart, as tags: reddit/<subreddit>, marketplace (after the entry's own tags).
INSERT OR IGNORE INTO `tags` (`path`, `created_at`)
  SELECT DISTINCT 'reddit/' || lower(trim(substr(`site`, 3))), CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `captures`
  WHERE `handler` = 'reddit' AND `site` LIKE 'r/_%' AND `entry_id` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `tags` (`path`, `created_at`)
  SELECT 'marketplace', CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE EXISTS (SELECT 1 FROM `captures` WHERE `handler` = 'marketplace' AND `entry_id` IS NOT NULL);--> statement-breakpoint
INSERT OR IGNORE INTO `entry_tags` (`entry_id`, `tag_id`, `position`)
  SELECT c.`entry_id`, t.`id`, coalesce((SELECT max(et.`position`) FROM `entry_tags` et WHERE et.`entry_id` = c.`entry_id`), -1) + 1
  FROM `captures` c JOIN `tags` t ON t.`path` = CASE c.`handler` WHEN 'marketplace' THEN 'marketplace' ELSE 'reddit/' || lower(trim(substr(c.`site`, 3))) END
  WHERE c.`entry_id` IS NOT NULL AND (c.`handler` = 'marketplace' OR (c.`handler` = 'reddit' AND c.`site` LIKE 'r/_%'));--> statement-breakpoint
-- The image board: an entry per day, a node per row, the row's items in order.
INSERT INTO `entries` (`id`, `type`, `date`, `title`, `position`, `archived`, `created_at`, `updated_at`)
  SELECT 'board:' || `date`, 'media', `date`, '', 0, 0, min(`created_at`), max(`created_at`) FROM `board_items` GROUP BY `date`;--> statement-breakpoint
CREATE TEMP TABLE `board_rows` AS
  SELECT `date`, `row`, ROW_NUMBER() OVER (PARTITION BY `date` ORDER BY `row`) AS `n`, min(`created_at`) AS `created_at`, max(`created_at`) AS `updated_at`
  FROM `board_items` GROUP BY `date`, `row`;--> statement-breakpoint
INSERT INTO `nodes` (`id`, `entry_id`, `content`, `position`, `archived`, `active_image_id`, `created_at`, `updated_at`)
  SELECT 'board:' || r.`date` || ':' || r.`n`, 'board:' || r.`date`, '', r.`n`, 0,
    (SELECT b.`id` FROM `board_items` b WHERE b.`date` = r.`date` AND b.`row` = r.`row` ORDER BY b.`position` LIMIT 1), r.`created_at`, r.`updated_at`
  FROM `board_rows` r;--> statement-breakpoint
INSERT INTO `images` (`id`, `node_id`, `file`, `mime`, `width`, `height`, `thumb`, `position`, `created_at`)
  SELECT b.`id`, 'board:' || b.`date` || ':' || r.`n`, b.`file`, b.`mime`, b.`width`, b.`height`, b.`thumb`, b.`position`, b.`created_at`
  FROM `board_items` b JOIN `board_rows` r ON r.`date` = b.`date` AND r.`row` = b.`row`;--> statement-breakpoint
-- Any tags the board items' entries had go to their day's entry; then those entries go.
INSERT OR IGNORE INTO `entry_tags` (`entry_id`, `tag_id`, `position`)
  SELECT 'board:' || b.`date`, et.`tag_id`, min(et.`position`) FROM `board_items` b JOIN `entry_tags` et ON et.`entry_id` = b.`entry_id` GROUP BY b.`date`, et.`tag_id`;--> statement-breakpoint
DROP TABLE `board_rows`;--> statement-breakpoint
DELETE FROM `entries` WHERE `type` = 'media' AND `id` NOT LIKE 'board:%';--> statement-breakpoint
-- Entries ordered by time (bookmarks, the board's days): after the day's journal entries, oldest first.
UPDATE `entries` SET `position` =
  coalesce((SELECT max(j.`position`) FROM `entries` j WHERE j.`date` = `entries`.`date` AND j.`type` = 'journal'), 0)
  + (SELECT count(*) FROM `entries` o WHERE o.`date` = `entries`.`date` AND o.`type` <> 'journal'
      AND (o.`created_at` < `entries`.`created_at` OR (o.`created_at` = `entries`.`created_at` AND o.`id` <= `entries`.`id`)))
  WHERE `type` <> 'journal';--> statement-breakpoint
DROP TABLE `board_items`;--> statement-breakpoint
DROP TABLE `capture_images`;--> statement-breakpoint
DROP TABLE `captures`;--> statement-breakpoint
DROP INDEX `entries_type_idx`;--> statement-breakpoint
ALTER TABLE `entries` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `entries` DROP COLUMN `subtype`;--> statement-breakpoint
DELETE FROM `tags` WHERE `id` NOT IN (SELECT `tag_id` FROM `entry_tags`);
