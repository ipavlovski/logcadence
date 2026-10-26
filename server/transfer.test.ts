import { createHash } from 'node:crypto'
import { createWriteStream, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EntryDTO } from '../shared/types.ts'
import type { Manifest } from './lib/transfer/format.ts'

// The db client reads LOGCADENCE_DATA_DIR at import time, so the app is imported after setting it.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'logcadence-transfer-'))
const dataDir = path.join(tmp, 'source')
process.env.LOGCADENCE_DATA_DIR = dataDir
const zipFile = path.join(tmp, 'export.zip')

type Client = typeof import('./db/client.ts')
type Transfer = typeof import('./lib/transfer/export.ts') & typeof import('./lib/transfer/import.ts')
let app: typeof import('./app.ts').app
let client: Client
let transfer: Transfer
let tables: typeof import('./lib/transfer/format.ts')

beforeAll(async () => {
  app = (await import('./app.ts')).app
  client = await import('./db/client.ts')
  tables = await import('./lib/transfer/format.ts')
  transfer = { ...(await import('./lib/transfer/export.ts')), ...(await import('./lib/transfer/import.ts')) }
})
// Databases closed first: Windows can't delete open database files.
afterAll(async () => {
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(tmp, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

async function exportLibrary(file = zipFile) {
  const lib = { db: client.db, eventsDb: client.eventsDb, dataDir }
  return transfer.exportTo(createWriteStream(file), lib)
}

describe('data export / import', () => {
  it('round-trips every table and the assets into an empty library', async () => {
    const e = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-20', title: 'SSD check', tags: ['dev', 'hardware:disk'] })
    await req('PATCH', `/api/nodes/${e.nodes[0]!.id}`, { content: 'smart data **ok**' })
    await req('POST', '/api/entries', { date: '2026-09-21', title: 'archived one', tags: ['misc'] }).then((x) => req('PATCH', `/api/entries/${(x as EntryDTO).id}`, { archived: true }))

    const form = new FormData()
    form.append('file', new File([Buffer.from('fake png bytes')], 'a.png', { type: 'image/png' }))
    const up = await app.request(`/api/nodes/${e.nodes[0]!.id}/images`, { method: 'POST', body: form })
    expect(up.status).toBe(201)

    const manifest = await exportLibrary()
    expect(manifest.tables.entries!.rows).toBe(2)
    expect(manifest.assets.files).toBe(1)
    expect(manifest.gps).toBeUndefined()

    const target = path.join(tmp, 'target')
    const { warnings } = transfer.importFrom(zipFile, { dataDir: target })
    expect(warnings).toEqual([])

    const { openContentDb, openEventsDb } = await import('./db/open.ts')
    const content = openContentDb(path.join(target, 'db'))
    const events = openEventsDb(path.join(target, 'db'))
    try {
      for (const [name, t] of Object.entries(tables.CONTENT_TABLES)) expect(content.select().from(t).all(), name).toEqual(client.db.select().from(t).all())
      for (const [name, t] of Object.entries(tables.EVENTS_TABLES)) expect(events.select().from(t).all(), name).toEqual(client.eventsDb.select().from(t).all())
    } finally {
      content.$client.close()
      events.$client.close()
    }
    for (const f of readdirSync(path.join(dataDir, 'assets'))) expect(readFileSync(path.join(target, 'assets', f))).toEqual(readFileSync(path.join(dataDir, 'assets', f)))
    expect(readdirSync(target)).not.toContain('.importing')
  })

  it('refuses a library that already has data', () => {
    expect(() => transfer.importFrom(zipFile, { dataDir })).toThrow(/empty library/)
  })

  it('refuses exports from a newer format and corrupt tables', async () => {
    const { ZipWriter, withZip } = await import('./lib/zip.ts')
    const rewrite = async (file: string, edit: (name: string, data: Buffer) => Buffer) => {
      const members = withZip(zipFile, (ms) => ms.map((m) => [m.name, m.read()] as const))
      const zip = new ZipWriter(createWriteStream(file))
      for (const [name, data] of members) await zip.add(name, edit(name, data))
      await zip.finish()
    }

    const newer = path.join(tmp, 'newer.zip')
    await rewrite(newer, (name, data) => (name === 'manifest.json' ? Buffer.from(JSON.stringify({ ...JSON.parse(data.toString()), formatVersion: 99 })) : data))
    expect(() => transfer.importFrom(newer, { dataDir: path.join(tmp, 'empty1') })).toThrow(/newer version/)

    const corrupt = path.join(tmp, 'corrupt.zip')
    await rewrite(corrupt, (name, data) => (name === 'tables/entries.ndjson' ? Buffer.from(data.toString().replace('SSD', 'HDD')) : data))
    const empty = path.join(tmp, 'empty2')
    expect(() => transfer.importFrom(corrupt, { dataDir: empty })).toThrow(/checksum/)
    // A failed import leaves nothing behind.
    expect(readdirSync(empty).filter((f) => f !== 'db')).toEqual([])
  })

  it('imports an export made before GPS, activity and checklists moved to logtracker, skipping them', async () => {
    const { ZipWriter, withZip } = await import('./lib/zip.ts')
    const members = withZip(zipFile, (ms) => ms.map((m) => [m.name, m.read()] as const))
    const old = path.join(tmp, 'old.zip')
    const zip = new ZipWriter(createWriteStream(old))
    const gpsDays = Buffer.from(JSON.stringify({ date: '2026-09-17', sourceStamp: '1:2', dayStart: 0, homebaseId: null, homebaseOverride: false, pointCount: 1, processedAt: 0 }) + '\n')
    const gpx = Buffer.from('<gpx/>')
    for (const [name, data] of members) {
      if (name !== 'manifest.json') {
        await zip.add(name, data)
        continue
      }
      const m = JSON.parse(data.toString()) as Manifest
      m.tables.gps_days = { rows: 1, sha256: createHash('sha256').update(gpsDays).digest('hex') }
      m.gps = { files: 1, bytes: gpx.length }
      await zip.add(name, Buffer.from(JSON.stringify(m)))
    }
    await zip.add('tables/gps_days.ndjson', gpsDays)
    await zip.add('gps/20260917.gpx', gpx)
    await zip.finish()

    const target = path.join(tmp, 'old-target')
    const { warnings } = transfer.importFrom(old, { dataDir: target })
    expect(warnings).toEqual(['skipped unknown table "gps_days"', 'skipped 1 GPS file(s): GPS moved to logtracker'])
    expect(readdirSync(target)).not.toContain('gps')
  })

  it('imports Reddit and Bookmarks captures from a format 1 export as handlers, with one tag set', async () => {
    const { ZipWriter, withZip } = await import('./lib/zip.ts')
    const ndjson = (rows: object[]) => Buffer.from(rows.map((r) => JSON.stringify(r) + '\n').join(''))
    const row = { url: '', title: 'T', site: '', icon: null, screenshot: 's.jpg', screenshotWidth: null, screenshotHeight: null, thumb: null, capturedAt: 1, capturedDate: '2026-09-20', notes: '', activeImageId: null, comments: '', commentsActiveImageId: null, updatedAt: 1 }
    const v1 = {
      captures: ndjson([
        { ...row, id: 'post', kind: 'reddit', key: 'abc', author: 'alice', score: 5, commentCount: null, postedAt: 7 },
        { ...row, id: 'mark', kind: 'bookmark', key: 'https://example.com/', author: null, score: null, commentCount: null, postedAt: null },
      ]),
      capture_tags: ndjson([
        { id: 1, kind: 'reddit', path: 'homelab', createdAt: 1 },
        { id: 2, kind: 'bookmark', path: 'homelab', createdAt: 1 },
        { id: 3, kind: 'reddit', path: 'nas', createdAt: 1 },
      ]),
      capture_item_tags: ndjson([
        { captureId: 'post', tagId: 1, position: 0 },
        { captureId: 'post', tagId: 3, position: 1 },
        { captureId: 'mark', tagId: 2, position: 0 },
      ]),
    } as Record<string, Buffer>
    const members = withZip(zipFile, (ms) => ms.map((m) => [m.name, m.read()] as const))
    const old = path.join(tmp, 'v1.zip')
    const zip = new ZipWriter(createWriteStream(old))
    for (const [name, data] of members) {
      const table = name.match(/^tables\/(.+)\.ndjson$/)?.[1]
      if (table && v1[table]) continue
      if (name !== 'manifest.json') {
        await zip.add(name, data)
        continue
      }
      const m = JSON.parse(data.toString()) as Manifest
      m.formatVersion = 1
      for (const [t, buf] of Object.entries(v1)) m.tables[t] = { rows: buf.toString().split('\n').filter(Boolean).length, sha256: createHash('sha256').update(buf).digest('hex') }
      await zip.add(name, Buffer.from(JSON.stringify(m)))
    }
    for (const [t, buf] of Object.entries(v1)) await zip.add(`tables/${t}.ndjson`, buf)
    await zip.finish()

    const target = path.join(tmp, 'v1-target')
    transfer.importFrom(old, { dataDir: target })
    const Database = (await import('better-sqlite3')).default
    const sqlite = new Database(path.join(target, 'db', 'content.db'), { readonly: true })
    try {
      expect(sqlite.prepare('SELECT id, handler, fields, published_at AS publishedAt FROM captures ORDER BY id').all()).toEqual([
        { id: 'mark', handler: 'page', fields: '{}', publishedAt: null },
        { id: 'post', handler: 'reddit', fields: JSON.stringify({ author: 'alice', score: 5 }), publishedAt: 7 },
      ])
      expect(sqlite.prepare('SELECT capture_id AS id, path FROM capture_item_tags JOIN capture_tags ON capture_tags.id = tag_id ORDER BY capture_id, position').all()).toEqual([
        { id: 'mark', path: 'homelab' },
        { id: 'post', path: 'homelab' },
        { id: 'post', path: 'nas' },
      ])
      expect(sqlite.prepare('SELECT count(*) AS n FROM capture_tags').get()).toEqual({ n: 2 })
    } finally {
      sqlite.close()
    }
  })
})
