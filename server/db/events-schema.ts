import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// events.db: append-only log of every content mutation (basis for sync between devices later).

export const EVENT_OPS = ['create', 'edit', 'delete', 'archive', 'unarchive'] as const
export type EventOp = (typeof EVENT_OPS)[number]

export const EVENT_ENTITIES = ['entry', 'node', 'tag', 'image', 'yt-video', 'yt-image', 'yt-tag', 'capture', 'capture-image', 'capture-tag', 'checklist', 'checklist-mark', 'board-item'] as const
export type EventEntity = (typeof EVENT_ENTITIES)[number]

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: integer('ts').notNull(), // epoch ms
    entity: text('entity', { enum: EVENT_ENTITIES }).notNull(),
    // Id of the affected entity (a tag's path for tag events).
    nodeId: text('node_id').notNull(),
    op: text('op', { enum: EVENT_OPS }).notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('events_node_idx').on(t.nodeId), index('events_ts_idx').on(t.ts)],
)
