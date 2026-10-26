import { TAG_SEP } from '../shared/tags.ts'

/** Ranks tag paths for a query: exact, path prefix, segment prefix, then substring. */
export function rankTags(paths: string[], query: string, limit = 50): string[] {
  const q = query.trim().replace(/^#/, '').toLowerCase()
  if (!q) return paths.slice(0, limit)
  const scored: [number, string][] = []
  for (const p of paths) {
    let score = -1
    if (p === q) score = 0
    else if (p.startsWith(q)) score = 1
    else if (p.split(TAG_SEP).some((s) => s.startsWith(q))) score = 2
    else if (p.includes(q)) score = 3
    if (score >= 0) scored.push([score, p])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map(([, p]) => p)
}

export interface TagSuggestion {
  path: string
  /** Has tags under it: completing it adds the separator and moves on to the next level. */
  branch: boolean
}

/** What's typed, as a path prefix: lowercase, no '#', spaces as dashes, ':' read as the separator. */
export const tagQuery = (text: string) => text.trimStart().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replaceAll(':', TAG_SEP)

/**
 * Suggestions for a partly typed path, a level at a time: the children of what's typed up to the last separator whose
 * name starts with the rest (then those containing it). On the first level, deeper paths matching the text follow.
 * `taken` paths are left out unless they have children to complete into.
 */
export function suggestTags(paths: string[], text: string, taken: string[] = [], limit = 8): TagSuggestion[] {
  const q = tagQuery(text)
  const cut = q.lastIndexOf(TAG_SEP)
  const parent = q.slice(0, cut + 1)
  const part = q.slice(cut + 1)
  const branches = new Set(paths.map((p) => p.slice(0, p.lastIndexOf(TAG_SEP))).filter(Boolean))
  const usable = (p: string) => !taken.includes(p) || branches.has(p)
  const name = (p: string) => p.slice(parent.length)
  const level = paths
    .filter((p) => p.length > parent.length && p.startsWith(parent) && !name(p).includes(TAG_SEP) && name(p).includes(part) && usable(p))
    .sort((a, b) => Number(!name(a).startsWith(part)) - Number(!name(b).startsWith(part)) || name(a).localeCompare(name(b), undefined, { numeric: true }))
  // Paths under a suggested one are a level away from it, not listed again.
  const listed = (p: string) => level.some((l) => p === l || p.startsWith(l + TAG_SEP))
  const deeper = cut < 0 && part ? rankTags(paths.filter((p) => !listed(p) && !taken.includes(p)), part, limit) : []
  return [...level, ...deeper].slice(0, limit).map((path) => ({ path, branch: branches.has(path) }))
}
