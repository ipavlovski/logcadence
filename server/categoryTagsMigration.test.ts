import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './db/open.ts'

// 0020_category_tags on a library from before it: entries that kept their category's tag (0016_unified_entries),
// a fab entry with the old fabrication tag (0019_fab_category), a tag under the category, and one left alone.

const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-category-tags-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const MIGRATIONS = path.join(ROOT, 'server/db/migrations/content')

function migrationsBefore(tag: string): string {
  const dir = path.join(tmp, 'before')
  cpSync(MIGRATIONS, dir, { recursive: true })
  const file = path.join(dir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag))
  writeFileSync(file, JSON.stringify(journal))
  return dir
}

describe('migration 0020_category_tags', () => {
  it("drops each entry's category from its tags", () => {
    const sqlite = new Database(path.join(tmp, 'content.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0020_category_tags') })

    const run = (sql: string) => sqlite.prepare(sql).run()
    const entry = (id: string, category: string | null) =>
      sqlite.prepare(`INSERT INTO entries (id, date, title, position, category, created_at, updated_at) VALUES (?, '2026-10-01', '', 1, ?, 1, 1)`).run(id, category)
    entry('notes1', 'notes')
    entry('dev1', 'dev')
    entry('fab1', 'fab')
    entry('plain', null)
    run(`INSERT INTO tags (id, path, created_at) VALUES (1, 'notes', 1), (2, 'dev', 1), (3, 'dev/react', 1), (4, 'react', 1),
      (5, 'fabrication', 1), (6, 'fabrication/cnc', 1), (7, 'shop', 1), (8, 'design/x', 1)`)
    run(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES ('notes1', 1, 0), ('notes1', 7, 1),
      ('dev1', 2, 0), ('dev1', 3, 1), ('dev1', 8, 2), ('fab1', 5, 0), ('fab1', 6, 1), ('plain', 2, 0), ('plain', 3, 1)`)
    // An entry that has the shortened tag already.
    entry('dev2', 'dev')
    run(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES ('dev2', 4, 0), ('dev2', 3, 1)`)

    migrate(db, { migrationsFolder: MIGRATIONS })

    const tagsOf = (id: string) =>
      sqlite
        .prepare(`SELECT t.path FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY et.position`)
        .all(id)
        .map((r) => (r as { path: string }).path)
    expect(tagsOf('notes1')).toEqual(['shop'])
    expect(tagsOf('dev1')).toEqual(['react', 'design/x'])
    expect(tagsOf('dev2')).toEqual(['react'])
    expect(tagsOf('fab1')).toEqual(['cnc'])
    // Not filed under dev: its tags stay.
    expect(tagsOf('plain')).toEqual(['dev', 'dev/react'])
    const paths = sqlite.prepare(`SELECT path FROM tags ORDER BY path`).all().map((r) => (r as { path: string }).path)
    expect(paths).toEqual(['cnc', 'design/x', 'dev', 'dev/react', 'react', 'shop'])
    sqlite.close()
  })
})
