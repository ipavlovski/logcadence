import { createHash, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { toIsoDate } from '../../shared/dates.ts'
import { cleanFields, handlerById, handlerFor } from '../../shared/handlers.ts'
import { cleanTags, isUnder, TAG_SEP } from '../../shared/tags.ts'
import type { CaptureDTO, CaptureLibraryDTO, CaptureRequest, CaptureResult, CaptureSection, CaptureSummary, ImageDTO, TagInfo, UpdateCaptureBody } from '../../shared/types.ts'
import { ASSETS_DIR, db } from '../db/client.ts'
import { captureImages, captureItemTags, captures, captureTags } from '../db/content-schema.ts'
import { imageUrl } from './content.ts'
import { logEvent } from './events.ts'
import { bad, notFound } from './validate.ts'

// Pages captured by the Chrome extension (extension/), for the Bookmarks tab. A capture is a screenshot with the
// page's url, title and icon, and what its handler (shared/handlers.ts) read from the page; notes, comments, images
// and tags are added in the app. Capturing a page again replaces its screenshot and fields, keeping the rest.

type Row = typeof captures.$inferSelect

/** The active image column of each image section. */
const ACTIVE = { notes: 'activeImageId', comments: 'commentsActiveImageId' } as const

// Bumped by every capture from the extension, so an open tab notices and reloads (the app's own edits reload it already).
let captured = 0
const started = Date.now()
export const captureRevision = () => `${started}.${captured}`

// ── pages ──────────────────────────────────────────────────────────────────

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

function saveFile(img: { data: Buffer; ext: string }): string {
  const name = `${randomUUID()}.${img.ext}`
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

const optInt = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? Math.round(n) : null)

/** Stores what the extension sent: a new page, a page captured again, or a screenshot for a capture's comments. */
export function capture(req: CaptureRequest): CaptureResult {
  if (req.target === 'comment') return captureComment(req)
  const u = parseUrl(req.url)
  const { handler, key } = handlerFor(u)
  const url = handler.canonical(u, key)
  const fields = cleanFields(handler, req.fields)
  const shot = decodeImage(req.image, 'image')
  const thumb = req.thumb ? decodeImage(req.thumb, 'thumb') : null
  const icon = req.icon ? iconOf(req.icon) : null
  const now = Date.now()
  const cols = {
    handler: handler.id,
    key,
    url,
    title: (handler.title?.(req.title.trim()) ?? req.title.trim()) || url,
    site: handler.site(u, req.site, fields),
    screenshot: saveFile(shot),
    screenshotWidth: optInt(req.width),
    screenshotHeight: optInt(req.height),
    thumb: thumb ? saveFile(thumb) : null,
    ...(icon && { icon: saveIcon(icon) }),
    fields,
    publishedAt: optInt(req.publishedAt),
    updatedAt: now,
  }
  // A page captured before its site had a handler is the same page: it takes the handler.
  const existing =
    db.select({ id: captures.id }).from(captures).where(and(eq(captures.handler, handler.id), eq(captures.key, key))).get() ??
    (handler.id === 'page' ? undefined : db.select({ id: captures.id }).from(captures).where(and(eq(captures.handler, 'page'), inArray(captures.url, [url, req.url]))).get())
  captured++
  if (existing) {
    // The old screenshot's file stays in assets/, like a deleted image's.
    db.update(captures).set(cols).where(eq(captures.id, existing.id)).run()
    logEvent('capture', existing.id, 'edit', { recaptured: true, handler: handler.id, screenshot: cols.screenshot, title: cols.title, fields })
    return { handler: handler.id, id: existing.id, title: cols.title, created: false, comment: false }
  }
  const id = randomUUID()
  db.insert(captures)
    .values({ id, ...cols, capturedAt: now, capturedDate: toIsoDate(new Date(now)) })
    .run()
  logEvent('capture', id, 'create', { handler: handler.id, url, title: cols.title, screenshot: cols.screenshot, fields })
  return { handler: handler.id, id, title: cols.title, created: true, comment: false }
}

/**
 * Pages captured before their site had a handler (Marketplace listings bookmarked before there was one) take it,
 * when no capture of the handler has the same key already. Run at startup; returns how many changed.
 */
export function adoptPages(): number {
  let n = 0
  for (const r of db.select().from(captures).where(eq(captures.handler, 'page')).all()) {
    const u = new URL(r.url)
    const { handler, key } = handlerFor(u)
    if (handler.id === 'page' || db.select({ id: captures.id }).from(captures).where(and(eq(captures.handler, handler.id), eq(captures.key, key))).get()) continue
    const cols = { handler: handler.id, key, url: handler.canonical(u, key), title: handler.title?.(r.title) || r.title, site: handler.site(u, undefined, r.fields) }
    db.update(captures).set(cols).where(eq(captures.id, r.id)).run()
    logEvent('capture', r.id, 'edit', { adopted: true, ...cols })
    n++
  }
  return n
}

function captureComment(req: CaptureRequest): CaptureResult {
  const { handler, key } = handlerFor(parseUrl(req.url))
  if (!handler.sections.includes('comments')) bad(`${handler.name} ${handler.many} don’t keep comments: open a Reddit post (…/comments/<id>/…)`)
  const item = db.select().from(captures).where(and(eq(captures.handler, handler.id), eq(captures.key, key))).get()
  if (!item) throw new HTTPException(404, { message: `This ${handler.one} isn’t in Logcadence yet: capture it first` })
  const img = decodeImage(req.image, 'image')
  addImage(item.id, 'comments', { id: randomUUID(), file: saveFile(img), mime: img.mime })
  captured++
  return { handler: handler.id, id: item.id, title: item.title, created: false, comment: true }
}

// ── listing ────────────────────────────────────────────────────────────────

function tagsByCapture(ids?: string[]): Map<string, string[]> {
  const rows = db
    .select({ id: captureItemTags.captureId, path: captureTags.path })
    .from(captureItemTags)
    .innerJoin(captureTags, eq(captureTags.id, captureItemTags.tagId))
    .where(ids ? inArray(captureItemTags.captureId, ids) : undefined)
    .orderBy(asc(captureItemTags.position))
    .all()
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.id, [...(map.get(r.id) ?? []), r.path])
  return map
}

