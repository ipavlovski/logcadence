import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import type { YtLibraryDTO, YtVideoDTO } from '../shared/types.ts'
import { parsePlaylistId, parsePlaylistPage } from './lib/youtube/playlist.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-yt-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app
let lib: typeof import('./lib/youtube/library.ts')
let thumbs: typeof import('./lib/youtube/thumbs.ts')

beforeAll(async () => {
  app = (await import('./app.ts')).app
  lib = await import('./lib/youtube/library.ts')
  thumbs = await import('./lib/youtube/thumbs.ts')
  // No waiting between retries.
  ;(await import('./lib/youtube/http.ts')).retry.delaysMs = [0, 0, 0]
})
afterAll(async () => {
  await thumbs.downloadThumbs() // let background downloads finish before the database closes
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json)}`)
  return json as T
}

// ── a playlist as YouTube serves it: a page in the current (lockup) format, then a continuation page in the older one ──

const LIST = 'PL2IxbRSmRuD6AzID8P8RgJpa8efVEkHHG'

const lockup = (id: string, title: string, channel: string) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '15:25' } }] } }] } },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
        image: { decoratedAvatarViewModel: { avatar: { avatarViewModel: { image: { sources: [{ url: 'https://yt3.ggpht.com/a=s68' }] } } } } },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [
              { metadataParts: [{ text: { content: channel, commandRuns: [{ onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: `/@${channel}` } }, browseEndpoint: { browseId: 'UCwot' } } } }] } }] },
              { metadataParts: [{ text: { content: '3.7M' }, accessibilityLabel: '3.7 million views' }, { text: { content: '4y ago' }, accessibilityLabel: '4 years ago' }] },
            ],
          },
        },
      },
    },
  },
})

const renderer = (id: string, title: string) => ({
  playlistVideoRenderer: {
    videoId: id,
    title: { runs: [{ text: title }] },
    shortBylineText: { runs: [{ text: 'Cypsmen', navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/@Cypsmen' } } } }] },
    lengthText: { simpleText: '8:43' },
    videoInfo: { runs: [{ text: '1.5M views' }, { text: ' • ' }, { text: '5 years ago' }] },
    isPlayable: true,
  },
})

const continuation = (token: string) => ({ continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token } } } } })

function page(items: unknown[], withMore: boolean) {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }, ...(withMore ? [continuation('PAGE2')] : [])] } } } }],
      },
    },
    header: {
      pageHeaderRenderer: {
        pageTitle: 'BUILD - WELL',
        content: {
          pageHeaderViewModel: {
            metadata: {
              avatarStackViewModel: { text: { content: 'by trickticklerschmoove' } },
              contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: 'Playlist' } }, { text: { content: '4,123 videos' } }] }] },
            },
          },
        },
      },
    },
    metadata: { playlistMetadataRenderer: { title: 'BUILD - WELL' } },
  }
  return `<html><script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261002.10.00","INNERTUBE_API_KEY":"KEY"});</script><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script></html>`
}

/** A fake YouTube; `videos` is what the playlist holds now (the first two on the page, the rest paged). */
/** Thumbnails: YouTube has none in these tests, unless a test serves its own. */
const noThumbs = (url: string) => (url.startsWith('https://i.ytimg.com/') ? new Response('', { status: 404 }) : null)

function youtube(videos: { id: string; title: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const img = noThumbs(url)
    if (img) return img
    if (url.includes('/playlist?list=')) {
      if (!url.includes(LIST)) return new Response('', { status: 404 })
      const first = videos.slice(0, 2).map((v) => lockup(v.id, v.title, 'WOT'))
      return new Response(page([...first, lockup('private0000', '[Private video]', '')], videos.length > 2))
    }
    expect(JSON.parse(String(init?.body)).continuation).toBe('PAGE2')
    const rest = videos.slice(2).map((v) => renderer(v.id, v.title))
    return Response.json({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: rest } }] })
  }) as typeof fetch
}

