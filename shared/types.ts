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
