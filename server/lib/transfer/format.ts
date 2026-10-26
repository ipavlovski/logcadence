import * as content from '../../db/content-schema.ts'
import * as events from '../../db/events-schema.ts'
import type { ContentDb, EventsDb } from '../../db/open.ts'

// The data export: a zip that any build (desktop, web, later mobile) can import into an empty library.
//
//   manifest.json          Manifest (below)
//   tables/<name>.ndjson   one row per line, as drizzle selects it (JSON columns nested, booleans, epoch ms)
//   assets/<file>          pasted media, stored as is
//
// The journal markdown mirror is left out: it is derived from the database and rebuilt on start. Exports made before
// GPS, activity and checklists moved to logtracker also have their tables and a gps/ folder; an import skips them.

export const FORMAT = 'logcadence-export'
// Exports written before the rename to logcadence.
export const LEGACY_FORMATS = ['logseq-rewrite-export']
// Bumped only when existing rows change meaning; new optional columns don't need it. An importer upgrades
// rows from older versions (see upgradeRow in import.ts) and refuses newer ones.
// 2: Reddit merged into Bookmarks (captures' kind became handler, Reddit's columns became fields; one capture tag set).
export const FORMAT_VERSION = 2

// Insert order: parents before the rows that reference them.
export const CONTENT_TABLES = {
  tags: content.tags,
  entries: content.entries,
  nodes: content.nodes,
  entry_tags: content.entryTags,
  images: content.images,
  chats: content.chats,
  yt_playlists: content.ytPlaylists,
  yt_videos: content.ytVideos,
  yt_tags: content.ytTags,
  yt_video_tags: content.ytVideoTags,
  yt_images: content.ytImages,
  captures: content.captures,
  capture_tags: content.captureTags,
  capture_item_tags: content.captureItemTags,
  capture_images: content.captureImages,
  board_items: content.boardItems,
}
export const EVENTS_TABLES = { events: events.events }

export interface FileSet {
  files: number
  bytes: number
}

export interface Manifest {
  format: typeof FORMAT
  formatVersion: number
  appVersion: string
  exportedAt: string // ISO time
  /** Newest migration of each database when exported. */
  schema: { content: string; events: string }
  tables: Record<string, { rows: number; sha256: string }>
  assets: FileSet
  /** Raw GPS days, in exports made before GPS moved to logtracker. */
  gps?: FileSet
}

/** A library to export from: its open databases and folders. */
export interface Library {
  db: ContentDb
  eventsDb: EventsDb
  dataDir: string
}

export type Progress = (p: { phase: 'tables' | 'assets'; done: number; total: number }) => void
