import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { SearchHit } from '../../shared/types.ts'
import { db, eventsDb } from '../db/client.ts'
import { entries, nodes } from '../db/content-schema.ts'
import { events } from '../db/events-schema.ts'
import { tagsFor } from '../lib/content.ts'

const LIMIT = 60

/** Every whitespace-separated term must appear (case-insensitive for ASCII). */
function allTerms(column: AnySQLiteColumn, terms: string[]): SQL | undefined {
  return and(...terms.map((t) => sql`${column} like ${'%' + t.replace(/[\\%_]/g, (m) => '\\' + m) + '%'} escape '\\'`))
}

function snippet(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const i = Math.max(0, flat.toLowerCase().indexOf(term.toLowerCase()))
  const start = Math.max(0, i - 50)
  return (start > 0 ? '…' : '') + flat.slice(start, start + 160) + (start + 160 < flat.length ? '…' : '')
}

export const searchRoutes = new Hono()
  .get(
    '/search',
    validator('query', (v) => ({ q: String(v.q ?? '') })),
    (c) => {
      const terms = c.req.valid('query').q.trim().split(/\s+/).filter(Boolean)
      if (!terms.length) return c.json({ hits: [] as SearchHit[] })

      const entryRows = db
        .select({ id: entries.id, date: entries.date, title: entries.title, archived: entries.archived })
        .from(entries)
        .where(allTerms(entries.title, terms))
        .orderBy(desc(entries.date))
        .limit(LIMIT)
        .all()
      const nodeRows = db
        .select({
          id: nodes.id,
          content: nodes.content,
          archived: nodes.archived,
          entryId: entries.id,
          date: entries.date,
          title: entries.title,
          entryArchived: entries.archived,
        })
        .from(nodes)
        .innerJoin(entries, eq(entries.id, nodes.entryId))
        .where(allTerms(nodes.content, terms))
        .orderBy(desc(entries.date), nodes.position)
        .limit(LIMIT)
        .all()

      const tagMap = tagsFor([...new Set([...entryRows.map((r) => r.id), ...nodeRows.map((r) => r.entryId)])])
      const hits: SearchHit[] = [
        ...entryRows.map((r) => ({
          entryId: r.id,
          nodeId: null,
          date: r.date,
          title: r.title,
          tags: tagMap.get(r.id) ?? [],
          snippet: '',
          archived: r.archived,
        })),
        ...nodeRows.map((r) => ({
          entryId: r.entryId,
          nodeId: r.id,
          date: r.date,
          title: r.title,
          tags: tagMap.get(r.entryId) ?? [],
          snippet: snippet(r.content, terms[0]!),
          archived: r.archived || r.entryArchived,
        })),
      ]
      return c.json({ hits })
    },
  )
  // Recent mutation log, newest first (debugging / future sync).
  .get('/events', (c) => {
    const limit = Math.min(500, Number(c.req.query('limit')) || 100)
    return c.json({ events: eventsDb.select().from(events).orderBy(desc(events.id)).limit(limit).all() })
  })
