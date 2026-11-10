import path from 'node:path'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { NOTE_TYPES, type EntryType } from '../../shared/entryTypes.ts'
import type { CategoryInfo, EntryDates, EntryDetail, EntryDTO, ImageDTO, NodeDTO } from '../../shared/types.ts'
import { cleanTags, isUnder, normalizeTag, TAG_SEP } from '../../shared/tags.ts'
import { db } from '../db/client.ts'
import { boardItems, captures, categories, entries, entryTags, images, nodes, tags } from '../db/content-schema.ts'
import { logEvent } from './events.ts'
import { bad, notFound } from './validate.ts'

type NodeRow = typeof nodes.$inferSelect
type ImageRow = typeof images.$inferSelect

export const imageUrl = (file: string) => `/assets/${file}`

/** Extension for an uploaded file's name under assets/: its own, or one from its type. */
export function extension(file: File): string {
  const fromName = path.extname(file.name).slice(1).toLowerCase()
  const ext = /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : (file.type.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5)
  return ext || 'bin'
}

const toImage = (r: ImageRow): ImageDTO => ({ id: r.id, url: imageUrl(r.file), mime: r.mime })

function toNode(r: NodeRow, imgs: ImageDTO[]): NodeDTO {
  return {
    id: r.id,
    entryId: r.entryId,
    content: r.content,
    position: r.position,
    archived: r.archived,
    activeImageId: r.activeImageId,
    images: imgs,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function imagesByNode(where: SQL): Map<string, ImageDTO[]> {
  const rows = db.select({ img: images }).from(images).innerJoin(nodes, eq(nodes.id, images.nodeId)).where(where).orderBy(asc(images.position)).all()
  const map = new Map<string, ImageDTO[]>()
  for (const { img } of rows) {
    const list = map.get(img.nodeId) ?? []
    list.push(toImage(img))
    map.set(img.nodeId, list)
  }
  return map
}

/** Tag paths per entry, in order. */
export function tagsFor(entryIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (!entryIds.length) return map
  const rows = db
    .select({ entryId: entryTags.entryId, path: tags.path })
    .from(entryTags)
    .innerJoin(tags, eq(tags.id, entryTags.tagId))
    .where(inArray(entryTags.entryId, entryIds))
    .orderBy(asc(entryTags.position))
    .all()
  for (const r of rows) map.set(r.entryId, [...(map.get(r.entryId) ?? []), r.path])
  return map
}

/** Full entries (tags, nodes, images, the type's details) in the order of `ids`. */
export function loadEntries(ids: string[]): EntryDTO[] {
  if (!ids.length) return []
  const entryRows = db.select().from(entries).where(inArray(entries.id, ids)).all()
  const nodeRows = db.select().from(nodes).where(inArray(nodes.entryId, ids)).orderBy(asc(nodes.position)).all()
  const imgs = imagesByNode(inArray(nodes.entryId, ids))
  const tagMap = tagsFor(ids)
  const details = detailsFor(entryRows)

  const nodesByEntry = new Map<string, NodeDTO[]>()
  for (const n of nodeRows) {
    const list = nodesByEntry.get(n.entryId) ?? []
    list.push(toNode(n, imgs.get(n.id) ?? []))
    nodesByEntry.set(n.entryId, list)
  }
  const byId = new Map(entryRows.map((e) => [e.id, e]))
  return ids.flatMap((id) => {
    const e = byId.get(id)
    if (!e) return []
    const d = details.get(id)
    const dates: EntryDates = { created: e.createdAt, updated: e.updatedAt, ...d?.dates }
    return [
      {
        ...e,
        tags: tagMap.get(id) ?? [],
        nodes: nodesByEntry.get(id) ?? [],
        detail: d?.detail ?? null,
        dates,
      },
    ]
  })
}

/** The details of bookmark and media entries: what their cards show, and their own dates. */
function detailsFor(rows: { id: string; type: EntryType }[]): Map<string, { detail: EntryDetail; dates: Partial<EntryDates> }> {
  const out = new Map<string, { detail: EntryDetail; dates: Partial<EntryDates> }>()
  const of = (type: EntryType) => rows.filter((r) => r.type === type).map((r) => r.id)
  const captureIds = of('bookmark')
  if (captureIds.length)
    for (const c of db.select().from(captures).where(inArray(captures.entryId, captureIds)).all())
      out.set(c.entryId!, {
        detail: { kind: 'bookmark', id: c.id, handler: c.handler, url: c.url, site: c.site, iconUrl: c.icon ? imageUrl(c.icon) : null, thumbUrl: c.thumb ? imageUrl(c.thumb) : null },
        dates: { captured: c.capturedAt, published: c.publishedAt ?? undefined },
      })
  const mediaIds = of('media')
  if (mediaIds.length)
    for (const m of db.select().from(boardItems).where(inArray(boardItems.entryId, mediaIds)).all())
      out.set(m.entryId!, {
        detail: { kind: 'media', id: m.id, url: imageUrl(m.file), thumbUrl: m.thumb ? imageUrl(m.thumb) : null, mime: m.mime, width: m.width, height: m.height },
        dates: {},
      })
  return out
}

export function loadNode(id: string): NodeDTO | undefined {
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get()
  return row && toNode(row, imagesByNode(eq(nodes.id, id)).get(id) ?? [])
}

/** Journal entries: the entries with nodes, ordered by hand. */
export const noteTypes = () => inArray(entries.type, [...NOTE_TYPES])

/** A day's entries (of every type, or only the note types), hand-ordered ones first, then the rest by time. */
export function entriesForDate(date: string, only?: 'notes'): EntryDTO[] {
  const ids = db
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.date, date), only ? noteTypes() : undefined))
    .orderBy(asc(entries.position))
    .all()
  return loadEntries(ids.map((r) => r.id))
}

