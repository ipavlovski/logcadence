import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureDTO, CaptureLibraryDTO, CaptureRequest, CaptureResult } from '../shared/types.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-captures-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app

beforeAll(async () => {
  app = (await import('./app.ts')).app
})
beforeEach(async () => {
  const { db } = await import('./db/client.ts')
  const { captures, captureTags } = await import('./db/content-schema.ts')
  db.delete(captures).run()
  db.delete(captureTags).run()
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

const library = () => req<CaptureLibraryDTO>('GET', '/api/captures/library')

describe('capturing from the extension', () => {
  it('refuses requests without the extension header (a web page could send them otherwise)', async () => {
    const r = await call('POST', '/api/capture', { target: 'bookmark', url: 'https://example.com', title: 'x', image: img('shot') })
    expect(r.status).toBe(400)
    expect(await library()).toEqual({ items: [], tags: [] })
  })

  it('stores a Reddit post with its handler: screenshot, icon and what the page showed', async () => {
    const r = await redditPost()
    expect(r.status).toBe(201)
    const res = r.json as CaptureResult
    expect(res).toMatchObject({ handler: 'reddit', title: 'My homelab tour', created: true, comment: false })
    const post = await req<CaptureDTO>('GET', `/api/captures/items/${res.id}`)
    expect(post).toMatchObject({
      url: 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/',
      handler: 'reddit',
      site: 'r/selfhosted',
      fields: { author: 'alice', score: 412, commentCount: 87 },
      publishedAt: 1_760_000_000_000,
      width: 740,
      height: 2210,
      tags: [],
      hasNotes: false,
      hasComments: false,
    })
    for (const url of [post.screenshotUrl, post.thumbUrl!, post.iconUrl!]) expect(existsSync(path.join(dataDir, url))).toBe(true)
    expect(post.screenshotUrl).toMatch(/\.jpg$/)
    expect(post.iconUrl).toMatch(/\/icon-[0-9a-f]+\.png$/)
  })

  it('captures a post again in place: new screenshot and numbers, same notes, tags and day', async () => {
    const first = (await redditPost()).json as CaptureResult
    await req('PATCH', `/api/captures/items/${first.id}`, { notes: 'worth reading', tags: ['homelab'] })
    const before = await req<CaptureDTO>('GET', `/api/captures/items/${first.id}`)
    const again = await redditPost({ url: 'https://old.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/', image: img('shot 2'), fields: { author: 'alice', score: 900 } })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ id: first.id, created: false })
    const after = await req<CaptureDTO>('GET', `/api/captures/items/${first.id}`)
    expect(after).toMatchObject({ notes: 'worth reading', tags: ['homelab'], fields: { author: 'alice', score: 900 }, capturedAt: before.capturedAt, iconUrl: before.iconUrl })
    expect(after.screenshotUrl).not.toBe(before.screenshotUrl)
    expect((await library()).items).toHaveLength(1)
  })

  it('stores a Marketplace listing by its id, keeping only the handler’s fields; its location is its site', async () => {
    const r = (await listing()).json as CaptureResult
    expect(r).toMatchObject({ handler: 'marketplace', created: true })
    const got = await req<CaptureDTO>('GET', `/api/captures/items/${r.id}`)
    expect(got).toMatchObject({
      url: 'https://www.facebook.com/marketplace/item/1234567890/',
      site: 'Berlin, Germany',
      fields: { price: '€250', condition: 'Used – good', location: 'Berlin, Germany', seller: 'Bob' },
      publishedAt: 1_760_000_000_000,
    })
    expect(got.fields).not.toHaveProperty('mood')
    const again = await listing({ url: 'https://m.facebook.com/marketplace/item/1234567890', fields: { price: '€200' } })
    expect(again.json).toMatchObject({ id: r.id, created: false })
    expect(await req<CaptureDTO>('GET', `/api/captures/items/${r.id}`)).toMatchObject({ site: 'Marketplace', fields: { price: '€200' } })
  })

  it('a page captured before its site had a handler takes the handler when captured again', async () => {
    const { db } = await import('./db/client.ts')
    const { captures } = await import('./db/content-schema.ts')
    const old = (await send({ target: 'bookmark', url: 'https://www.facebook.com/marketplace/item/1234567890/', title: 'Desk' })).json as CaptureResult
    // As 0014_capture_handlers left a bookmark made before the Marketplace handler.
    db.update(captures).set({ handler: 'page', key: 'https://www.facebook.com/marketplace/item/1234567890/' }).run()
    await req('PATCH', `/api/captures/items/${old.id}`, { tags: ['desk'] })
    const r = (await listing()).json as CaptureResult
    expect(r).toMatchObject({ id: old.id, handler: 'marketplace', created: false })
    expect((await library()).items).toMatchObject([{ id: old.id, handler: 'marketplace', tags: ['desk'] }])
  })

  it('at startup, gives pages a handler claims to that handler, tidying their title', async () => {
    const { db } = await import('./db/client.ts')
    const { captures } = await import('./db/content-schema.ts')
    const { adoptPages } = await import('./lib/captures.ts')
    const old = (await send({ target: 'bookmark', url: 'https://example.com/a', title: '(2) Marketplace – Steel helmet | Facebook' })).json as CaptureResult
    db.update(captures).set({ url: 'https://www.facebook.com/marketplace/item/1571269678353375/?ref=browse_tab' }).run()
    await send({ target: 'bookmark', url: 'https://example.com/b' })
    expect(adoptPages()).toBe(1)
    expect(adoptPages()).toBe(0)
    expect(await req<CaptureDTO>('GET', `/api/captures/items/${old.id}`)).toMatchObject({
      handler: 'marketplace',
      url: 'https://www.facebook.com/marketplace/item/1571269678353375/',
      title: 'Steel helmet',
      site: 'Marketplace',
    })
  })

  it('edits fields by hand, as the handler takes them', async () => {
    const r = (await listing()).json as CaptureResult
    const got = await req<CaptureDTO>('PATCH', `/api/captures/items/${r.id}`, { fields: { price: '€180', location: 'Potsdam', mood: 'x' } })
    expect(got).toMatchObject({ fields: { price: '€180', location: 'Potsdam' }, site: 'Potsdam' })
    const post = (await redditPost()).json as CaptureResult
    expect(await req<CaptureDTO>('PATCH', `/api/captures/items/${post.id}`, { fields: { score: '1,204' } })).toMatchObject({ fields: { score: 1204 }, site: 'r/selfhosted' })
  })

  it('adds comment screenshots to a captured post, from the post or a comment’s link', async () => {
    const post = (await redditPost()).json as CaptureResult
    const r = await send({ target: 'comment', url: 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/comment/mt0abcd/', title: 'whatever' })
    expect(r.json).toMatchObject({ id: post.id, comment: true, created: false })
    await send({ target: 'comment', url: POST_URL, image: img('second comment') })
    const got = await req<CaptureDTO>('GET', `/api/captures/items/${post.id}`)
    expect(got.commentImages).toHaveLength(2)
    expect(got.commentsActiveImageId).toBe(got.commentImages[0]!.id)
    expect(got.hasComments).toBe(true)
    expect(got.images).toEqual([])
  })

  it('explains that a post must be captured before its comments', async () => {
    const r = await send({ target: 'comment', url: POST_URL })
    expect(r.status).toBe(404)
    expect((r.json as { error: string }).error).toBe('This post isn’t in Logcadence yet: capture it first')
    // Only handlers with comments take them.
    expect((await send({ target: 'comment', url: 'https://example.com/a' })).status).toBe(400)
    await listing()
    expect((await send({ target: 'comment', url: LISTING_URL })).status).toBe(400)
  })

  it('refuses old targets, screenshots that are not images, and pages that are not on the web', async () => {
    expect((await send({ target: 'reddit' as 'bookmark', url: POST_URL })).status).toBe(400)
    expect((await send({ target: 'bookmark', url: 'https://example.com', image: img('<svg/>', 'image/svg+xml') })).status).toBe(400)
    expect((await send({ target: 'bookmark', url: 'https://example.com', image: 'not a data url' })).status).toBe(400)
    expect((await send({ target: 'bookmark', url: 'file:///etc/passwd' })).status).toBe(400)
  })

  it('leaves out an icon it can’t read, keeping the capture', async () => {
    const r = await send({ target: 'bookmark', url: 'https://example.com/bmp', icon: img('BM…', 'image/bmp') })
    expect(r.status).toBe(201)
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${(r.json as CaptureResult).id}`)).iconUrl).toBeNull()
  })

  it('keys bookmarks by url without the #fragment, and stores one copy of a repeated icon', async () => {
    const a = (await send({ target: 'bookmark', url: 'https://www.example.com/docs?page=2#intro', title: 'Docs', icon: img('fav', 'image/x-icon') })).json as CaptureResult
    const b = (await send({ target: 'bookmark', url: 'https://www.example.com/docs?page=2#usage', title: 'Docs again', icon: img('fav', 'image/x-icon') })).json as CaptureResult
    const c = (await send({ target: 'bookmark', url: 'https://www.example.com/blog', title: '', icon: img('fav', 'image/x-icon') })).json as CaptureResult
    expect(b.id).toBe(a.id)
    expect(c.id).not.toBe(a.id)
    const lib = await library()
    expect(lib.items.map((i) => [i.title, i.site, i.url])).toEqual([
      ['https://www.example.com/blog', 'example.com', 'https://www.example.com/blog'],
      ['Docs again', 'example.com', 'https://www.example.com/docs?page=2'],
    ])
    expect(new Set(lib.items.map((i) => i.iconUrl)).size).toBe(1)
    expect(readdirSync(path.join(dataDir, 'assets')).filter((f) => f.startsWith('icon-') && f.endsWith('.ico'))).toHaveLength(1)
  })

  it('bumps the revision an open tab polls', async () => {
    const before = await req<{ revision: string }>('GET', '/api/captures/revision')
    await send({ target: 'bookmark', url: 'https://example.com/x' })
    expect((await req<{ revision: string }>('GET', '/api/captures/revision')).revision).not.toBe(before.revision)
  })
})

describe('the tab', () => {
  it('lists every handler’s captures together, with one tag set', async () => {
    const post = (await redditPost()).json as CaptureResult
    const mark = (await send({ target: 'bookmark', url: 'https://example.com/a', title: 'A' })).json as CaptureResult
    await req('PATCH', `/api/captures/items/${post.id}`, { tags: ['homelab:storage', 'nas'] })
    await req('PATCH', `/api/captures/items/${mark.id}`, { tags: ['homelab'] })
    const all = await library()
    expect(all.items.map((i) => [i.id, i.handler])).toEqual([
      [mark.id, 'page'],
      [post.id, 'reddit'],
    ])
    expect(all.tags.map((t) => [t.path, t.active])).toEqual([
      ['homelab', 1],
      ['homelab:storage', 1],
      ['nas', 1],
    ])

    // A tag is the same tag on a post and a page.
    await req('POST', '/api/captures/tags/move', { from: 'homelab', to: 'lab' })
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${post.id}`)).tags).toEqual(['lab:storage', 'nas'])
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${mark.id}`)).tags).toEqual(['lab'])
    await req('POST', '/api/captures/tags/delete', { path: 'lab' })
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${post.id}`)).tags).toEqual(['nas'])
    expect((await library()).tags.map((t) => t.path)).toEqual(['nas'])
  })

  it('takes pasted images into notes, reorders and deletes them', async () => {
    const mark = (await send({ target: 'bookmark', url: 'https://example.com/a' })).json as CaptureResult
    const upload = async (name: string) => {
      const form = new FormData()
      form.append('file', new File([name], `${name}.png`, { type: 'image/png' }))
      const res = await app.request(`/api/captures/items/${mark.id}/images/notes`, { method: 'POST', body: form })
      expect(res.status).toBe(201)
      return ((await res.json()) as { image: { id: string } }).image.id
    }
    const a = await upload('a')
    const b = await upload('b')
    await req('POST', `/api/captures/items/${mark.id}/images/notes/order`, { ids: [b, a] })
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${mark.id}`)).images.map((i) => i.id)).toEqual([b, a])
    expect(await req('DELETE', `/api/captures/images/${a}`)).toEqual({ activeImageId: b })
    expect((await library()).items[0]).toMatchObject({ hasNotes: true, hasComments: false })
  })

  it('deletes a capture with its tags', async () => {
    const mark = (await send({ target: 'bookmark', url: 'https://example.com/a' })).json as CaptureResult
    await req('PATCH', `/api/captures/items/${mark.id}`, { tags: ['gone'] })
    await req('DELETE', `/api/captures/items/${mark.id}`)
    expect(await library()).toEqual({ items: [], tags: [] })
    expect((await call('GET', `/api/captures/items/${mark.id}`)).status).toBe(404)
  })
})
