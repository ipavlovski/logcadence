import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openContentDb, openEventsDb } from '../../db/open.ts'
import { withZip, type ZipMember } from '../zip.ts'
import { CHAT_SUBTYPE, captureEntryId, mediaEntryId, mediaSubtype, videoEntryId } from '../../../shared/entryTypes.ts'
import { CHAT_SOURCES, type ChatSource } from '../../../shared/types.ts'
import { CONTENT_TABLES, EVENTS_TABLES, FORMAT, FORMAT_VERSION, LEGACY_FORMATS, V3_CONTENT_TABLES, type FileSet, type Manifest, type Progress } from './format.ts'

export interface ImportOptions {
  /** The library folder to import into; it must be empty (no entries, events or assets). */
  dataDir: string
  onProgress?: Progress
}

export interface ImportResult {
  manifest: Manifest
  /** Things skipped: tables a newer build exported, or an older one's that moved to logtracker (GPS, activity, checklists). */
  warnings: string[]
}

/**
 * Imports an export zip into an empty library. The databases and assets are built in <dataDir>/.importing and
 * only moved into place once complete, so a failed import leaves the library as it was. The app must not
 * have the library open meanwhile.
 */
export function importFrom(zipFile: string, { dataDir, onProgress }: ImportOptions): ImportResult {
  const problem = libraryNotEmpty(dataDir)
  if (problem) throw new Error(`can only import into an empty library: ${problem}`)

  return withZip(zipFile, (members) => {
    const byName = new Map(members.map((m) => [m.name, m]))
    const manifest = readManifest(byName.get('manifest.json'))
    const warnings: string[] = []

    const staging = path.join(dataDir, '.importing')
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(path.join(staging, 'db'), { recursive: true })
    mkdirSync(path.join(staging, 'assets'))
    try {
      const all = { ...CONTENT_TABLES, ...EVENTS_TABLES }
      const known = new Set([...Object.keys(all), ...(manifest.formatVersion < 4 ? V3_CONTENT_TABLES : [])])
      for (const name of Object.keys(manifest.tables)) if (!known.has(name)) warnings.push(`skipped unknown table "${name}"`)
      const total = Object.keys(all).length
      let done = 0
      const progress = () => onProgress?.({ phase: 'tables', done: ++done, total })

      const tables = upgradeTables(manifest.formatVersion, (name) => readTable(byName, manifest, name))
      const content = openContentDb(path.join(staging, 'db'))
      try {
        content.transaction((tx) => {
          // A fresh library has the default categories (0016_unified_entries); the export's replace them.
          tx.delete(CONTENT_TABLES.categories).run()
          for (const [name, table] of Object.entries(CONTENT_TABLES)) insertRows(tx, table, tables[name] ?? []), progress()
        })
      } finally {
        content.$client.close()
      }
      const events = openEventsDb(path.join(staging, 'db'))
      try {
        events.transaction((tx) => {
          for (const [name, table] of Object.entries(EVENTS_TABLES)) insertRows(tx, table, readTable(byName, manifest, name)), progress()
        })
      } finally {
        events.$client.close()
      }

      extractDir(members, 'assets', path.join(staging, 'assets'), manifest.assets, onProgress)

      // Move into place. Whatever an empty library already has (fresh database files) is replaced.
      const dbDir = path.join(dataDir, 'db')
      mkdirSync(dbDir, { recursive: true })
      for (const f of readdirSync(dbDir)) if (/\.db(-wal|-shm)?$/.test(f)) rmSync(path.join(dbDir, f))
      for (const f of readdirSync(path.join(staging, 'db'))) renameSync(path.join(staging, 'db', f), path.join(dbDir, f))
      rmSync(path.join(dataDir, 'assets'), { recursive: true, force: true })
      renameSync(path.join(staging, 'assets'), path.join(dataDir, 'assets'))
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }

    if (manifest.gps?.files) warnings.push(`skipped ${manifest.gps.files} GPS file(s): GPS moved to logtracker`)

    return { manifest, warnings }
  })
}

