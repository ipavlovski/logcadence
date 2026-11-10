import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import { normalizeTag, TAG_SEP } from '../../shared/tags.ts'
import type { CreateEntryBody, EntryQuery, SelectionBody, UpdateEntryBody } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { entries, entryTags, nodes, tags } from '../db/content-schema.ts'
import { datesOf, entryPositionAfter, loadEntries, pruneTags, setEntryCategory, setEntryTags } from '../lib/content.ts'
import { logEvent } from '../lib/events.ts'
import { touchDates } from '../lib/journalFiles.ts'
import { bad, date, defined, notFound, obj, optBool, optDate, optNum, optStr, optStrArr, optStrOrNull, str } from '../lib/validate.ts'

function parseCreate(v: unknown): CreateEntryBody {
  const o = obj(v)
  const list = o.nodes
  if (list !== undefined && !Array.isArray(list)) bad('nodes must be an array')
  return defined({
    id: optStr(o, 'id'),
    date: date(o, 'date'),
    title: optStr(o, 'title'),
    tags: optStrArr(o, 'tags'),
    category: optStrOrNull(o, 'category'),
    afterEntryId: optStr(o, 'afterEntryId'),
    nodes: list?.map((n) => {
      const no = obj(n)
      return defined({ id: optStr(no, 'id'), content: str(no, 'content') })
    }),
  })
}

function parseUpdate(v: unknown): UpdateEntryBody {
  const o = obj(v)
  return defined({
    title: optStr(o, 'title'),
    tags: optStrArr(o, 'tags'),
    category: optStrOrNull(o, 'category'),
    archived: optBool(o, 'archived'),
    date: optDate(o, 'date'),
    position: optNum(o, 'position'),
  })
}

export interface ArchiveBody extends SelectionBody {
  archived: boolean
}

function parseSelection(v: unknown): Required<SelectionBody> {
  const o = obj(v)
  return { entryIds: optStrArr(o, 'entryIds') ?? [], nodeIds: optStrArr(o, 'nodeIds') ?? [] }
}

const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

/** GET /entries' query string: `tag` repeats; flags are "1". */
function parseQuery(v: Record<string, string | string[]>): EntryQuery & { limit: number } {
  const one = (k: string) => list(v[k])[0]
  const date = one('date')
  if (date !== undefined && !isIsoDate(date)) bad('date must be YYYY-MM-DD')
  const limit = Number(one('limit') ?? 1000)
  if (!Number.isInteger(limit) || limit < 1) bad('limit must be a positive integer')
  return defined({
    category: one('category'),
    uncategorized: one('uncategorized') === '1' || undefined,
    tags: list(v.tag).map(normalizeTag).filter(Boolean),
    untagged: one('untagged') === '1' || undefined,
    exact: one('exact') === '1' || undefined,
    archived: one('archived') === '1' || undefined,
    date,
    limit: Math.min(limit, 5000),
  })
}

function queryWhere(q: EntryQuery): SQL | undefined {
  const conds: (SQL | undefined)[] = []
  if (q.category) conds.push(eq(entries.category, q.category))
  if (q.uncategorized) conds.push(isNull(entries.category))
  for (const tag of q.tags ?? []) {
    const match = q.exact ? sql`${tags.path} = ${tag}` : sql`(${tags.path} = ${tag} or substr(${tags.path}, 1, ${tag.length + 1}) = ${tag + TAG_SEP})`
    conds.push(sql`exists (select 1 from ${entryTags} join ${tags} on ${tags.id} = ${entryTags.tagId} where ${entryTags.entryId} = ${entries.id} and ${match})`)
  }
  if (q.untagged) conds.push(sql`not exists (select 1 from ${entryTags} where ${entryTags.entryId} = ${entries.id})`)
  if (!q.archived) conds.push(eq(entries.archived, false))
  if (q.date) conds.push(eq(entries.date, q.date))
  return and(...conds)
}

