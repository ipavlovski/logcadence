import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { openContentDb, openEventsDb, ROOT } from './open.ts'

export { ROOT }
// App data layout: db/ (sqlite files), journals/ (markdown mirror, one file per day), assets/ (pasted media).
export const DATA_DIR = process.env.LOGCADENCE_DATA_DIR ? path.resolve(process.env.LOGCADENCE_DATA_DIR) : path.join(ROOT, 'data')
export const DB_DIR = path.join(DATA_DIR, 'db')
export const JOURNALS_DIR = path.join(DATA_DIR, 'journals')
export const ASSETS_DIR = path.join(DATA_DIR, 'assets')

for (const dir of [DB_DIR, JOURNALS_DIR, ASSETS_DIR]) mkdirSync(dir, { recursive: true })

export const db = openContentDb(DB_DIR)
export const eventsDb = openEventsDb(DB_DIR)

/** Closes both databases (before quitting, or before an update replaces the app). */
export function closeDbs() {
  db.$client.close()
  eventsDb.$client.close()
}
