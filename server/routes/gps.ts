import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import { getDay, listDays, renamePlace, scanGps, setHomebase } from '../lib/gps/scan.ts'
import { bad, notFound, obj } from '../lib/validate.ts'

const dateParam = (date: string) => (isIsoDate(date) ? date : bad('invalid date'))

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
