import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { normalizeTag } from '../../shared/tags.ts'
import type { CaptureKind, CaptureRequest, CaptureSection, UpdateCaptureBody } from '../../shared/types.ts'
import { ASSETS_DIR } from '../db/client.ts'
import { extension } from '../lib/content.ts'
import { addImage, capture, captureRevision, deleteCapture, deleteImage, deleteTag, getCapture, library, moveTag, reorderImages, updateCapture } from '../lib/captures.ts'
import { bad, defined, notFound, obj, optNum, optStr, optStrArr, str, type Obj } from '../lib/validate.ts'

// The Reddit and Bookmarks tabs, and POST /capture, where the Chrome extension (extension/) sends a page.

// The extension sends this header. A web page can't add it to a request to another origin without a CORS
// preflight, which this server never answers, so pages open in the browser can't send captures.
export const CAPTURE_HEADER = 'x-logcadence-capture'

const MAX_UPLOAD = 500 * 1024 * 1024

const KINDS: CaptureKind[] = ['reddit', 'bookmark']
const kind = (v: string | undefined): CaptureKind => (KINDS.includes(v as CaptureKind) ? (v as CaptureKind) : bad('kind must be reddit or bookmark'))
const SECTIONS: CaptureSection[] = ['notes', 'comments']
const section = (v: string | undefined): CaptureSection => (SECTIONS.includes(v as CaptureSection) ? (v as CaptureSection) : bad('section must be notes or comments'))
const tagPath = (o: Obj, k: string) => normalizeTag(str(o, k)) || bad(`${k} must be a tag`)

function parseCapture(v: unknown): CaptureRequest {
  const o = obj(v)
  const target = str(o, 'target')
  if (target !== 'reddit' && target !== 'bookmark' && target !== 'comment') bad('target must be reddit, bookmark or comment')
  const p = o.post === undefined ? undefined : obj(o.post)
  return defined({
    target,
    url: str(o, 'url'),
    title: optStr(o, 'title') ?? '',
    image: str(o, 'image'),
    thumb: optStr(o, 'thumb'),
    width: optNum(o, 'width'),
    height: optNum(o, 'height'),
    icon: optStr(o, 'icon'),
    post: p && defined({ subreddit: optStr(p, 'subreddit'), author: optStr(p, 'author'), score: optNum(p, 'score'), comments: optNum(p, 'comments'), postedAt: optNum(p, 'postedAt') }),
  })
}

function parseUpdate(v: unknown): UpdateCaptureBody {
  const o = obj(v)
  const image = (k: string) => {
    const v = o[k]
    if (v !== undefined && v !== null && typeof v !== 'string') bad(`${k} must be a string or null`)
    return v as string | null | undefined
  }
  return defined({
    notes: optStr(o, 'notes'),
    comments: optStr(o, 'comments'),
    tags: optStrArr(o, 'tags'),
    activeImageId: image('activeImageId'),
    commentsActiveImageId: image('commentsActiveImageId'),
  })
}


export const captureRoutes = new Hono()
  // ── from the extension ──
  .get('/capture/ping', (c) => c.json({ app: 'logcadence' }))
  .post(
    '/capture',
    async (c, next) => {
      if (!c.req.header(CAPTURE_HEADER)) bad(`captures come from the Logcadence extension (missing ${CAPTURE_HEADER})`)
      await next()
    },
    validator('json', parseCapture),
    (c) => {
      const r = capture(c.req.valid('json'))
      return c.json(r, r.created ? 201 : 200)
    },
  )
  // Polled by an open tab, to reload when a capture arrives.
  .get('/captures/revision', (c) => c.json({ revision: captureRevision() }))

  // ── the tabs ──
  .get('/captures/:kind/library', (c) => c.json(library(kind(c.req.param('kind')))))
  .get('/captures/items/:id', (c) => c.json(getCapture(c.req.param('id')) ?? notFound('capture')))
  .patch('/captures/items/:id', validator('json', parseUpdate), (c) => c.json(updateCapture(c.req.param('id'), c.req.valid('json'))))
  .delete('/captures/items/:id', (c) => {
    deleteCapture(c.req.param('id'))
    return c.json({ ok: true })
  })
  // Pasted/dropped images, gifs and videos for a capture's notes or comments, stored under assets/ like the journal's.
  .post(
    '/captures/items/:id/images/:section',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (!/^(image|video)\//.test(file.type)) bad('only images and videos are supported')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const id = c.req.param('id')
      const sec = section(c.req.param('section'))
      getCapture(id) ?? notFound('capture')
      const { file } = c.req.valid('form')
      const imageId = randomUUID()
      const name = `${imageId}.${extension(file)}`
      writeFileSync(path.join(ASSETS_DIR, name), Buffer.from(await file.arrayBuffer()))
      return c.json(addImage(id, sec, { id: imageId, file: name, mime: file.type }), 201)
    },
  )
  .post(
    '/captures/items/:id/images/:section/order',
    validator('json', (v) => ({ ids: optStrArr(obj(v), 'ids') ?? [] })),
    (c) => {
      reorderImages(c.req.param('id'), section(c.req.param('section')), c.req.valid('json').ids)
      return c.json({ ok: true })
    },
  )
  .delete('/captures/images/:id', (c) => c.json(deleteImage(c.req.param('id'))))

  // ── tags (each tab's own) ──
  .post(
    '/captures/:kind/tags/move',
    validator('json', (v) => {
      const o = obj(v)
      return { from: tagPath(o, 'from'), to: tagPath(o, 'to') }
    }),
    (c) => {
      const { from, to } = c.req.valid('json')
      moveTag(kind(c.req.param('kind')), from, to)
      return c.json({ ok: true })
    },
  )
  .post(
    '/captures/:kind/tags/delete',
    validator('json', (v) => ({ path: tagPath(obj(v), 'path') })),
    (c) => {
      deleteTag(kind(c.req.param('kind')), c.req.valid('json').path)
      return c.json({ ok: true })
    },
  )
