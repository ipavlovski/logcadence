import { shiftDate } from '../shared/dates.ts'
import { TAG_SEP } from '../shared/tags.ts'
import type { EntryDTO } from '../shared/types.ts'

// Threads canvas tab: project progress over time. An entry tagged "done:<project>" marks
// progress on <project> for the entry's day; a project may be any tag path ("hp-d1", "home:coop").

export const DONE_TAG = 'done'

export type ThreadScale = 'true' | 'compact'

/** project → day → entries done that day (journal order). */
export type ThreadMap = Map<string, Map<string, EntryDTO[]>>

export function groupThreads(entries: EntryDTO[]): ThreadMap {
  const prefix = DONE_TAG + TAG_SEP
  const map: ThreadMap = new Map()
  for (const e of entries) {
    for (const t of e.tags) {
      if (!t.startsWith(prefix)) continue
      const project = t.slice(prefix.length)
      const days = map.get(project) ?? new Map<string, EntryDTO[]>()
      map.set(project, days)
      days.set(e.date, [...(days.get(e.date) ?? []), e])
    }
  }
  return map
}

/**
 * Timeline days, oldest first, ending at `end` (today) where every thread terminates.
 * True scale lists every calendar day from the first activity; compact keeps only active days.
 */
export function threadRows(active: Iterable<string>, end: string, scale: ThreadScale): string[] {
  const dates = [...new Set(active)].sort()
  if (!dates.length) return []
  const last = dates[dates.length - 1]! > end ? dates[dates.length - 1]! : end
  if (scale === 'compact') return dates.includes(last) ? dates : [...dates, last]
  const rows: string[] = []
  for (let d = dates[0]!; d <= last; d = shiftDate(d, 1)) rows.push(d)
  return rows
}
