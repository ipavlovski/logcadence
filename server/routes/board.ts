import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate, today } from '../../shared/dates.ts'
import type { BoardItemDTO, BoardPageDTO, MoveBoardItemBody } from '../../shared/types.ts'
import { ASSETS_DIR, db } from '../db/client.ts'
import { boardItems } from '../db/content-schema.ts'
import { extension, imageUrl } from '../lib/content.ts'
import { logEvent } from '../lib/events.ts'
import { bad, date, notFound, num, obj, optDate } from '../lib/validate.ts'

// The image board (Images tab): a scratchpad of pasted images, gifs and videos, in rows under a day.

const MAX_UPLOAD = 500 * 1024 * 1024
const PAGE_DAYS = 14

type BoardRow = typeof boardItems.$inferSelect

const toItem = (r: BoardRow): BoardItemDTO => ({
  id: r.id,
  date: r.date,
  row: r.row,
  position: r.position,
  url: imageUrl(r.file),
  thumbUrl: r.thumb ? imageUrl(r.thumb) : null,
  mime: r.mime,
  width: r.width,
  height: r.height,
})

function formNum(v: unknown, k: string): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) bad(`${k} must be a number`)
  return n
}

function formSize(v: unknown, k: string): number {
  const n = formNum(v, k)
  if (n === undefined || !Number.isInteger(n) || n < 1) bad(`${k} must be a positive integer`)
  return n
}

function parseUpload(v: Record<string, string | File | (string | File)[]>) {
  const { file, thumb } = v
  if (!(file instanceof File)) bad('file is required')
  if (!/^(image|video)\//.test(file.type)) bad('only images and videos are supported')
  if (file.size > MAX_UPLOAD) bad('file too large')
  if (thumb !== undefined && !(thumb instanceof File && /^image\//.test(thumb.type))) bad('thumb must be an image')
  const day = v.date
  if (day !== undefined && (typeof day !== 'string' || !isIsoDate(day))) bad('date must be a YYYY-MM-DD date')
  return {
    file,
    thumb: thumb as File | undefined,
    width: formSize(v.width, 'width'),
    height: formSize(v.height, 'height'),
    date: (day as string | undefined) ?? today(),
    row: formNum(v.row, 'row'),
    position: formNum(v.position, 'position'),
  }
}

function parseMove(v: unknown): MoveBoardItemBody {
  const o = obj(v)
  return { date: date(o, 'date'), row: num(o, 'row'), position: num(o, 'position') }
}

export const boardRoutes = new Hono()
  // Newest days first; `before` pages to older ones.
  .get(
    '/board',
    validator('query', (v) => ({ before: optDate(v, 'before') })),
    (c) => {
      const { before } = c.req.valid('query')
      const dates = db
        .selectDistinct({ date: boardItems.date })
        .from(boardItems)
        .where(before ? lt(boardItems.date, before) : undefined)
        .orderBy(desc(boardItems.date))
        .limit(PAGE_DAYS + 1)
        .all()
        .map((r) => r.date)
      const shown = dates.slice(0, PAGE_DAYS)
      const rows = shown.length ? db.select().from(boardItems).where(inArray(boardItems.date, shown)).orderBy(asc(boardItems.row), asc(boardItems.position)).all() : []
      const page: BoardPageDTO = {
        days: shown.map((d) => ({ date: d, items: rows.filter((r) => r.date === d).map(toItem) })),
        next: dates.length > PAGE_DAYS ? shown[shown.length - 1]! : null,
      }
      return c.json(page)
    },
  )
  // A pasted or dropped file, with the thumbnail the app made of it. Without a place it goes at the end of the day's last row.
  .post('/board', validator('form', parseUpload), async (c) => {
    const b = c.req.valid('form')
    const id = randomUUID()
    const file = `${id}.${extension(b.file)}`
    writeFileSync(path.join(ASSETS_DIR, file), Buffer.from(await b.file.arrayBuffer()))
    const thumb = b.thumb ? `${id}-thumb.${extension(b.thumb)}` : null
    if (b.thumb && thumb) writeFileSync(path.join(ASSETS_DIR, thumb), Buffer.from(await b.thumb.arrayBuffer()))
    const row =
      b.row ??
      db
        .select({ r: sql<number | null>`max(${boardItems.row})` })
        .from(boardItems)
        .where(eq(boardItems.date, b.date))
        .get()?.r ??
      1
    const position =
      b.position ??
      (db
        .select({ p: sql<number | null>`max(${boardItems.position})` })
        .from(boardItems)
        .where(and(eq(boardItems.date, b.date), eq(boardItems.row, row)))
        .get()?.p ?? 0) + 1
    const values = { id, date: b.date, row, position, file, thumb, mime: b.file.type, width: b.width, height: b.height, createdAt: Date.now() }
    db.insert(boardItems).values(values).run()
    logEvent('board-item', id, 'create', { ...values })
    return c.json(toItem(values), 201)
  })
  // Reordered: a new place in a row, a new row, or another day.
  .patch('/board/:id', validator('json', parseMove), (c) => {
    const id = c.req.param('id')
    db.select({ id: boardItems.id }).from(boardItems).where(eq(boardItems.id, id)).get() ?? notFound('board item')
    const b = c.req.valid('json')
    db.update(boardItems).set(b).where(eq(boardItems.id, id)).run()
    logEvent('board-item', id, 'edit', { ...b })
    return c.json(toItem(db.select().from(boardItems).where(eq(boardItems.id, id)).get()!))
  })
  // The files stay in assets/ so an undo can bring the item back (the event keeps the whole row).
  .delete('/board/:id', (c) => {
    const id = c.req.param('id')
    const row = db.select().from(boardItems).where(eq(boardItems.id, id)).get() ?? notFound('board item')
    db.delete(boardItems).where(eq(boardItems.id, id)).run()
    logEvent('board-item', id, 'delete', { ...row })
    return c.json({ ok: true })
  })
