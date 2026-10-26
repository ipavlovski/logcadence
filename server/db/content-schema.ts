import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { CaptureFields, ChatMessage } from '../../shared/types.ts'

// content.db: the notes. Entries belong to a journal day; nodes are an entry's children.

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(), // YYYY-MM-DD journal day
    title: text('title').notNull().default(''),
    // Fractional order within the day, so inserts never renumber neighbours.
    position: real('position').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('entries_date_idx').on(t.date, t.position)],
)

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''), // markdown
    position: real('position').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    // Image shown in the large preview; the first image in the gallery is the thumbnail.
    activeImageId: text('active_image_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('nodes_entry_idx').on(t.entryId, t.position)],
)

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Full colon-separated path ("system:windows:powertoys"); ancestors are implicit.
  path: text('path').notNull().unique(),
  createdAt: integer('created_at').notNull(),
})

export const entryTags = sqliteTable(
  'entry_tags',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => entries.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    // Lowest position is the primary tag, which groups the entry in the journal view.
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] }), index('entry_tags_tag_idx').on(t.tagId)],
)

// Imported AI chats. Each one owns a journal entry (one node per prompt); the full transcript
// stays here for the AI canvas tab.
export const chats = sqliteTable(
  'chats',
  {
    id: text('id').primaryKey(), // `${source}:${externalId}`
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    // Null once the user deletes the entry; re-imports then leave the chat out of the journal.
    entryId: text('entry_id').references(() => entries.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    turns: integer('turns').notNull(),
    messages: text('messages', { mode: 'json' }).$type<ChatMessage[]>().notNull(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    // Node created for each turn, so re-imports append new turns and refresh unedited ones.
    nodeIds: text('node_ids', { mode: 'json' }).$type<string[]>().notNull(),
    // Source file fingerprint (mtime:size); an unchanged file is not parsed again.
    sourceStamp: text('source_stamp'),
    importedAt: integer('imported_at').notNull(),
  },
  (t) => [index('chats_started_idx').on(t.startedAt), index('chats_entry_idx').on(t.entryId)],
)

export const images = sqliteTable(
  'images',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    file: text('file').notNull(), // file name under data/assets
    mime: text('mime').notNull(),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('images_node_idx').on(t.nodeId, t.position)],
)

// YouTube videos for the canvas YouTube tab, imported from playlists (see server/lib/youtube/). Their tags are a
// set of their own, apart from the journal's. Which playlist a video came from is not kept.

export const ytPlaylists = sqliteTable('yt_playlists', {
  id: text('id').primaryKey(), // YouTube's list id (PL…)
  title: text('title').notNull(),
  channel: text('channel'),
  createdAt: integer('created_at').notNull(),
  lastImportAt: integer('last_import_at'),
  lastImportCount: integer('last_import_count'), // videos in the playlist at the last import
  lastError: text('last_error'),
})

export const ytVideos = sqliteTable(
  'yt_videos',
  {
    id: text('id').primaryKey(), // YouTube's video id
    title: text('title').notNull(),
    channel: text('channel').notNull().default(''),
    channelUrl: text('channel_url'),
    channelAvatar: text('channel_avatar'),
    channelId: text('channel_id'), // UC…, when the import source gives it
    duration: text('duration'), // "15:25", as YouTube shows it
    views: text('views'), // "3.7M views", as of the last import
    published: text('published'), // "4 years ago", as of the last import (without an API key)
    publishedAt: integer('published_at'), // when YouTube published it (epoch ms; from the Data API)
    // When it was added to a playlist: from the Data API, or without a key, when an import first saw it. The
    // earliest playlist wins when it is in several.
    addedAt: integer('added_at').notNull(), // epoch ms
    addedDate: text('added_date').notNull(), // local YYYY-MM-DD of addedAt
    importedAt: integer('imported_at').notNull().default(0), // first imported (epoch ms)
    notes: text('notes').notNull().default(''), // markdown
    activeImageId: text('active_image_id'),
    // Comments worth keeping (markdown, plus screenshots in yt_images under 'comments').
    comments: text('comments').notNull().default(''),
    commentsActiveImageId: text('comments_active_image_id'),
    // Thumbnail files under data/assets, downloaded once: the largest YouTube has (thumbSize: maxres = 1280×720,
    // sd = 640×480, hq = 480×360) for the video page, and a 480×360 one for the grid. thumbSize null = not
    // downloaded yet (retried by the next import); 'none' = YouTube has none (a removed video).
    thumb: text('thumb'),
    thumbSmall: text('thumb_small'),
    thumbSize: text('thumb_size', { enum: ['maxres', 'sd', 'hq', 'none'] }),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('yt_videos_added_idx').on(t.addedDate, t.addedAt)],
)

export const ytTags = sqliteTable('yt_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(), // "build:well:drilling"; ancestors are implicit
  createdAt: integer('created_at').notNull(),
})

