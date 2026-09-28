import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { CreateEntryBody, SelectionBody, UpdateEntryBody } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { entries, nodes } from '../db/content-schema.ts'
import { datesOf, entryPositionAfter, loadEntries, pruneTags, setEntryTags } from '../lib/content.ts'
import { logEvent } from '../lib/events.ts'
import { touchDates } from '../lib/journalFiles.ts'
import { bad, date, defined, notFound, obj, optBool, optDate, optNum, optStr, optStrArr, str } from '../lib/validate.ts'

function parseCreate(v: unknown): CreateEntryBody {
  const o = obj(v)
  const list = o.nodes
  if (list !== undefined && !Array.isArray(list)) bad('nodes must be an array')
  return defined({
    id: optStr(o, 'id'),
    date: date(o, 'date'),
    title: optStr(o, 'title'),
    tags: optStrArr(o, 'tags'),
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

export const entryRoutes = new Hono()
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
      return setEntryTags(id, b.tags ?? [])
    })
    logEvent('entry', id, 'create', { date: b.date, title: b.title ?? '', tags: tagList })
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
      const { tags: tagList, ...cols } = b
      db.update(entries)
        .set({ ...cols, updatedAt: Date.now() })
        .where(eq(entries.id, id))
        .run()
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
