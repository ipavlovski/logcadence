import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { CaptureFields, CaptureRequest } from '../../shared/types.ts'
import { capture, captureRevision } from '../lib/captures.ts'
import { bad, defined, obj, optNum, optStr, str, type Obj } from '../lib/validate.ts'

// POST /capture, where the Chrome extension (extension/) sends a page: it becomes an entry (server/lib/captures.ts).

// The extension sends this header. A web page can't add it to a request to another origin without a CORS
// preflight, which this server never answers, so pages open in the browser can't send captures.
export const CAPTURE_HEADER = 'x-logcadence-capture'

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

export const captureRoutes = new Hono()
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
  // Polled by the open app, to reload when a capture arrives.
  .get('/revision', (c) => c.json({ revision: captureRevision() }))
