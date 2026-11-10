import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openContentDb, openEventsDb } from '../../db/open.ts'
import { dropCategoryTagsIn } from '../categoryTags.ts'
import { withZip, type ZipMember } from '../zip.ts'
import { CONTENT_TABLES, EVENTS_TABLES, FORMAT, FORMAT_VERSION, LEGACY_FORMATS, V3_CONTENT_TABLES, V4_MOVED_TABLES, V5_ITEM_TABLES, type FileSet, type Manifest, type Progress } from './format.ts'

export interface ImportOptions {
  /** The library folder to import into; it must be empty (no entries, events or assets). */
  dataDir: string
  onProgress?: Progress
}

export interface ImportResult {
  manifest: Manifest
  /** Things skipped: tables a newer build exported, or an older one's that moved out (GPS, activity and checklists to
   * logtracker; videos to youtube-lib, AI chats to ai-lib). */
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
      const known = new Set([...Object.keys(all), ...(manifest.formatVersion < 4 ? V3_CONTENT_TABLES : []), ...(manifest.formatVersion < 5 ? V4_MOVED_TABLES : []), ...(manifest.formatVersion < 6 ? V5_ITEM_TABLES : [])])
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
          // An export from before 0020_category_tags: its entries' tags without their category, as the migration did.
          dropCategoryTagsIn(tx)
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
    const videos = manifest.tables.yt_videos?.rows ?? 0
    const chats = manifest.tables.chats?.rows ?? 0
    if (videos) warnings.push(`skipped ${videos} YouTube video(s): they moved to youtube-lib (import them there from a library)`)
    if (chats) warnings.push(`skipped ${chats} AI chat(s): they moved to ai-lib (import them there from a library)`)

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
  const readAll = (names: string[]) => Object.fromEntries(names.map((name) => [name, read(name)]))
  if (fromVersion >= 7) return readAll(Object.keys(CONTENT_TABLES))
  if (fromVersion === 6) return toV7(readAll(Object.keys(CONTENT_TABLES)))
  const v5Tables = [...Object.keys(CONTENT_TABLES), ...V5_ITEM_TABLES]
  if (fromVersion === 5) return toV7(toV6(readAll(v5Tables)))
  if (fromVersion === 4) return toV7(toV6(toV5(readAll(v5Tables))))
  // Formats 1–3 upgrade table by table, in their insert order (a step can depend on an earlier table's).
  const upgrade = upgrader(fromVersion)
  return toV7(toV6(toV5(toV4(Object.fromEntries(V3_CONTENT_TABLES.map((name) => [name, upgrade(name, read(name))]))))))
}

