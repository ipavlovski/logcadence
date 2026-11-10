import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { isIsoDate } from '../../shared/dates.ts'
import type { DayCount } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { entries } from '../db/content-schema.ts'
import { entriesForDate } from '../lib/content.ts'
import { bad } from '../lib/validate.ts'

export const journalRoutes = new Hono()
  .get('/journal/:date', (c) => {
    const date = c.req.param('date')
    if (!isIsoDate(date)) bad('invalid date')
    return c.json({ date, entries: entriesForDate(date) })
  })
  // Days that have entries, newest first, for date navigation.
  .get('/journal-dates', (c) => {
    const dates = db
      .select({ date: entries.date, count: sql<number>`count(*)` })
      .from(entries)
      .where(eq(entries.archived, false))
      .groupBy(entries.date)
      .orderBy(desc(entries.date))
      .all()
    return c.json({ dates })
  })
  // Entries written per day from `from` on (for heatmaps).
  .get('/journal-activity', (c) => {
    const from = c.req.query('from') ?? ''
    if (!isIsoDate(from)) bad('from must be YYYY-MM-DD')
    const days: DayCount[] = db
      .select({ date: entries.date, count: sql<number>`count(*)` })
      .from(entries)
      .where(and(eq(entries.archived, false), eq(entries.type, 'journal'), gte(entries.date, from)))
      .groupBy(entries.date)
      .all()
    return c.json({ days })
  })