/** Captures with images in each section. */
function withImages(): Record<CaptureSection, Set<string>> {
  const rows = db.selectDistinct({ id: captureImages.captureId, section: captureImages.section }).from(captureImages).all()
  const out = { notes: new Set<string>(), comments: new Set<string>() }
  for (const r of rows) out[r.section].add(r.id)
  return out
}

function toSummary(r: Row, tags: string[], images: { notes: boolean; comments: boolean }): CaptureSummary {
  return {
    id: r.id,
    handler: r.handler,
    url: r.url,
    title: r.title,
    site: r.site,
    iconUrl: r.icon ? imageUrl(r.icon) : null,
    screenshotUrl: imageUrl(r.screenshot),
    thumbUrl: r.thumb ? imageUrl(r.thumb) : null,
    width: r.screenshotWidth,
    height: r.screenshotHeight,
    fields: r.fields,
    publishedAt: r.publishedAt,
    capturedAt: r.capturedAt,
    capturedDate: r.capturedDate,
    updatedAt: r.updatedAt,
    tags,
    hasNotes: images.notes || !!r.notes.trim(),
    hasComments: images.comments || !!r.comments.trim(),
  }
}

export function tagInfos(): TagInfo[] {
  return db
    .select({ path: captureTags.path, active: sql<number>`count(${captureItemTags.captureId})` })
    .from(captureTags)
    .leftJoin(captureItemTags, eq(captureItemTags.tagId, captureTags.id))
    .groupBy(captureTags.id)
    .orderBy(asc(captureTags.path))
    .all()
    .map((t) => ({ ...t, archived: 0 }))
}

