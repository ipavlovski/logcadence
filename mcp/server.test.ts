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
let app: typeof import('../server/app.ts').app

beforeAll(async () => {
  app = (await import('../server/app.ts')).app
  const post = (body: object) => app.request('/api/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await post({ date: '2026-10-01', title: 'Drilling', tags: ['build/well/drilling'], category: 'build' })
  await post({ date: '2026-10-02', title: 'Casing', tags: ['build/well/casing', 'build/well/drilling'] })

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

describe('mcp server', () => {
  it('lists its tools', async () => {
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['list_categories', 'list_tags', 'move_tag'])
  })

  it('lists the tags and the categories with their counts', async () => {
    expect(await call('list_tags')).toEqual([
      { path: 'build/well/casing', entries: 1 },
      { path: 'build/well/drilling', entries: 2 },
    ])
    expect((await call<{ name: string }[]>('list_categories')).map((c) => c.name)).toEqual(['design', 'build', 'fabrication', 'dev', 'notes'])
    expect(await call('list_categories')).toContainEqual({ name: 'build', entries: 1 })
  })

  it('renames a tag on every entry, merging', async () => {
    expect(await call('move_tag', { from: 'build/well/casing', to: 'Build:Well:Drilling' })).toEqual({ ok: true, from: 'build/well/casing', to: 'build/well/drilling' })
    expect(await call('list_tags')).toEqual([{ path: 'build/well/drilling', entries: 2 }])
  })

  it('reports app errors as tool errors', async () => {
    await expect(call('move_tag', { from: 'nope', to: 'x' })).rejects.toThrow(/not found/)
  })

  it('says when the app is not running', async () => {
    const down = new LogcadenceApi('http://127.0.0.1:9/api', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(down.get('/tags')).rejects.toThrow(/isn't running/)
  })
})