/** Why `dataDir` can't take an import, or null when it is empty. */
export function libraryNotEmpty(dataDir: string): string | null {
  const assets = path.join(dataDir, 'assets')
  if (existsSync(assets) && readdirSync(assets).length) return 'it has assets'
  for (const [file, table] of [
    ['content.db', 'entries'],
    ['events.db', 'events'],
  ] as const) {
    const f = path.join(dataDir, 'db', file)
    if (!existsSync(f)) continue
    const sqlite = new Database(f, { readonly: true, fileMustExist: true })
    try {
      const exists = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
      if (exists && (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n) return `it has ${table}`
    } finally {
      sqlite.close()
    }
  }
  return null
}

function readManifest(member: ZipMember | undefined): Manifest {
  if (!member) throw new Error('not a data export (no manifest.json)')
  const m = JSON.parse(member.read().toString('utf8')) as Manifest
  if (m.format !== FORMAT && !LEGACY_FORMATS.includes(m.format)) throw new Error('not a data export (unknown format)')
  if (!(m.formatVersion >= 1)) throw new Error('invalid export: bad formatVersion')
  if (m.formatVersion > FORMAT_VERSION) throw new Error(`this export was made by a newer version (${m.appVersion}): update the app first`)
  return m
}

function readTable(byName: Map<string, ZipMember>, manifest: Manifest, name: string): Record<string, unknown>[] {
  const expected = manifest.tables[name]
  const member = byName.get(`tables/${name}.ndjson`)
  if (!expected || !member) return [] // a table this export predates
  const buf = member.read()
  if (createHash('sha256').update(buf).digest('hex') !== expected.sha256) throw new Error(`export is corrupt: ${name} checksum mismatch`)
  const rows = buf
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  if (rows.length !== expected.rows) throw new Error(`export is corrupt: ${name} has ${rows.length} rows, expected ${expected.rows}`)
  return rows
}

type Row = Record<string, unknown>

/** Every content table's rows, brought from the export's format up to FORMAT_VERSION. */
function upgradeTables(fromVersion: number, read: (name: string) => Row[]): Record<string, Row[]> {
  if (fromVersion >= 4) return Object.fromEntries(Object.keys(CONTENT_TABLES).map((name) => [name, read(name)]))
  // Formats 1–3 upgrade table by table, in their insert order (a step can depend on an earlier table's).
  const upgrade = upgrader(fromVersion)
  return toV4(Object.fromEntries(V3_CONTENT_TABLES.map((name) => [name, upgrade(name, read(name))])))
}

/** Brings a table's rows from format `fromVersion` (1–3) up to 3. */
function upgrader(fromVersion: number): (table: string, rows: Row[]) => Row[] {
  const steps = [toV2(), toV3()].slice(fromVersion - 1)
  return (table, rows) => steps.reduce((r, step) => step(table, r), rows)
}

// v1 → 2: Reddit merged into Bookmarks (migration 0014_capture_handlers). Merged capture tags' old ids → the kept one's.
function toV2(): (table: string, rows: Row[]) => Row[] {
  const tagIds = new Map<unknown, unknown>()
  return (table, rows) => {
    if (table === 'captures')
      return rows.map(({ kind, author, score, commentCount, postedAt, ...r }) => ({
        ...r,
        handler: kind === 'bookmark' ? 'page' : kind,
        fields: kind === 'reddit' ? Object.fromEntries(Object.entries({ author, score, commentCount }).filter(([, v]) => v != null)) : {},
        publishedAt: postedAt ?? null,
      }))
    if (table === 'capture_tags') {
      const byPath = new Map<unknown, Row>()
      // Bookmark tags first: theirs is the id a same-path Reddit tag merges into.
      for (const { kind, ...r } of [...rows].sort((a, b) => Number(a.kind !== 'bookmark') - Number(b.kind !== 'bookmark'))) {
        const kept = byPath.get(r.path)
        if (kept) tagIds.set(r.id, kept.id)
        else byPath.set(r.path, r)
      }
      return [...byPath.values()]
    }
    if (table === 'capture_item_tags') return rows.map((r) => (tagIds.has(r.tagId) ? { ...r, tagId: tagIds.get(r.tagId) } : r))
    return rows
  }
}

const TAG_TABLES: Record<string, string> = { tags: 'entry_tags', yt_tags: 'yt_video_tags', capture_tags: 'capture_item_tags' }

// v2 → 3: tag paths separated by '/' (migration 0015_tag_slash). A path whose '/' form is there too merges into it.
function toV3(): (table: string, rows: Row[]) => Row[] {
  const tagIds = new Map<string, Map<unknown, unknown>>()
  return (table, rows) => {
    if (table in TAG_TABLES) {
      const ids = new Map<unknown, unknown>()
      tagIds.set(TAG_TABLES[table]!, ids)
      const byPath = new Map<unknown, Row>()
      // Paths already in '/' form first: theirs is the id a ':' one merges into.
      for (const r of [...rows].sort((a, b) => Number(String(a.path).includes(':')) - Number(String(b.path).includes(':')))) {
        const path = String(r.path).replaceAll(':', '/')
        const kept = byPath.get(path)
        if (kept) ids.set(r.id, kept.id)
        else byPath.set(path, { ...r, path })
      }
      return [...byPath.values()]
    }
    const ids = tagIds.get(table)
    if (!ids?.size) return rows
    const seen = new Set<string>()
    return rows
      .map((r) => (ids.has(r.tagId) ? { ...r, tagId: ids.get(r.tagId) } : r))
      .filter((r) => {
        const key = JSON.stringify([r.entryId ?? r.videoId ?? r.captureId, r.tagId])
        return !seen.has(key) && !!seen.add(key)
      })
  }
}

// v3 → 4: every item an entry, one tag set, categories (as migration 0016_unified_entries, which see).
const V4_CATEGORIES = ['design', 'build', 'fabrication', 'dev', 'notes']
const CHAT_SOURCE_TAGS = new Set(CHAT_SOURCES.map((s) => `ai/${s}`))

export function toV4(t: Record<string, Row[]>): Record<string, Row[]> {
  const get = (name: string) => t[name] ?? []
  const root = (path: string) => path.split('/')[0]!
  const categoryOf = (path: string | undefined) => (path !== undefined && V4_CATEGORIES.includes(root(path)) ? root(path) : null)
  /** The path of each item's first (lowest position) tag. */
  const firstPaths = (links: Row[], key: string, pathOf: Map<unknown, string>) => {
    const first = new Map<unknown, { position: number; path: string }>()
    for (const l of links) {
      const path = pathOf.get(l.tagId)
      const cur = first.get(l[key])
      if (path !== undefined && (!cur || Number(l.position) < cur.position)) first.set(l[key], { position: Number(l.position), path })
    }
    return new Map([...first].map(([k, v]) => [k, v.path]))
  }

  const tags = get('tags').map((r) => ({ ...r }))
  const pathOf = new Map(tags.map((r) => [r.id, String(r.path)]))
  const byPath = new Map(tags.map((r) => [String(r.path), r]))
  let nextId = Math.max(0, ...tags.map((r) => Number(r.id))) + 1
  const tagId = (path: string, createdAt: unknown) => {
    let r = byPath.get(path)
    if (!r) {
      r = { id: nextId++, path, createdAt }
      tags.push(r)
      byPath.set(path, r)
    }
    return r.id
  }

  const chatSource = new Map(get('chats').filter((c) => c.entryId).map((c) => [c.entryId, c.source as ChatSource]))
  const entryTags = get('entry_tags').filter((l) => !(chatSource.has(l.entryId) && CHAT_SOURCE_TAGS.has(pathOf.get(l.tagId) ?? '')))
  const first = firstPaths(entryTags, 'entryId', pathOf)
  const entries: Row[] = get('entries').map((e) => {
    const source = chatSource.get(e.id)
    return { ...e, type: source ? 'ai' : 'journal', subtype: source ? CHAT_SUBTYPE[source] : null, category: categoryOf(first.get(e.id)) }
  })

  /** Items of a type with tags of their own: each gets an entry, its tags go under `prefix`. */
  const items = (rows: Row[], tagRows: Row[], links: Row[], key: string, entryIdOf: (id: string) => string, prefix: string, entry: (r: Row) => Row) => {
    const ownPath = new Map(tagRows.map((r) => [r.id, String(r.path)]))
    const created = new Map(tagRows.map((r) => [r.id, r.createdAt]))
    const firstOwn = firstPaths(links, key, ownPath)
    const have = new Set(entries.map((e) => e.id))
    for (const r of rows) if (!have.has(entryIdOf(String(r.id)))) entries.push({ id: entryIdOf(String(r.id)), archived: false, category: categoryOf(firstOwn.get(r.id)), ...entry(r) })
    for (const l of links) {
      const path = ownPath.get(l.tagId)
      if (path !== undefined) entryTags.push({ entryId: entryIdOf(String(l[key])), tagId: tagId(`${prefix}/${path}`, created.get(l.tagId)), position: l.position })
    }
    return rows.map((r) => ({ ...r, entryId: entryIdOf(String(r.id)) }))
  }
  const ytVideos = items(get('yt_videos'), get('yt_tags'), get('yt_video_tags'), 'videoId', videoEntryId, 'youtube', (v) => ({
    type: 'video',
    subtype: 'youtube',
    date: v.addedDate,
    title: v.title,
    position: v.addedAt,
    createdAt: Number(v.importedAt) > 0 ? v.importedAt : v.addedAt,
    updatedAt: v.updatedAt,
  }))
  const captures = items(get('captures'), get('capture_tags'), get('capture_item_tags'), 'captureId', captureEntryId, 'bookmark', (c) => ({
    type: 'bookmark',
    subtype: c.handler,
    date: c.capturedDate,
    title: c.title,
    position: c.capturedAt,
    createdAt: c.capturedAt,
    updatedAt: c.updatedAt,
  }))
  const boardItems = items(get('board_items'), [], [], 'id', mediaEntryId, 'media', (b) => ({
    type: 'media',
    subtype: mediaSubtype(String(b.mime)),
    date: b.date,
    title: '',
    position: b.createdAt,
    createdAt: b.createdAt,
    updatedAt: b.createdAt,
  }))

  const used = new Set(entryTags.map((l) => l.tagId))
  return {
    ...t,
    categories: V4_CATEGORIES.map((name, i) => ({ name, position: i + 1, createdAt: 0 })),
    tags: tags.filter((r) => used.has(r.id)),
    entries,
    entry_tags: entryTags,
    yt_videos: ytVideos,
    captures,
    board_items: boardItems,
  }
}

// Keeps each statement well under SQLite's bound-parameter limit.
const BATCH = 100

function insertRows(tx: { insert(t: SQLiteTable): { values(rows: never[]): { run(): unknown } } }, table: SQLiteTable, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += BATCH)
    tx
      .insert(table)
      .values(rows.slice(i, i + BATCH) as never[])
      .run()
}

function extractDir(members: ZipMember[], prefix: 'assets', dir: string, expected: FileSet, onProgress?: Progress) {
  const list = members.filter((m) => m.name.startsWith(`${prefix}/`))
  const got = { files: 0, bytes: 0 }
  for (const [i, m] of list.entries()) {
    const name = m.name.slice(prefix.length + 1)
    if (!name || name !== path.basename(name) || name === '..') throw new Error(`export is corrupt: bad file name ${m.name}`)
    const file = path.join(dir, name)
    m.extractTo(file)
    if (statSync(file).size !== m.size) throw new Error(`export is corrupt: ${m.name} is truncated`)
    got.files++
    got.bytes += m.size
    if (i % 25 === 0 || i === list.length - 1) onProgress?.({ phase: prefix, done: i + 1, total: list.length })
  }
  if (got.files !== expected.files || got.bytes !== expected.bytes)
    throw new Error(`export is incomplete: ${prefix} has ${got.files} files / ${got.bytes} bytes, expected ${expected.files} / ${expected.bytes}`)
}
