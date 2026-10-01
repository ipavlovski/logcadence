import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { asc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { CreateNodeBody, UpdateNodeBody } from '../../shared/types.ts'
import { ASSETS_DIR, db } from '../db/client.ts'
import { entries, images, nodes } from '../db/content-schema.ts'
import { imageUrl, loadNode } from '../lib/content.ts'
import { logEvent } from '../lib/events.ts'
import { touchDates } from '../lib/journalFiles.ts'
import { bad, defined, notFound, num, obj, optBool, optNum, optStr, optStrArr, str } from '../lib/validate.ts'

const MAX_UPLOAD = 50 * 1024 * 1024

function parseCreate(v: unknown): CreateNodeBody {
  const o = obj(v)
  return defined({ id: optStr(o, 'id'), entryId: str(o, 'entryId'), content: optStr(o, 'content'), position: num(o, 'position') })
}

function parseUpdate(v: unknown): UpdateNodeBody {
  const o = obj(v)
  const active = o.activeImageId
  if (active !== undefined && active !== null && typeof active !== 'string') bad('activeImageId must be a string or null')
  return defined({
    content: optStr(o, 'content'),
    archived: optBool(o, 'archived'),
    activeImageId: active as string | null | undefined,
    position: optNum(o, 'position'),
  })
}

function entryDate(entryId: string): string {
  return db.select({ date: entries.date }).from(entries).where(eq(entries.id, entryId)).get()?.date ?? notFound('entry')
}

function extension(file: File): string {
  const fromName = path.extname(file.name).slice(1).toLowerCase()
  const ext = /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : (file.type.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5)
  return ext || 'bin'
}

export const nodeRoutes = new Hono()
  .post('/nodes', validator('json', parseCreate), (c) => {
    const b = c.req.valid('json')
    const date = entryDate(b.entryId)
    const id = b.id ?? randomUUID()
    const now = Date.now()
    db.insert(nodes)
      .values({ id, entryId: b.entryId, content: b.content ?? '', position: b.position, createdAt: now, updatedAt: now })
      .run()
    logEvent('node', id, 'create', { entryId: b.entryId, content: b.content ?? '' })
    touchDates(date)
    return c.json(loadNode(id)!, 201)
  })
  .patch('/nodes/:id', validator('json', parseUpdate), (c) => {
    const id = c.req.param('id')
    const b = c.req.valid('json')
    const before = db.select().from(nodes).where(eq(nodes.id, id)).get() ?? notFound('node')
    db.update(nodes)
      .set({ ...b, updatedAt: Date.now() })
      .where(eq(nodes.id, id))
      .run()
    const onlyArchive = Object.keys(b).length === 1 && b.archived !== undefined
    logEvent('node', id, onlyArchive ? (b.archived ? 'archive' : 'unarchive') : 'edit', { ...b })
    touchDates(entryDate(before.entryId))
    return c.json(loadNode(id)!)
  })
  .delete('/nodes/:id', (c) => {
    const id = c.req.param('id')
    const before = db.select().from(nodes).where(eq(nodes.id, id)).get() ?? notFound('node')
    db.delete(nodes).where(eq(nodes.id, id)).run()
    logEvent('node', id, 'delete', { entryId: before.entryId, content: before.content })
    touchDates(entryDate(before.entryId))
    return c.json({ ok: true })
  })
  // Pasted/dropped image: stored under assets/, appended to the node's gallery.
  .post(
    '/nodes/:id/images',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (!file.type.startsWith('image/')) bad('only images are supported')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const nodeId = c.req.param('id')
      const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get() ?? notFound('node')
      const { file } = c.req.valid('form')
      const id = randomUUID()
      const name = `${id}.${extension(file)}`
      writeFileSync(path.join(ASSETS_DIR, name), Buffer.from(await file.arrayBuffer()))
      const max = db
        .select({ p: sql<number | null>`max(${images.position})` })
        .from(images)
        .where(eq(images.nodeId, nodeId))
        .get()?.p
      db.transaction(() => {
        db.insert(images)
          .values({ id, nodeId, file: name, mime: file.type, position: (max ?? 0) + 1, createdAt: Date.now() })
          .run()
        // The first image becomes active; later pastes keep the current large preview.
        if (!node.activeImageId) db.update(nodes).set({ activeImageId: id }).where(eq(nodes.id, nodeId)).run()
      })
      logEvent('image', id, 'create', { nodeId, file: name, mime: file.type })
      touchDates(entryDate(node.entryId))
      return c.json({ image: { id, url: imageUrl(name), mime: file.type }, activeImageId: node.activeImageId ?? id }, 201)
    },
  )
  // New gallery order (the first image is the node's thumbnail); `ids` must be all of the node's images.
  .post(
    '/nodes/:id/images/order',
    validator('json', (v) => ({ ids: optStrArr(obj(v), 'ids') ?? [] })),
    (c) => {
      const nodeId = c.req.param('id')
      const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get() ?? notFound('node')
      const { ids } = c.req.valid('json')
      const current = db.select({ id: images.id }).from(images).where(eq(images.nodeId, nodeId)).all().map((r) => r.id)
      if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) bad('ids must list each of the node’s images once')
      db.transaction(() => ids.forEach((id, i) => db.update(images).set({ position: i + 1 }).where(eq(images.id, id)).run()))
      logEvent('node', nodeId, 'edit', { imageOrder: ids })
      touchDates(entryDate(node.entryId))
      return c.json({ ok: true })
    },
  )
  // Removes the image from its node. The file stays in assets/ so an undo can bring the image back
  // (the event keeps the whole row); a separate cleanup removes files nothing references.
  .delete('/images/:id', (c) => {
    const id = c.req.param('id')
    const img = db.select().from(images).where(eq(images.id, id)).get() ?? notFound('image')
    const node = db.select().from(nodes).where(eq(nodes.id, img.nodeId)).get()!
    let activeImageId = node.activeImageId
    db.transaction(() => {
      db.delete(images).where(eq(images.id, id)).run()
      if (activeImageId === id) {
        activeImageId = db.select({ id: images.id }).from(images).where(eq(images.nodeId, node.id)).orderBy(asc(images.position)).get()?.id ?? null
        db.update(nodes).set({ activeImageId }).where(eq(nodes.id, node.id)).run()
      }
    })
    logEvent('image', id, 'delete', { nodeId: node.id, file: img.file, mime: img.mime, position: img.position, createdAt: img.createdAt, wasActive: node.activeImageId === id })
    touchDates(entryDate(node.entryId))
    return c.json({ activeImageId })
  })
