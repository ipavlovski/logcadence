import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { normalizeTag } from '../../shared/tags.ts'
import type { CaptureFields, CaptureRequest, CaptureSection, UpdateCaptureBody } from '../../shared/types.ts'
import { addImage, capture, captureRevision, deleteCapture, deleteImage, deleteTag, getCapture, library, moveTag, reorderImages, updateCapture } from '../lib/captures.ts'
import { saveUpload } from '../lib/media.ts'
import { bad, defined, notFound, obj, optNum, optStr, optStrArr, str, type Obj } from '../lib/validate.ts'

// The Bookmarks tab, and POST /capture, where the Chrome extension (extension/) sends a page.

// The extension sends this header. A web page can't add it to a request to another origin without a CORS
// preflight, which this server never answers, so pages open in the browser can't send captures.
export const CAPTURE_HEADER = 'x-logcadence-capture'

const MAX_UPLOAD = 500 * 1024 * 1024

const SECTIONS: CaptureSection[] = ['notes', 'comments']
const section = (v: string | undefined): CaptureSection => (SECTIONS.includes(v as CaptureSection) ? (v as CaptureSection) : bad('section must be notes or comments'))
const tagPath = (o: Obj, k: string) => normalizeTag(str(o, k)) || bad(`${k} must be a tag`)

/** An object of strings and numbers; which keys a capture keeps is up to its handler (cleanFields). */
function optFields(o: Obj, k: string): CaptureFields | undefined {
  if (o[k] === undefined) return undefined
  const f = obj(o[k])
  if (!Object.values(f).every((v) => typeof v === 'string' || typeof v === 'number')) bad(`${k} must map names to strings or numbers`)
  return f as CaptureFields
}

function parseCapture(v: unknown): CaptureRequest {
  const o = obj(v)
  const target = str(o, 'target')
  if (target !== 'bookmark' && target !== 'comment') bad('target must be bookmark or comment')
  return defined({
    target,
    url: str(o, 'url'),
    title: optStr(o, 'title') ?? '',
    image: str(o, 'image'),
    thumb: optStr(o, 'thumb'),
    width: optNum(o, 'width'),
    height: optNum(o, 'height'),
    icon: optStr(o, 'icon'),
    site: optStr(o, 'site'),
    fields: optFields(o, 'fields'),
    publishedAt: optNum(o, 'publishedAt'),
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
    fields: optFields(o, 'fields'),
    publishedAt: o.publishedAt === null ? null : optNum(o, 'publishedAt'),
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

  // ── the tab ──
  .get('/captures/library', (c) => c.json(library()))
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
      return c.json(addImage(id, sec, { id: imageId, ...(await saveUpload(imageId, file)) }), 201)
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

  // ── tags ──
  .post(
    '/captures/tags/move',
    validator('json', (v) => {
      const o = obj(v)
      return { from: tagPath(o, 'from'), to: tagPath(o, 'to') }
    }),
    (c) => {
      const { from, to } = c.req.valid('json')
      moveTag(from, to)
      return c.json({ ok: true })
    },
  )
  .post(
    '/captures/tags/delete',
    validator('json', (v) => ({ path: tagPath(obj(v), 'path') })),
    (c) => {
      deleteTag(c.req.valid('json').path)
      return c.json({ ok: true })
    },
  )
