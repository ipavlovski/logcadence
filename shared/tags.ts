import type { TagInfo } from './types.ts'

/** Tags are hierarchical paths: "system/windows/powertoys". */
export const TAG_SEP = '/'

/** Lowercase, no leading '#', spaces become dashes, empty segments dropped. Returns '' for junk.
 *  ':' (the separator before 0015_tag_slash) still splits, for old notes, exports and clients. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[\s,#[\]()]+/g, '-')
    .split(/[/:]/)
    .map((s) => s.replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join(TAG_SEP)
}

/** Normalized, de-duplicated tag list (order kept). */
export function cleanTags(paths: string[]): string[] {
  return [...new Set(paths.map(normalizeTag).filter(Boolean))]
}

/**
 * An entry's tags without its category: filed under `dev`, it drops a `dev` tag and `dev/react` becomes `react` (the
 * category says that much already). Normalized and de-duplicated, as cleanTags.
 */
export function withoutCategory(paths: string[], category: string | null | undefined): string[] {
  const clean = cleanTags(paths)
  if (!category) return clean
  return [...new Set(clean.flatMap((p) => (p === category ? [] : p.startsWith(category + TAG_SEP) ? [p.slice(category.length + 1)] : [p])))]
}

export function tagName(path: string): string {
  return path.slice(path.lastIndexOf(TAG_SEP) + 1)
}

export function parentTag(path: string): string | null {
  const i = path.lastIndexOf(TAG_SEP)
  return i < 0 ? null : path.slice(0, i)
}

/** Ancestor paths, root first, excluding `path` itself. */
export function ancestors(path: string): string[] {
  const parts = path.split(TAG_SEP)
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(TAG_SEP))
}

/** `path` is `root` or one of its descendants. */
export function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(root + TAG_SEP)
}

export interface TagTreeNode {
  path: string
  name: string
  /** Entries tagged with exactly this path. */
  active: number
  archived: number
  /** Including descendants (an entry tagged at two levels counts twice). */
  totalActive: number
  totalArchived: number
  children: TagTreeNode[]
}

/** Builds the tag hierarchy; ancestors that no entry uses directly appear as virtual nodes. */
export function buildTagTree(infos: TagInfo[]): TagTreeNode[] {
  const byPath = new Map<string, TagTreeNode>()
  const roots: TagTreeNode[] = []
  const get = (path: string): TagTreeNode => {
    let n = byPath.get(path)
    if (n) return n
    n = { path, name: tagName(path), active: 0, archived: 0, totalActive: 0, totalArchived: 0, children: [] }
    byPath.set(path, n)
    const parent = parentTag(path)
    ;(parent ? get(parent).children : roots).push(n)
    return n
  }
  for (const t of infos) {
    const n = get(t.path)
    n.active += t.active
    n.archived += t.archived
    for (const p of [t.path, ...ancestors(t.path)]) {
      const a = get(p)
      a.totalActive += t.active
      a.totalArchived += t.archived
    }
  }
  const sort = (list: TagTreeNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}

/** Every path in the hierarchy, including virtual ancestors. */
export function allTagPaths(infos: TagInfo[]): string[] {
  const set = new Set<string>()
  for (const t of infos) for (const p of [...ancestors(t.path), t.path]) set.add(p)
  return [...set].sort()
}