/** Position for a new journal entry: right after `afterId` (between it and its successor), else at the end of the day. */
export function entryPositionAfter(date: string, afterId: string | undefined): number {
  if (afterId) {
    const after = db.select().from(entries).where(eq(entries.id, afterId)).get()
    if (after && after.date === date) {
      const next = db
        .select({ p: sql<number | null>`min(${entries.position})` })
        .from(entries)
        .where(and(eq(entries.date, date), noteTypes(), sql`${entries.position} > ${after.position}`))
        .get()?.p
      return next == null ? after.position + 1 : (after.position + next) / 2
    }
  }
  const max = db
    .select({ p: sql<number | null>`max(${entries.position})` })
    .from(entries)
    .where(and(eq(entries.date, date), noteTypes()))
    .get()?.p
  return (max ?? 0) + 1
}

/** The entry of a video, capture or board item: created with it, then kept in step with its title and day. */
export function upsertItemEntry(id: string, v: { type: EntryType; subtype: string; date: string; title: string; position: number; createdAt: number; updatedAt: number }) {
  db.insert(entries)
    .values({ id, ...v })
    .onConflictDoUpdate({ target: entries.id, set: { subtype: v.subtype, date: v.date, title: v.title, updatedAt: v.updatedAt } })
    .run()
}

// ── categories ─────────────────────────────────────────────────────────────

export function listCategories(): CategoryInfo[] {
  return db
    .select({
      name: categories.name,
      active: sql<number>`coalesce(sum(${entries.archived} = 0), 0)`,
      archived: sql<number>`coalesce(sum(${entries.archived} = 1), 0)`,
    })
    .from(categories)
    .leftJoin(entries, eq(entries.category, categories.name))
    .groupBy(categories.name)
    .orderBy(asc(categories.position))
    .all()
}

/** A category name: one segment, as a tag's would be. */
export function categoryName(raw: string): string {
  const name = normalizeTag(raw).replaceAll(TAG_SEP, '-')
  if (!name) bad('category name is empty')
  return name
}

