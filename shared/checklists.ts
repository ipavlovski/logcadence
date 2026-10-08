// Daily checklists (the dashboard's Checklists section). A checklist is due on the days between its start and end
// date (none: ongoing) that fall on one of its weekdays. Each item has a target: 1 is a checkbox, more is a counter
// ("save 50 posts"). An item can count on its own from the app's data (a source); +/− then add to that by hand.

export const CHECKLIST_SOURCES = ['reddit-posts', 'reddit-subreddits', 'bookmarks', 'youtube-videos'] as const
export type ChecklistSource = (typeof CHECKLIST_SOURCES)[number]

export const SOURCE_LABELS: Record<ChecklistSource, string> = {
  'reddit-posts': 'Reddit posts saved',
  'reddit-subreddits': 'Subreddits saved from',
  bookmarks: 'Bookmarks added',
  'youtube-videos': 'YouTube videos annotated',
}

/** Bit i is weekday i, Sunday first (Date.getDay()). */
export const EVERY_DAY = 0b111_1111
export const WEEKDAYS_ONLY = 0b011_1110

export interface ChecklistItemDTO {
  id: string
  label: string
  target: number
  source: ChecklistSource | null
}

export interface ChecklistDTO {
  id: string
  title: string
  startDate: string
  /** Last day it is due; null runs on. */
  endDate: string | null
  weekdays: number
  archived: boolean
  items: ChecklistItemDTO[]
}

/** Items of a checklist being saved: ones with an id are kept (in this order), others are added, missing ones removed. */
export interface ChecklistItemBody {
  id?: string
  label: string
  target: number
  source: ChecklistSource | null
}

export interface ChecklistBody {
  title: string
  startDate: string
  endDate: string | null
  weekdays: number
  items: ChecklistItemBody[]
}

export interface ChecklistDayItem extends ChecklistItemDTO {
  /** Counted by hand (for a sourced item, on top of `auto`). */
  count: number
  /** Counted from the app's data, for an item with a source. */
  auto: number | null
}

/** A day's due checklists, with the items they had that day. */
export interface ChecklistDayDTO {
  date: string
  lists: { id: string; title: string; items: ChecklistDayItem[] }[]
}

export function isDue(c: Pick<ChecklistDTO, 'startDate' | 'endDate' | 'weekdays'>, date: string): boolean {
  if (date < c.startDate || (c.endDate != null && date > c.endDate)) return false
  return (c.weekdays & (1 << new Date(date + 'T12:00:00').getDay())) !== 0
}

export const itemTotal = (i: Pick<ChecklistDayItem, 'count' | 'auto'>) => i.count + (i.auto ?? 0)
export const itemDone = (i: ChecklistDayItem) => itemTotal(i) >= i.target

/** 0–1: the items' progress averaged, so a half-done counter counts as half an item. */
export function listProgress(items: ChecklistDayItem[]): number {
  if (!items.length) return 1
  return items.reduce((n, i) => n + Math.min(itemTotal(i) / i.target, 1), 0) / items.length
}

/** Days from start to end, both included. */
export function spanDays(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86_400_000) + 1
}
