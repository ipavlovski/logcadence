import { sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

type Db = Pick<BetterSQLite3Database, 'all' | 'run'>

/**
 * Every entry's tags without its category (withoutCategory), over the whole library: after tag moves, a category
 * rename, an import. As 0020_category_tags did once. Takes the database (or a transaction) to use, so the importer
 * can run it on the library it builds; returns the days of the entries changed.
 */
export function dropCategoryTagsIn(d: Db): string[] {
  const under = sql.raw(`substr(t.path, 1, length(e.category) + 1) = e.category || '/'`)
  const from = sql.raw('FROM entries e JOIN entry_tags et ON et.entry_id = e.id JOIN tags t ON t.id = et.tag_id')
  const dates = d.all<{ date: string }>(sql`SELECT DISTINCT e.date AS date ${from} WHERE t.path = e.category OR ${under}`).map((r) => r.date)
  if (!dates.length) return []
  // `dev/react` on a dev entry: `react`, where the old tag was (unless the entry has it already).
  d.run(sql`INSERT OR IGNORE INTO tags (path, created_at) SELECT DISTINCT substr(t.path, length(e.category) + 2), ${Date.now()} ${from} WHERE ${under}`)
  d.run(sql`INSERT OR IGNORE INTO entry_tags (entry_id, tag_id, position)
    SELECT e.id, n.id, et.position ${from} JOIN tags n ON n.path = substr(t.path, length(e.category) + 2) WHERE ${under}`)
  d.run(sql`DELETE FROM entry_tags WHERE EXISTS (SELECT 1 FROM entries e JOIN tags t ON t.id = entry_tags.tag_id
    WHERE e.id = entry_tags.entry_id AND (t.path = e.category OR ${under}))`)
  d.run(sql`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)`)
  return dates
}
