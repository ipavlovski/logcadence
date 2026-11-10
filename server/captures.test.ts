import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureRequest, CaptureResult, EntryDTO } from '../shared/types.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-captures-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app

beforeAll(async () => {
  app = (await import('./app.ts')).app
})
beforeEach(async () => {
  const { db } = await import('./db/client.ts')
  const { entries, tags } = await import('./db/content-schema.ts')
  db.delete(entries).run()
  db.delete(tags).run()
})
afterAll(async () => {
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as unknown }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await call(method, url, body)
  if (r.status >= 400) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.json)}`)
  return r.json as T
}

const img = (text: string, type = 'image/jpeg') => `data:${type};base64,${Buffer.from(text).toString('base64')}`
const send = (body: Partial<CaptureRequest>) => call('POST', '/api/capture', { title: '', image: img('shot'), ...body }, { 'x-logcadence-capture': '1' })

const POST_URL = 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/?utm_source=share'
const redditPost = (over: Partial<CaptureRequest> = {}) =>
  send({
    target: 'bookmark',
    url: POST_URL,
    title: 'My homelab tour',
    thumb: img('thumb'),
    icon: img('icon', 'image/png'),
    width: 740,
    height: 2210,
    site: 'r/selfhosted',
    fields: { author: 'u/alice', score: 412, commentCount: 87 },
    publishedAt: 1_760_000_000_000,
    ...over,
  })

const LISTING_URL = 'https://www.facebook.com/marketplace/item/1234567890/?ref=search&referral_code=null'
const listing = (over: Partial<CaptureRequest> = {}) =>
  send({ target: 'bookmark', url: LISTING_URL, title: 'Standing desk', fields: { price: '€250', condition: 'Used – good', location: 'Berlin, Germany', seller: 'Bob', mood: 'great' }, publishedAt: 1_760_000_000_000, ...over })

const entryOf = async (id: string) => (await req<{ entries: EntryDTO[] }>('GET', `/api/entries?archived=1`)).entries.find((e) => e.id === id)!
const asset = (url: string) => path.join(dataDir, 'assets', url.replace(/^\/assets\//, ''))

describe('captures', () => {
  it('makes a page an entry of today: its title links to the page, its first node holds the screenshot', async () => {
    const r = await redditPost()
    expect(r.status).toBe(201)
    const res = r.json as CaptureResult
    expect(res).toMatchObject({ handler: 'reddit', title: 'My homelab tour', created: true, comment: false })
    const e = await entryOf(res.entryId)
    expect(e.date).toBe(res.date)
    expect(e.title).toBe('My homelab tour')
    expect(e.source).toMatchObject({
      url: 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/',
      handler: 'reddit',
      host: 'reddit.com',
      fields: { author: 'alice', score: 412, commentCount: 87 },
      publishedAt: 1_760_000_000_000,
    })
    expect(e.source!.iconUrl).toMatch(/^\/assets\/icon-/)
    expect(e.tags).toEqual(['reddit/selfhosted'])
    expect(e.nodes).toHaveLength(1)
    const [image] = e.nodes[0]!.images
    expect(image).toMatchObject({ mime: 'image/jpeg', width: 740, height: 2210 })
    expect(e.nodes[0]!.activeImageId).toBe(image!.id)
    expect(existsSync(asset(image!.url))).toBe(true)
    expect(existsSync(asset(image!.thumbUrl!))).toBe(true)
  })

  it('adds a page captured again to its entry, in a new node, keeping the title and tags it was given', async () => {
    const first = (await redditPost()).json as CaptureResult
    await req('PATCH', `/api/entries/${first.entryId}`, { title: 'Homelab ideas', tags: ['build/server', 'reddit/selfhosted'] })
    const again = await redditPost({ url: 'https://old.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/mt0abcd/', image: img('shot 2'), fields: { score: 500 } })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ entryId: first.entryId, created: false, title: 'Homelab ideas' })
    const e = await entryOf(first.entryId)
    expect(e.title).toBe('Homelab ideas')
    expect(e.tags).toEqual(['build/server', 'reddit/selfhosted'])
    expect(e.nodes).toHaveLength(2)
    expect(e.source!.fields).toEqual({ score: 500 })
    const all = (await req<{ entries: EntryDTO[] }>('GET', '/api/entries')).entries
    expect(all).toHaveLength(1)
  })

  it('adds a comment screenshot to the post’s entry, and refuses one for a page not captured or without comments', async () => {
    const first = (await redditPost()).json as CaptureResult
    const c = await send({ target: 'comment', url: 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/mt0abcd/', image: img('comment') })
    expect(c.status).toBe(200)
    expect(c.json).toMatchObject({ entryId: first.entryId, comment: true })
    expect((await entryOf(first.entryId)).nodes).toHaveLength(2)
    expect((await send({ target: 'comment', url: 'https://www.reddit.com/r/x/comments/zzz9/other/', image: img('c') })).status).toBe(404)
    expect((await send({ target: 'comment', url: 'https://example.com/', image: img('c') })).status).toBe(400)
  })

  it('tags a listing marketplace, keeps only its handler’s fields, and strips the title of Facebook’s decoration', async () => {
    const r = (await listing({ title: '(3) Marketplace – Standing desk | Facebook' })).json as CaptureResult
    const e = await entryOf(r.entryId)
    expect(e.title).toBe('Standing desk')
    expect(e.tags).toEqual(['marketplace'])
    expect(e.source).toMatchObject({ handler: 'marketplace', url: 'https://www.facebook.com/marketplace/item/1234567890/', fields: { price: '€250', condition: 'Used – good', location: 'Berlin, Germany', seller: 'Bob' } })
  })

  it('appends to the day after its other entries, and a plain page gets no tags', async () => {
    const day = new Date().toISOString().slice(0, 10)
    const own = await req<EntryDTO>('POST', '/api/entries', { date: day, title: 'Notes' })
    const r = (await send({ target: 'bookmark', url: 'https://example.com/docs#intro', title: 'Docs' })).json as CaptureResult
    const e = await entryOf(r.entryId)
    expect(e.position).toBeGreaterThan(own.position)
    expect(e.tags).toEqual([])
    expect(e.source).toMatchObject({ url: 'https://example.com/docs', handler: 'page', host: 'example.com' })
  })

  it('needs the extension’s header, a link and a screenshot', async () => {
    expect((await call('POST', '/api/capture', { target: 'bookmark', url: 'https://example.com/', image: img('x') })).status).toBe(400)
    expect((await send({ target: 'bookmark', url: 'file:///etc/passwd' })).status).toBe(400)
    expect((await send({ target: 'bookmark', url: 'https://example.com/', image: 'not a data url' })).status).toBe(400)
  })

  it('bumps the revision the app polls', async () => {
    const before = await req<{ revision: string }>('GET', '/api/revision')
    await send({ target: 'bookmark', url: 'https://example.com/a', title: 'A' })
    expect((await req<{ revision: string }>('GET', '/api/revision')).revision).not.toBe(before.revision)
  })
})
