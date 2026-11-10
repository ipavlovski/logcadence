-- An entry's category isn't one of its tags too. 0016_unified_entries took the category from the first tag's root
-- and left the tag; now a dev entry loses its `dev` tag, and `dev/react` becomes `react` (where the entry has no
-- `react` already). A fab entry's `fabrication` tags (the category's name before 0019_fab_category) go the same way.
-- From here on the server keeps it so (shared/tags.ts withoutCategory, server/lib/categoryTags.ts).
CREATE TEMP TABLE `category_names` AS
  SELECT `name` AS `category`, `name` FROM `categories`
  UNION SELECT 'fab', 'fabrication' WHERE EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'fab');--> statement-breakpoint
CREATE TEMP TABLE `category_tags` AS
  SELECT et.`entry_id`, et.`tag_id`, et.`position`,
    CASE WHEN t.`path` = cn.`name` THEN NULL ELSE substr(t.`path`, length(cn.`name`) + 2) END AS `rest`
  FROM `entry_tags` et JOIN `entries` e ON e.`id` = et.`entry_id` JOIN `tags` t ON t.`id` = et.`tag_id`
  JOIN `category_names` cn ON cn.`category` = e.`category`
  WHERE t.`path` = cn.`name` OR substr(t.`path`, 1, length(cn.`name`) + 1) = cn.`name` || '/';--> statement-breakpoint
INSERT OR IGNORE INTO `tags` (`path`, `created_at`)
  SELECT DISTINCT `rest`, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM `category_tags` WHERE `rest` IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `entry_tags` (`entry_id`, `tag_id`, `position`)
  SELECT ct.`entry_id`, t.`id`, ct.`position` FROM `category_tags` ct JOIN `tags` t ON t.`path` = ct.`rest`;--> statement-breakpoint
DELETE FROM `entry_tags` WHERE EXISTS (
  SELECT 1 FROM `category_tags` ct WHERE ct.`entry_id` = `entry_tags`.`entry_id` AND ct.`tag_id` = `entry_tags`.`tag_id`
);--> statement-breakpoint
DROP TABLE `category_tags`;--> statement-breakpoint
DROP TABLE `category_names`;--> statement-breakpoint
DELETE FROM `tags` WHERE `id` NOT IN (SELECT `tag_id` FROM `entry_tags`);
