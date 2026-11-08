import { parseTypeRef, SUBTYPE_LABEL, TYPE_LABEL, type EntryType } from './entryTypes.ts'
import { normalizeTag } from './tags.ts'

// What a tags pane tab shows: entries narrowed by any of their metadata. Written into the tab's key (and GET
// /entries' query string) as URL parameters: "type=video&channel=WOT", "tag=dev/react".

export interface Query {
  /** "video" or "video/youtube": entries of any of them. */
  types?: string[]
  category?: string
  /** Only entries without a category. */
  uncategorized?: boolean
  /** Entries with every one of them (and their subtrees). */
  tags?: string[]
  /** Only entries without tags. */
  untagged?: boolean
  /** A video's channel. */
  channel?: string
  /** A bookmark's site. */
  site?: string
}

/** The query as URL parameters, in a fixed order (so one query is one tab key). */
export function queryToString(q: Query): string {
  const p = new URLSearchParams()
  for (const t of q.types ?? []) p.append('type', t)
  if (q.category) p.set('category', q.category)
  if (q.uncategorized) p.set('uncategorized', '1')
  for (const t of q.tags ?? []) p.append('tag', t)
  if (q.untagged) p.set('untagged', '1')
  if (q.channel) p.set('channel', q.channel)
  if (q.site) p.set('site', q.site)
  return p.toString()
}

/** Reads a query back, leaving out what isn't valid; junk reads as the empty query. */
export function parseQuery(s: string): Query {
  const p = new URLSearchParams(s)
  const q: Query = {}
  const types = [...new Set(p.getAll('type').filter((t) => parseTypeRef(t)))]
  if (types.length) q.types = types
  const category = p.get('category')?.trim()
  if (category) q.category = category
  else if (p.get('uncategorized') === '1') q.uncategorized = true
  const tags = [...new Set(p.getAll('tag').map(normalizeTag).filter(Boolean))]
  if (tags.length) q.tags = tags
  else if (p.get('untagged') === '1') q.untagged = true
  const channel = p.get('channel')
  if (channel) q.channel = channel
  const site = p.get('site')
  if (site) q.site = site
  return q
}

/** The same query, written the one way it's keyed. */
export const normalizeQuery = (s: string) => queryToString(parseQuery(s))

export const isEmptyQuery = (q: Query) => queryToString(q) === ''

/** A tab's name: "#dev/react", "Videos · WOT", "build · #well". */
export function queryLabel(q: Query): string {
  const parts = [
    ...(q.types ?? []).map((t) => SUBTYPE_LABEL[t] ?? TYPE_LABEL[t as EntryType] ?? t),
    ...(q.category ? [q.category] : q.uncategorized ? ['uncategorized'] : []),
    ...(q.channel ? [q.channel] : []),
    ...(q.site ? [q.site] : []),
    ...(q.tags ?? []).map((t) => `#${t}`),
    ...(q.untagged ? ['untagged'] : []),
  ]
  return parts.join(' · ') || 'Browse'
}

/**
 * The type whose own view shows the query (the YouTube grid, the bookmarks grid, the image board, the chat list):
 * one type, narrowed only by what that view filters by itself. Null: the query shows as a list of entries.
 */
export function typeView(q: Query): EntryType | null {
  if (q.types?.length !== 1 || q.category || q.uncategorized || (q.tags?.length ?? 0) > 1 || (q.tags?.length && q.untagged)) return null
  const t = parseTypeRef(q.types[0]!)!
  switch (t.type) {
    case 'video':
      // The grid filters by one of: a tag, untagged, a channel.
      return (t.subtype === null || t.subtype === 'youtube') && !q.site && [q.tags?.length, q.untagged, q.channel].filter(Boolean).length <= 1 ? 'video' : null
    case 'bookmark':
      return !q.channel && [q.tags?.length, q.untagged, q.site].filter(Boolean).length <= 1 ? 'bookmark' : null
    case 'ai':
    case 'media':
      return !q.tags?.length && !q.untagged && !q.channel && !q.site ? t.type : null
    default:
      return null
  }
}
