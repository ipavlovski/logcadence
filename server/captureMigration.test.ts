import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './db/open.ts'

// 0014_capture_handlers on a library from before it: Reddit posts and bookmarks with tags, images and overlapping tag paths.

const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-capture-migration-'))
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

describe('migration 0014_capture_handlers', () => {
  it('turns kinds into handlers, Reddit columns into fields, and merges the tag sets, keeping tags and images', () => {
    const sqlite = new Database(path.join(tmp, 'content.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0014_capture_handlers') })

    const cap = sqlite.prepare(
      `INSERT INTO captures (id, kind, key, url, title, site, screenshot, author, score, comment_count, posted_at, captured_at, captured_date, updated_at)
       VALUES (?, ?, ?, ?, 'T', ?, 's.jpg', ?, ?, ?, ?, 1, '2026-09-20', 1)`,
    )
    cap.run('post', 'reddit', 'abc', 'https://www.reddit.com/r/x/comments/abc/', 'r/x', 'alice', 12, null, 7)
    cap.run('mark', 'bookmark', 'https://example.com/', 'https://example.com/', 'example.com', null, null, null, null)
    const tag = sqlite.prepare(`INSERT INTO capture_tags (id, kind, path, created_at) VALUES (?, ?, ?, 1)`)
    tag.run(1, 'reddit', 'homelab')
    tag.run(2, 'bookmark', 'homelab')
    tag.run(3, 'reddit', 'nas')
    const itemTag = sqlite.prepare(`INSERT INTO capture_item_tags (capture_id, tag_id, position) VALUES (?, ?, ?)`)
    itemTag.run('post', 1, 0)
    itemTag.run('post', 3, 1)
    itemTag.run('mark', 2, 0)
    sqlite.prepare(`INSERT INTO capture_images (id, capture_id, section, file, mime, position, created_at) VALUES ('img', 'post', 'comments', 'c.jpg', 'image/jpeg', 1, 1)`).run()

    migrate(db, { migrationsFolder: MIGRATIONS })

    expect(sqlite.prepare('SELECT id, handler, key, site, fields, published_at AS publishedAt FROM captures ORDER BY id').all()).toEqual([
      { id: 'mark', handler: 'page', key: 'https://example.com/', site: 'example.com', fields: '{}', publishedAt: null },
      { id: 'post', handler: 'reddit', key: 'abc', site: 'r/x', fields: JSON.stringify({ author: 'alice', score: 12 }), publishedAt: 7 },
    ])
    expect(sqlite.prepare('SELECT capture_id AS id, path FROM capture_item_tags JOIN capture_tags ON capture_tags.id = tag_id ORDER BY capture_id, position').all()).toEqual([
      { id: 'mark', path: 'homelab' },
      { id: 'post', path: 'homelab' },
      { id: 'post', path: 'nas' },
    ])
    expect(sqlite.prepare('SELECT id, path FROM capture_tags ORDER BY id').all()).toEqual([
      { id: 2, path: 'homelab' },
      { id: 3, path: 'nas' },
    ])
    expect(sqlite.prepare('SELECT id FROM capture_images').all()).toEqual([{ id: 'img' }])
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})
