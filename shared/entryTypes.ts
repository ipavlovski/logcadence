import type { ChatSource, HandlerId } from './types.ts'

// Every item is an entry with a type and (for most types) a subtype: a journal entry, a video, a bookmark, a
// media item (the image board) or an AI chat. A type's own data lives in its table (yt_videos, captures,
// board_items, chats), keyed to the entry. Written "type/subtype" where both are meant: "video/youtube".

export const ENTRY_TYPES = ['journal', 'video', 'bookmark', 'media', 'ai'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export const SUBTYPES = {
  journal: [],
  // youtube = a YouTube video; yt = a YouTube Short; ig = an Instagram reel; tt = a TikTok.
  video: ['youtube', 'yt', 'ig', 'tt'],
  bookmark: ['page', 'reddit', 'marketplace'],
  media: ['image', 'video'],
  ai: ['claude-chat', 'claude-code', 'gemini-chat', 'gemini-code'],
} as const satisfies Record<EntryType, readonly string[]>

export const TYPE_LABEL: Record<EntryType, string> = { journal: 'Journal', video: 'Videos', bookmark: 'Bookmarks', media: 'Media', ai: 'AI' }

export const SUBTYPE_LABEL: Record<string, string> = {
  'video/youtube': 'YouTube',
  'video/yt': 'YouTube Shorts',
  'video/ig': 'Instagram',
  'video/tt': 'TikTok',
  'bookmark/page': 'Pages',
  'bookmark/reddit': 'Reddit',
  'bookmark/marketplace': 'Marketplace',
  'media/image': 'Images',
  'media/video': 'Videos',
  'ai/claude-chat': 'Claude',
  'ai/claude-code': 'Claude Code',
  'ai/gemini-chat': 'Gemini',
  'ai/gemini-code': 'Antigravity',
}

export const isEntryType = (v: unknown): v is EntryType => typeof v === 'string' && (ENTRY_TYPES as readonly string[]).includes(v)

/** "video" or "video/youtube" → its type and subtype; null for anything else. */
export function parseTypeRef(ref: string): { type: EntryType; subtype: string | null } | null {
  const [type, subtype, ...rest] = ref.split('/')
  if (rest.length || !isEntryType(type)) return null
  if (subtype === undefined) return { type, subtype: null }
  return (SUBTYPES[type] as readonly string[]).includes(subtype) ? { type, subtype } : null
}

export const typeRef = (type: string, subtype: string | null) => (subtype ? `${type}/${subtype}` : type)

/** An AI chat's subtype, by the source it was imported from. */
export const CHAT_SUBTYPE: Record<ChatSource, (typeof SUBTYPES.ai)[number]> = {
  claude: 'claude-chat',
  'claude-code': 'claude-code',
  gemini: 'gemini-chat',
  antigravity: 'gemini-code',
}

/** A bookmark's subtype is its handler. */
export const bookmarkSubtype = (handler: HandlerId) => handler

/** A media item's subtype: gifs are stored as mp4, so they are videos too. */
export const mediaSubtype = (mime: string): 'image' | 'video' => (mime.startsWith('video/') ? 'video' : 'image')

// The entry of a video, capture or board item has an id made from the item's own, so either finds the other.
export const videoEntryId = (videoId: string) => `yt:${videoId}`
export const captureEntryId = (captureId: string) => `cap:${captureId}`
export const mediaEntryId = (itemId: string) => `media:${itemId}`

/** Types whose entries have nodes and are ordered by hand within their day (the others by time). */
export const NOTE_TYPES = ['journal', 'ai'] as const satisfies readonly EntryType[]
