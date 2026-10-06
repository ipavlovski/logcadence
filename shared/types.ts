// Domain types shared by the server and every client (web now; electron and react-native later).

export interface ImageDTO {
  id: string
  url: string
  mime: string
}

export interface NodeDTO {
  id: string
  entryId: string
  content: string
  /** Fractional order within the entry. */
  position: number
  archived: boolean
  /** Image shown in the large preview; `images[0]` is the node's thumbnail. */
  activeImageId: string | null
  images: ImageDTO[]
  createdAt: number
  updatedAt: number
}

export interface EntryDTO {
  id: string
  /** Journal day, YYYY-MM-DD. */
  date: string
  title: string
  /** Fractional order within the day. */
  position: number
  archived: boolean
  /** Tag paths; the first one is the primary tag that groups the entry in the journal. */
  tags: string[]
  nodes: NodeDTO[]
  /**
   * Set when the entry was imported from an AI chat. Such entries are read-only in the journal; the full
   * transcript lives in the AI canvas tab. `nodeIds[i]` is the node for the chat's i-th prompt.
   */
  chat: { id: string; source: ChatSource; nodeIds: string[] } | null
  createdAt: number
  updatedAt: number
}

export const CHAT_SOURCES = ['claude', 'claude-code', 'gemini', 'antigravity'] as const
export type ChatSource = (typeof CHAT_SOURCES)[number]

export interface ChatTool {
  name: string
  /** Short description of the call (command, file, query…). */
  summary: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** Markdown. */
  text: string
  /** Epoch ms, when the source records it. */
  ts: number | null
  tools?: ChatTool[]
}

export interface ChatSummary {
  id: string
  source: ChatSource
  title: string
  startedAt: number
  updatedAt: number
  /** Number of user prompts. */
  turns: number
  /** Journal entry created for the chat; null once the entry is deleted. */
  entryId: string | null
  /** Journal day of the entry (the day the chat started). */
  date: string
}

export interface ChatDTO extends ChatSummary {
  messages: ChatMessage[]
  meta: Record<string, string>
}

export interface ImportCounts {
  found: number
  created: number
  updated: number
  unchanged: number
  errors: string[]
}

export type ImportReport = Partial<Record<ChatSource, ImportCounts>>

export interface ChatSourceInfo {
  source: ChatSource
  /** Locations scanned automatically (existing ones only). */
  paths: string[]
  /** How to get chats from this source into the app. */
  hint: string
}

export interface TagInfo {
  path: string
  /** Unarchived entries tagged with exactly this path. */
  active: number
  archived: number
}

export interface SearchHit {
  entryId: string
  /** Null when the entry title matched. */
  nodeId: string | null
  date: string
  title: string
  tags: string[]
  snippet: string
  archived: boolean
}

export interface CreateEntryBody {
  id?: string
  date: string
  title?: string
  tags?: string[]
  /** Place right after this entry; otherwise appended to the day. */
  afterEntryId?: string
  /** Initial child nodes; defaults to one empty node. */
  nodes?: { id?: string; content: string }[]
}

export interface UpdateEntryBody {
  title?: string
  tags?: string[]
  archived?: boolean
  date?: string
  position?: number
}

export interface CreateNodeBody {
  id?: string
  entryId: string
  content?: string
  position: number
}

export interface UpdateNodeBody {
  content?: string
  archived?: boolean
  activeImageId?: string | null
  position?: number
}

export interface SelectionBody {
  entryIds?: string[]
  nodeIds?: string[]
}

// ── Spotify canvas tab ──────────────────────────────────────────────────────

export interface SpotifyStatus {
  /** A Client ID is set (SPOTIFY_CLIENT_ID or saved from the tab). */
  configured: boolean
  connected: boolean
  /** Must be registered as a Redirect URI in the Spotify app's settings. */
  redirectUri: string
  lastSync: number | null
  error: string | null
}

export interface SpotifyContext {
  uri: string
  type: string
  name: string
}

export interface SpotifyPlay {
  playedAt: number
  trackId: string
  trackName: string
  artists: string
  album: string
  imageUrl: string | null
  durationMs: number
  context: SpotifyContext | null
}

export interface SpotifyNowPlaying {
  isPlaying: boolean
  progressMs: number
  device: string | null
  track: Omit<SpotifyPlay, 'playedAt' | 'context'> | null
  context: SpotifyContext | null
}

export interface SpotifyDayCount {
  date: string
  count: number
}

