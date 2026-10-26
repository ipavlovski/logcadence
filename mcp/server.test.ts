import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LogcadenceApi } from './api.ts'
import { createServer } from './server.ts'

// The MCP server end to end: an MCP client calls its tools, which call the app (server/app.ts) on a test library.

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-mcp-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let client: Client

beforeAll(async () => {
  const { app } = await import('../server/app.ts')
  const { db } = await import('../server/db/client.ts')
  const { ytVideos } = await import('../server/db/content-schema.ts')
  const video = (id: string, title: string, channel: string, day: number) => ({ id, title, channel, addedAt: day, addedDate: `2026-10-${String(day).padStart(2, '0')}`, updatedAt: 0 })
  db.insert(ytVideos)
    .values([video('v1', 'Drilling a water well by hand', 'WellCo', 1), video('v2', 'PowerToys tips', 'WinTips', 2), video('v3', 'Casing a well', 'WellCo', 3)])
    .run()

  const api = new LogcadenceApi('http://logcadence/api', async (url, init) => app.request(url.replace('http://logcadence', ''), init))
  const [a, b] = InMemoryTransport.createLinkedPair()
  await createServer(api).connect(a)
  client = new Client({ name: 'test', version: '0' })
  await client.connect(b)
})
afterAll(async () => {
  await client.close()
  const { closeDbs } = await import('../server/db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  if (res.isError) throw new Error(res.content[0]!.text)
  return JSON.parse(res.content[0]!.text) as T
}

type Page = { total: number; offset: number; videos: { id: string; tags: string[] }[] }
const ids = (p: Page) => p.videos.map((v) => v.id)

describe('mcp server', () => {
  it('lists its tools', async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['yt_get_video', 'yt_list_tags', 'yt_list_videos', 'yt_move_tag', 'yt_set_tags'])
  })

  it('lists videos newest first, paged and filtered', async () => {
    expect(ids(await call<Page>('yt_list_videos'))).toEqual(['v3', 'v2', 'v1'])
    expect(await call<Page>('yt_list_videos', { limit: 1, offset: 1 })).toMatchObject({ total: 3, offset: 1, videos: [{ id: 'v2', title: 'PowerToys tips', channel: 'WinTips', added: '2026-10-02', tags: [] }] })
    expect(ids(await call<Page>('yt_list_videos', { query: 'wellco' }))).toEqual(['v3', 'v1'])
    expect((await call<Page>('yt_list_videos', { limit: 1, fields: ['id', 'title'] })).videos).toEqual([{ id: 'v3', title: 'Casing a well' }])
  })

  it('adds tags to the current ones, or replaces them', async () => {
    const tagsOf = async (id: string) => (await call<{ tags: string[] }>('yt_get_video', { id })).tags
    expect(await call('yt_set_tags', { items: [{ id: 'v1', tags: ['Build:Well'] }, { id: 'nope', tags: ['x'] }] })).toEqual({ updated: 1, errors: [{ id: 'nope', error: 'video not found' }] })
    expect(await tagsOf('v1')).toEqual(['build/well'])
    expect(await call('yt_set_tags', { items: [{ id: 'v1', tags: ['build/well/drilling', 'build/well'] }] })).toEqual({ updated: 1 })
    expect(await tagsOf('v1')).toEqual(['build/well', 'build/well/drilling'])
    expect(await call('yt_set_tags', { items: [{ id: 'v1', tags: ['build/well/drilling'] }, { id: 'v3', tags: ['build/well/casing'] }], mode: 'replace' })).toEqual({ updated: 2 })
    expect(await tagsOf('v1')).toEqual(['build/well/drilling'])
    expect(await call('yt_list_tags')).toEqual([
      { path: 'build/well/casing', videos: 1 },
      { path: 'build/well/drilling', videos: 1 },
    ])
    expect(ids(await call<Page>('yt_list_videos', { tag: 'build' }))).toEqual(['v3', 'v1'])
    expect(ids(await call<Page>('yt_list_videos', { untagged: true }))).toEqual(['v2'])
  })

  it('renames a tag and reads one video', async () => {
    await call('yt_move_tag', { from: 'build/well', to: 'water/well' })
    expect(await call('yt_get_video', { id: 'v1' })).toMatchObject({ id: 'v1', tags: ['water/well/drilling'], url: 'https://www.youtube.com/watch?v=v1', notes: '' })
  })

  it('reports app errors as tool errors', async () => {
    await expect(call('yt_get_video', { id: 'nope' })).rejects.toThrow(/not found/)
  })

  it('says when the app is not running', async () => {
    const down = new LogcadenceApi('http://127.0.0.1:9/api', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(down.get('/youtube/library')).rejects.toThrow(/isn't running/)
  })
})
