import { normalizeTag } from './tags.ts'

// What a tags pane tab shows: entries narrowed by any of their metadata. Written into the tab's key (and GET
// /entries' query string) as URL parameters: "category=build&tag=dev/react".

export interface Query {
  category?: string
  /** Only entries without a category. */
  uncategorized?: boolean
  /** Entries with every one of them (and their subtrees). */
  tags?: string[]
  /** Only entries without tags. */
  untagged?: boolean
}

/** The query as URL parameters, in a fixed order (so one query is one tab key). */
export function queryToString(q: Query): string {
  const p = new URLSearchParams()
  if (q.category) p.set('category', q.category)
  if (q.uncategorized) p.set('uncategorized', '1')
  for (const t of q.tags ?? []) p.append('tag', t)
  if (q.untagged) p.set('untagged', '1')
  return p.toString()
}

// Entry types went in 0018_entries_only: tabs saved with one of the types that became a tag read as that tag.
const TYPE_TAGS: Record<string, string> = { 'bookmark/reddit': 'reddit', 'bookmark/marketplace': 'marketplace' }

/** Reads a query back, leaving out what isn't valid (and the type= and site= of older tabs); junk reads as the empty query. */
export function parseQuery(s: string): Query {
  const p = new URLSearchParams(s)
  const q: Query = {}
  const category = p.get('category')?.trim()
  if (category) q.category = category
  else if (p.get('uncategorized') === '1') q.uncategorized = true
  const typeTags = p.getAll('type').flatMap((t) => TYPE_TAGS[t] ?? [])
  const tags = [...new Set([...p.getAll('tag'), ...typeTags].map(normalizeTag).filter(Boolean))]
  if (tags.length) q.tags = tags
  else if (p.get('untagged') === '1') q.untagged = true
  return q
}

/** The same query, written the one way it's keyed. */
export const normalizeQuery = (s: string) => queryToString(parseQuery(s))

export const isEmptyQuery = (q: Query) => queryToString(q) === ''

/** A tab's name: "#dev/react", "Build · #well" (categories capitalized). */
export function queryLabel(q: Query): string {
  const parts = [
    ...(q.category ? [q.category.charAt(0).toUpperCase() + q.category.slice(1)] : q.uncategorized ? ['uncategorized'] : []),
    ...(q.tags ?? []).map((t) => `#${t}`),
    ...(q.untagged ? ['untagged'] : []),
  ]
  return parts.join(' · ') || 'Browse'
}
