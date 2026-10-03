import { Hono } from 'hono'
import { db } from '../db/client.ts'
import { spansBetween } from '../lib/activity.ts'
import { bad } from '../lib/validate.ts'

const DAY_MS = 86_400_000

export const activityRoutes = new Hono()
  // Input and tracked spans in [from, to) (epoch ms). The client picks the range, so days follow its time zone.
  .get('/activity/spans', (c) => {
    const from = Number(c.req.query('from'))
    const to = Number(c.req.query('to'))
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) bad('from and to must be epoch ms, from < to')
    if (to - from > 400 * DAY_MS) bad('range too long')
    return c.json(spansBetween(db, from, to))
  })
