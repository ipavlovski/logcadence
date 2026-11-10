import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import type { CaptureFields } from '../../shared/types.ts'

// content.db: the notes. Every item is an entry, on a day, with one category, any number of tags and its child
// nodes, which hold its content (text, images, gifs and videos). An entry captured from a page with the Chrome
// extension (extension/, server/lib/captures.ts) also has the page's url and what its handler read from it.
// (Bookmarks and the image board became plain entries in 0018_entries_only; videos and AI chats moved out to
// youtube-lib and ai-lib in 0017_split_ai_youtube.)

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
    category: text('category').references(() => categories.name, { onUpdate: 'cascade', onDelete: 'set null' }),
    date: text('date').notNull(), // YYYY-MM-DD journal day
    title: text('title').notNull().default(''),
    position: real('position').notNull(), // fractional order within the day, so inserts never renumber neighbours
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    // A captured page: its url (the title links to it), what makes two captures the same page (`<handler>:<key>`,
    // see shared/handlers.ts), its favicon (a file under data/assets), and what the handler read from it.
    url: text('url'),
    linkKey: text('link_key'),
    icon: text('icon'),
    fields: text('fields', { mode: 'json' }).$type<CaptureFields>().notNull().default({}),
    publishedAt: integer('published_at'), // when the page says it was posted (epoch ms)
    createdAt: integer('created_at').notNull(), // epoch ms
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('entries_date_idx').on(t.date, t.position), index('entries_category_idx').on(t.category), uniqueIndex('entries_link_key_idx').on(t.linkKey)],
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

// A node's images, gifs (stored as mp4) and videos, in gallery order.
export const images = sqliteTable(
  'images',
  {
    id: text('id').primaryKey(),
    nodeId: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    file: text('file').notNull(), // file name under data/assets
    mime: text('mime').notNull(),
    // Its size, and a smaller still (a video's poster) under data/assets; none for gifs and small images. Older
    // images have neither: they're measured when shown.
    width: integer('width'),
    height: integer('height'),
    thumb: text('thumb'),
    position: real('position').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('images_node_idx').on(t.nodeId, t.position)],
)
