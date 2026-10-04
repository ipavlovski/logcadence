import { shiftDate } from '../shared/dates.ts'
import { TAG_SEP } from '../shared/tags.ts'
import type { EntryDTO } from '../shared/types.ts'

// Progress canvas tab: project progress over time. An entry tagged "tasks:progress" (in any position)
// marks progress for the entry's day on the project given by its full primary tag path ("project:coop");
// entries whose primary tag is "tasks:progress" itself go to the untagged project.

export const PROGRESS_TAG = 'tasks:progress'
/** Project key of entries without a primary tag of their own; no tag path is empty. */
export const UNTAGGED = ''

export type ProgressScale = 'true' | 'compact'

/** project → day → entries with progress that day (journal order). */
export type ProgressMap = Map<string, Map<string, EntryDTO[]>>

export function progressProject(e: EntryDTO): string {
  const primary = e.tags[0]
  return primary && primary !== PROGRESS_TAG ? primary : UNTAGGED
}

/**
 * Display name per project: the tag's last segment, with parent segments prepended only as far as
 * needed to tell apart projects ending the same way ("project:coop" and "home:coop" stay whole).
 */
export function progressLabels(projects: string[]): Map<string, string> {
  const parts = new Map(projects.map((p) => [p, p.split(TAG_SEP)]))
  const depth = new Map(projects.map((p) => [p, 1]))
  const label = (p: string) => (p === UNTAGGED ? 'untagged' : parts.get(p)!.slice(-depth.get(p)!).join(TAG_SEP))
  for (let clash = true; clash; ) {
    clash = false
    const byLabel = new Map<string, string[]>()
    for (const p of projects) byLabel.set(label(p), [...(byLabel.get(label(p)) ?? []), p])
    for (const group of byLabel.values()) {
      if (group.length < 2) continue
      for (const p of group) {
        if (depth.get(p)! >= parts.get(p)!.length) continue
        depth.set(p, depth.get(p)! + 1)
        clash = true
      }
    }
  }
  return new Map(projects.map((p) => [p, label(p)]))
}

/** Projects ordered by display name, so lines that end the same way sit side by side. */
export function sortProjects(projects: string[]): string[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
  const last = (p: string) => (p === UNTAGGED ? 'untagged' : p.slice(p.lastIndexOf(TAG_SEP) + 1))
  return [...projects].sort((a, b) => cmp(last(a), last(b)) || cmp(a, b))
}

export function groupProgress(entries: EntryDTO[]): ProgressMap {
  const map: ProgressMap = new Map()
  for (const e of entries) {
    if (!e.tags.includes(PROGRESS_TAG)) continue
    const project = progressProject(e)
    const days = map.get(project) ?? new Map<string, EntryDTO[]>()
    map.set(project, days)
    days.set(e.date, [...(days.get(e.date) ?? []), e])
  }
  return map
}

/**
 * Timeline days, oldest first, ending at `end` (today) where every line terminates.
 * True scale lists every calendar day from the first activity; compact keeps only active days.
 */
export function progressRows(active: Iterable<string>, end: string, scale: ProgressScale): string[] {
  const dates = [...new Set(active)].sort()
  if (!dates.length) return []
  const last = dates[dates.length - 1]! > end ? dates[dates.length - 1]! : end
  if (scale === 'compact') return dates.includes(last) ? dates : [...dates, last]
  const rows: string[] = []
  for (let d = dates[0]!; d <= last; d = shiftDate(d, 1)) rows.push(d)
  return rows
}
