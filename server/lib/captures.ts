import { createHash, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { eq, inArray, like, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { toIsoDate } from '../../shared/dates.ts'
import { cleanFields, handlerFor } from '../../shared/handlers.ts'
import type { CaptureRequest, CaptureResult } from '../../shared/types.ts'
import { ASSETS_DIR, db } from '../db/client.ts'
import { entries, images, nodes } from '../db/content-schema.ts'
import { entryPositionAfter, setEntryTags, tagsFor } from './content.ts'
import { logEvent } from './events.ts'
import { touchDates } from './journalFiles.ts'
import { bad } from './validate.ts'

// Pages captured by the Chrome extension (extension/). A page becomes an entry of today's journal: its title links
// to the page, and its first node holds the screenshot. The page's handler (shared/handlers.ts) decides what makes
// two captures the same page (the entry's link key, `<handler>:<key>`), what is read from it (fields) and which
// tags it gets (reddit/<subreddit>, marketplace). Capturing a page again adds the new screenshot to its entry, in
// a node of its own; so does a screenshot sent as a comment.

// Bumped by every capture from the extension, so the open app notices and reloads (its own edits reload it already).
let captured = 0
const started = Date.now()
export const captureRevision = () => `${started}.${captured}`

function parseUrl(url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    bad('url must be a link')
  }
  if (!/^https?:$/.test(u.protocol)) bad('only http(s) pages can be captured')
  return u
}

// ── files ──────────────────────────────────────────────────────────────────

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'image/svg+xml': 'svg', 'image/gif': 'gif' }
const MAX_IMAGE = 60 * 1024 * 1024

/** A data: url's bytes and type; screenshots must be jpeg, png or webp, icons can also be ico, svg or gif. */
export function decodeImage(dataUrl: string, what: string, icon = false): { data: Buffer; mime: string; ext: string } {
  const m = dataUrl.match(/^data:([a-z0-9.+/-]+);base64,/i)
  const mime = m?.[1]?.toLowerCase() ?? ''
  const ext = TYPES[mime]
  if (!m || !ext || (!icon && !['jpg', 'png', 'webp'].includes(ext))) bad(`${what} must be a data: url of a ${icon ? 'image' : 'jpeg, png or webp'}`)
  const data = Buffer.from(dataUrl.slice(m[0].length), 'base64')
  if (!data.length) bad(`${what} is empty`)
  if (data.length > MAX_IMAGE) bad(`${what} is too large`)
  return { data, mime, ext }
}

/** An icon is a nicety: one that can't be read is left out rather than failing the capture. */
function iconOf(dataUrl: string) {
  try {
    return decodeImage(dataUrl, 'icon', true)
  } catch {
    return null
  }
}

function saveFile(name: string, img: { data: Buffer }): string {
  writeFileSync(path.join(ASSETS_DIR, name), img.data)
  return name
}

/** Icons repeat (every page of a site, every post of a subreddit): stored once, named by their content. */
function saveIcon(img: { data: Buffer; ext: string }): string {
  const name = `icon-${createHash('sha256').update(img.data).digest('hex').slice(0, 24)}.${img.ext}`
  const file = path.join(ASSETS_DIR, name)
  if (!existsSync(file)) writeFileSync(file, img.data)
  return name
}

// ── capture ────────────────────────────────────────────────────────────────

const optInt = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? Math.round(n) : null)

/** The screenshot as a new node at the end of the entry (inside the caller's transaction). */
function addShotNode(entryId: string, req: CaptureRequest, now: number) {
  const shot = decodeImage(req.image, 'image')
  const thumb = req.thumb ? decodeImage(req.thumb, 'thumb') : null
  const nodeId = randomUUID()
  const imageId = randomUUID()
  const max = db
    .select({ p: sql<number | null>`max(${nodes.position})` })
    .from(nodes)
    .where(eq(nodes.entryId, entryId))
    .get()?.p
  db.insert(nodes)
    .values({ id: nodeId, entryId, content: '', position: (max ?? 0) + 1, activeImageId: imageId, createdAt: now, updatedAt: now })
    .run()
  const image = {
    id: imageId,
    nodeId,
    file: saveFile(`${imageId}.${shot.ext}`, shot),
    mime: shot.mime,
    width: optInt(req.width),
    height: optInt(req.height),
    thumb: thumb ? saveFile(`${imageId}-thumb.${thumb.ext}`, thumb) : null,
    position: 1,
    createdAt: now,
  }
  db.insert(images).values(image).run()
  logEvent('node', nodeId, 'create', { entryId, content: '' })
  logEvent('image', imageId, 'create', { nodeId, file: image.file, mime: image.mime, width: image.width, height: image.height, thumb: image.thumb })
}

