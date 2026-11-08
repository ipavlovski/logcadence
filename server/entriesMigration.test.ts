import Database from 'better-sqlite3'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { ROOT } from './db/open.ts'

// 0016_unified_entries on a library from before it: journal entries, an AI chat, a video, a capture and board
// items, each with the tags of their own set.

const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-entries-migration-'))
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

describe('migration 0016_unified_entries', () => {
  it('makes every item an entry with a type, a category and the one tag set', () => {
    const sqlite = new Database(path.join(tmp, 'content.db'))
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite)
    migrate(db, { migrationsFolder: migrationsBefore('0016_unified_entries') })

    const run = (sql: string, ...args: unknown[]) => sqlite.prepare(sql).run(...args)
    const entry = (id: string, date = '2026-10-01') => run(`INSERT INTO entries (id, title, date, position, created_at, updated_at) VALUES (?, 'T', ?, 1, 1, 1)`, id, date)
    const tag = (id: number, p: string) => run(`INSERT INTO tags (id, path, created_at) VALUES (?, ?, 1)`, id, p)
    const link = (e: string, t: number, pos: number) => run(`INSERT INTO entry_tags (entry_id, tag_id, position) VALUES (?, ?, ?)`, e, t, pos)
    entry('j1') // build/well first: category build
    entry('j2') // a non-category first tag: none, even with dev second
    entry('j3') // untagged
    entry('chat-e')
    tag(1, 'build/well')
    tag(2, 'project/solar')
    tag(3, 'dev')
    tag(4, 'ai/claude-code')
    tag(5, 'ai/claude') // tagged by hand on a journal entry: stays
    link('j1', 1, 0)
    link('j2', 2, 0)
    link('j2', 3, 1)
    link('chat-e', 4, 0)
    link('chat-e', 3, 1) // the chat's own first tag after the source tag: category dev
    link('j3', 5, 0)
    run(
      `INSERT INTO chats (id, source, external_id, entry_id, title, started_at, updated_at, turns, messages, meta, node_ids, imported_at) VALUES ('claude-code:x', 'claude-code', 'x', 'chat-e', 'C', 1, 1, 1, '[]', '{}', '[]', 1)`,
    )
    run(`INSERT INTO chats (id, source, external_id, entry_id, title, started_at, updated_at, turns, messages, meta, node_ids, imported_at) VALUES ('gemini:y', 'gemini', 'y', NULL, 'G', 1, 1, 1, '[]', '{}', '[]', 1)`)

    run(`INSERT INTO yt_videos (id, title, added_at, added_date, imported_at, updated_at) VALUES ('v1', 'Drilling a well', 5000, '2026-10-02', 0, 6000)`)
    run(`INSERT INTO yt_tags (id, path, created_at) VALUES (1, 'build/well', 1), (2, 'misc', 1)`)
    run(`INSERT INTO yt_video_tags (video_id, tag_id, position) VALUES ('v1', 1, 0), ('v1', 2, 1)`)
    run(`INSERT INTO yt_images (id, video_id, section, file, mime, position, created_at) VALUES ('yi', 'v1', 'notes', 'f.png', 'image/png', 1, 1)`)

    run(
      `INSERT INTO captures (id, handler, key, url, title, screenshot, captured_at, captured_date, updated_at) VALUES ('c1', 'reddit', 'k', 'https://reddit.com/r/x/comments/k', 'Post', 's.jpg', 7000, '2026-10-03', 7000)`,
    )
    run(`INSERT INTO capture_tags (id, path, created_at) VALUES (1, 'homelab/nas', 1)`)
    run(`INSERT INTO capture_item_tags (capture_id, tag_id, position) VALUES ('c1', 1, 0)`)

    const board = (id: string, mime: string, thumb: string | null) =>
      run(`INSERT INTO board_items (id, date, row, position, file, thumb, mime, width, height, created_at) VALUES (?, '2026-10-04', 1, 1, 'f', ?, ?, 10, 10, 8000)`, id, thumb, mime)
    board('b-mp4', 'video/mp4', 'poster.jpg')
    board('b-gif', 'video/mp4', null) // a gif, stored as mp4
    board('b-png', 'image/png', null)

    migrate(db, { migrationsFolder: MIGRATIONS })

    expect(sqlite.prepare('SELECT id, type, subtype, category, date, title, position FROM entries ORDER BY id').all()).toEqual([
      { id: 'cap:c1', type: 'bookmark', subtype: 'reddit', category: null, date: '2026-10-03', title: 'Post', position: 7000 },
      { id: 'chat-e', type: 'ai', subtype: 'claude-code', category: 'dev', date: '2026-10-01', title: 'T', position: 1 },
      { id: 'j1', type: 'journal', subtype: null, category: 'build', date: '2026-10-01', title: 'T', position: 1 },
      { id: 'j2', type: 'journal', subtype: null, category: null, date: '2026-10-01', title: 'T', position: 1 },
      { id: 'j3', type: 'journal', subtype: null, category: null, date: '2026-10-01', title: 'T', position: 1 },
      { id: 'media:b-gif', type: 'media', subtype: 'video', category: null, date: '2026-10-04', title: '', position: 8000 },
      { id: 'media:b-mp4', type: 'media', subtype: 'video', category: null, date: '2026-10-04', title: '', position: 8000 },
      { id: 'media:b-png', type: 'media', subtype: 'image', category: null, date: '2026-10-04', title: '', position: 8000 },
      // Category from the video's own primary tag, before it moved under youtube/.
      { id: 'yt:v1', type: 'video', subtype: 'youtube', category: 'build', date: '2026-10-02', title: 'Drilling a well', position: 5000 },
    ])
    expect(sqlite.prepare(`SELECT created_at AS c, updated_at AS u FROM entries WHERE id = 'yt:v1'`).get()).toEqual({ c: 5000, u: 6000 })
    expect(sqlite.prepare('SELECT entry_id AS id, path FROM entry_tags JOIN tags ON tags.id = tag_id ORDER BY entry_id, position').all()).toEqual([
      { id: 'cap:c1', path: 'bookmark/homelab/nas' },
      { id: 'chat-e', path: 'dev' },
      { id: 'j1', path: 'build/well' },
      { id: 'j2', path: 'project/solar' },
      { id: 'j2', path: 'dev' },
      { id: 'j3', path: 'ai/claude' },
      { id: 'yt:v1', path: 'youtube/build/well' },
      { id: 'yt:v1', path: 'youtube/misc' },
    ])
    // The chat source tag no entry carries any more is gone; the journal's build/well stays apart from the video's.
    expect(sqlite.prepare('SELECT path FROM tags ORDER BY path').all().map((r) => (r as { path: string }).path)).toEqual([
      'ai/claude',
      'bookmark/homelab/nas',
      'build/well',
      'dev',
      'project/solar',
      'youtube/build/well',
      'youtube/misc',
    ])
    expect(sqlite.prepare('SELECT name FROM categories ORDER BY position').all().map((r) => (r as { name: string }).name)).toEqual(['design', 'build', 'fabrication', 'dev', 'notes'])
    expect(sqlite.prepare(`SELECT entry_id FROM yt_videos`).get()).toEqual({ entry_id: 'yt:v1' })
    expect(sqlite.prepare(`SELECT entry_id FROM captures`).get()).toEqual({ entry_id: 'cap:c1' })
    const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => (r as { name: string }).name)
    for (const gone of ['yt_tags', 'yt_video_tags', 'capture_tags', 'capture_item_tags']) expect(tables).not.toContain(gone)
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    // The entry is the parent: deleting it deletes the video, its images with it.
    run(`DELETE FROM entries WHERE id = 'yt:v1'`)
    expect(sqlite.prepare('SELECT count(*) AS n FROM yt_videos').get()).toEqual({ n: 0 })
    expect(sqlite.prepare('SELECT count(*) AS n FROM yt_images').get()).toEqual({ n: 0 })
    // A deleted category leaves its entries uncategorized; a renamed one follows.
    run(`UPDATE categories SET name = 'make' WHERE name = 'build'`)
    expect(sqlite.prepare(`SELECT category FROM entries WHERE id = 'j1'`).get()).toEqual({ category: 'make' })
    run(`DELETE FROM categories WHERE name = 'dev'`)
    expect(sqlite.prepare(`SELECT category FROM entries WHERE id = 'chat-e'`).get()).toEqual({ category: null })
    sqlite.close()
  })
})
