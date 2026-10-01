import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { openContentDb, openEventsDb } from '../../db/open.ts'
import { withZip, type ZipMember } from '../zip.ts'
import { CONTENT_TABLES, EVENTS_TABLES, FORMAT, FORMAT_VERSION, type FileSet, type Manifest, type Progress, type Settings } from './format.ts'

export interface ImportOptions {
  /** The library folder to import into; it must be empty (no entries, events or assets). */
  dataDir: string
  /** Defaults to <dataDir>/gps. */
  gpsDir?: string
  onProgress?: Progress
}

export interface ImportResult {
  manifest: Manifest
  /** Things skipped that a newer build exported (unknown tables). */
  warnings: string[]
}

/**
 * Imports an export zip into an empty library. The databases and assets are built in <dataDir>/.importing and
 * only moved into place once complete, so a failed import leaves the library as it was. The app must not
 * have the library open meanwhile.
 */
export function importFrom(zipFile: string, { dataDir, gpsDir = path.join(dataDir, 'gps'), onProgress }: ImportOptions): ImportResult {
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
      for (const name of Object.keys(manifest.tables)) if (!(name in all)) warnings.push(`skipped unknown table "${name}"`)
      const total = Object.keys(all).length
      let done = 0
      const progress = () => onProgress?.({ phase: 'tables', done: ++done, total })

      const content = openContentDb(path.join(staging, 'db'))
      try {
        content.transaction((tx) => {
          for (const [name, table] of Object.entries(CONTENT_TABLES)) insertRows(tx, table, readTable(byName, manifest, name)), progress()
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

    // GPS files are source data the app re-reads, so existing ones are kept and they go straight in.
    mkdirSync(gpsDir, { recursive: true })
    extractDir(members, 'gps', gpsDir, manifest.gps, onProgress, { keepExisting: true })

    const settings = byName.get('settings.json') ? (JSON.parse(byName.get('settings.json')!.read().toString('utf8')) as Settings) : {}
    const spotifyFile = path.join(dataDir, 'spotify.json')
    if (settings.spotify?.clientId && !existsSync(spotifyFile)) {
      writeFileSync(spotifyFile, JSON.stringify({ clientId: settings.spotify.clientId }, null, 2))
      try {
        chmodSync(spotifyFile, 0o600)
      } catch {
        // not supported on every filesystem
      }
    }
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
  if (m.format !== FORMAT) throw new Error('not a data export (unknown format)')
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
    .map((line) => upgradeRow(manifest.formatVersion, name, JSON.parse(line) as Record<string, unknown>))
  if (rows.length !== expected.rows) throw new Error(`export is corrupt: ${name} has ${rows.length} rows, expected ${expected.rows}`)
  return rows
}

/** Brings a row from an older export format up to FORMAT_VERSION. Add a step per version bump. */
function upgradeRow(_fromVersion: number, _table: string, row: Record<string, unknown>): Record<string, unknown> {
  return row
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

function extractDir(members: ZipMember[], prefix: string, dir: string, expected: FileSet, onProgress?: Progress, { keepExisting = false } = {}) {
  const list = members.filter((m) => m.name.startsWith(`${prefix}/`))
  const got = { files: 0, bytes: 0 }
  for (const [i, m] of list.entries()) {
    const name = m.name.slice(prefix.length + 1)
    if (!name || name !== path.basename(name) || name === '..') throw new Error(`export is corrupt: bad file name ${m.name}`)
    const file = path.join(dir, name)
    if (!(keepExisting && existsSync(file))) m.extractTo(file)
    if (statSync(file).size !== m.size && !keepExisting) throw new Error(`export is corrupt: ${m.name} is truncated`)
    got.files++
    got.bytes += m.size
    if (i % 25 === 0 || i === list.length - 1) onProgress?.({ phase: prefix as 'assets' | 'gps', done: i + 1, total: list.length })
  }
  if (got.files !== expected.files || got.bytes !== expected.bytes)
    throw new Error(`export is incomplete: ${prefix} has ${got.files} files / ${got.bytes} bytes, expected ${expected.files} / ${expected.bytes}`)
}
