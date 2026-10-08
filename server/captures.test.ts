import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureDTO, CaptureLibraryDTO, CaptureRequest, CaptureResult } from '../shared/types.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-captures-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app
let lib: typeof import('./lib/captures.ts')

beforeAll(async () => {
  app = (await import('./app.ts')).app
  lib = await import('./lib/captures.ts')
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
  send({ target: 'reddit', url: POST_URL, title: 'My homelab tour', thumb: img('thumb'), icon: img('icon', 'image/png'), width: 740, height: 2210, post: { subreddit: 'r/selfhosted', author: 'u/alice', score: 412, comments: 87, postedAt: 1_760_000_000_000 }, ...over })

describe('Reddit post ids', () => {
  it('reads the post from its link, a comment link, old reddit and redd.it', () => {
    expect(lib.redditPostId(POST_URL)).toBe('1kq2x3v')
    expect(lib.redditPostId('https://old.reddit.com/r/selfhosted/comments/1KQ2X3V/my_homelab_tour/mt0abcd/')).toBe('1kq2x3v')
    expect(lib.redditPostId('https://www.reddit.com/comments/1kq2x3v')).toBe('1kq2x3v')
    expect(lib.redditPostId('https://redd.it/1kq2x3v')).toBe('1kq2x3v')
    expect(lib.redditPostId('https://www.reddit.com/r/selfhosted/')).toBeNull()
    expect(lib.redditPostId('https://example.com/comments/1kq2x3v/')).toBeNull()
  })
})

describe('capturing from the extension', () => {
  it('refuses requests without the extension header (a web page could send them otherwise)', async () => {
    const r = await call('POST', '/api/capture', { target: 'bookmark', url: 'https://example.com', title: 'x', image: img('shot') })
    expect(r.status).toBe(400)
    expect(await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')).toEqual({ items: [], tags: [] })
  })

  it('stores a Reddit post with its screenshot, icon and what the page showed', async () => {
    const r = await redditPost()
    expect(r.status).toBe(201)
    const res = r.json as CaptureResult
    expect(res).toMatchObject({ kind: 'reddit', title: 'My homelab tour', created: true, comment: false })
    const post = await req<CaptureDTO>('GET', `/api/captures/items/${res.id}`)
    expect(post).toMatchObject({
      url: 'https://www.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/',
      site: 'r/selfhosted',
      author: 'alice',
      score: 412,
      commentCount: 87,
      postedAt: 1_760_000_000_000,
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
    const again = await redditPost({ url: 'https://old.reddit.com/r/selfhosted/comments/1kq2x3v/my_homelab_tour/', image: img('shot 2'), post: { score: 900 } })
    expect(again.status).toBe(200)
    expect(again.json).toMatchObject({ id: first.id, created: false })
    const after = await req<CaptureDTO>('GET', `/api/captures/items/${first.id}`)
    expect(after).toMatchObject({ notes: 'worth reading', tags: ['homelab'], score: 900, capturedAt: before.capturedAt, iconUrl: before.iconUrl })
    expect(after.screenshotUrl).not.toBe(before.screenshotUrl)
    expect((await req<CaptureLibraryDTO>('GET', '/api/captures/reddit/library')).items).toHaveLength(1)
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
    expect((r.json as { error: string }).error).toBe('This post isn’t in Logcadence yet: capture the post first')
    expect((await send({ target: 'comment', url: 'https://example.com/a' })).status).toBe(400)
  })

  it('refuses a Reddit capture of a page that is not a post, and screenshots that are not images', async () => {
    expect((await send({ target: 'reddit', url: 'https://www.reddit.com/r/selfhosted/' })).status).toBe(400)
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
    const lib = await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')
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

describe('the tabs', () => {
  it('keeps Reddit and Bookmarks apart, with tag sets of their own', async () => {
    const post = (await redditPost()).json as CaptureResult
    const mark = (await send({ target: 'bookmark', url: 'https://example.com/a', title: 'A' })).json as CaptureResult
    await req('PATCH', `/api/captures/items/${post.id}`, { tags: ['homelab:storage', 'nas'] })
    await req('PATCH', `/api/captures/items/${mark.id}`, { tags: ['homelab'] })
    const reddit = await req<CaptureLibraryDTO>('GET', '/api/captures/reddit/library')
    const marks = await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')
    expect(reddit.items.map((i) => i.id)).toEqual([post.id])
    expect(reddit.tags.map((t) => t.path)).toEqual(['homelab:storage', 'nas'])
    expect(marks.tags).toEqual([{ path: 'homelab', active: 1, archived: 0 }])

    // Renaming a Reddit tag leaves the bookmark's tag of the same name alone.
    await req('POST', '/api/captures/reddit/tags/move', { from: 'homelab', to: 'lab' })
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${post.id}`)).tags).toEqual(['lab:storage', 'nas'])
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${mark.id}`)).tags).toEqual(['homelab'])
    await req('POST', '/api/captures/reddit/tags/delete', { path: 'lab' })
    expect((await req<CaptureDTO>('GET', `/api/captures/items/${post.id}`)).tags).toEqual(['nas'])
    expect((await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')).tags).toHaveLength(1)
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
    expect((await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')).items[0]).toMatchObject({ hasNotes: true, hasComments: false })
  })

  it('deletes a capture with its tags', async () => {
    const mark = (await send({ target: 'bookmark', url: 'https://example.com/a' })).json as CaptureResult
    await req('PATCH', `/api/captures/items/${mark.id}`, { tags: ['gone'] })
    await req('DELETE', `/api/captures/items/${mark.id}`)
    expect(await req<CaptureLibraryDTO>('GET', '/api/captures/bookmark/library')).toEqual({ items: [], tags: [] })
    expect((await call('GET', `/api/captures/items/${mark.id}`)).status).toBe(404)
  })
})