const categoryExists = (name: string) => !!db.select({ name: categories.name }).from(categories).where(eq(categories.name, name)).get()

/** Files an entry under a category (null: none). Returns the entry's date. */
export function setEntryCategory(entryId: string, category: string | null): string {
  const e = db.select({ date: entries.date }).from(entries).where(eq(entries.id, entryId)).get() ?? notFound('entry')
  if (category !== null && !categoryExists(category)) bad(`no category ${category}`)
  db.update(entries).set({ category, updatedAt: Date.now() }).where(eq(entries.id, entryId)).run()
  logEvent('entry', entryId, 'edit', { category })
  return e.date
}

export function createCategory(raw: string): string {
  const name = categoryName(raw)
  if (categoryExists(name)) bad(`category ${name} exists`)
  const max = db.select({ p: sql<number | null>`max(${categories.position})` }).from(categories).get()?.p
  db.insert(categories).values({ name, position: (max ?? 0) + 1, createdAt: Date.now() }).run()
  logEvent('category', name, 'create')
  return name
}

/** Renames a category; its entries follow (ON UPDATE CASCADE). Returns the days affected. */
export function renameCategory(from: string, raw: string): string[] {
  const to = categoryName(raw)
  if (!categoryExists(from)) notFound('category')
  if (from === to) return []
  if (categoryExists(to)) bad(`category ${to} exists`)
  const dates = datesForCategory(from)
  db.update(categories).set({ name: to }).where(eq(categories.name, from)).run()
  logEvent('category', from, 'edit', { renameTo: to })
  return dates
}

/** Deletes a category; its entries become uncategorized. Returns the days affected. */
export function deleteCategory(name: string): string[] {
  if (!categoryExists(name)) notFound('category')
  const dates = datesForCategory(name)
  db.delete(categories).where(eq(categories.name, name)).run()
  logEvent('category', name, 'delete')
  return dates
}

/** New display order; `names` must list every category once. */
export function orderCategories(names: string[]) {
  const current = db.select({ name: categories.name }).from(categories).all().map((r) => r.name)
  if (names.length !== current.length || new Set(names).size !== names.length || !names.every((n) => current.includes(n))) bad('names must list each category once')
  db.transaction(() => names.forEach((name, i) => db.update(categories).set({ position: i + 1 }).where(eq(categories.name, name)).run()))
  logEvent('category', '', 'edit', { order: names })
}

function datesForCategory(name: string): string[] {
  return db
    .selectDistinct({ date: entries.date })
    .from(entries)
    .where(eq(entries.category, name))
    .all()
    .map((r) => r.date)
}

// ── tags ───────────────────────────────────────────────────────────────────

export function ensureTag(path: string): number {
  db.insert(tags).values({ path, createdAt: Date.now() }).onConflictDoNothing().run()
  return db.select({ id: tags.id }).from(tags).where(eq(tags.path, path)).get()!.id
}

/** Replaces an entry's tags; returns the stored (normalized) list. */
export function setEntryTags(entryId: string, paths: string[]): string[] {
  const clean = cleanTags(paths)
  db.delete(entryTags).where(eq(entryTags.entryId, entryId)).run()
  clean.forEach((p, position) =>
    db
      .insert(entryTags)
      .values({ entryId, tagId: ensureTag(p), position })
      .run(),
  )
  pruneTags()
  return clean
}

/** Drops tags no entry uses any more (typos, removed tags). */
export function pruneTags() {
  db.delete(tags)
    .where(sql`${tags.id} not in (select ${entryTags.tagId} from ${entryTags})`)
    .run()
}

/** SQL condition: tag path is `root` or below it. */
export function tagSubtree(root: string): SQL {
  return sql`(${tags.path} = ${root} or substr(${tags.path}, 1, ${root.length + 1}) = ${root + TAG_SEP})`
}

