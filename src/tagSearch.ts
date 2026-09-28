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
