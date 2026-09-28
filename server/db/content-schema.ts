import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
