import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { isIsoDate } from '../../shared/dates.ts'
import type { DayCount } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { chats, entries } from '../db/content-schema.ts'
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
  // Entries written per day from `from` on (dashboard heatmap); imported AI chats aren't journal entries here.
  .get('/journal-activity', (c) => {
    const from = c.req.query('from') ?? ''
    if (!isIsoDate(from)) bad('from must be YYYY-MM-DD')
    const days: DayCount[] = db
      .select({ date: entries.date, count: sql<number>`count(*)` })
      .from(entries)
      .leftJoin(chats, eq(chats.entryId, entries.id))
      .where(and(eq(entries.archived, false), isNull(chats.id), gte(entries.date, from)))
      .groupBy(entries.date)
      .all()
    return c.json({ days })
  })