export const ytVideoTags = sqliteTable(
  'yt_video_tags',
  {
    videoId: text('video_id')
      .notNull()
      .references(() => ytVideos.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => ytTags.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // lowest is the primary tag
  },
  (t) => [primaryKey({ columns: [t.videoId, t.tagId] }), index('yt_video_tags_tag_idx').on(t.tagId)],
)

// Images and gifs pasted into a video's notes or comments; files live under data/assets like the journal's.
export const ytImages = sqliteTable(
  'yt_images',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id')
      .notNull()
      .references(() => ytVideos.id, { onDelete: 'cascade' }),
    section: text('section', { enum: ['notes', 'comments'] }).notNull().default('notes'),
    file: text('file').notNull(),
    mime: text('mime').notNull(),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('yt_images_video_idx').on(t.videoId, t.position)],
)

// Web pages captured by the Chrome extension (extension/) for the canvas Bookmarks tab (see server/lib/captures.ts):
// a screenshot with the page's url, title and icon, plus notes, comments, images and tags of their own (one tag
// set, apart from the journal's). A capture's handler (shared/handlers.ts) is what its url made it: a Reddit post,
// a Marketplace listing, any other page.

export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    handler: text('handler', { enum: ['page', 'reddit', 'marketplace'] }).notNull(),
    // What makes two captures the same page, from the handler: a Reddit post's id ("1kq2x3v"), a listing's id, a page's url without its #fragment.
    key: text('key').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    site: text('site').notNull().default(''), // a page's host ("example.com"); a Reddit post's subreddit ("r/selfhosted"); a listing's location
    icon: text('icon'), // favicon, or the subreddit's icon: a file under data/assets
    // The screenshot (a whole Reddit post, stitched; otherwise the visible page) and the top of it for the grid, jpegs under data/assets.
    screenshot: text('screenshot').notNull(),
    screenshotWidth: integer('screenshot_width'),
    screenshotHeight: integer('screenshot_height'),
    thumb: text('thumb'),
    // What the handler read from the page (a post's author and score, a listing's price…), and when the page says it was posted.
    fields: text('fields', { mode: 'json' }).$type<CaptureFields>().notNull().default({}),
    publishedAt: integer('published_at'), // epoch ms
    capturedAt: integer('captured_at').notNull(), // first captured (epoch ms); capturing again replaces the screenshot only
    capturedDate: text('captured_date').notNull(), // local YYYY-MM-DD of capturedAt
    notes: text('notes').notNull().default(''), // markdown
    activeImageId: text('active_image_id'),
    comments: text('comments').notNull().default(''), // markdown, plus screenshots in capture_images under 'comments'
    commentsActiveImageId: text('comments_active_image_id'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('captures_handler_key_idx').on(t.handler, t.key), index('captures_date_idx').on(t.capturedDate, t.capturedAt)],
)

export const captureTags = sqliteTable(
  'capture_tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    path: text('path').notNull(), // ancestors are implicit
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('capture_tags_path_idx').on(t.path)],
)

export const captureItemTags = sqliteTable(
  'capture_item_tags',
  {
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => captureTags.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(), // lowest is the primary tag
  },
  (t) => [primaryKey({ columns: [t.captureId, t.tagId] }), index('capture_item_tags_tag_idx').on(t.tagId)],
)

// Images pasted or dropped into a capture's notes or comments, and comment screenshots sent by the extension.
export const captureImages = sqliteTable(
  'capture_images',
  {
    id: text('id').primaryKey(),
    captureId: text('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    section: text('section', { enum: ['notes', 'comments'] }).notNull(),
    file: text('file').notNull(),
    mime: text('mime').notNull(),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('capture_images_capture_idx').on(t.captureId, t.position)],
)

// The image board (Images tab): pasted images, gifs and videos kept as a scratchpad, in rows under a day.
export const boardItems = sqliteTable(
  'board_items',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(), // YYYY-MM-DD day it's shown under
    row: real('row').notNull(), // fractional order of the item's row within the day
    position: real('position').notNull(), // fractional order within the row
    file: text('file').notNull(), // file name under data/assets
    thumb: text('thumb'), // smaller still (a video's poster) under data/assets; none for gifs and small images
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('board_items_day_idx').on(t.date, t.row, t.position)],
)
