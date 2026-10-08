import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { isDue, type ChecklistBody, type ChecklistDayDTO, type ChecklistDTO, type ChecklistItemBody, type ChecklistSource } from '../../shared/checklists.ts'
import { shiftDate, toIsoDate, today } from '../../shared/dates.ts'
import { newId } from '../../shared/id.ts'
import { db, eventsDb } from '../db/client.ts'
import { captures, checklistItems, checklistMarks, checklists } from '../db/content-schema.ts'
import { events } from '../db/events-schema.ts'
import { logEvent } from './events.ts'
import { notFound } from './validate.ts'

// Daily checklists: the lists and their items, what was done of each item per day, and the counts sourced items
// take from the app's data (Reddit and Bookmarks captures, YouTube edits).

type ListRow = typeof checklists.$inferSelect
type ItemRow = typeof checklistItems.$inferSelect

const toDTO = (c: ListRow, items: ItemRow[]): ChecklistDTO => ({
  id: c.id,
  title: c.title,
  startDate: c.startDate,
  endDate: c.endDate,
  weekdays: c.weekdays,
  archived: c.archived,
  items: items.map((i) => ({ id: i.id, label: i.label, target: i.target, source: i.source as ChecklistSource | null })),
})

const currentItems = (listId?: string) =>
  db
    .select()
    .from(checklistItems)
    .where(and(isNull(checklistItems.removedDate), listId ? eq(checklistItems.checklistId, listId) : undefined))
    .orderBy(asc(checklistItems.position))
    .all()

export function listChecklists(): ChecklistDTO[] {
  const items = currentItems()
  return db
    .select()
    .from(checklists)
    .orderBy(asc(checklists.position))
    .all()
    .map((c) => toDTO(c, items.filter((i) => i.checklistId === c.id)))
}

const listRow = (id: string) => db.select().from(checklists).where(eq(checklists.id, id)).get() ?? notFound('checklist')

export const getChecklist = (id: string): ChecklistDTO => toDTO(listRow(id), currentItems(id))

/**
 * Saves a checklist's items in the given order: ones with a known id are updated, others added (counting from
 * `addedDate`), and missing ones removed. A removed item that was ticked before today is kept for those days.
 */
function saveItems(listId: string, items: ChecklistItemBody[], addedDate: string) {
  const t = today()
  const existing = new Set(currentItems(listId).map((i) => i.id))
  const keep = new Set(items.map((i) => i.id).filter((id) => id && existing.has(id)))
  for (const id of existing) {
    if (keep.has(id)) continue
    db.delete(checklistMarks)
      .where(and(eq(checklistMarks.itemId, id), gte(checklistMarks.date, t)))
      .run()
    const ticked = db.select({ id: checklistMarks.itemId }).from(checklistMarks).where(eq(checklistMarks.itemId, id)).get()
    if (ticked) db.update(checklistItems).set({ removedDate: t }).where(eq(checklistItems.id, id)).run()
    else db.delete(checklistItems).where(eq(checklistItems.id, id)).run()
  }
  items.forEach((i, idx) => {
    const cols = { label: i.label, target: i.target, source: i.source, position: idx + 1 }
    if (i.id && keep.has(i.id)) db.update(checklistItems).set(cols).where(eq(checklistItems.id, i.id)).run()
    else db.insert(checklistItems).values({ id: newId(), checklistId: listId, ...cols, addedDate, createdAt: Date.now() }).run()
  })
}

export function createChecklist(b: ChecklistBody): ChecklistDTO {
  const id = newId()
  const now = Date.now()
  const last = db.select({ p: sql<number | null>`max(${checklists.position})` }).from(checklists).get()
  db.transaction(() => {
    const { items, ...cols } = b
    db.insert(checklists)
      .values({ id, ...cols, position: (last?.p ?? 0) + 1, createdAt: now, updatedAt: now })
      .run()
    // Items of a new checklist count from its first day, so earlier days can be filled in too.
    saveItems(id, items, b.startDate)
  })
  logEvent('checklist', id, 'create', { ...b })
  return getChecklist(id)
}

export function updateChecklist(id: string, b: Partial<ChecklistBody> & { archived?: boolean }): ChecklistDTO {
  const before = listRow(id)
  db.transaction(() => {
    const { items, ...cols } = b
    db.update(checklists)
      .set({ ...cols, updatedAt: Date.now() })
      .where(eq(checklists.id, id))
      .run()
    const start = cols.startDate ?? before.startDate
    // The items it started with move along with its first day.
    if (start !== before.startDate)
      db.update(checklistItems)
        .set({ addedDate: start })
        .where(and(eq(checklistItems.checklistId, id), eq(checklistItems.addedDate, before.startDate)))
        .run()
    // Items added later count from today (or its first day, if that's still ahead).
    if (items) saveItems(id, items, today() > start ? today() : start)
  })
  const op = b.archived === undefined || b.archived === before.archived ? 'edit' : b.archived ? 'archive' : 'unarchive'
  logEvent('checklist', id, op, { ...b })
  return getChecklist(id)
}

