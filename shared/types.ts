// Domain types shared by the server and every client (web now; electron and react-native later).

import type { EntryType } from './entryTypes.ts'

/** A gallery item: an image, gif or (in journal nodes) a video, told apart by `mime`. */
export interface ImageDTO {
  id: string
  url: string
  mime: string
}

/** An image, gif or video on the image board, in a row under a day. */
export interface BoardItemDTO {
  id: string
  /** The item's entry (`media:<id>`). */
  entryId: string
  date: string
  row: number
  position: number
  url: string
  /** A smaller still (a video's poster); null when the original is shown as is (gifs, small images). */
  thumbUrl: string | null
  mime: string
  width: number
  height: number
}

export interface BoardDayDTO {
  date: string
  items: BoardItemDTO[]
}

export interface BoardPageDTO {
  days: BoardDayDTO[]
  /** Pass as `before` for older days; null when there are none. */
  next: string | null
}

export interface MoveBoardItemBody {
  date: string
  row: number
  position: number
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

/** When things happened to an entry (epoch ms); which of them there are depends on its type. */
export interface EntryDates {
  created: number
  updated: number
  /** Posted by its author: a video's publish date, what a captured page says. */
  published?: number
  /** Added to a YouTube playlist. */
  added?: number
  /** First imported into the app (videos, AI chats). */
  imported?: number
  /** A bookmark's first capture. */
  captured?: number
  /** An AI chat's start. */
  started?: number
}

/** What a video, bookmark or media entry's card shows; the full item comes from its own tab's API. */
export type EntryDetail =
  | { kind: 'video'; id: string; channel: string; channelAvatar: string | null; duration: string | null; thumbUrl: string | null }
  | { kind: 'bookmark'; id: string; handler: HandlerId; url: string; site: string; iconUrl: string | null; thumbUrl: string | null }
  | { kind: 'media'; id: string; url: string; thumbUrl: string | null; mime: string; width: number; height: number }

export interface EntryDTO {
  id: string
  type: EntryType
  /** See SUBTYPES (shared/entryTypes.ts); null for journal entries. */
  subtype: string | null
  /** At most one; null when uncategorized. */
  category: string | null
  /** Journal day, YYYY-MM-DD. */
  date: string
  title: string
  /** Fractional order within the day. */
  position: number
  archived: boolean
  /** Tag paths, in display order. */
  tags: string[]
  /** A journal (or AI chat) entry's children; none for the other types. */
  nodes: NodeDTO[]
  detail: EntryDetail | null
  dates: EntryDates
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

export interface CategoryInfo {
  name: string
  /** Unarchived entries filed under it. */
  active: number
  archived: number
}

/** GET /meta: what entries can be filtered by, with counts. */
export interface MetaDTO {
  types: { type: EntryType; subtype: string | null; active: number; archived: number }[]
  categories: CategoryInfo[]
  uncategorized: { active: number; archived: number }
  tags: TagInfo[]
}

/** GET /entries: a query over every entry. Each field narrows it; repeated ones (types, tags) match any / all. */
export interface EntryQuery {
  /** "video" or "video/youtube"; any of them. */
  types?: string[]
  category?: string
  /** Only entries without a category. */
  uncategorized?: boolean
  /** Every one of them (with its subtree, unless `exact`). */
  tags?: string[]
  exact?: boolean
  archived?: boolean
  date?: string
  /** A video's channel. */
  channel?: string
  /** A bookmark's site ("example.com", "r/selfhosted"). */
  site?: string
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
  category?: string | null
  /** Place right after this entry; otherwise appended to the day. */
  afterEntryId?: string
  /** Initial child nodes; defaults to one empty node. */
  nodes?: { id?: string; content: string }[]
}

export interface UpdateEntryBody {
  title?: string
  tags?: string[]
  /** null: uncategorized. */
  category?: string | null
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

// ── Heatmaps ────────────────────────────────────────────────────────────────

/** A count for one journal day (heatmaps). */
export interface DayCount {
  date: string
  count: number
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
  /** The video's entry (`yt:<id>`), which holds its tags and category. */
  entryId: string
  category: string | null
  /** Tag paths, in order. */
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

// ── Bookmarks canvas tab (pages captured by the Chrome extension) ──

/** The handler a capture's url picked (shared/handlers.ts): any page, a Reddit post, a Facebook Marketplace listing. */
export type HandlerId = 'page' | 'reddit' | 'marketplace'
export type CaptureSection = 'notes' | 'comments'
/** What a handler read from the page (its `fields`), by key: Reddit's author, score…; a listing's price, seller… */
export type CaptureFields = Record<string, string | number>

/** A capture in the listing. */
export interface CaptureSummary {
  id: string
  handler: HandlerId
  url: string
  title: string
  /** A page's host ("example.com"), a Reddit post's subreddit ("r/selfhosted"), a listing's location. */
  site: string
  /** Favicon, or the subreddit's icon. */
  iconUrl: string | null
  /** The whole screenshot, and the top of it (480 px wide) for the grid. */
  screenshotUrl: string
  thumbUrl: string | null
  width: number | null
  height: number | null
  /** As the page showed them when captured (or as edited since). */
  fields: CaptureFields
  /** When the page says it was posted or listed (epoch ms). */
  publishedAt: number | null
  /** First captured (epoch ms) and that local day. */
  capturedAt: number
  capturedDate: string
  /** Last edited or captured again. */
  updatedAt: number
  /** The capture's entry (`cap:<id>`), which holds its tags and category. */
  entryId: string
  category: string | null
  /** Tag paths, in order. */
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
  category?: string | null
  activeImageId?: string | null
  commentsActiveImageId?: string | null
  /** All of them: replaces what was read from the page. */
  fields?: CaptureFields
  publishedAt?: number | null
}

/** What the extension sends to POST /api/capture. Images are data: urls (jpeg, png or webp). */
export interface CaptureRequest {
  /** bookmark: any page (its handler is picked by url); comment: a screenshot for the comments of a capture made before. */
  target: 'bookmark' | 'comment'
  url: string
  title: string
  image: string
  /** The top of the image, 480 px wide, for the grid. */
  thumb?: string
  width?: number
  height?: number
  /** Favicon, or the subreddit's icon. */
  icon?: string
  /** What the page says it belongs to: a Reddit post's subreddit. */
  site?: string
  /** Read from the page by the extension's handler; the server keeps only its handler's fields. */
  fields?: CaptureFields
  publishedAt?: number
}

export interface CaptureResult {
  handler: HandlerId
  id: string
  title: string
  /** False when the page was captured before: its screenshot was replaced. */
  created: boolean
  /** The image went to the capture's comments. */
  comment: boolean
}

export interface UpdateYtVideoBody {
  notes?: string
  comments?: string
  tags?: string[]
  category?: string | null
  activeImageId?: string | null
  commentsActiveImageId?: string | null
}
