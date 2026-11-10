// Domain types shared by the server and every client (web now; electron and react-native later).

/** A node's image, gif (stored as mp4) or video, told apart by `mime`. */
export interface ImageDTO {
  id: string
  url: string
  mime: string
  /** Its size; null for images stored before sizes were (they're measured when shown). */
  width?: number | null
  height?: number | null
  /** A smaller still (a video's poster); null when the original is shown as is (gifs, small images). */
  thumbUrl?: string | null
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

/** The page an entry was captured from (with the Chrome extension): its title links to it. */
export interface EntrySource {
  url: string
  /** The handler that claims the url (shared/handlers.ts): any page, a Reddit post, a Marketplace listing. */
  handler: HandlerId
  /** "example.com", without www. */
  host: string
  /** Favicon, or the subreddit's icon. */
  iconUrl: string | null
  /** What the handler read from the page: Reddit's author, score…; a listing's price, seller… */
  fields: CaptureFields
  /** When the page says it was posted or listed (epoch ms). */
  publishedAt: number | null
}

export interface EntryDTO {
  id: string
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
  /** Its children, which hold its content. */
  nodes: NodeDTO[]
  /** Set when it was captured from a page. */
  source: EntrySource | null
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
  categories: CategoryInfo[]
  uncategorized: { active: number; archived: number }
  tags: TagInfo[]
}

/** GET /entries: a query over every entry. Each field narrows it; tags (repeated) match all. */
export interface EntryQuery {
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
}

export interface TagInfo {
  path: string
  /** Unarchived entries tagged with exactly this path. */
  active: number
  archived: number
}

export interface SearchHit {
  entryId: string
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

// ── Captures (pages sent by the Chrome extension) ──

/** The handler a capture's url picked (shared/handlers.ts): any page, a Reddit post, a Facebook Marketplace listing. */
export type HandlerId = 'page' | 'reddit' | 'marketplace'
/** What a handler read from the page (its `fields`), by key: Reddit's author, score…; a listing's price, seller… */
export type CaptureFields = Record<string, string | number>

/** What the extension sends to POST /api/capture. Images are data: urls (jpeg, png or webp). */
export interface CaptureRequest {
  /** bookmark: any page (its handler is picked by url); comment: a screenshot added to a page captured before. */
  target: 'bookmark' | 'comment'
  url: string
  title: string
  image: string
  /** The top of the image, 480 px wide. */
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
  /** The entry the page went to. */
  entryId: string
  date: string
  title: string
  /** False when the page was captured before: the screenshot went into a new node of its entry. */
  created: boolean
  /** The image went to the page's entry as a comment. */
  comment: boolean
}
