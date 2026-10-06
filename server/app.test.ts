import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EntryDTO, NodeDTO, TagInfo } from '../shared/types.ts'

// The db client reads LOGCADENCE_DATA_DIR at import time, so the app is imported after setting it.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app
let flush: () => void

beforeAll(async () => {
  app = (await import('./app.ts')).app
  flush = (await import('./lib/journalFiles.ts')).flushJournalFiles
})
// Databases closed first: Windows can't delete open database files.
afterAll(async () => {
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

const day = (date: string) => req<{ entries: EntryDTO[] }>('GET', `/api/journal/${date}`).then((r) => r.entries)
const tagList = () => req<{ tags: TagInfo[] }>('GET', '/api/tags').then((r) => r.tags)

describe('entries and nodes', () => {
  it('creates an entry with normalized tags and a default node', async () => {
    const e = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-20', title: 'SSD check', tags: ['#DEV', 'Dev', 'hardware: disk'] })
    expect(e.tags).toEqual(['dev', 'hardware:disk'])
    expect(e.nodes).toHaveLength(1)
    expect((await day('2026-09-20')).map((x) => x.id)).toEqual([e.id])
  })

  it('inserts after a given entry and keeps day order', async () => {
    const [first] = await day('2026-09-20')
    const last = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-20', title: 'last' })
    const mid = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-20', title: 'mid', afterEntryId: first!.id })
    expect((await day('2026-09-20')).map((x) => x.id)).toEqual([first!.id, mid.id, last.id])
  })

  it('edits nodes and mirrors the day to markdown', async () => {
    const [e] = await day('2026-09-20')
    const n = await req<NodeDTO>('POST', '/api/nodes', { entryId: e!.id, content: 'Get-PhysicalDisk', position: 5 })
    await req('PATCH', `/api/nodes/${n.id}`, { content: 'Get-PhysicalDisk | Format-Table' })
    flush()
    const md = readFileSync(path.join(dataDir, 'journals', '2026_09_20.md'), 'utf8')
    expect(md).toContain('# Sep 20th, 2026')
    expect(md).toContain('- Get-PhysicalDisk | Format-Table')
    expect(md).toContain('tags:: dev, hardware:disk')
  })

  it('logs events', async () => {
    const { events } = await req<{ events: { op: string; entity: string }[] }>('GET', '/api/events?limit=5')
    expect(events[0]).toMatchObject({ entity: 'node', op: 'edit' })
  })

  it('archives a selection and hides it from tag listings', async () => {
    const e = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-21', title: 'old note', tags: ['dev:old'] })
    await req('POST', '/api/archive', { entryIds: [e.id], archived: true })
    const visible = await req<{ entries: EntryDTO[] }>('GET', '/api/tags/entries?tag=dev')
    expect(visible.entries.map((x) => x.id)).not.toContain(e.id)
    const all = await req<{ entries: EntryDTO[] }>('GET', '/api/tags/entries?tag=dev&archived=1')
    expect(all.entries[0]!.id).toBe(e.id) // newest day first
    expect((await tagList()).find((t) => t.path === 'dev:old')).toEqual({ path: 'dev:old', active: 0, archived: 1 })
  })
})

describe('tag operations', () => {
  it('renames a subtree and merges on collision', async () => {
    await req('POST', '/api/entries', { date: '2026-09-22', title: 'a', tags: ['system:windows:powertoys'] })
    await req('POST', '/api/entries', { date: '2026-09-22', title: 'b', tags: ['os:win:powertoys', 'os:win'] })
    await req('POST', '/api/tags/rename', { from: 'system:windows', to: 'os:win' })
    const paths = (await tagList()).map((t) => t.path)
    expect(paths).toContain('os:win:powertoys')
    expect(paths.some((p) => p.startsWith('system'))).toBe(false)
    const listed = await req<{ entries: EntryDTO[] }>('GET', '/api/tags/entries?tag=os:win:powertoys')
    expect(listed.entries.map((e) => e.title).sort()).toEqual(['a', 'b'])
  })

  it('refuses to move a tag into its own subtree', async () => {
    await expect(req('POST', '/api/tags/rename', { from: 'os', to: 'os:x' })).rejects.toThrow(/400/)
  })

  it('branches selected entries into a sub-tag', async () => {
    const listed = await req<{ entries: EntryDTO[] }>('GET', '/api/tags/entries?tag=os:win:powertoys')
    const a = listed.entries.find((e) => e.title === 'a')!
    await req('POST', '/api/tags/branch', { from: 'os:win:powertoys', to: 'os:win:powertoys:fancyzones', entryIds: [a.id] })
    const exact = await req<{ entries: EntryDTO[] }>('GET', '/api/tags/entries?tag=os:win:powertoys&sub=0')
    expect(exact.entries.map((e) => e.title)).toEqual(['b'])
  })

  it('deletes a tag subtree without deleting entries', async () => {
    await req('POST', '/api/tags/delete', { tag: 'os' })
    expect((await tagList()).some((t) => t.path.startsWith('os'))).toBe(false)
    expect((await day('2026-09-22')).map((e) => e.tags)).toEqual([[], []])
  })
})

describe('search', () => {
  it('matches all terms across titles and node content', async () => {
    const { hits } = await req<{ hits: { nodeId: string | null; snippet: string }[] }>('GET', '/api/search?q=physicaldisk%20format')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.snippet).toContain('Format-Table')
  })
})

describe('images', () => {
  const upload = async (nodeId: string, name: string) => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' }))
    const res = await app.request(`/api/nodes/${nodeId}/images`, { method: 'POST', body: form })
    return ((await res.json()) as { image: { id: string; url: string } }).image
  }

  it('reorders a gallery so any image can become the thumbnail', async () => {
    const entry = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-25', title: 'gallery', nodes: [{ content: 'pics' }] })
    const nodeId = entry.nodes[0]!.id
    const [a, b, c] = [await upload(nodeId, 'a.png'), await upload(nodeId, 'b.png'), await upload(nodeId, 'c.png')]
    await req('POST', `/api/nodes/${nodeId}/images/order`, { ids: [c!.id, b!.id, a!.id] })
    expect((await day('2026-09-25'))[0]!.nodes[0]!.images.map((i) => i.id)).toEqual([c!.id, b!.id, a!.id])

    const bad = await app.request(`/api/nodes/${nodeId}/images/order`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [c!.id, a!.id] }) })
    expect(bad.status).toBe(400)
  })

  it('removes an image from its node but keeps the file for undo', async () => {
    const node = (await day('2026-09-25'))[0]!.nodes[0]!
    const img = node.images[0]!
    const res = await req<{ activeImageId: string | null }>('DELETE', `/api/images/${img.id}`)
    const after = (await day('2026-09-25'))[0]!.nodes[0]!
    expect(after.images.map((i) => i.id)).not.toContain(img.id)
    expect(res.activeImageId).toBe(after.activeImageId)
    // The asset file is still there, and the event holds what an undo needs.
    expect(readFileSync(path.join(dataDir, 'assets', img.url.split('/').at(-1)!))).toHaveLength(4)
    const { events } = await req<{ events: { entity: string; op: string; payload: Record<string, unknown> }[] }>('GET', '/api/events?limit=1')
    expect(events[0]).toMatchObject({ entity: 'image', op: 'delete', payload: { nodeId: node.id, mime: 'image/png' } })
    expect(events[0]!.payload.file).toBeTruthy()
  })

  it('takes pasted videos into the gallery but nothing else', async () => {
    const entry = await req<EntryDTO>('POST', '/api/entries', { date: '2026-09-26', title: 'clip', nodes: [{ content: 'recording' }] })
    const nodeId = entry.nodes[0]!.id
    const post = (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return app.request(`/api/nodes/${nodeId}/images`, { method: 'POST', body: form })
    }
    expect((await post(new File([new Uint8Array([1, 2, 3])], 'ShareX.mp4', { type: 'video/mp4' }))).status).toBe(201)
    expect((await post(new File(['x'], 'notes.txt', { type: 'text/plain' }))).status).toBe(400)
    const [video] = (await day('2026-09-26'))[0]!.nodes[0]!.images
    expect(video).toMatchObject({ mime: 'video/mp4', url: expect.stringMatching(/\.mp4$/) })
  })
})
