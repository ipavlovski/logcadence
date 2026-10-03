import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GpsDriveStatus } from '../shared/types.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'logcadence-gpsdrive-'))
const dataDir = path.join(root, 'data')
process.env.LOGCADENCE_DATA_DIR = dataDir
const gpsDir = path.join(dataDir, 'gps')
let app: typeof import('./app.ts').app
let drive: typeof import('./lib/gps/drive.ts')

// A day at home: enough for the scan to classify it.
const gpx = (date: string, extra = 0) => {
  const t0 = Date.parse(`${date}T00:00:00Z`)
  const pts = Array.from({ length: 40 + extra }, (_, i) => `<trkpt lat="44.63" lon="-63.89"><time>${new Date(t0 + i * 600_000).toISOString()}</time></trkpt>`)
  return `<?xml version="1.0"?><gpx version="1.0"><trk><trkseg>${pts.join('\n')}</trkseg></trk></gpx>`
}

// The Drive folder: id → file.
const FOLDER = '1AbCdEfGhIjKlMnOpQrStUv'
const remote = new Map<string, { name: string; body: string; modifiedTime: string }>()
const put = (id: string, name: string, body: string, modifiedTime: string) => remote.set(id, { name, body, modifiedTime })

function fakeDrive(input: string | URL | Request): Response {
  const url = new URL(String(input))
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
  if (url.pathname === '/drive/v3/files')
    return json({ files: [...remote].map(([id, f]) => ({ id, name: f.name, size: String(Buffer.byteLength(f.body)), modifiedTime: f.modifiedTime })) })
  const id = decodeURIComponent(url.pathname.split('/').at(-1)!)
  if (id === FOLDER) return json({ id, name: 'GPSLogger', mimeType: 'application/vnd.google-apps.folder' })
  const f = remote.get(id)
  if (!f) return new Response(JSON.stringify({ error: { message: 'File not found' } }), { status: 404 })
  return url.searchParams.get('alt') === 'media' ? new Response(f.body) : json({ id, name: f.name, mimeType: 'application/zip' })
}

const req = async <T,>(method: string, url: string, body?: unknown) => {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as T }
}

beforeAll(async () => {
  mkdirSync(gpsDir, { recursive: true })
  // Already here (dropped by hand): the newest local day becomes the first lastDate.
  writeFileSync(path.join(gpsDir, '20260910.gpx'), gpx('2026-09-10'))
  // A connected account whose access token is still valid, so no token request is made.
  writeFileSync(
    path.join(dataDir, 'google.json'),
    JSON.stringify({ clientId: 'x.apps.googleusercontent.com', clientSecret: 's', accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }),
  )
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => fakeDrive(input)))
  app = (await import('./app.ts')).app
  drive = await import('./lib/gps/drive.ts')
})

afterAll(async () => {
  vi.unstubAllGlobals()
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(root, { recursive: true, force: true })
})

describe('GPS import from Google Drive', () => {
  it('reads folder links and IDs', async () => {
    const { parseFolderId } = await import('./lib/gdrive/drive.ts')
    expect(parseFolderId(`https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`)).toBe(FOLDER)
    expect(parseFolderId(`https://drive.google.com/open?id=${FOLDER}`)).toBe(FOLDER)
    expect(parseFolderId(` ${FOLDER} `)).toBe(FOLDER)
    expect(parseFolderId('not a folder')).toBeNull()
  })

  it('picks the folder, starting from the newest day already here', async () => {
    expect((await req('PUT', '/api/gps/drive/folder', { folder: 'nope' })).status).toBe(400)
    const { json } = await req<GpsDriveStatus>('PUT', '/api/gps/drive/folder', { folder: `https://drive.google.com/drive/folders/${FOLDER}` })
    expect(json).toMatchObject({ connected: true, folder: { id: FOLDER, name: 'GPSLogger' }, auto: true, lastDate: '2026-09-10' })
  })

  it('imports new days automatically and leaves older ones for a range import', async () => {
    put('a', '20260901.zip.txt', 'not gps', '2026-09-02T00:00:00Z') // ignored: not a day file
    put('b', '20260905.gpx', gpx('2026-09-05'), '2026-09-06T00:00:00Z')
    put('c', '20260908.gpx', gpx('2026-09-08'), '2026-09-09T00:00:00Z')
    put('d', '20260910.gpx', gpx('2026-09-10'), '2026-09-11T00:00:00Z') // differs from the hand-dropped copy
    put('e', '20260912.gpx', gpx('2026-09-12'), '2026-09-12T12:00:00Z')

    const r = await drive.importNew()
    expect(r).toMatchObject({ downloaded: 2, unchanged: 0, processed: 2, errors: [], older: { count: 2, from: '2026-09-05', to: '2026-09-08' } })
    expect(drive.status().lastDate).toBe('2026-09-12')
    expect(readdirSync(gpsDir).sort()).toEqual(['20260910.gpx', '20260912.gpx'])
    expect(statSync(path.join(gpsDir, '20260912.gpx')).mtimeMs).toBe(Date.parse('2026-09-12T12:00:00Z'))
    expect((await req('GET', '/api/gps/day/2026-09-12')).status).toBe(200)

    // Nothing changed: nothing downloaded.
    expect(await drive.importNew()).toMatchObject({ downloaded: 0, unchanged: 1 })
  })

  it('downloads the newest day again as it grows', async () => {
    put('e', '20260912.gpx', gpx('2026-09-12', 30), '2026-09-12T20:00:00Z')
    put('f', '20260913.gpx', gpx('2026-09-13'), '2026-09-13T08:00:00Z')
    expect(await drive.importNew()).toMatchObject({ downloaded: 2, unchanged: 0 })
    expect(drive.status().lastDate).toBe('2026-09-13')
  })

  it('imports older days by range without moving the last imported day back', async () => {
    expect((await req('POST', '/api/gps/drive/import-range', { from: '2026-09-08', to: '2026-09-01' })).status).toBe(400)
    const r = await drive.importRange('2026-09-01', '2026-09-08')
    expect(r).toMatchObject({ downloaded: 2, errors: [], older: null })
    expect(drive.status().lastDate).toBe('2026-09-13')
    expect((await req('GET', '/api/gps/day/2026-09-05')).status).toBe(200)
  })

  it('updates settings and turns automatic imports off', async () => {
    expect((await req('PATCH', '/api/gps/drive/settings', { lastDate: 'yesterday' })).status).toBe(400)
    const { json } = await req<GpsDriveStatus>('PATCH', '/api/gps/drive/settings', { auto: false })
    expect(json).toMatchObject({ auto: false, lastDate: '2026-09-13' })
    expect(drive.autoReady()).toBe(false)
  })
})
