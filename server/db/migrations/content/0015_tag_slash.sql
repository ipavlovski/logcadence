-- Tag paths are separated by '/' instead of ':'. A path whose '/' form already exists (a Logseq-imported "a/b" next to
-- "a:b") merges into it: its links move over (one already there stays) and the tag goes, its leftover links with it.
UPDATE OR IGNORE `entry_tags` SET `tag_id` = (
  SELECT b.`id` FROM `tags` a JOIN `tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id` WHERE a.`id` = `entry_tags`.`tag_id`
) WHERE `tag_id` IN (SELECT a.`id` FROM `tags` a JOIN `tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
DELETE FROM `tags` WHERE `id` IN (SELECT a.`id` FROM `tags` a JOIN `tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
UPDATE `tags` SET `path` = replace(`path`, ':', '/') WHERE `path` LIKE '%:%';
--> statement-breakpoint
UPDATE OR IGNORE `yt_video_tags` SET `tag_id` = (
  SELECT b.`id` FROM `yt_tags` a JOIN `yt_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id` WHERE a.`id` = `yt_video_tags`.`tag_id`
) WHERE `tag_id` IN (SELECT a.`id` FROM `yt_tags` a JOIN `yt_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
DELETE FROM `yt_tags` WHERE `id` IN (SELECT a.`id` FROM `yt_tags` a JOIN `yt_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
UPDATE `yt_tags` SET `path` = replace(`path`, ':', '/') WHERE `path` LIKE '%:%';
--> statement-breakpoint
UPDATE OR IGNORE `capture_item_tags` SET `tag_id` = (
  SELECT b.`id` FROM `capture_tags` a JOIN `capture_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id` WHERE a.`id` = `capture_item_tags`.`tag_id`
) WHERE `tag_id` IN (SELECT a.`id` FROM `capture_tags` a JOIN `capture_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
DELETE FROM `capture_tags` WHERE `id` IN (SELECT a.`id` FROM `capture_tags` a JOIN `capture_tags` b ON b.`path` = replace(a.`path`, ':', '/') AND b.`id` <> a.`id`);
--> statement-breakpoint
UPDATE `capture_tags` SET `path` = replace(`path`, ':', '/') WHERE `path` LIKE '%:%';
