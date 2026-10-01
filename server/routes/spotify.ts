import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate, shiftDate, today } from '../../shared/dates.ts'
import type { SpotifyStatus } from '../../shared/types.ts'
import { clientId, disconnect, forget, handleCallback, isConnected, loginUrl, REDIRECT_URI, setClientId } from '../lib/spotify/auth.ts'
import { nowPlaying, playFrom, playsOn, resumePoints, SpotifyError, stats, sync, syncState } from '../lib/spotify/spotify.ts'
import { bad, obj, str } from '../lib/validate.ts'

/** Only send the browser back into this app (dev server or production, on this machine). */
function safeReturn(url: string | undefined): string {
  try {
    const u = new URL(url ?? '')
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && /^https?:$/.test(u.protocol)) return u.href
  } catch {
    // fall through
  }
  return '/'
}

/** Spotify errors become 4xx answers the tab can show as they are. */
async function spotify<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof SpotifyError) bad(err.message)
    throw err
  }
}

export const spotifyRoutes = new Hono()
  .get('/spotify/status', (c) => {
    const status: SpotifyStatus = { configured: !!clientId(), connected: isConnected(), redirectUri: REDIRECT_URI, ...syncState() }
    return c.json(status)
  })
  .post(
    '/spotify/client-id',
    validator('json', (v) => {
      const clientId = str(obj(v), 'clientId').trim()
      if (!/^[0-9a-f]{32}$/i.test(clientId)) bad('A Spotify Client ID is 32 hex characters (Spotify developer dashboard → your app → Settings)')
      return { clientId }
    }),
    (c) => {
      setClientId(c.req.valid('json').clientId)
      return c.json({ ok: true })
    },
  )
  .get('/spotify/login', (c) => {
    try {
      return c.redirect(loginUrl(safeReturn(c.req.query('return'))))
    } catch (err) {
      bad((err as Error).message)
    }
  })
  .get('/spotify/callback', async (c) => {
    const q = c.req.query()
    try {
      const back = await handleCallback(q.code, q.state, q.error)
      sync().catch(() => {}) // first history pull; the tab shows progress via status
      return c.redirect(back)
    } catch (err) {
      return c.text((err as Error).message, 400)
    }
  })
  .post('/spotify/disconnect', (c) => {
    disconnect()
    return c.json({ ok: true })
  })
  .post('/spotify/forget', (c) => {
    forget()
    return c.json({ ok: true })
  })
  .post('/spotify/sync', async (c) => c.json(await spotify(sync)))
  .get('/spotify/now', async (c) => c.json(await spotify(nowPlaying)))
  // Plays and likes per day since `from` (default: a year ago), for the heatmaps.
  .get('/spotify/stats', (c) => {
    const from = c.req.query('from')
    return c.json(stats(from && isIsoDate(from) ? from : shiftDate(today(), -371)))
  })
  .get('/spotify/day/:date', (c) => {
    const date = c.req.param('date')
    if (!isIsoDate(date)) bad('invalid date')
    return c.json({ date, plays: playsOn(date) })
  })
  // Resume points from the last listening day before `before` (default today), i.e. "yesterday".
  .get('/spotify/resume', (c) => {
    const before = c.req.query('before')
    return c.json({ resume: resumePoints(before && isIsoDate(before) ? before : today()) })
  })
  .post(
    '/spotify/play',
    validator('json', (v) => {
      const o = obj(v)
      return { contextUri: str(o, 'contextUri'), trackUri: str(o, 'trackUri') }
    }),
    async (c) => {
      const { contextUri, trackUri } = c.req.valid('json')
      await spotify(() => playFrom(contextUri, trackUri))
      return c.json({ ok: true })
    },
  )
