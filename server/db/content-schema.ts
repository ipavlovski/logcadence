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

// Spotify listening history for the canvas Spotify tab, synced from the Web API.

// One row per play (Spotify counts a play after ~30s), with the playlist/album it was played from.
export const spotifyPlays = sqliteTable(
  'spotify_plays',
  {
    playedAt: integer('played_at').primaryKey(), // epoch ms; one play per timestamp
    date: text('date').notNull(), // local YYYY-MM-DD
    trackId: text('track_id').notNull(),
    trackName: text('track_name').notNull(),
    artists: text('artists').notNull(),
    album: text('album').notNull(),
    imageUrl: text('image_url'),
    durationMs: integer('duration_ms').notNull(),
    contextType: text('context_type'), // playlist | album | artist | null (e.g. liked songs, search)
    contextUri: text('context_uri'),
  },
  (t) => [index('spotify_plays_date_idx').on(t.date)],
)

// Liked songs with the day they were liked.
export const spotifyLikes = sqliteTable(
  'spotify_likes',
  {
    trackId: text('track_id').primaryKey(),
    addedAt: integer('added_at').notNull(),
    date: text('date').notNull(),
    trackName: text('track_name').notNull(),
    artists: text('artists').notNull(),
  },
  (t) => [index('spotify_likes_date_idx').on(t.date)],
)

// Names of the playlists/albums plays came from.
export const spotifyContexts = sqliteTable('spotify_contexts', {
  uri: text('uri').primaryKey(),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  fetchedAt: integer('fetched_at').notNull(),
})

// GPS days for the canvas Map tab, classified into stays and movements (see server/lib/gps/classify.ts).

// Places stayed at (≥ 5 min within 120 m), shared across days so they can be named once.
export const gpsPlaces = sqliteTable('gps_places', {
  id: text('id').primaryKey(),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
})

export const gpsDays = sqliteTable('gps_days', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  // Source file fingerprint (mtime:size); an unchanged file is not processed again.
  sourceStamp: text('source_stamp').notNull(),
  dayStart: integer('day_start').notNull(), // local midnight, epoch ms
  homebaseId: text('homebase_id'),
  // Set when the homebase was picked by hand (e.g. a hotel while travelling).
  homebaseOverride: integer('homebase_override', { mode: 'boolean' }).notNull().default(false),
  pointCount: integer('point_count').notNull(),
  processedAt: integer('processed_at').notNull(),
})

// The day's timeline: rows tile the day (A, B, A->B, B->B, B->A, A->A, gap).
export const gpsSegments = sqliteTable(
  'gps_segments',
  {
    date: text('date')
      .notNull()
      .references(() => gpsDays.date, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: text('kind').notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at').notNull(),
    placeId: text('place_id'),
    fromPlaceId: text('from_place_id'),
    toPlaceId: text('to_place_id'),
    distanceM: integer('distance_m').notNull(),
    // Movements: simplified [lon, lat, seconds since day start].
    path: text('path', { mode: 'json' }).$type<[number, number, number][]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.idx] })],
)

// Computer activity for the canvas Activity tab (see server/lib/activity.ts). `input` spans are stretches of
// keyboard/mouse input (pauses under a minute included); `tracked` spans are when the recorder was running
// with the machine awake, so idle time can be told apart from time that was not recorded.
export const activitySpans = sqliteTable(
  'activity_spans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(), // host name
    kind: text('kind', { enum: ['input', 'tracked'] }).notNull(),
    startAt: integer('start_at').notNull(), // epoch ms
    endAt: integer('end_at').notNull(),
  },
  (t) => [index('activity_spans_end_idx').on(t.endAt)],
)