/** Dates of entries that carry any tag in `tagIds`. */
function datesForTags(tagIds: number[]): string[] {
  if (!tagIds.length) return []
  return db
    .selectDistinct({ date: entries.date })
    .from(entries)
    .innerJoin(entryTags, eq(entryTags.entryId, entries.id))
    .where(inArray(entryTags.tagId, tagIds))
    .all()
    .map((r) => r.date)
}

/** Moves `from` and its subtree under the path `to`. Where the target path exists, the tags merge. */
export function moveTag(from: string, to: string): string[] {
  if (from === to) return []
  if (isUnder(to, from)) bad('cannot move a tag into its own subtree')
  const rows = db.select().from(tags).where(tagSubtree(from)).all()
  if (!rows.length) bad(`tag ${from} not found`)
  const affectedDates = datesForTags(rows.map((r) => r.id))
  for (const row of rows) {
    const target = to + row.path.slice(from.length)
    const existing = db.select().from(tags).where(eq(tags.path, target)).get()
    if (!existing) {
      db.update(tags).set({ path: target }).where(eq(tags.id, row.id)).run()
      continue
    }
    // Merge: entries that already carry the target just lose the old tag.
    const already = db
      .select({ entryId: entryTags.entryId })
      .from(entryTags)
      .where(eq(entryTags.tagId, existing.id))
      .all()
      .map((r) => r.entryId)
    if (already.length)
      db.delete(entryTags)
        .where(and(eq(entryTags.tagId, row.id), inArray(entryTags.entryId, already)))
        .run()
    db.update(entryTags).set({ tagId: existing.id }).where(eq(entryTags.tagId, row.id)).run()
    db.delete(tags).where(eq(tags.id, row.id)).run()
  }
  return affectedDates
}

/** Removes `path` and its subtree from every entry. */
export function deleteTag(path: string): string[] {
  const ids = db
    .select({ id: tags.id })
    .from(tags)
    .where(tagSubtree(path))
    .all()
    .map((r) => r.id)
  const affectedDates = datesForTags(ids)
  if (ids.length) db.delete(tags).where(inArray(tags.id, ids)).run()
  return affectedDates
}

/** Re-tags the given entries from `from` to `to` (e.g. into a new sub-tag), keeping tag order. */
export function branchTag(from: string, to: string, entryIds: string[]): string[] {
  const src = db.select().from(tags).where(eq(tags.path, from)).get()
  if (!src || !entryIds.length) return []
  const targetId = ensureTag(to)
  const rows = db
    .select()
    .from(entryTags)
    .where(and(eq(entryTags.tagId, src.id), inArray(entryTags.entryId, entryIds)))
    .all()
  const has = new Set(
    db
      .select({ entryId: entryTags.entryId })
      .from(entryTags)
      .where(eq(entryTags.tagId, targetId))
      .all()
      .map((r) => r.entryId),
  )
  for (const r of rows) {
    const where = and(eq(entryTags.entryId, r.entryId), eq(entryTags.tagId, src.id))
    if (has.has(r.entryId)) db.delete(entryTags).where(where).run()
    else db.update(entryTags).set({ tagId: targetId }).where(where).run()
  }
  pruneTags()
  const ids = rows.map((r) => r.entryId)
  return ids.length
    ? db
        .selectDistinct({ date: entries.date })
        .from(entries)
        .where(inArray(entries.id, ids))
        .all()
        .map((r) => r.date)
    : []
}

/** Dates touched by a selection of entries and nodes (for the markdown mirror). */
export function datesOf(entryIds: string[], nodeIds: string[]): string[] {
  const set = new Set<string>()
  if (entryIds.length) for (const r of db.select({ date: entries.date }).from(entries).where(inArray(entries.id, entryIds)).all()) set.add(r.date)
  if (nodeIds.length)
    for (const r of db.select({ date: entries.date }).from(nodes).innerJoin(entries, eq(entries.id, nodes.entryId)).where(inArray(nodes.id, nodeIds)).all())
      set.add(r.date)
  return [...set]
}
