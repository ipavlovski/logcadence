import { createHash, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { toIsoDate } from '../../shared/dates.ts'
import { cleanTags, isUnder } from '../../shared/tags.ts'
import type { CaptureDTO, CaptureKind, CaptureLibraryDTO, CaptureRequest, CaptureResult, CaptureSection, CaptureSummary, ImageDTO, TagInfo, UpdateCaptureBody } from '../../shared/types.ts'
import { ASSETS_DIR, db } from '../db/client.ts'
import { captureImages, captureItemTags, captures, captureTags } from '../db/content-schema.ts'
import { imageUrl } from './content.ts'
import { logEvent } from './events.ts'
import { bad, notFound } from './validate.ts'

// Pages captured by the Chrome extension (extension/): Reddit posts for the Reddit tab, anything else for the
// Bookmarks tab. A capture is a screenshot with the page's url, title and icon; notes, comments, images and tags
// are added in the app. Capturing a page again replaces its screenshot (and what Reddit showed), keeping the rest.

type Row = typeof captures.$inferSelect

/** The active image column of each image section. */
const ACTIVE = { notes: 'activeImageId', comments: 'commentsActiveImageId' } as const

// Bumped by every capture from the extension, so an open tab notices and reloads (the app's own edits reload it already).
let captured = 0
const started = Date.now()
export const captureRevision = () => `${started}.${captured}`

// ── pages ──────────────────────────────────────────────────────────────────

/** A Reddit post's id from its url (…/comments/<id>/…, also on a comment's link, or redd.it/<id>). */
export function redditPostId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname === 'redd.it') return u.pathname.match(/^\/([a-z0-9]+)\/?$/i)?.[1]?.toLowerCase() ?? null
  if (!/(^|\.)reddit\.com$/.test(u.hostname)) return null
  return u.pathname.match(/\/comments\/([a-z0-9]+)(\/|$)/i)?.[1]?.toLowerCase() ?? null
}

/** The post's link as Reddit gives it, without the query, the comment and the old/np/m host. */
function redditPermalink(url: string, id: string): string {
  const u = new URL(url)
  const m = u.pathname.match(/^(\/r\/[^/]+)?\/comments\/[a-z0-9]+(\/[^/]+)?/i)
  return `https://www.reddit.com${m ? m[0] : `/comments/${id}`}/`
}