const V = (n: number) => ({ id: `video000000${n}`.slice(-11), title: `Well ${n}` })

describe('playlist parsing', () => {
  it('takes a link, a watch link with a list, or a bare id', () => {
    expect(parsePlaylistId(`https://www.youtube.com/playlist?list=${LIST}`)).toBe(LIST)
    expect(parsePlaylistId(`https://www.youtube.com/watch?v=xQRhsoSCXvg&list=${LIST}&index=2`)).toBe(LIST)
    expect(parsePlaylistId(` ${LIST} `)).toBe(LIST)
    expect(parsePlaylistId('https://www.youtube.com/watch?v=xQRhsoSCXvg')).toBeNull()
  })

  it('reads the first page: details, the paging token, unavailable videos left out', () => {
    const p = parsePlaylistPage(page([lockup('xQRhsoSCXvg', 'DIY Well Drilling', 'WOT'), lockup('private0000', '[Private video]', '')], true))
    expect(p).toMatchObject({ title: 'BUILD - WELL', channel: 'trickticklerschmoove', total: 4123, unavailable: 1, next: 'PAGE2', clientVersion: '2.20261002.10.00', apiKey: 'KEY' })
    expect(p.videos).toEqual([
      {
        id: 'xQRhsoSCXvg',
        title: 'DIY Well Drilling',
        channel: 'WOT',
        channelUrl: 'https://www.youtube.com/@WOT',
        channelAvatar: 'https://yt3.ggpht.com/a=s68',
        channelId: 'UCwot',
        duration: '15:25',
        views: '3.7M views',
        published: '4 years ago',
      },
    ])
  })
})

// ── the Data API, as it answers with a key ──

/** Fake Data API: the playlist's items (2 per page) with the times they were added, plus videos and channels. */
/** Video ids the fake Data API was asked the details of. */
const detailsAsked: string[] = []

