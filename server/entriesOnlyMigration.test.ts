import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './db/open.ts'

// 0018_entries_only on a library from before it: a journal entry, a Reddit post and a Marketplace listing captured
// (with notes, comments and their images), and two rows of the image board on a day.

const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-entries-only-'))
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

describe('migration 0018_entries_only', () => {
  it('makes bookmarks and board days plain entries with nodes, their types tags, and drops the types', () => {
    const sqlite = new Database(path.join(tmp, 'content.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0018_entries_only') })

    const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args)
    const D = '2026-10-03'
    const entry = (id: string, type: string, subtype: string | null, position: number, createdAt: number, title = 'T') =>
      run(`INSERT INTO entries (id, type, subtype, date, title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, type, subtype, D, title, position, createdAt, createdAt)
    entry('j1', 'journal', null, 1, 1)
    entry('j2', 'journal', null, 2, 2)
    run(`INSERT INTO nodes (id, entry_id, content, position, created_at, updated_at) VALUES ('jn', 'j1', 'hello', 1, 1, 1)`)
    run(`INSERT INTO tags (id, path, created_at) VALUES (1, 'build/well', 1), (2, 'bookmark/old', 1)`)
    run(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES ('j1', 1, 0)`)

    entry('cap:r1', 'bookmark', 'reddit', 9000, 9000, 'Post')
    run(
      `INSERT INTO captures (id, entry_id, handler, key, url, title, site, icon, screenshot, screenshot_width, screenshot_height, thumb, fields, published_at, captured_at, captured_date, notes, comments, updated_at)
       VALUES ('r1', 'cap:r1', 'reddit', 'k1', 'https://www.reddit.com/r/ClaudeAI/comments/k1/', 'Post', 'r/ClaudeAI', 'icon-a.png', 'r1.jpg', 700, 2000, 'r1-t.jpg', '{"score":3}', 5, 9000, ?, 'my notes', 'a comment', 9100)`,
      D,
    )
    run(`INSERT INTO capture_images (id, capture_id, section, file, mime, position, created_at) VALUES ('rn', 'r1', 'notes', 'rn.png', 'image/png', 1, 9001), ('rc', 'r1', 'comments', 'rc.png', 'image/png', 1, 9002)`)
    entry('cap:m1', 'bookmark', 'marketplace', 7000, 7000, 'Desk')
    run(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES ('cap:m1', 2, 0)`)
    run(
      `INSERT INTO captures (id, entry_id, handler, key, url, title, site, screenshot, captured_at, captured_date, updated_at)
       VALUES ('m1', 'cap:m1', 'marketplace', '42', 'https://www.facebook.com/marketplace/item/42/', 'Desk', 'Berlin', 'm1.png', 7000, ?, 7000)`,
      D,
    )
    for (const [id, row, position, createdAt] of [
      ['b1', 1, 2, 8000],
      ['b2', 1, 1, 8001],
      ['b3', 2, 1, 8002],
    ] as const) {
      entry(`media:${id}`, 'media', 'image', createdAt, createdAt, '')
      run(
        `INSERT INTO board_items (id, entry_id, date, row, position, file, thumb, mime, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'image/png', 10, 20, ?)`,
        id,
        `media:${id}`,
        D,
        row,
        position,
        `${id}.png`,
        createdAt,
      )
    }

    migrate(db, { migrationsFolder: MIGRATIONS })

    const all = (sql: string) => sqlite.prepare(sql).all()
    const cols = (sql: string) => all(sql).map((r) => Object.values(r as object))
    // Journal entries keep their order; the others follow, oldest first.
    expect(cols('SELECT id, position FROM entries ORDER BY position')).toEqual([
      ['j1', 1],
      ['j2', 2],
      ['cap:m1', 3],
      ['board:2026-10-03', 4],
      ['cap:r1', 5],
    ])
    expect(all(`SELECT url, link_key AS linkKey, icon, fields, published_at AS publishedAt FROM entries WHERE id = 'cap:r1'`)).toEqual([
      { url: 'https://www.reddit.com/r/ClaudeAI/comments/k1/', linkKey: 'reddit:k1', icon: 'icon-a.png', fields: '{"score":3}', publishedAt: 5 },
    ])
    expect(cols(`SELECT id, entry_id, content, active_image_id FROM nodes ORDER BY entry_id, position`)).toEqual([
      ['board:2026-10-03:1', 'board:2026-10-03', '', 'b2'],
      ['board:2026-10-03:2', 'board:2026-10-03', '', 'b3'],
      ['m1', 'cap:m1', '', 'shot-m1'],
      ['r1', 'cap:r1', 'my notes', 'shot-r1'],
      ['r1-comments', 'cap:r1', 'a comment', 'rc'],
      ['jn', 'j1', 'hello', null],
    ])
    expect(cols(`SELECT id, node_id, mime, width, height, thumb FROM images ORDER BY node_id, position`)).toEqual([
      ['b2', 'board:2026-10-03:1', 'image/png', 10, 20, null],
      ['b1', 'board:2026-10-03:1', 'image/png', 10, 20, null],
      ['b3', 'board:2026-10-03:2', 'image/png', 10, 20, null],
      ['shot-m1', 'm1', 'image/png', null, null, null],
      ['shot-r1', 'r1', 'image/jpeg', 700, 2000, 'r1-t.jpg'],
      ['rn', 'r1', 'image/png', null, null, null],
      ['rc', 'r1-comments', 'image/png', null, null, null],
    ])
    expect(cols(`SELECT entry_id, path, position FROM entry_tags JOIN tags ON tags.id = tag_id ORDER BY entry_id, position`)).toEqual([
      ['cap:m1', 'bookmark/old', 0],
      ['cap:m1', 'marketplace', 1],
      ['cap:r1', 'reddit/claudeai', 0],
      ['j1', 'build/well', 0],
    ])
    const tables = cols(`SELECT name FROM sqlite_master WHERE type = 'table'`).flat()
    for (const gone of ['captures', 'capture_images', 'board_items']) expect(tables).not.toContain(gone)
    const entryCols = all(`PRAGMA table_info(entries)`).map((c) => (c as { name: string }).name)
    expect(entryCols).not.toContain('type')
    expect(entryCols).not.toContain('subtype')
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    sqlite.close()
  })
})

describe('migration 0019_fab_category', () => {
  it('renames fabrication to fab, and its entries follow', () => {
    const sqlite = new Database(path.join(tmp, 'fab.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0019_fab_category') })
    sqlite.prepare(`INSERT INTO entries (id, date, title, position, category, created_at, updated_at) VALUES ('e', '2026-10-03', 'T', 1, 'fabrication', 1, 1)`).run()
    migrate(db, { migrationsFolder: MIGRATIONS })
    expect(sqlite.prepare(`SELECT name FROM categories ORDER BY position`).all()).toEqual([{ name: 'design' }, { name: 'build' }, { name: 'fab' }, { name: 'dev' }, { name: 'notes' }])
    expect(sqlite.prepare(`SELECT category FROM entries`).get()).toEqual({ category: 'fab' })
    sqlite.close()
  })
})
