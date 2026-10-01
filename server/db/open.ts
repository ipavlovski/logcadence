import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as contentSchema from './content-schema.ts'
import * as eventsSchema from './events-schema.ts'

// Opening (and migrating) the two databases, without side effects on import, so a library other than the
// running one can be opened too (the data importer builds a fresh one next to it).

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// The desktop build ships the migrations as resources, outside the source tree. Read when used, so the
// desktop app can set it after this module has loaded.
const migrationsDir = () => (process.env.LOGSEQ_MIGRATIONS_DIR ? path.resolve(process.env.LOGSEQ_MIGRATIONS_DIR) : path.join(ROOT, 'server/db/migrations'))

function openSqlite(file: string) {
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return sqlite
}

export function openContentDb(dbDir: string) {
  const db = drizzle(openSqlite(path.join(dbDir, 'content.db')), { schema: contentSchema })
  migrate(db, { migrationsFolder: path.join(migrationsDir(), 'content') })
  return db
}

export function openEventsDb(dbDir: string) {
  const db = drizzle(openSqlite(path.join(dbDir, 'events.db')), { schema: eventsSchema })
  migrate(db, { migrationsFolder: path.join(migrationsDir(), 'events') })
  return db
}

export type ContentDb = ReturnType<typeof openContentDb>
export type EventsDb = ReturnType<typeof openEventsDb>

/** Tag of the newest migration of a database ("content" | "events"): the schema version this build writes. */
export function schemaTag(kind: 'content' | 'events'): string {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir(), kind, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  return journal.entries.at(-1)?.tag ?? ''
}