/** Where a day's listening stopped in one playlist/album: what "continue" resumes. */
export interface SpotifyResume {
  date: string
  context: SpotifyContext
  trackUri: string
  trackName: string
  artists: string
  playedAt: number
  plays: number
}

// ── Map canvas tab (GPS) ────────────────────────────────────────────────────

/** A = homebase, B = a place, X->Y = moving between them, A->A = a round trip from home, gap = no data. */
export type GpsKind = 'A' | 'B' | 'A->B' | 'B->B' | 'B->A' | 'A->A' | 'gap'
export const GPS_KINDS: GpsKind[] = ['A', 'B', 'A->B', 'B->B', 'B->A', 'A->A', 'gap']

export interface GpsPlaceDTO {
  id: string
  lat: number
  lon: number
  name: string | null
}

export interface GpsSegmentDTO {
  kind: GpsKind
  start: number
  end: number
  placeId: string | null
  fromPlaceId: string | null
  toPlaceId: string | null
  distanceM: number
  /** Movements: simplified [lon, lat, seconds since day start]. */
  path: [number, number, number][]
}

/** Rows of the timetable grouped by hand; a segment belongs to the trip its midpoint falls in. */
export interface GpsTripDTO {
  id: string
  start: number
  end: number
}

export interface GpsDayDTO {
  date: string
  dayStart: number
  homebaseId: string | null
  homebaseOverride: boolean
  pointCount: number
  segments: GpsSegmentDTO[]
  /** Places referenced by the day's segments. */
  places: GpsPlaceDTO[]
  trips: GpsTripDTO[]
  /** ms per kind; sums to the day's length. */
  totals: Record<GpsKind, number>
}

/** GPS files imported from a Google Drive folder (server/lib/gps/drive.ts). */
export interface GpsDriveStatus {
  /** A Google OAuth client is set (GOOGLE_CLIENT_ID/SECRET or saved from the settings window). */
  configured: boolean
  connected: boolean
  /** Must be an authorized redirect URI when the OAuth client is a "Web application" (Desktop clients take any). */
  redirectUri: string
  folder: { id: string; name: string } | null
  /** New files are imported in the background. */
  auto: boolean
  /** Newest day imported; automatic imports take files from this day on (it may still have grown). */
  lastDate: string | null
  running: 'new' | 'range' | null
  progress: { done: number; total: number } | null
  lastSync: number | null
  error: string | null
  result: GpsDriveResult | null
}

export interface GpsDriveResult {
  downloaded: number
  unchanged: number
  /** Days classified by the scan after the download. */
  processed: number
  errors: string[]
  /** Files in the folder dated before lastDate that aren't here: import them with a date range. */
  older: { count: number; from: string; to: string } | null
}

// ── YouTube canvas tab ──────────────────────────────────────────────────────

export interface YtPlaylistDTO {
  id: string
  title: string
  channel: string | null
  /** Videos of this playlist in the catalog (also ones since removed from it on YouTube). */
  count: number
  lastImportAt: number | null
  lastError: string | null
}

/** A video in the listing. */
export interface YtVideoSummary {
  id: string
  title: string
  channel: string
  channelUrl: string | null
  channelAvatar: string | null
  /** "15:25", as YouTube shows it. */
  duration: string | null
  /** "3.7M views" and "4 years ago", as of the last import. */
  views: string | null
  published: string | null
  /** First imported (epoch ms), and the day it counts as discovered (YYYY-MM-DD, can be changed by hand). */
  addedAt: number
  addedDate: string
  /** Tag paths, primary first. These are YouTube tags, separate from the journal's. */
  tags: string[]
  playlistIds: string[]
  /** Notes or images were added. */
  hasNotes: boolean
}

export interface YtVideoDTO extends YtVideoSummary {
  /** Markdown. */
  notes: string
  /** Image shown large; `images[0]` is the first one added. */
  activeImageId: string | null
  images: ImageDTO[]
}

export interface YtLibraryDTO {
  videos: YtVideoSummary[]
  playlists: YtPlaylistDTO[]
  /** Videos tagged with exactly each path (as TagInfo, with `archived` always 0). */
  tags: TagInfo[]
}

export interface YtImportResult {
  playlistId: string
  title: string
  /** Videos in the playlist now. */
  found: number
  /** Newly discovered (not in the catalog before). */
  added: number
  /** Already in the catalog, newly in this playlist. */
  linked: number
  error: string | null
}

export interface UpdateYtVideoBody {
  notes?: string
  tags?: string[]
  addedDate?: string
  activeImageId?: string | null
}
