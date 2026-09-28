import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as contentSchema from './content-schema.ts'
import * as eventsSchema from './events-schema.ts'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// App data layout: db/ (sqlite files), journals/ (markdown mirror, one file per day), assets/ (pasted media).
export const DATA_DIR = process.env.LOGSEQ_DATA_DIR ? path.resolve(process.env.LOGSEQ_DATA_DIR) : path.join(ROOT, 'data')
export const DB_DIR = path.join(DATA_DIR, 'db')
export const JOURNALS_DIR = path.join(DATA_DIR, 'journals')
export const ASSETS_DIR = path.join(DATA_DIR, 'assets')

for (const dir of [DB_DIR, JOURNALS_DIR, ASSETS_DIR]) mkdirSync(dir, { recursive: true })

function open(file: string) {
  const sqlite = new Database(path.join(DB_DIR, file))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return sqlite
}

export const db = drizzle(open('content.db'), { schema: contentSchema })
migrate(db, { migrationsFolder: path.join(ROOT, 'server/db/migrations/content') })

export const eventsDb = drizzle(open('events.db'), { schema: eventsSchema })
migrate(eventsDb, { migrationsFolder: path.join(ROOT, 'server/db/migrations/events') })
