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
  /** Posted by its author: what a captured page says. */
  published?: number
  /** A bookmark's first capture. */
  captured?: number
}

/** What a bookmark or media entry's card shows; the full item comes from its own tab's API. */
export type EntryDetail =
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
  /** A journal entry's children; none for the other types. */
  nodes: NodeDTO[]
  detail: EntryDetail | null
  dates: EntryDates
  createdAt: number
  updatedAt: number
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
  /** "bookmark" or "bookmark/reddit"; any of them. */
  types?: string[]
  category?: string
  /** Only entries without a category. */
  uncategorized?: boolean
  /** Every one of them (with its subtree, unless `exact`). */
  tags?: string[]
  /** Only entries without tags. */
  untagged?: boolean
  exact?: boolean
  archived?: boolean
  date?: string
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
  type: EntryType
  subtype: string | null
  category: string | null
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

