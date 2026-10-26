import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './db/open.ts'

// 0015_tag_slash on a library from before it: ':' paths in the three tag sets, one whose '/' form exists too.

const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-tag-migration-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const MIGRATIONS = path.join(ROOT, 'server/db/migrations/content')

/** The content migrations up to (without) `tag`. */
function migrationsBefore(tag: string): string {
  const dir = path.join(tmp, 'before')
  cpSync(MIGRATIONS, dir, { recursive: true })
  const file = path.join(dir, 'meta/_journal.json')
  const journal = JSON.parse(readFileSync(file, 'utf8')) as { entries: { tag: string }[] }
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag))
  writeFileSync(file, JSON.stringify(journal))
  return dir
}

describe('migration 0015_tag_slash', () => {
  it("separates tag paths with '/', merging a ':' path into its '/' form", () => {
    const sqlite = new Database(path.join(tmp, 'content.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0015_tag_slash') })

    const entry = sqlite.prepare(`INSERT INTO entries (id, title, date, position, created_at, updated_at) VALUES (?, 'T', '2026-09-20', 1, 1, 1)`)
    entry.run('a')
    entry.run('b')
    const tag = sqlite.prepare(`INSERT INTO tags (id, path, created_at) VALUES (?, ?, 1)`)
    tag.run(1, 'dev:frontend:react')
    tag.run(2, 'project:solar')
    tag.run(3, 'project/solar') // Logseq-imported
    tag.run(4, 'dev')
    const entryTag = sqlite.prepare(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES (?, ?, ?)`)
    entryTag.run('a', 1, 0)
    entryTag.run('a', 2, 1)
    entryTag.run('b', 2, 0)
    entryTag.run('b', 3, 1)
    entryTag.run('b', 4, 2)
    sqlite.prepare(`INSERT INTO yt_tags (id, path, created_at) VALUES (1, 'build:well', 1)`).run()
    sqlite.prepare(`INSERT INTO capture_tags (id, path, created_at) VALUES (1, 'homelab:nas', 1)`).run()

    migrate(db, { migrationsFolder: MIGRATIONS })

    expect(sqlite.prepare('SELECT id, path FROM tags ORDER BY id').all()).toEqual([
      { id: 1, path: 'dev/frontend/react' },
      { id: 3, path: 'project/solar' },
      { id: 4, path: 'dev' },
    ])
    expect(sqlite.prepare('SELECT entry_id AS id, path FROM entry_tags JOIN tags ON tags.id = tag_id ORDER BY entry_id, position').all()).toEqual([
      { id: 'a', path: 'dev/frontend/react' },
      { id: 'a', path: 'project/solar' },
      { id: 'b', path: 'project/solar' },
      { id: 'b', path: 'dev' },
    ])
    expect(sqlite.prepare('SELECT path FROM yt_tags').all()).toEqual([{ path: 'build/well' }])
    expect(sqlite.prepare('SELECT path FROM capture_tags').all()).toEqual([{ path: 'homelab/nas' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})
