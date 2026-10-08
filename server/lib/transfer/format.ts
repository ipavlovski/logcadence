import * as content from '../../db/content-schema.ts'
import * as events from '../../db/events-schema.ts'
import type { ContentDb, EventsDb } from '../../db/open.ts'

// The data export: a zip that any build (desktop, web, later mobile) can import into an empty library.
//
//   manifest.json          Manifest (below)
//   tables/<name>.ndjson   one row per line, as drizzle selects it (JSON columns nested, booleans, epoch ms)
//   assets/<file>          pasted media, stored as is
//   gps/<file>             raw GPS days (the map's source data)
//   settings.json          Settings: no secrets, so Spotify has to be connected again after an import
//
// The journal markdown mirror is left out: it is derived from the database and rebuilt on start.

export const FORMAT = 'logcadence-export'
// Exports written before the rename to logcadence.
export const LEGACY_FORMATS = ['logseq-rewrite-export']
// Bumped only when existing rows change meaning; new optional columns don't need it. An importer upgrades
// rows from older versions (see upgradeRow in import.ts) and refuses newer ones.
export const FORMAT_VERSION = 1

// Insert order: parents before the rows that reference them.
export const CONTENT_TABLES = {
  tags: content.tags,
  entries: content.entries,
  nodes: content.nodes,
  entry_tags: content.entryTags,
  images: content.images,
  chats: content.chats,
  spotify_plays: content.spotifyPlays,
  spotify_likes: content.spotifyLikes,
  spotify_contexts: content.spotifyContexts,
  gps_places: content.gpsPlaces,
  gps_days: content.gpsDays,
  gps_segments: content.gpsSegments,
  gps_trips: content.gpsTrips,
  activity_spans: content.activitySpans,
  yt_playlists: content.ytPlaylists,
  yt_videos: content.ytVideos,
  yt_tags: content.ytTags,
  yt_video_tags: content.ytVideoTags,
  yt_images: content.ytImages,
  captures: content.captures,
  capture_tags: content.captureTags,
  capture_item_tags: content.captureItemTags,
  capture_images: content.captureImages,
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
  gps: FileSet
}

export interface Settings {
  spotify?: { clientId?: string }
}

/** A library to export from: its open databases and folders. */
export interface Library {
  db: ContentDb
  eventsDb: EventsDb
  dataDir: string
  gpsDir: string
}

export type Progress = (p: { phase: 'tables' | 'assets' | 'gps'; done: number; total: number }) => void
