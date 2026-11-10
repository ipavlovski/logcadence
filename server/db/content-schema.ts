import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { ENTRY_TYPES } from '../../shared/entryTypes.ts'
import type { CaptureFields } from '../../shared/types.ts'

// content.db: the notes. Every item is an entry (shared/entryTypes.ts): a journal entry, a bookmark or a media item,
// on a day, with one category and any number of tags. A type's own data is in its table (captures, board_items),
// which points at the entry; a journal entry's nodes are its children. (Videos and AI chats moved out to their own
// apps, youtube-lib and ai-lib: see 0017_split_ai_youtube.)

// The categories an entry can be filed under (one at most), in display order.
export const categories = sqliteTable('categories', {
  name: text('name').primaryKey(),
  position: real('position').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ENTRY_TYPES }).notNull().default('journal'),
    subtype: text('subtype'), // see SUBTYPES; null for a journal entry
    category: text('category').references(() => categories.name, { onUpdate: 'cascade', onDelete: 'set null' }),
    date: text('date').notNull(), // YYYY-MM-DD journal day
    title: text('title').notNull().default(''),
    // Fractional order within the day, so inserts never renumber neighbours. Entries of other types than journal
    // and ai are ordered by time (epoch ms).
    position: real('position').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('entries_date_idx').on(t.date, t.position), index('entries_type_idx').on(t.type, t.subtype), index('entries_category_idx').on(t.category)],
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
  // Full slash-separated path ("system/windows/powertoys"); ancestors are implicit.
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
    position: integer('position').notNull(), // display order
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tagId] }), index('entry_tags_tag_idx').on(t.tagId)],
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

// Web pages captured by the Chrome extension (extension/) for the canvas Bookmarks tab (see server/lib/captures.ts):
// a screenshot with the page's url, title and icon, plus notes, comments and images. Each is an entry
// (bookmark/<handler>, id `cap:<capture id>`), which holds its tags and category. A capture's handler (shared/handlers.ts) is what its url made it: a Reddit post,
// a Marketplace listing, any other page.

export const captures = sqliteTable(
  'captures',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }), // always set, as yt_videos'
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
  (t) => [uniqueIndex('captures_handler_key_idx').on(t.handler, t.key), index('captures_date_idx').on(t.capturedDate, t.capturedAt), uniqueIndex('captures_entry_idx').on(t.entryId)],
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

// The image board (Images tab): pasted images, gifs and videos kept as a scratchpad, in rows under a day. Each is an
// entry (media/image or media/video, id `media:<item id>`).
export const boardItems = sqliteTable(
  'board_items',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }), // always set, as yt_videos'
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
  (t) => [index('board_items_day_idx').on(t.date, t.row, t.position), uniqueIndex('board_items_entry_idx').on(t.entryId)],
)