export const entryRoutes = new Hono()
  // Entries matching a query (category, tags…), newest day first.
  .get(
    '/entries',
    validator('query', (v) => parseQuery(v)),
    (c) => {
      const q = c.req.valid('query')
      const ids = db
        .select({ id: entries.id })
        .from(entries)
        .where(queryWhere(q))
        .orderBy(desc(entries.date), asc(entries.position))
        .limit(q.limit)
        .all()
        .map((r) => r.id)
      const found = loadEntries(ids)
      return c.json({ entries: q.archived ? found : found.map((e) => ({ ...e, nodes: e.nodes.filter((n) => !n.archived) })) })
    },
  )
  .post('/entries', validator('json', parseCreate), (c) => {
    const b = c.req.valid('json')
    const id = b.id ?? randomUUID()
    const now = Date.now()
    const nodeList = (b.nodes ?? [{ content: '' }]).map((n) => ({ id: n.id ?? randomUUID(), content: n.content }))
    const tagList = db.transaction(() => {
      const position = entryPositionAfter(b.date, b.afterEntryId)
      db.insert(entries)
        .values({ id, date: b.date, title: b.title ?? '', position, createdAt: now, updatedAt: now })
        .run()
      nodeList.forEach((n, i) =>
        db
          .insert(nodes)
          .values({ id: n.id, entryId: id, content: n.content, position: i + 1, createdAt: now, updatedAt: now })
          .run(),
      )
      if (b.category) setEntryCategory(id, b.category)
      return setEntryTags(id, b.tags ?? [])
    })
    logEvent('entry', id, 'create', { date: b.date, title: b.title ?? '', tags: tagList, ...(b.category && { category: b.category }) })
    for (const n of nodeList) logEvent('node', n.id, 'create', { entryId: id, content: n.content })
    touchDates(b.date)
    return c.json(loadEntries([id])[0]!, 201)
  })
  .patch('/entries/:id', validator('json', parseUpdate), (c) => {
    const id = c.req.param('id')
    const b = c.req.valid('json')
    const before = db.select().from(entries).where(eq(entries.id, id)).get() ?? notFound('entry')
    const payload: Record<string, unknown> = { ...b }
    db.transaction(() => {
      const { tags: tagList, category, ...cols } = b
      db.update(entries)
        .set({ ...cols, updatedAt: Date.now() })
        .where(eq(entries.id, id))
        .run()
      // The category first: the tags are stored without it (withoutCategory).
      if (category !== undefined) setEntryCategory(id, category)
      if (tagList) payload.tags = setEntryTags(id, tagList)
    })
    const onlyArchive = Object.keys(b).length === 1 && b.archived !== undefined
    logEvent('entry', id, onlyArchive ? (b.archived ? 'archive' : 'unarchive') : 'edit', payload)
    touchDates(before.date, b.date ?? before.date)
    return c.json(loadEntries([id])[0]!)
  })
  .delete('/entries/:id', (c) => {
    const id = c.req.param('id')
    const before = db.select().from(entries).where(eq(entries.id, id)).get() ?? notFound('entry')
    db.transaction(() => {
      db.delete(entries).where(eq(entries.id, id)).run()
      pruneTags()
    })
    logEvent('entry', id, 'delete', { date: before.date, title: before.title })
    touchDates(before.date)
    return c.json({ ok: true })
  })
  // Archive or unarchive a selection of entries and nodes (tags pane).
  .post(
    '/archive',
    validator('json', (v): ArchiveBody & Required<SelectionBody> => {
      const archived = optBool(obj(v), 'archived')
      if (archived === undefined) bad('archived is required')
      return { ...parseSelection(v), archived }
    }),
    (c) => {
      const { entryIds, nodeIds, archived } = c.req.valid('json')
      const now = Date.now()
      db.transaction(() => {
        if (entryIds.length) db.update(entries).set({ archived, updatedAt: now }).where(inArray(entries.id, entryIds)).run()
        if (nodeIds.length) db.update(nodes).set({ archived, updatedAt: now }).where(inArray(nodes.id, nodeIds)).run()
      })
      const op = archived ? 'archive' : 'unarchive'
      for (const id of entryIds) logEvent('entry', id, op)
      for (const id of nodeIds) logEvent('node', id, op)
      touchDates(...datesOf(entryIds, nodeIds))
      return c.json({ ok: true })
    },
  )
  .post('/bulk-delete', validator('json', parseSelection), (c) => {
    const { entryIds, nodeIds } = c.req.valid('json')
    const dates = datesOf(entryIds, nodeIds)
    db.transaction(() => {
      if (entryIds.length) db.delete(entries).where(inArray(entries.id, entryIds)).run()
      if (nodeIds.length) db.delete(nodes).where(inArray(nodes.id, nodeIds)).run()
      pruneTags()
    })
    for (const id of entryIds) logEvent('entry', id, 'delete')
    for (const id of nodeIds) logEvent('node', id, 'delete')
    touchDates(...dates)
    return c.json({ ok: true })
  })
