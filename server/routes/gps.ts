import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import { disconnect, forget, GoogleAuthError, handleCallback, loginUrl, setClient } from '../lib/gdrive/auth.ts'
import { DriveError } from '../lib/gdrive/drive.ts'
import { importNew, importRange, setFolder, status, updateSettings } from '../lib/gps/drive.ts'
import { getDay, listDays, renamePlace, scanGps, setHomebase } from '../lib/gps/scan.ts'
import { bad, notFound, obj, optBool, str } from '../lib/validate.ts'

const dateParam = (date: string) => (isIsoDate(date) ? date : bad('invalid date'))

/** Drive errors become 4xx answers the settings window can show as they are. */
async function drive<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DriveError || err instanceof GoogleAuthError) bad(err.message)
    throw err
  }
}

/** The page the Google login ends on, in the system browser (Google won't sign in inside the desktop app). */
const callbackPage = (ok: boolean, message: string) => `<!doctype html><meta charset="utf-8"><title>Logcadence</title>
<body style="font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#333">
<p style="max-width:420px;text-align:center">${ok ? '<b>Google Drive connected.</b><br>' : ''}${message.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`

export const gpsRoutes = new Hono()
  // Processes new and changed files in data/gps/.
  .post('/gps/scan', async (c) => c.json(await scanGps()))
  // Days with GPS data, with time per kind (for a later heatmap/overview).
  .get('/gps/days', (c) => c.json({ days: listDays() }))
  .get('/gps/day/:date', (c) => c.json(getDay(dateParam(c.req.param('date'))) ?? notFound('GPS day')))
  .patch(
    '/gps/places/:id',
    validator('json', (v) => {
      const name = obj(v).name
      if (name !== null && typeof name !== 'string') bad('name must be a string or null')
      return { name: (name as string | null)?.trim() || null }
    }),
    (c) => {
      renamePlace(c.req.param('id'), c.req.valid('json').name)
      return c.json({ ok: true })
    },
  )
  // Homebase picked by hand (a hotel when travelling); null goes back to the overnight guess.
  .put(
    '/gps/day/:date/homebase',
    validator('json', (v) => {
      const placeId = obj(v).placeId
      if (placeId !== null && typeof placeId !== 'string') bad('placeId must be a string or null')
      return { placeId: placeId as string | null }
    }),
    (c) => {
      const date = dateParam(c.req.param('date'))
      setHomebase(date, c.req.valid('json').placeId)
      return c.json(getDay(date)!)
    },
  )

  // ── Google Drive import ──
  .get('/gps/drive/status', (c) => c.json(status()))
  .post(
    '/gps/drive/client',
    validator('json', (v) => {
      const o = obj(v)
      const clientId = str(o, 'clientId').trim()
      const clientSecret = str(o, 'clientSecret').trim()
      if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) bad('A Google Client ID ends in .apps.googleusercontent.com')
      if (!clientSecret) bad('Paste the client secret too')
      return { clientId, clientSecret }
    }),
    (c) => {
      const { clientId, clientSecret } = c.req.valid('json')
      setClient(clientId, clientSecret)
      return c.json(status())
    },
  )
  .get('/gps/drive/login', (c) => {
    try {
      return c.redirect(loginUrl())
    } catch (err) {
      bad((err as Error).message)
    }
  })
  .get('/gps/drive/callback', async (c) => {
    const q = c.req.query()
    try {
      await handleCallback(q.code, q.state, q.error)
      return c.html(callbackPage(true, 'You can close this tab and go back to Logcadence.'))
    } catch (err) {
      return c.html(callbackPage(false, (err as Error).message), 400)
    }
  })
  .post('/gps/drive/disconnect', (c) => {
    disconnect()
    return c.json(status())
  })
  .post('/gps/drive/forget', (c) => {
    forget()
    return c.json(status())
  })
  .put(
    '/gps/drive/folder',
    validator('json', (v) => ({ folder: str(obj(v), 'folder') })),
    async (c) => {
      await drive(() => setFolder(c.req.valid('json').folder))
      return c.json(status())
    },
  )
  .patch(
    '/gps/drive/settings',
    validator('json', (v) => {
      const o = obj(v)
      const lastDate = o.lastDate
      if (lastDate !== undefined && lastDate !== null && !(typeof lastDate === 'string' && isIsoDate(lastDate))) bad('lastDate must be a YYYY-MM-DD date or null')
      return { auto: optBool(o, 'auto'), lastDate: lastDate as string | null | undefined }
    }),
    (c) => {
      const { auto, lastDate } = c.req.valid('json')
      updateSettings({ ...(auto !== undefined && { auto }), ...(lastDate !== undefined && { lastDate }) })
      return c.json(status())
    },
  )
  // Imports run in the background; the window polls the status for progress and the result.
  .post('/gps/drive/import-new', (c) => {
    importNew().catch(() => {}) // the error is in the status
    return c.json(status())
  })
  .post(
    '/gps/drive/import-range',
    validator('json', (v) => {
      const o = obj(v)
      const from = dateParam(str(o, 'from'))
      const to = dateParam(str(o, 'to'))
      if (from > to) bad('The start date is after the end date')
      return { from, to }
    }),
    (c) => {
      const { from, to } = c.req.valid('json')
      importRange(from, to).catch(() => {})
      return c.json(status())
    },
  )
