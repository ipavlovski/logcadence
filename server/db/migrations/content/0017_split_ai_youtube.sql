-- Videos and AI chats move out to their own apps: youtube-lib (yt.localhost) and ai-lib (ai.localhost), which
-- import them from this library first (`pnpm import:logcadence` in each). Here they go: their entries (with their
-- tag links, and an AI chat's prompt nodes and their images) and then their tables. Tags no entry carries any more
-- (the youtube/ subtree, mostly) go too. The asset files (thumbnails) stay on disk.
DELETE FROM `entries` WHERE `type` IN ('video', 'ai');--> statement-breakpoint
DROP TABLE `yt_images`;--> statement-breakpoint
DROP TABLE `yt_videos`;--> statement-breakpoint
DROP TABLE `yt_playlists`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
DELETE FROM `tags` WHERE `id` NOT IN (SELECT `tag_id` FROM `entry_tags`);
