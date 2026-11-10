import type { HandlerId } from './types.ts'

// Every item is an entry with a type and (for most types) a subtype: a journal entry, a bookmark or a media item
// (the image board). A type's own data lives in its table (captures, board_items), keyed to the entry. Written
// "type/subtype" where both are meant: "bookmark/reddit". (Videos and AI chats are apps of their own now:
// youtube-lib and ai-lib.)

export const ENTRY_TYPES = ['journal', 'bookmark', 'media'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export const SUBTYPES = {
  journal: [],
  bookmark: ['page', 'reddit', 'marketplace'],
  media: ['image', 'video'],
} as const satisfies Record<EntryType, readonly string[]>

export const TYPE_LABEL: Record<EntryType, string> = { journal: 'Journal', bookmark: 'Bookmarks', media: 'Media' }

export const SUBTYPE_LABEL: Record<string, string> = {
  'bookmark/page': 'Pages',
  'bookmark/reddit': 'Reddit',
  'bookmark/marketplace': 'Marketplace',
  'media/image': 'Images',
  'media/video': 'Videos',
}

export const isEntryType = (v: unknown): v is EntryType => typeof v === 'string' && (ENTRY_TYPES as readonly string[]).includes(v)

/** "bookmark" or "bookmark/reddit" → its type and subtype; null for anything else. */
export function parseTypeRef(ref: string): { type: EntryType; subtype: string | null } | null {
  const [type, subtype, ...rest] = ref.split('/')
  if (rest.length || !isEntryType(type)) return null
  if (subtype === undefined) return { type, subtype: null }
  return (SUBTYPES[type] as readonly string[]).includes(subtype) ? { type, subtype } : null
}

export const typeRef = (type: string, subtype: string | null) => (subtype ? `${type}/${subtype}` : type)

/** A bookmark's subtype is its handler. */
export const bookmarkSubtype = (handler: HandlerId) => handler

/** A media item's subtype: gifs are stored as mp4, so they are videos too. */
export const mediaSubtype = (mime: string): 'image' | 'video' => (mime.startsWith('video/') ? 'video' : 'image')

// The entry of a capture or board item has an id made from the item's own, so either finds the other.
export const captureEntryId = (captureId: string) => `cap:${captureId}`
export const mediaEntryId = (itemId: string) => `media:${itemId}`

/** Types whose entries have nodes and are ordered by hand within their day (the others by time). */
export const NOTE_TYPES = ['journal'] as const satisfies readonly EntryType[]