/** Every capture, most recently captured first. */
export function library(): CaptureLibraryDTO {
  const tags = tagsByCapture()
  const imgs = withImages()
  const items = db
    .select()
    .from(captures)
    .orderBy(sql`${captures.capturedDate} desc, ${captures.capturedAt} desc`)
    .all()
    .map((r) => toSummary(r, tags.get(r.id) ?? [], { notes: imgs.notes.has(r.id), comments: imgs.comments.has(r.id) }))
  return { items, tags: tagInfos() }
}

export function getCapture(id: string): CaptureDTO | undefined {
  const r = db.select().from(captures).where(eq(captures.id, id)).get()
  if (!r) return undefined
  const rows = db.select().from(captureImages).where(eq(captureImages.captureId, id)).orderBy(asc(captureImages.position)).all()
  const images = (section: CaptureSection): ImageDTO[] => rows.filter((x) => x.section === section).map((x) => ({ id: x.id, url: imageUrl(x.file), mime: x.mime }))
  const notesImages = images('notes')
  const commentImages = images('comments')
  return {
    ...toSummary(r, tagsByCapture([id]).get(id) ?? [], { notes: notesImages.length > 0, comments: commentImages.length > 0 }),
    notes: r.notes,
    activeImageId: r.activeImageId,
    images: notesImages,
    comments: r.comments,
    commentsActiveImageId: r.commentsActiveImageId,
    commentImages,
  }
}

// ── editing ────────────────────────────────────────────────────────────────

function ensureTag(path: string): number {
  db.insert(captureTags).values({ path, createdAt: Date.now() }).onConflictDoNothing().run()
  return db.select({ id: captureTags.id }).from(captureTags).where(eq(captureTags.path, path)).get()!.id
}

/** Drops tags no capture carries any more. */
function pruneTags() {
  db.delete(captureTags)
    .where(sql`${captureTags.id} not in (select ${captureItemTags.tagId} from ${captureItemTags})`)
    .run()
}

function setTags(id: string, paths: string[]) {
  db.delete(captureItemTags).where(eq(captureItemTags.captureId, id)).run()
  cleanTags(paths).forEach((p, position) => db.insert(captureItemTags).values({ captureId: id, tagId: ensureTag(p), position }).run())
  pruneTags()
}

export function updateCapture(id: string, b: UpdateCaptureBody): CaptureDTO {
  const row = db.select().from(captures).where(eq(captures.id, id)).get() ?? notFound('capture')
  const handler = handlerById(row.handler)
  db.transaction(() => {
    const { tags, fields: raw, ...cols } = b
    // Fields edited by hand: the handler's only, and the site follows them where it comes from one (a listing's location).
    const fields = raw && cleanFields(handler, raw)
    const site = fields && handler.site(new URL(row.url), row.site, fields)
    db.update(captures)
      .set({ ...cols, ...(fields && { fields, site }), updatedAt: Date.now() })
      .where(eq(captures.id, id))
      .run()
    if (tags) setTags(id, tags)
  })
  logEvent('capture', id, 'edit', { ...b })
  return getCapture(id)!
}

/** Removes a capture, with its notes, comments and tags (its files stay in assets/, as the event keeps them). */
export function deleteCapture(id: string) {
  const before = getCapture(id) ?? notFound('capture')
  db.delete(captures).where(eq(captures.id, id)).run()
  pruneTags()
  logEvent('capture', id, 'delete', { handler: before.handler, url: before.url, title: before.title, notes: before.notes, comments: before.comments, tags: before.tags, capturedAt: before.capturedAt })
}

export function addImage(captureId: string, section: CaptureSection, img: { id: string; file: string; mime: string }): { image: ImageDTO; activeImageId: string } {
  const row = db.select().from(captures).where(eq(captures.id, captureId)).get() ?? notFound('capture')
  const active = row[ACTIVE[section]]
  const max = db
    .select({ p: sql<number | null>`max(${captureImages.position})` })
    .from(captureImages)
    .where(and(eq(captureImages.captureId, captureId), eq(captureImages.section, section)))
    .get()?.p
  db.transaction(() => {
    db.insert(captureImages)
      .values({ ...img, captureId, section, position: (max ?? 0) + 1, createdAt: Date.now() })
      .run()
    if (!active) db.update(captures).set({ [ACTIVE[section]]: img.id }).where(eq(captures.id, captureId)).run()
  })
  logEvent('capture-image', img.id, 'create', { captureId, section, file: img.file, mime: img.mime })
  return { image: { id: img.id, url: imageUrl(img.file), mime: img.mime }, activeImageId: active ?? img.id }
}