export function reorderChecklists(ids: string[]) {
  db.transaction(() => ids.forEach((id, i) => db.update(checklists).set({ position: i + 1 }).where(eq(checklists.id, id)).run()))
  logEvent('checklist', 'order', 'edit', { ids })
}

export function deleteChecklist(id: string) {
  const before = getChecklist(id)
  db.delete(checklists).where(eq(checklists.id, id)).run()
  logEvent('checklist', id, 'delete', { ...before })
}

/** What was done of an item on a day, by hand. */
export function setMark(itemId: string, date: string, count: number) {
  db.select({ id: checklistItems.id }).from(checklistItems).where(eq(checklistItems.id, itemId)).get() ?? notFound('checklist item')
  if (count <= 0) db.delete(checklistMarks).where(and(eq(checklistMarks.itemId, itemId), eq(checklistMarks.date, date))).run()
  else
    db.insert(checklistMarks)
      .values({ itemId, date, count, updatedAt: Date.now() })
      .onConflictDoUpdate({ target: [checklistMarks.itemId, checklistMarks.date], set: { count, updatedAt: Date.now() } })
      .run()
  logEvent('checklist-mark', itemId, 'edit', { date, count })
}

const localMidnight = (date: string) => new Date(date + 'T00:00:00').getTime()

/** Per source, per day in [from, to]: what the app's data counts for it. */
function autoCounts(sources: Set<string>, from: string, to: string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  const put = (source: string, date: string, n: number) => {
    if (!out.has(source)) out.set(source, new Map())
    out.get(source)!.set(date, n)
  }
  if (sources.has('reddit-posts') || sources.has('reddit-subreddits') || sources.has('bookmarks')) {
    const rows = db
      .select({ date: captures.capturedDate, kind: captures.kind, n: sql<number>`count(*)`, sites: sql<number>`count(distinct ${captures.site})` })
      .from(captures)
      .where(and(gte(captures.capturedDate, from), lte(captures.capturedDate, to)))
      .groupBy(captures.capturedDate, captures.kind)
      .all()
    for (const r of rows) {
      if (r.kind === 'bookmark') put('bookmarks', r.date, r.n)
      else put('reddit-posts', r.date, r.n), put('reddit-subreddits', r.date, r.sites)
    }
  }
  // A video counts on the days its notes, comments or tags were edited or an image (a gif or clip) was added to it.
  if (sources.has('youtube-videos')) {
    const rows = eventsDb
      .select({ ts: events.ts, entity: events.entity, op: events.op, nodeId: events.nodeId, payload: events.payload })
      .from(events)
      .where(
        and(
          gte(events.ts, localMidnight(from)),
          lt(events.ts, localMidnight(shiftDate(to, 1))),
          or(and(eq(events.entity, 'yt-video'), eq(events.op, 'edit')), and(eq(events.entity, 'yt-image'), eq(events.op, 'create'))),
        ),
      )
      .all()
    const videos = new Map<string, Set<string>>()
    for (const r of rows) {
      const video = r.entity === 'yt-video' ? r.nodeId : (r.payload.videoId as string | undefined)
      if (!video) continue
      const date = toIsoDate(new Date(r.ts))
      if (!videos.has(date)) videos.set(date, new Set())
      videos.get(date)!.add(video)
    }
    for (const [date, set] of videos) put('youtube-videos', date, set.size)
  }
  return out
}

/** Each day in [from, to], with the active checklists due that day and the items they had. */
export function checklistDays(from: string, to: string): ChecklistDayDTO[] {
  const lists = db.select().from(checklists).where(eq(checklists.archived, false)).orderBy(asc(checklists.position)).all()
  const items = lists.length
    ? db
        .select()
        .from(checklistItems)
        .where(
          inArray(
            checklistItems.checklistId,
            lists.map((c) => c.id),
          ),
        )
        .orderBy(asc(checklistItems.position))
        .all()
    : []
  const marks = new Map<string, number>()
  if (items.length)
    for (const m of db
      .select()
      .from(checklistMarks)
      .where(
        and(
          gte(checklistMarks.date, from),
          lte(checklistMarks.date, to),
          inArray(
            checklistMarks.itemId,
            items.map((i) => i.id),
          ),
        ),
      )
      .all())
      marks.set(`${m.itemId}|${m.date}`, m.count)
  const auto = autoCounts(new Set(items.map((i) => i.source).filter((s) => s != null)), from, to)

  const days: ChecklistDayDTO[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const dayLists = lists
      .filter((c) => isDue(c, date))
      .map((c) => ({
        id: c.id,
        title: c.title,
        items: items
          .filter((i) => i.checklistId === c.id && (i.removedDate == null || date < i.removedDate) && (date >= i.addedDate || marks.has(`${i.id}|${date}`)))
          .map((i) => ({
            id: i.id,
            label: i.label,
            target: i.target,
            source: i.source as ChecklistSource | null,
            count: marks.get(`${i.id}|${date}`) ?? 0,
            auto: i.source ? (auto.get(i.source)?.get(date) ?? 0) : null,
          })),
      }))
      .filter((l) => l.items.length)
    days.push({ date, lists: dayLists })
  }
  return days
}