// v6 → 7: the fabrication category is called fab (as migration 0019_fab_category), unless there is a fab already.
export function toV7(t: Record<string, Row[]>): Record<string, Row[]> {
  const cats = t.categories ?? []
  if (!cats.some((c) => c.name === 'fabrication') || cats.some((c) => c.name === 'fab')) return t
  const fab = (v: unknown) => (v === 'fabrication' ? 'fab' : v)
  return { ...t, categories: cats.map((c) => ({ ...c, name: fab(c.name) })), entries: (t.entries ?? []).map((e) => ({ ...e, category: fab(e.category) })) }
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
// What format 4 had for AI chats and videos (they are gone in 5, see toV5).
const CHAT_SUBTYPE: Record<string, string> = { claude: 'claude-chat', 'claude-code': 'claude-code', gemini: 'gemini-chat', antigravity: 'gemini-code' }
const CHAT_SOURCE_TAGS = new Set(Object.keys(CHAT_SUBTYPE).map((s) => `ai/${s}`))
const videoEntryId = (videoId: string) => `yt:${videoId}`
// Format 4 and 5's ids of a capture's and a board item's entries.
const captureEntryId = (captureId: string) => `cap:${captureId}`
const mediaEntryId = (itemId: string) => `media:${itemId}`
const mediaSubtype = (mime: string) => (mime.startsWith('video/') ? 'video' : 'image')

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

  const chatSource = new Map(get('chats').filter((c) => c.entryId).map((c) => [c.entryId, String(c.source)]))
  const entryTags = get('entry_tags').filter((l) => !(chatSource.has(l.entryId) && CHAT_SOURCE_TAGS.has(pathOf.get(l.tagId) ?? '')))
  const first = firstPaths(entryTags, 'entryId', pathOf)
  const entries: Row[] = get('entries').map((e) => {
    const source = chatSource.get(e.id)
    return { ...e, type: source ? 'ai' : 'journal', subtype: source ? (CHAT_SUBTYPE[source] ?? null) : null, category: categoryOf(first.get(e.id)) }
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

// v4 → 5: videos and AI chats moved out to youtube-lib and ai-lib (as migration 0017_split_ai_youtube): their
// entries go, with an AI chat's nodes and their images, their tag links, and the tags nothing carries any more.
export function toV5(t: Record<string, Row[]>): Record<string, Row[]> {
  const get = (name: string) => t[name] ?? []
  const gone = new Set(get('entries').filter((e) => e.type === 'video' || e.type === 'ai').map((e) => e.id))
  const nodes = get('nodes').filter((n) => !gone.has(n.entryId))
  const kept = new Set(nodes.map((n) => n.id))
  const entryTags = get('entry_tags').filter((l) => !gone.has(l.entryId))
  const used = new Set(entryTags.map((l) => l.tagId))
  const out: Record<string, Row[]> = {
    ...t,
    entries: get('entries').filter((e) => !gone.has(e.id)),
    nodes,
    images: get('images').filter((i) => kept.has(i.nodeId)),
    entry_tags: entryTags,
    tags: get('tags').filter((r) => used.has(r.id)),
  }
  return Object.fromEntries([...Object.keys(CONTENT_TABLES), ...V5_ITEM_TABLES].map((name) => [name, out[name] ?? []]))
}

// v5 → 6: bookmarks and the image board became plain entries, and entry types went (as migration
// 0018_entries_only, which see): a capture's page goes on its entry, its screenshot and notes into a first node,
// its comments into a second; Reddit posts get reddit/<subreddit>, listings marketplace. Each board day becomes an
// entry with a node per row. Entries that were ordered by time go after their day's journal entries.
export function toV6(t: Record<string, Row[]>): Record<string, Row[]> {
  const get = (name: string) => t[name] ?? []
  const num = (v: unknown) => Number(v)
  const entries = get('entries').map((e) => ({ ...e }))
  const entryById = new Map(entries.map((e) => [e.id, e]))
  const nodes = get('nodes').map((n) => ({ ...n }))
  const images: Row[] = get('images').map((i) => ({ width: null, height: null, thumb: null, ...i }))
  const entryTags = get('entry_tags').map((l) => ({ ...l }))
  const tags = get('tags').map((r) => ({ ...r }))
  const byPath = new Map(tags.map((r) => [String(r.path), r]))
  let nextTagId = Math.max(0, ...tags.map((r) => num(r.id))) + 1
  const now = Date.now()
  const tag = (entryId: unknown, path: string) => {
    let r = byPath.get(path)
    if (!r) {
      r = { id: nextTagId++, path, createdAt: now }
      tags.push(r)
      byPath.set(path, r)
    }
    const own = entryTags.filter((l) => l.entryId === entryId)
    if (!own.some((l) => l.tagId === r.id)) entryTags.push({ entryId, tagId: r.id, position: Math.max(-1, ...own.map((l) => num(l.position))) + 1 })
  }
  const lastNodePosition = (entryId: unknown) => Math.max(0, ...nodes.filter((n) => n.entryId === entryId).map((n) => num(n.position)))
  const mimeOf = (file: string) => (/\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg')

  const captureImages = get('capture_images')
  for (const c of get('captures')) {
    const e = entryById.get(c.entryId ?? captureEntryId(String(c.id)))
    if (!e) continue
    Object.assign(e, { url: c.url, linkKey: `${c.handler}:${c.key}`, icon: c.icon ?? null, fields: c.fields ?? {}, publishedAt: c.publishedAt ?? null })
    const shotId = `shot-${c.id}`
    const position = lastNodePosition(e.id) + 1
    nodes.push({ id: c.id, entryId: e.id, content: c.notes ?? '', position, archived: false, activeImageId: c.activeImageId ?? shotId, createdAt: c.capturedAt, updatedAt: c.updatedAt })
    images.push({ id: shotId, nodeId: c.id, file: c.screenshot, mime: mimeOf(String(c.screenshot)), width: c.screenshotWidth ?? null, height: c.screenshotHeight ?? null, thumb: c.thumb ?? null, position: 0, createdAt: c.capturedAt })
    const own = captureImages.filter((i) => i.captureId === c.id)
    const asImage = (i: Row, nodeId: unknown) => ({ id: i.id, nodeId, file: i.file, mime: i.mime, width: null, height: null, thumb: null, position: i.position, createdAt: i.createdAt })
    for (const i of own.filter((i) => i.section === 'notes')) images.push(asImage(i, c.id))
    const comments = own.filter((i) => i.section === 'comments').sort((a, b) => num(a.position) - num(b.position))
    if (String(c.comments ?? '').trim() || comments.length) {
      const nodeId = `${c.id}-comments`
      nodes.push({ id: nodeId, entryId: e.id, content: c.comments ?? '', position: position + 1, archived: false, activeImageId: c.commentsActiveImageId ?? comments[0]?.id ?? null, createdAt: c.capturedAt, updatedAt: c.updatedAt })
      for (const i of comments) images.push(asImage(i, nodeId))
    }
    const site = String(c.site ?? '')
    if (c.handler === 'reddit' && /^r\/./.test(site)) tag(e.id, `reddit/${site.slice(2).trim().toLowerCase()}`)
    if (c.handler === 'marketplace') tag(e.id, 'marketplace')
  }

  // The image board: an entry per day, a node per row.
  const days = new Map<string, Row[]>()
  for (const b of get('board_items')) days.set(String(b.date), [...(days.get(String(b.date)) ?? []), b])
  for (const [date, items] of days) {
    const id = `board:${date}`
    const created = items.map((b) => num(b.createdAt))
    entries.push({ id, type: 'media', category: null, date, title: '', position: 0, archived: false, fields: {}, createdAt: Math.min(...created), updatedAt: Math.max(...created) })
    const rows = [...new Set(items.map((b) => num(b.row)))].sort((a, b) => a - b)
    rows.forEach((row, i) => {
      const inRow = items.filter((b) => num(b.row) === row).sort((a, b) => num(a.position) - num(b.position))
      const nodeId = `${id}:${i + 1}`
      const times = inRow.map((b) => num(b.createdAt))
      nodes.push({ id: nodeId, entryId: id, content: '', position: i + 1, archived: false, activeImageId: inRow[0]!.id, createdAt: Math.min(...times), updatedAt: Math.max(...times) })
      for (const b of inRow) images.push({ id: b.id, nodeId, file: b.file, mime: b.mime, width: b.width, height: b.height, thumb: b.thumb ?? null, position: b.position, createdAt: b.createdAt })
    })
    for (const b of items) for (const l of get('entry_tags').filter((l) => l.entryId === (b.entryId ?? mediaEntryId(String(b.id))))) {
      const path = tags.find((r) => r.id === l.tagId)?.path
      if (path !== undefined) tag(id, String(path))
    }
  }
  const kept = entries.filter((e) => !(e.type === 'media' && !String(e.id).startsWith('board:')))

  // Entries ordered by time: after their day's journal entries, oldest first.
  const timed = kept.filter((e) => e.type !== 'journal').sort((a, b) => num(a.createdAt) - num(b.createdAt) || String(a.id).localeCompare(String(b.id)))
  const next = new Map<unknown, number>()
  for (const e of timed) {
    const base = next.get(e.date) ?? Math.max(0, ...kept.filter((j) => j.date === e.date && j.type === 'journal').map((j) => num(j.position)))
    e.position = base + 1
    next.set(e.date, base + 1)
  }

  const keptIds = new Set(kept.map((e) => e.id))
  const links = entryTags.filter((l) => keptIds.has(l.entryId))
  const used = new Set(links.map((l) => l.tagId))
  return {
    ...Object.fromEntries(Object.keys(CONTENT_TABLES).map((name) => [name, get(name)])),
    entries: kept.map(({ type: _type, subtype: _subtype, ...e }) => e),
    nodes,
    images,
    entry_tags: links,
    tags: tags.filter((r) => used.has(r.id)),
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