/** New order of a section's images; `ids` must be all of them. */
export function reorderImages(captureId: string, section: CaptureSection, ids: string[]) {
  const current = db
    .select({ id: captureImages.id })
    .from(captureImages)
    .where(and(eq(captureImages.captureId, captureId), eq(captureImages.section, section)))
    .all()
    .map((r) => r.id)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) bad(`ids must list each of the capture’s ${section} images once`)
  db.transaction(() => ids.forEach((id, i) => db.update(captureImages).set({ position: i + 1 }).where(eq(captureImages.id, id)).run()))
  logEvent('capture', captureId, 'edit', { [`${section}ImageOrder`]: ids })
}

/** Removes an image from its capture; the file stays in assets/ (the event keeps the row, for an undo). */
export function deleteImage(id: string): { activeImageId: string | null } {
  const img = db.select().from(captureImages).where(eq(captureImages.id, id)).get() ?? notFound('image')
  const row = db.select().from(captures).where(eq(captures.id, img.captureId)).get()!
  const col = ACTIVE[img.section]
  let activeImageId = row[col]
  db.transaction(() => {
    db.delete(captureImages).where(eq(captureImages.id, id)).run()
    if (activeImageId === id) {
      activeImageId =
        db
          .select({ id: captureImages.id })
          .from(captureImages)
          .where(and(eq(captureImages.captureId, row.id), eq(captureImages.section, img.section)))
          .orderBy(asc(captureImages.position))
          .get()?.id ?? null
      db.update(captures).set({ [col]: activeImageId }).where(eq(captures.id, row.id)).run()
    }
  })
  logEvent('capture-image', id, 'delete', { captureId: row.id, section: img.section, file: img.file, mime: img.mime, position: img.position, createdAt: img.createdAt })
  return { activeImageId }
}

// ── tags ───────────────────────────────────────────────────────────────────

const subtree = (root: string) => sql`(${captureTags.path} = ${root} or substr(${captureTags.path}, 1, ${root.length + 1}) = ${root + TAG_SEP})`

/** Moves `from` and its subtree under `to`; where a target path exists, the tags merge. */
export function moveTag(from: string, to: string) {
  if (from === to) return
  if (isUnder(to, from)) bad('cannot move a tag into its own subtree')
  const rows = db.select().from(captureTags).where(subtree(from)).all()
  if (!rows.length) bad(`tag ${from} not found`)
  db.transaction(() => {
    for (const row of rows) {
      const target = to + row.path.slice(from.length)
      const existing = db.select().from(captureTags).where(eq(captureTags.path, target)).get()
      if (!existing) {
        db.update(captureTags).set({ path: target }).where(eq(captureTags.id, row.id)).run()
        continue
      }
      const already = db.select({ id: captureItemTags.captureId }).from(captureItemTags).where(eq(captureItemTags.tagId, existing.id)).all().map((r) => r.id)
      if (already.length)
        db.delete(captureItemTags)
          .where(and(eq(captureItemTags.tagId, row.id), inArray(captureItemTags.captureId, already)))
          .run()
      db.update(captureItemTags).set({ tagId: existing.id }).where(eq(captureItemTags.tagId, row.id)).run()
      db.delete(captureTags).where(eq(captureTags.id, row.id)).run()
    }
  })
  logEvent('capture-tag', from, 'edit', { to })
}

/** Removes `path` and its subtree from every capture. */
export function deleteTag(path: string) {
  db.delete(captureTags).where(subtree(path)).run()
  logEvent('capture-tag', path, 'delete', {})
}
