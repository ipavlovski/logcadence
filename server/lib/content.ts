import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { ChatSource, EntryDTO, ImageDTO, NodeDTO } from '../../shared/types.ts'
import { cleanTags, isUnder } from '../../shared/tags.ts'
import { db } from '../db/client.ts'
import { chats, entries, entryTags, images, nodes, tags } from '../db/content-schema.ts'
import { bad } from './validate.ts'

type NodeRow = typeof nodes.$inferSelect
type ImageRow = typeof images.$inferSelect

export const imageUrl = (file: string) => `/assets/${file}`

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

/** Tag paths per entry, primary first. */
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

/** Full entries (tags, nodes, images) in the order of `ids`. */
export function loadEntries(ids: string[]): EntryDTO[] {
  if (!ids.length) return []
  const entryRows = db.select().from(entries).where(inArray(entries.id, ids)).all()
  const nodeRows = db.select().from(nodes).where(inArray(nodes.entryId, ids)).orderBy(asc(nodes.position)).all()
  const imgs = imagesByNode(inArray(nodes.entryId, ids))
  const tagMap = tagsFor(ids)
  const chatMap = new Map(
    db
      .select({ id: chats.id, source: chats.source, entryId: chats.entryId })
      .from(chats)
      .where(inArray(chats.entryId, ids))
      .all()
      .map((c) => [c.entryId!, { id: c.id, source: c.source as ChatSource }]),
  )

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
    return [{ ...e, tags: tagMap.get(id) ?? [], nodes: nodesByEntry.get(id) ?? [], chat: chatMap.get(id) ?? null }]
  })
}

export function loadNode(id: string): NodeDTO | undefined {
  const row = db.select().from(nodes).where(eq(nodes.id, id)).get()
  return row && toNode(row, imagesByNode(eq(nodes.id, id)).get(id) ?? [])
}

export function entriesForDate(date: string): EntryDTO[] {
  const ids = db.select({ id: entries.id }).from(entries).where(eq(entries.date, date)).orderBy(asc(entries.position)).all()
  return loadEntries(ids.map((r) => r.id))
}

/** Position for a new entry: right after `afterId` (between it and its successor), else at the end of the day. */
export function entryPositionAfter(date: string, afterId: string | undefined): number {
  if (afterId) {
    const after = db.select().from(entries).where(eq(entries.id, afterId)).get()
    if (after && after.date === date) {
      const next = db
        .select({ p: sql<number | null>`min(${entries.position})` })
        .from(entries)
        .where(and(eq(entries.date, date), sql`${entries.position} > ${after.position}`))
        .get()?.p
      return next == null ? after.position + 1 : (after.position + next) / 2
    }
  }
  const max = db
    .select({ p: sql<number | null>`max(${entries.position})` })
    .from(entries)
    .where(eq(entries.date, date))
    .get()?.p
  return (max ?? 0) + 1
}

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
  return sql`(${tags.path} = ${root} or substr(${tags.path}, 1, ${root.length + 1}) = ${root + ':'})`
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