/** "r/selfhosted" from the page, or from the post's link. */
function subredditOf(url: string, given?: string): string {
  const name = (given ?? '').trim().replace(/^\/?r\//i, '') || new URL(url).pathname.match(/^\/r\/([^/]+)/)?.[1] || ''
  return name ? `r/${name}` : ''
}

function pageKey(kind: CaptureKind, url: string): { key: string; url: string } {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    bad('url must be a link')
  }
  if (!/^https?:$/.test(u.protocol)) bad('only http(s) pages can be captured')
  if (kind === 'reddit') {
    const id = redditPostId(url) ?? bad('not a Reddit post (…/comments/<id>/…)')
    return { key: id, url: redditPermalink(url, id) }
  }
  u.hash = ''
  return { key: u.href, url: u.href }
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

/** Stores what the extension sent: a new page, a page captured again, or a screenshot for a post's comments. */
export function capture(req: CaptureRequest): CaptureResult {
  if (req.target === 'comment') return captureComment(req)
  const kind = req.target
  const { key, url } = pageKey(kind, req.url)
  const shot = decodeImage(req.image, 'image')
  const thumb = req.thumb ? decodeImage(req.thumb, 'thumb') : null
  const icon = req.icon ? iconOf(req.icon) : null
  const now = Date.now()
  const fields = {
    url,
    title: req.title.trim() || url,
    site: kind === 'reddit' ? subredditOf(url, req.post?.subreddit) : new URL(url).hostname.replace(/^www\./, ''),
    screenshot: saveFile(shot),
    screenshotWidth: optInt(req.width),
    screenshotHeight: optInt(req.height),
    thumb: thumb ? saveFile(thumb) : null,
    ...(icon && { icon: saveIcon(icon) }),
    ...(kind === 'reddit' && {
      author: req.post?.author?.replace(/^u\//, '') || null,
      score: optInt(req.post?.score),
      commentCount: optInt(req.post?.comments),
      postedAt: optInt(req.post?.postedAt),
    }),
    updatedAt: now,
  }
  const existing = db.select({ id: captures.id }).from(captures).where(and(eq(captures.kind, kind), eq(captures.key, key))).get()
  captured++
  if (existing) {
    // The old screenshot's file stays in assets/, like a deleted image's.
    db.update(captures).set(fields).where(eq(captures.id, existing.id)).run()
    logEvent('capture', existing.id, 'edit', { recaptured: true, screenshot: fields.screenshot, title: fields.title })
    return { kind, id: existing.id, title: fields.title, created: false, comment: false }
  }
  const id = randomUUID()
  db.insert(captures)
    .values({ id, kind, key, ...fields, capturedAt: now, capturedDate: toIsoDate(new Date(now)) })
    .run()
  logEvent('capture', id, 'create', { kind, url, title: fields.title, screenshot: fields.screenshot })
  return { kind, id, title: fields.title, created: true, comment: false }
}

function captureComment(req: CaptureRequest): CaptureResult {
  const postId = redditPostId(req.url) ?? bad('comments go to a Reddit post: open the post (…/comments/<id>/…)')
  const post = db.select().from(captures).where(and(eq(captures.kind, 'reddit'), eq(captures.key, postId))).get()
  if (!post) throw new HTTPException(404, { message: 'This post isn’t in Logcadence yet: capture the post first' })
  const img = decodeImage(req.image, 'image')
  addImage(post.id, 'comments', { id: randomUUID(), file: saveFile(img), mime: img.mime })
  captured++
  return { kind: 'reddit', id: post.id, title: post.title, created: false, comment: true }
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
    kind: r.kind,
    url: r.url,
    title: r.title,
    site: r.site,
    iconUrl: r.icon ? imageUrl(r.icon) : null,
    screenshotUrl: imageUrl(r.screenshot),
    thumbUrl: r.thumb ? imageUrl(r.thumb) : null,
    width: r.screenshotWidth,
    height: r.screenshotHeight,
    author: r.author,
    score: r.score,
    commentCount: r.commentCount,
    postedAt: r.postedAt,
    capturedAt: r.capturedAt,
    capturedDate: r.capturedDate,
    updatedAt: r.updatedAt,
    tags,
    hasNotes: images.notes || !!r.notes.trim(),
    hasComments: images.comments || !!r.comments.trim(),
  }
}

export function tagInfos(kind: CaptureKind): TagInfo[] {
  return db
    .select({ path: captureTags.path, active: sql<number>`count(${captureItemTags.captureId})` })
    .from(captureTags)
    .leftJoin(captureItemTags, eq(captureItemTags.tagId, captureTags.id))
    .where(eq(captureTags.kind, kind))
    .groupBy(captureTags.id)
    .orderBy(asc(captureTags.path))
    .all()
    .map((t) => ({ ...t, archived: 0 }))
}

/** A tab's captures, most recently captured first. */
export function library(kind: CaptureKind): CaptureLibraryDTO {
  const tags = tagsByCapture()
  const imgs = withImages()
  const items = db
    .select()
    .from(captures)
    .where(eq(captures.kind, kind))
    .orderBy(sql`${captures.capturedDate} desc, ${captures.capturedAt} desc`)
    .all()
    .map((r) => toSummary(r, tags.get(r.id) ?? [], { notes: imgs.notes.has(r.id), comments: imgs.comments.has(r.id) }))
  return { items, tags: tagInfos(kind) }
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

const kindOf = (id: string): CaptureKind => db.select({ kind: captures.kind }).from(captures).where(eq(captures.id, id)).get()?.kind ?? notFound('capture')

function ensureTag(kind: CaptureKind, path: string): number {
  db.insert(captureTags).values({ kind, path, createdAt: Date.now() }).onConflictDoNothing().run()
  return db
    .select({ id: captureTags.id })
    .from(captureTags)
    .where(and(eq(captureTags.kind, kind), eq(captureTags.path, path)))
    .get()!.id
}

/** Drops tags no capture carries any more. */
function pruneTags() {
  db.delete(captureTags)
    .where(sql`${captureTags.id} not in (select ${captureItemTags.tagId} from ${captureItemTags})`)
    .run()
}

function setTags(id: string, kind: CaptureKind, paths: string[]) {
  db.delete(captureItemTags).where(eq(captureItemTags.captureId, id)).run()
  cleanTags(paths).forEach((p, position) => db.insert(captureItemTags).values({ captureId: id, tagId: ensureTag(kind, p), position }).run())
  pruneTags()
}

export function updateCapture(id: string, b: UpdateCaptureBody): CaptureDTO {
  const kind = kindOf(id)
  db.transaction(() => {
    const { tags, ...cols } = b
    db.update(captures)
      .set({ ...cols, updatedAt: Date.now() })
      .where(eq(captures.id, id))
      .run()
    if (tags) setTags(id, kind, tags)
  })
  logEvent('capture', id, 'edit', { ...b })
  return getCapture(id)!
}

/** Removes a capture, with its notes, comments and tags (its files stay in assets/, as the event keeps them). */
export function deleteCapture(id: string) {
  const before = getCapture(id) ?? notFound('capture')
  db.delete(captures).where(eq(captures.id, id)).run()
  pruneTags()
  logEvent('capture', id, 'delete', { kind: before.kind, url: before.url, title: before.title, notes: before.notes, comments: before.comments, tags: before.tags, capturedAt: before.capturedAt })
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

const subtree = (kind: CaptureKind, root: string) =>
  and(eq(captureTags.kind, kind), sql`(${captureTags.path} = ${root} or substr(${captureTags.path}, 1, ${root.length + 1}) = ${root + ':'})`)

/** Moves `from` and its subtree under `to`; where a target path exists, the tags merge. */
export function moveTag(kind: CaptureKind, from: string, to: string) {
  if (from === to) return
  if (isUnder(to, from)) bad('cannot move a tag into its own subtree')
  const rows = db.select().from(captureTags).where(subtree(kind, from)).all()
  if (!rows.length) bad(`tag ${from} not found`)
  db.transaction(() => {
    for (const row of rows) {
      const target = to + row.path.slice(from.length)
      const existing = db
        .select()
        .from(captureTags)
        .where(and(eq(captureTags.kind, kind), eq(captureTags.path, target)))
        .get()
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
  logEvent('capture-tag', `${kind}:${from}`, 'edit', { kind, to })
}

/** Removes `path` and its subtree from every capture of the kind. */
export function deleteTag(kind: CaptureKind, path: string) {
  db.delete(captureTags).where(subtree(kind, path)).run()
  logEvent('capture-tag', `${kind}:${path}`, 'delete', { kind })
}
