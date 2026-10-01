import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Writable } from 'node:stream'
import pkg from '../../../package.json' with { type: 'json' }
import { schemaTag } from '../../db/open.ts'
import { ZipWriter } from '../zip.ts'
import { CONTENT_TABLES, EVENTS_TABLES, FORMAT, FORMAT_VERSION, type FileSet, type Library, type Manifest, type Progress, type Settings } from './format.ts'

export interface ExportOptions {
  /** Include pasted media (default true): by far the bulk of an export. */
  assets?: boolean
  /** Include the raw GPS files (default true). */
  gps?: boolean
  onProgress?: Progress
}

/** Streams the library as an export zip into `out` (and ends it). */
export async function exportTo(out: Writable, lib: Library, { assets = true, gps = true, onProgress }: ExportOptions = {}): Promise<Manifest> {
  const zip = new ZipWriter(out)
  try {
    // One read transaction per database: a consistent snapshot even while the app keeps writing.
    const tables = {
      ...lib.db.transaction((tx) => Object.fromEntries(Object.entries(CONTENT_TABLES).map(([name, t]) => [name, tx.select().from(t).all() as unknown[]]))),
      ...lib.eventsDb.transaction((tx) => Object.fromEntries(Object.entries(EVENTS_TABLES).map(([name, t]) => [name, tx.select().from(t).all() as unknown[]]))),
    }

    const manifestTables: Manifest['tables'] = {}
    const names = Object.keys(tables)
    for (const [i, name] of names.entries()) {
      const rows = tables[name]!
      const ndjson = Buffer.from(rows.map((r) => JSON.stringify(r) + '\n').join(''), 'utf8')
      manifestTables[name] = { rows: rows.length, sha256: createHash('sha256').update(ndjson).digest('hex') }
      await zip.add(`tables/${name}.ndjson`, ndjson)
      onProgress?.({ phase: 'tables', done: i + 1, total: names.length })
    }

    const assetSet = assets ? await addDir(zip, path.join(lib.dataDir, 'assets'), 'assets', 'assets', onProgress) : { files: 0, bytes: 0 }
    const gpsSet = gps ? await addDir(zip, lib.gpsDir, 'gps', 'gps', onProgress) : { files: 0, bytes: 0 }

    await zip.add('settings.json', Buffer.from(JSON.stringify(readSettings(lib.dataDir), null, 2)))

    const manifest: Manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      appVersion: pkg.version,
      exportedAt: new Date().toISOString(),
      schema: { content: schemaTag('content'), events: schemaTag('events') },
      tables: manifestTables,
      assets: assetSet,
      gps: gpsSet,
    }
    await zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
    await zip.finish()
    return manifest
  } catch (err) {
    out.destroy(err as Error)
    throw err
  }
}

/** Adds every file directly in `dir` under `prefix/`. Files that vanish before they are reached are skipped. */
async function addDir(zip: ZipWriter, dir: string, prefix: string, phase: 'assets' | 'gps', onProgress?: Progress): Promise<FileSet> {
  const names = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name) : []
  const set = { files: 0, bytes: 0 }
  for (const [i, name] of names.entries()) {
    const file = path.join(dir, name)
    if (!existsSync(file)) continue // deleted since the listing
    set.bytes += await zip.addFile(`${prefix}/${name}`, file)
    set.files++
    if (i % 25 === 0 || i === names.length - 1) onProgress?.({ phase, done: i + 1, total: names.length })
  }
  return set
}

function readSettings(dataDir: string): Settings {
  try {
    const spotify = JSON.parse(readFileSync(path.join(dataDir, 'spotify.json'), 'utf8')) as { clientId?: string }
    return spotify.clientId ? { spotify: { clientId: spotify.clientId } } : {}
  } catch {
    return {}
  }
}
