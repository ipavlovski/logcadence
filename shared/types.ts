// Domain types shared by the server and every client (web now; electron and react-native later).

/** A gallery item: an image, gif or (in journal nodes) a video, told apart by `mime`. */
export interface ImageDTO {
  id: string
  url: string
  mime: string
}

export const isVideo = (m: { mime: string }) => m.mime.startsWith('video/')

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
  /** Files sent with a prompt. */
  attachments?: ChatAttachment[]
}

export interface ChatAttachment {
  name: string
  /** Kind, type, size or pages, e.g. "document · 3 pages". */
  meta?: string
  /** Text the AI app extracted from the file (.md, .docx, .txt…). */
  text?: string
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
  /** Signed in for live sync (claude.ai, desktop app only); absent when the source has no live sync. */
  connected?: boolean
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

// ── Canvas dashboard ────────────────────────────────────────────────────────

/** A count for one journal day (heatmaps). */
export interface DayCount {
  date: string
  count: number
}

/** GPS movement on one day: the A->B, B->B, B->A and A->A rows. */
export interface TravelDay {
  date: string
  distanceM: number
  movingMs: number
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
  /** Videos in the playlist at the last import. */
  count: number | null
  lastImportAt: number | null
  lastError: string | null
  /** While an import runs: listing the playlist, then (Data API) fetching new videos' details. */
  progress: { phase: 'listing' | 'details'; done: number; total: number } | null
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
  /** "3.7M views", as of the last import. */
  views: string | null
  /** "4 years ago" as of an import without an API key; publishedAt (epoch ms) comes from the Data API. */
  published: string | null
  publishedAt: number | null
  /**
   * The thumbnail downloaded into the library (largest YouTube has), and a 480×360 one for the grid; null until
   * downloaded (show YouTube's own meanwhile). thumbSize: maxres = 1280×720, sd = 640×480, hq = 480×360, none =
   * YouTube has none.
   */
  thumbUrl: string | null
  thumbSmallUrl: string | null
  thumbSize: 'maxres' | 'sd' | 'hq' | 'none' | null
  /**
   * When it was added to a playlist (epoch ms) and that local day: from the Data API, or without an API key,
   * when an import first saw it.
   */
  addedAt: number
  addedDate: string
  /** First imported (epoch ms). */
  importedAt: number
  /** Tag paths, primary first. These are YouTube tags, separate from the journal's. */
  tags: string[]
  /** Notes or images were added. */
  hasNotes: boolean
}

export type YtImageSection = 'notes' | 'comments'

export interface YtVideoDTO extends YtVideoSummary {
  /** Markdown. */
  notes: string
  /** Notes image shown large. */
  activeImageId: string | null
  images: ImageDTO[]
  /** Comments worth keeping (markdown), with their screenshots. */
  comments: string
  commentsActiveImageId: string | null
  commentImages: ImageDTO[]
}

export interface YtLibraryDTO {
  videos: YtVideoSummary[]
  /** Videos tagged with exactly each path (as TagInfo, with `archived` always 0). */
  tags: TagInfo[]
}

export interface YtSettingsDTO {
  auto: boolean
  /** The key's last characters ("…x7Qa"), or null without one. */
  apiKey: string | null
  /** The key comes from YOUTUBE_API_KEY, not the settings window. */
  apiKeyFromEnv: boolean
}

export interface YtImportResult {
  playlistId: string
  title: string
  /** Videos in the playlist now. */
  found: number
  /** New to the catalog. */
  added: number
  /** Known videos whose added date moved earlier (a real date from the Data API). */
  redated: number
  /** Private or deleted videos in the playlist, left out. */
  unavailable: number
  /** Added dates came from the Data API (an API key is set). */
  dated: boolean
  error: string | null
}

/** Thumbnail downloads (they run in the background after an import). */
export interface YtThumbStatus {
  running: boolean
  done: number
  total: number
  /** Failed this run; tried again at the next import or start. */
  failed: number
  /** Videos still without a downloaded thumbnail. */
  pending: number
  error: string | null
}

// ── Reddit and Bookmarks canvas tabs (pages captured by the Chrome extension) ──

export type CaptureKind = 'reddit' | 'bookmark'
export type CaptureSection = 'notes' | 'comments'

/** A capture in the listing. */
export interface CaptureSummary {
  id: string
  kind: CaptureKind
  url: string
  title: string
  /** A bookmark's host ("example.com"); a Reddit post's subreddit ("r/selfhosted"). */
  site: string
  /** Favicon, or the subreddit's icon. */
  iconUrl: string | null
  /** The whole screenshot, and the top of it (480 px wide) for the grid. */
  screenshotUrl: string
  thumbUrl: string | null
  width: number | null
  height: number | null
  /** Reddit posts, as the page showed them when captured. */
  author: string | null
  score: number | null
  commentCount: number | null
  postedAt: number | null
  /** First captured (epoch ms) and that local day. */
  capturedAt: number
  capturedDate: string
  /** Last edited or captured again. */
  updatedAt: number
  /** Tag paths, primary first: the tab's own tags. */
  tags: string[]
  /** Notes or note images were added. */
  hasNotes: boolean
  /** Comments or comment screenshots were added. */
  hasComments: boolean
}

export interface CaptureDTO extends CaptureSummary {
  notes: string
  activeImageId: string | null
  images: ImageDTO[]
  comments: string
  commentsActiveImageId: string | null
  commentImages: ImageDTO[]
}

export interface CaptureLibraryDTO {
  items: CaptureSummary[]
  /** Captures tagged with exactly each path (as TagInfo, with `archived` always 0). */
  tags: TagInfo[]
}

export interface UpdateCaptureBody {
  notes?: string
  comments?: string
  tags?: string[]
  activeImageId?: string | null
  commentsActiveImageId?: string | null
}

/** What the extension sends to POST /api/capture. Images are data: urls (jpeg, png or webp). */
export interface CaptureRequest {
  /** reddit: a post; bookmark: any page; comment: a screenshot for the comments of a Reddit post already captured. */
  target: CaptureKind | 'comment'
  url: string
  title: string
  image: string
  /** The top of the image, 480 px wide, for the grid. */
  thumb?: string
  width?: number
  height?: number
  /** Favicon, or the subreddit's icon. */
  icon?: string
  /** Read from a Reddit post's page. */
  post?: { subreddit?: string; author?: string; score?: number; comments?: number; postedAt?: number }
}

export interface CaptureResult {
  kind: CaptureKind
  id: string
  title: string
  /** False when the page was captured before: its screenshot was replaced. */
  created: boolean
  /** The image went to the post's comments. */
  comment: boolean
}

export interface UpdateYtVideoBody {
  notes?: string
  comments?: string
  tags?: string[]
  activeImageId?: string | null
  commentsActiveImageId?: string | null
}
