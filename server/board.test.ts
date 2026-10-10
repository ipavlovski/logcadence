import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BoardItemDTO, BoardPageDTO } from '../shared/types.ts'

// The db client reads LOGCADENCE_DATA_DIR at import time, so the app is imported after setting it.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app

beforeAll(async () => {
  app = (await import('./app.ts')).app
})
// Databases closed first: Windows can't delete open database files.
afterAll(async () => {
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.request(url, {
    method,
    headers: body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: (await res.json()) as T }
}

function upload(fields: Record<string, string>, file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }), thumb?: File) {
  const form = new FormData()
  form.set('file', file)
  if (thumb) form.set('thumb', thumb)
  form.set('width', '800')
  form.set('height', '400')
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return req<BoardItemDTO>('POST', '/api/board', form)
}

const board = (before?: string) => req<BoardPageDTO>('GET', `/api/board${before ? `?before=${before}` : ''}`).then((r) => r.json)
const ids = (page: BoardPageDTO, date: string) => page.days.find((d) => d.date === date)?.items.map((i) => i.id) ?? []

describe('image board', () => {
  it('appends uploads to the end of the day’s last row, storing the thumb', async () => {
    const thumb = new File([new Uint8Array([9])], 'thumb.webp', { type: 'image/webp' })
    const a = await upload({ date: '2026-10-01' }, undefined, thumb)
    expect(a.status).toBe(201)
    expect(a.json).toMatchObject({ date: '2026-10-01', row: 1, position: 1, mime: 'image/png', width: 800, height: 400 })
    expect(a.json.thumbUrl).toMatch(/^\/assets\/.+-thumb\.webp$/)
    expect(existsSync(path.join(dataDir, 'assets', path.basename(a.json.url)))).toBe(true)
    expect(existsSync(path.join(dataDir, 'assets', path.basename(a.json.thumbUrl!)))).toBe(true)

    const b = await upload({ date: '2026-10-01' })
    expect(b.json).toMatchObject({ row: 1, position: 2, thumbUrl: null })
  })

  it('starts a new row where asked, and later uploads follow it', async () => {
    const c = await upload({ date: '2026-10-01', row: '2', position: '1' })
    const d = await upload({ date: '2026-10-01' })
    expect(d.json).toMatchObject({ row: 2, position: 2 })
    const page = await board()
    const items = page.days[0]!.items
    expect(items.map((i) => [i.row, i.position])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ])
    expect(items[2]!.id).toBe(c.json.id)
  })

  it('moves an item within a row, to a new row and to another day', async () => {
    const [a, b] = (await board()).days[0]!.items
    await req('PATCH', `/api/board/${b!.id}`, { date: '2026-10-01', row: 1, position: 0.5 })
    expect(ids(await board(), '2026-10-01').slice(0, 2)).toEqual([b!.id, a!.id])

    await req('PATCH', `/api/board/${a!.id}`, { date: '2026-10-01', row: 1.5, position: 1 })
    const rows = (await board()).days[0]!.items.map((i) => i.row)
    expect(rows).toEqual([1, 1.5, 2, 2])

    const moved = await req<BoardItemDTO>('PATCH', `/api/board/${a!.id}`, { date: '2026-09-30', row: 1, position: 1 })
    expect(moved.json.date).toBe('2026-09-30')
    const page = await board()
    expect(page.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-09-30'])
    expect(ids(page, '2026-09-30')).toEqual([a!.id])
  })

  it('pages to older days', async () => {
    for (let i = 1; i <= 15; i++) await upload({ date: `2026-08-${String(i).padStart(2, '0')}` })
    const first = await board()
    expect(first.days).toHaveLength(14)
    expect(first.days[0]!.date).toBe('2026-10-01')
    expect(first.next).toBe('2026-08-04')
    const older = await board(first.next!)
    expect(older.days.map((d) => d.date)).toEqual(['2026-08-03', '2026-08-02', '2026-08-01'])
    expect(older.next).toBeNull()
  })

  it('deletes an item', async () => {
    const [item] = (await board()).days[0]!.items
    expect((await req('DELETE', `/api/board/${item!.id}`)).status).toBe(200)
    expect(ids(await board(), '2026-10-01')).not.toContain(item!.id)
    expect((await req('DELETE', `/api/board/${item!.id}`)).status).toBe(404)
  })

  it('rejects files that are not media, and bad moves', async () => {
    const text = await upload({}, new File(['hi'], 'a.txt', { type: 'text/plain' }))
    expect(text.status).toBe(400)
    const noSize = new FormData()
    noSize.set('file', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }))
    expect((await req('POST', '/api/board', noSize)).status).toBe(400)
    const [item] = (await board()).days[0]!.items
    expect((await req('PATCH', `/api/board/${item!.id}`, { date: 'yesterday', row: 1, position: 1 })).status).toBe(400)
  })
})
