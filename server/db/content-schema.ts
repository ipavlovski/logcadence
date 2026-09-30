import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ChatMessage } from '../../shared/types.ts'

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