/** Adds the handler's tags to an entry's own (inside the caller's transaction). */
function addTags(entryId: string, add: string[]) {
  if (add.length) setEntryTags(entryId, [...(tagsFor([entryId]).get(entryId) ?? []), ...add])
}

const findByKey = (keys: string[]) => (keys.length ? db.select().from(entries).where(inArray(entries.linkKey, keys)).get() : undefined)

/** Stores what the extension sent: a new page, a page captured again, or a screenshot for a page captured before. */
export function capture(req: CaptureRequest): CaptureResult {
  if (req.target === 'comment') return captureComment(req)
  const u = parseUrl(req.url)
  const { handler, key } = handlerFor(u)
  const url = handler.canonical(u, key)
  const linkKey = `${handler.id}:${key}`
  const fields = cleanFields(handler, req.fields)
  const icon = req.icon ? iconOf(req.icon) : null
  const now = Date.now()
  const page = {
    url,
    linkKey,
    fields,
    publishedAt: optInt(req.publishedAt),
    ...(icon && { icon: saveIcon(icon) }),
  }
  const tags = handler.tags(u, req.site)
  // A page captured before its site had a handler is the same page: it takes the handler.
  const existing = findByKey([linkKey]) ?? (handler.id === 'page' ? undefined : findByKey([`page:${url}`, `page:${req.url}`]))
  captured++
  if (existing) {
    // The entry's title stays: it may have been edited since.
    db.transaction(() => {
      db.update(entries)
        .set({ ...page, updatedAt: now })
        .where(eq(entries.id, existing.id))
        .run()
      addShotNode(existing.id, req, now)
      addTags(existing.id, tags)
    })
    logEvent('entry', existing.id, 'edit', { recaptured: true, ...page })
    touchDates(existing.date)
    return { handler: handler.id, entryId: existing.id, date: existing.date, title: existing.title, created: false, comment: false }
  }
  const id = randomUUID()
  const date = toIsoDate(new Date(now))
  const title = (handler.title?.(req.title.trim()) ?? req.title.trim()) || url
  db.transaction(() => {
    db.insert(entries)
      .values({ id, date, title, position: entryPositionAfter(date, undefined), ...page, createdAt: now, updatedAt: now })
      .run()
    addShotNode(id, req, now)
    addTags(id, tags)
  })
  logEvent('entry', id, 'create', { date, title, ...page, tags })
  touchDates(date)
  return { handler: handler.id, entryId: id, date, title, created: true, comment: false }
}

function captureComment(req: CaptureRequest): CaptureResult {
  const { handler, key } = handlerFor(parseUrl(req.url))
  if (!handler.comments) bad(`${handler.name} ${handler.many} don’t take comments: open a Reddit post (…/comments/<id>/…)`)
  const entry = findByKey([`${handler.id}:${key}`])
  if (!entry) throw new HTTPException(404, { message: `This ${handler.one} isn’t in Logcadence yet: capture it first` })
  const now = Date.now()
  db.transaction(() => {
    addShotNode(entry.id, req, now)
    db.update(entries).set({ updatedAt: now }).where(eq(entries.id, entry.id)).run()
  })
  captured++
  touchDates(entry.date)
  return { handler: handler.id, entryId: entry.id, date: entry.date, title: entry.title, created: false, comment: true }
}

/**
 * Pages captured before their site had a handler (Marketplace listings bookmarked before there was one) take it,
 * with its tags, when no entry has the handler's key already. Run at startup; returns how many changed.
 */
export function adoptPages(): number {
  let n = 0
  for (const r of db.select().from(entries).where(like(entries.linkKey, 'page:%')).all()) {
    let u: URL
    try {
      u = new URL(r.url ?? '')
    } catch {
      continue
    }
    const { handler, key } = handlerFor(u)
    const linkKey = `${handler.id}:${key}`
    if (handler.id === 'page' || findByKey([linkKey])) continue
    const cols = { linkKey, url: handler.canonical(u, key), title: handler.title?.(r.title) || r.title }
    db.transaction(() => {
      db.update(entries).set(cols).where(eq(entries.id, r.id)).run()
      addTags(r.id, handler.tags(u, undefined))
    })
    logEvent('entry', r.id, 'edit', { adopted: true, ...cols })
    n++
  }
  return n
}