function dataApi(items: { id: string; title: string; addedAt: string; status?: string; owner?: string | null }[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const img = noThumbs(String(input))
    if (img) return img
    const url = new URL(String(input))
    expect(url.searchParams.get('key')).toBe('AIzaTEST1234')
    const q = (k: string) => url.searchParams.get(k)
    const route = url.pathname.split('/').at(-1)
    if (route === 'playlists')
      return Response.json({ items: q('id') === LIST ? [{ snippet: { title: 'BUILD - WELL', channelTitle: 'trickticklerschmoove' }, contentDetails: { itemCount: items.length } }] : [] })
    if (route === 'playlistItems') {
      const start = Number(q('pageToken') ?? 0)
      const page = items.slice(start, start + 2).map((it) => ({
        snippet: { title: it.title, publishedAt: it.addedAt, resourceId: { videoId: it.id }, videoOwnerChannelTitle: it.owner === null ? undefined : (it.owner ?? 'WOT'), videoOwnerChannelId: 'UCwot' },
        status: { privacyStatus: it.status ?? 'public' },
      }))
      return Response.json({ items: page, ...(start + 2 < items.length && { nextPageToken: String(start + 2) }) })
    }
    if (route === 'videos') detailsAsked.push(...q('id')!.split(','))
    if (route === 'videos')
      return Response.json({
        items: q('id')!
          .split(',')
          .map((id) => ({ id, snippet: { title: `${id} (API)`, publishedAt: '2022-03-01T10:00:00Z' }, contentDetails: { duration: 'PT1H2M3S' }, statistics: { viewCount: '3712345' } })),
      })
    if (route === 'channels') return Response.json({ items: [{ id: 'UCwot', snippet: { customUrl: '@wot_utwente', thumbnails: { default: { url: 'https://yt3.ggpht.com/wot' } } } }] })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('importer', () => {
  it('adds a playlist and imports all its videos, across pages and formats; without a key they are dated by the import', async () => {
    const r = await lib.addPlaylist(`https://www.youtube.com/playlist?list=${LIST}`, youtube([V(1), V(2), V(3)]))
    expect(r).toMatchObject({ playlistId: LIST, title: 'BUILD - WELL', found: 3, added: 3, dated: false, error: null })
    expect(lib.listPlaylists()).toMatchObject([{ id: LIST, title: 'BUILD - WELL', channel: 'trickticklerschmoove', count: 3 }])
    const { videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(videos.map((v) => v.title)).toEqual(['Well 1', 'Well 2', 'Well 3'])
    expect(videos[2]).toMatchObject({ channel: 'Cypsmen', duration: '8:43', views: '1.5M views', published: '5 years ago', publishedAt: null, tags: [] })
    expect(videos[2]).not.toHaveProperty('playlistIds')
    expect(videos.every((v) => v.addedAt === v.importedAt)).toBe(true)
  })

  it('imports only what is new and keeps the rest’s notes', async () => {
    await req('PATCH', `/api/youtube/videos/${V(1).id}`, { notes: 'hand drill' })
    await new Promise((r) => setTimeout(r, 5)) // a later import time
    const r = await lib.importPlaylist(LIST, youtube([{ ...V(1), title: 'Well 1 (renamed)' }, V(2), V(3), V(4)]))
    expect(r).toMatchObject({ found: 4, added: 1, redated: 0 })
    const { videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    // Most recently added first; ones imported together keep playlist order.
    expect(videos.map((v) => v.title)).toEqual(['Well 4', 'Well 1 (renamed)', 'Well 2', 'Well 3'])
    expect(videos[1]).toMatchObject({ hasNotes: true })
  })

  it('records a failed import on the playlist', async () => {
    const r = await lib.importPlaylist(LIST, (async () => new Response('', { status: 500 })) as unknown as typeof fetch)
    expect(r.error).toMatch(/500/)
    expect(lib.listPlaylists()[0]!.lastError).toMatch(/500/)
    await lib.importPlaylist(LIST, youtube([V(1), V(2), V(3), V(4)]))
    expect(lib.listPlaylists()[0]!.lastError).toBeNull()
  })

  it('refuses a link without a playlist', async () => {
    const res = await app.request('/api/youtube/playlists', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://youtu.be/xyz' }) })
    expect(res.status).toBe(400)
  })

  it('with an API key, takes each video’s real added date (moving earlier ones back) and the API’s details', async () => {
    const { saveSettings, publicSettings } = await import('./lib/youtube/settings.ts')
    saveSettings({ apiKey: 'AIzaTEST1234' })
    onTestFinished(() => void saveSettings({ apiKey: undefined }))
    expect(publicSettings()).toEqual({ auto: true, apiKey: '…1234', apiKeyFromEnv: false })
    const before = (await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)).importedAt
    const r = await lib.importPlaylist(
      LIST,
      dataApi([
        { ...V(1), addedAt: '2026-09-01T12:00:00Z' },
        { ...V(2), addedAt: '2026-09-03T12:00:00Z' },
        { id: 'private0000', title: 'Private video', addedAt: '2026-09-04T12:00:00Z', status: 'private' },
        { id: 'deleted0000', title: 'Deleted video', addedAt: '2026-09-04T12:00:00Z', owner: null },
        { ...V(5), addedAt: '2026-09-02T12:00:00Z' },
      ]),
    )
    expect(r).toMatchObject({ found: 3, added: 1, redated: 2, unavailable: 2, dated: true, error: null })
    // Known videos keep their details: only the new one's are fetched.
    expect(detailsAsked).toEqual([V(5).id])
    const { videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(videos.filter((v) => [V(1).id, V(2).id, V(5).id].includes(v.id)).map((v) => [v.id, v.addedAt])).toEqual([
      [V(2).id, Date.parse('2026-09-03T12:00:00Z')],
      [V(5).id, Date.parse('2026-09-02T12:00:00Z')],
      [V(1).id, Date.parse('2026-09-01T12:00:00Z')],
    ])
    const v1 = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)
    expect(v1).toMatchObject({ title: 'Well 1', importedAt: before, notes: 'hand drill' })
    const v5 = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(5).id}`)
    expect(v5).toMatchObject({
      title: `${V(5).id} (API)`,
      duration: '1:02:03',
      views: '3.7M views',
      publishedAt: Date.parse('2022-03-01T10:00:00Z'),
      // The channel is known (from the first import): its avatar and link are reused, not fetched again.
      channelUrl: 'https://www.youtube.com/@WOT',
      channelAvatar: 'https://yt3.ggpht.com/a=s68',
    })
    // A later import with a later date (another playlist, say) never moves a video forward.
    await lib.importPlaylist(LIST, dataApi([{ ...V(1), addedAt: '2026-09-20T12:00:00Z' }]))
    expect((await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)).addedAt).toBe(Date.parse('2026-09-01T12:00:00Z'))
    saveSettings({ apiKey: undefined })
    expect(publicSettings().apiKey).toBeNull()
  })

  it('formats API durations and views the way YouTube shows them', async () => {
    const { formatDuration, formatViews } = await import('./lib/youtube/dataApi.ts')
    expect([formatDuration('PT15M25S'), formatDuration('PT45S'), formatDuration('PT2H'), formatDuration('P0D')]).toEqual(['15:25', '0:45', '2:00:00', null])
    expect([formatViews('1'), formatViews('950'), formatViews('45123'), formatViews(undefined)]).toEqual(['1 view', '950 views', '45.1K views', null])
  })
})

describe('large imports: retries, failures, thumbnails', () => {
  /** Answers with `status` (or a network error, for 0) the first `times` calls whose URL matches. */
  function flaky(fetchFn: typeof fetch, match: RegExp, times: number, status: number): typeof fetch & { failures: number } {
    const f = (async (input: string | URL | Request, init?: RequestInit) => {
      if (match.test(String(input)) && f.failures < times) {
        f.failures++
        if (status === 0) throw new TypeError('fetch failed')
        return new Response('', { status })
      }
      return fetchFn(input, init)
    }) as typeof fetch & { failures: number }
    f.failures = 0
    return f
  }

  it('retries network errors, 5xx and rate limits instead of failing the import', async () => {
    const page = flaky(flaky(youtube([V(1), V(2), V(3), V(4)]), /youtubei/, 1, 0), /playlist\?list/, 2, 503)
    const r = await lib.importPlaylist(LIST, page)
    expect(r).toMatchObject({ found: 4, error: null })
    expect(page.failures).toBe(2)
    const { saveSettings } = await import('./lib/youtube/settings.ts')
    saveSettings({ apiKey: 'AIzaTEST1234' })
    try {
      const api = flaky(dataApi([{ ...V(1), addedAt: '2026-09-01T12:00:00Z' }]), /playlistItems/, 2, 429)
      expect(await lib.importPlaylist(LIST, api)).toMatchObject({ found: 1, error: null })
      expect(api.failures).toBe(2)
    } finally {
      saveSettings({ apiKey: undefined })
    }
  })

  it('records a failure that outlasts the retries, and leaves the catalog as it was', async () => {
    const before = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    const down = flaky(youtube([V(1), V(2), V(3), V(4), V(6)]), /youtubei/, 99, 502)
    const r = await lib.importPlaylist(LIST, down)
    expect(down.failures).toBe(4) // the first try and 3 retries
    expect(r.error).toMatch(/502 for page 2 of the playlist \(after retries\)/)
    expect(lib.listPlaylists()[0]!.lastError).toBe(r.error)
    expect(await req<YtLibraryDTO>('GET', '/api/youtube/library')).toEqual(before)
  })

  it('explains a network failure when adding a playlist (not an internal error)', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(lib.addPlaylist('PLofflineofflineoffline', offline)).rejects.toThrow(/could not reach YouTube/)
  })

  it('downloads the largest thumbnail once (webp first), a small one for the grid, and marks videos without any', async () => {
    const { ytVideos } = await import('./db/content-schema.ts')
    const { db } = await import('./db/client.ts')
    await thumbs.downloadThumbs() // whatever an earlier import started
    db.update(ytVideos).set({ thumbSize: null, thumb: null, thumbSmall: null }).run()
    const jpeg = new Uint8Array(3000).fill(1)
    const asked: string[] = []
    const ytimg = (async (input: string | URL | Request) => {
      const url = String(input)
      asked.push(url.replace('https://i.ytimg.com/', ''))
      if (url.includes(V(1).id)) {
        if (url.endsWith('maxresdefault.jpg')) return new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })
        if (url.endsWith('hqdefault.webp')) return new Response(jpeg, { headers: { 'content-type': 'image/webp' } })
      }
      if (url.includes(V(2).id)) throw new TypeError('fetch failed')
      return new Response(new Uint8Array(1200), { status: 404, headers: { 'content-type': 'image/jpeg' } })
    }) as unknown as typeof fetch
    await thumbs.downloadThumbs(ytimg)
    const v1 = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)
    expect(v1).toMatchObject({ thumbSize: 'maxres', thumbUrl: `/assets/yt-${V(1).id}.jpg`, thumbSmallUrl: `/assets/yt-${V(1).id}-sm.webp` })
    expect(asked.filter((u) => u.includes(V(1).id))).toEqual([`vi_webp/${V(1).id}/maxresdefault.webp`, `vi/${V(1).id}/maxresdefault.jpg`, `vi_webp/${V(1).id}/hqdefault.webp`])
    expect((await app.request(v1.thumbUrl!)).status).toBe(200)
    // YouTube has none: recorded, not asked again.
    expect(await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(3).id}`)).toMatchObject({ thumbSize: 'none', thumbUrl: null })
    // A network failure leaves it for next time.
    expect(await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(2).id}`)).toMatchObject({ thumbSize: null, thumbUrl: null })
    const status = thumbs.thumbStatus()
    expect(status).toMatchObject({ running: false, failed: 1, pending: 1 })
    asked.length = 0
    await thumbs.downloadThumbs(ytimg)
    expect(new Set(asked.map((u) => u.split('/')[1]))).toEqual(new Set([V(2).id]))
  })

  it('takes in videos imported while a thumbnail run is going (another playlist)', async () => {
    const { ytVideos } = await import('./db/content-schema.ts')
    const { db } = await import('./db/client.ts')
    const { eq } = await import('drizzle-orm')
    db.update(ytVideos).set({ thumbSize: null }).where(eq(ytVideos.id, V(1).id)).run()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const asked = new Set<string>()
    const slow = (async (input: string | URL | Request) => {
      asked.add(String(input).split('/')[4]!)
      await gate
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const run = thumbs.downloadThumbs(slow)
    // "Imported" meanwhile:
    db.update(ytVideos).set({ thumbSize: null }).where(eq(ytVideos.id, V(4).id)).run()
    release()
    await run
    // V(2) is still due from the network failure above.
    expect(asked).toEqual(new Set([V(1).id, V(2).id, V(4).id]))
    expect(thumbs.thumbStatus()).toMatchObject({ done: 3, total: 3 })
  })
})

describe('tags, notes and comments', () => {
  it('tags videos with their own hierarchical tags, apart from the journal', async () => {
    const v = await req<YtVideoDTO>('PATCH', `/api/youtube/videos/${V(1).id}`, { tags: ['Build:Well', '#build:well:drilling', 'build:well'] })
    expect(v.tags).toEqual(['build:well', 'build:well:drilling'])
    await req('PATCH', `/api/youtube/videos/${V(2).id}`, { tags: ['build:pump'] })
    const lib1 = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(lib1.tags.map((t) => [t.path, t.active])).toEqual([
      ['build:pump', 1],
      ['build:well', 1],
      ['build:well:drilling', 1],
    ])
    const journal = await req<{ tags: unknown[] }>('GET', '/api/tags')
    expect(journal.tags).toEqual([])
  })

  it('renames (merging), then deletes a tag subtree', async () => {
    await req('POST', '/api/youtube/tags/move', { from: 'build:pump', to: 'build:well' })
    expect((await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(2).id}`)).tags).toEqual(['build:well'])
    await req('POST', '/api/youtube/tags/delete', { path: 'build:well' })
    const { tags, videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(tags).toEqual([])
    expect(videos.every((v) => !v.tags.length)).toBe(true)
  })

  const upload = async (videoId: string, section: string, name: string, type: string) => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([71, 73, 70])], name, { type }))
    const res = await app.request(`/api/youtube/videos/${videoId}/images/${section}`, { method: 'POST', body: form })
    if (res.status !== 201) throw new Error(`upload → ${res.status}`)
    return (await res.json()) as { image: { id: string; url: string }; activeImageId: string }
  }

  it('keeps notes images and comment screenshots apart', async () => {
    const gif = await upload(V(3).id, 'notes', 'loop.gif', 'image/gif')
    expect(gif.activeImageId).toBe(gif.image.id)
    expect(gif.image.url).toMatch(/\.gif$/)
    const shot1 = await upload(V(3).id, 'comments', 'c1.png', 'image/png')
    const shot2 = await upload(V(3).id, 'comments', 'c2.png', 'image/png')
    expect(shot2.activeImageId).toBe(shot1.image.id)
    await req('PATCH', `/api/youtube/videos/${V(3).id}`, { comments: 'top comment: use bentonite' })
    let v = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(3).id}`)
    expect(v).toMatchObject({
      activeImageId: gif.image.id,
      images: [{ id: gif.image.id, mime: 'image/gif' }],
      comments: 'top comment: use bentonite',
      commentsActiveImageId: shot1.image.id,
      commentImages: [{ id: shot1.image.id }, { id: shot2.image.id }],
      hasNotes: true,
    })
    await req('POST', `/api/youtube/videos/${V(3).id}/images/comments/order`, { ids: [shot2.image.id, shot1.image.id] })
    expect(await req('DELETE', `/api/youtube/images/${shot1.image.id}`)).toEqual({ activeImageId: shot2.image.id })
    expect(await req('DELETE', `/api/youtube/images/${gif.image.id}`)).toEqual({ activeImageId: null })
    v = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(3).id}`)
    expect(v).toMatchObject({ images: [], commentImages: [{ id: shot2.image.id }], commentsActiveImageId: shot2.image.id, hasNotes: false })
    const bad = await app.request(`/api/youtube/videos/${V(3).id}/images/other`, { method: 'POST', body: new FormData() })
    expect(bad.status).toBe(400)
  })

  it('takes pasted recordings into the notes', async () => {
    const clip = await upload(V(3).id, 'notes', 'ShareX.mp4', 'video/mp4')
    expect(clip.image.url).toMatch(/\.mp4$/)
    expect((await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(3).id}`)).images).toMatchObject([{ id: clip.image.id, mime: 'video/mp4' }])
    await expect(upload(V(3).id, 'notes', 'notes.txt', 'text/plain')).rejects.toThrow('400')
    await req('DELETE', `/api/youtube/images/${clip.image.id}`)
  })

  it('keeps a video’s notes when its playlist is removed', async () => {
    await req('DELETE', `/api/youtube/playlists/${LIST}`)
    expect(lib.listPlaylists()).toEqual([])
    const { videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(videos).toHaveLength(5)
    expect((await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)).notes).toBe('hand drill')
  })
})
