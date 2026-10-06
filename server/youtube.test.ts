import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { YtLibraryDTO, YtVideoDTO } from '../shared/types.ts'
import { parsePlaylistId, parsePlaylistPage } from './lib/youtube/playlist.ts'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-yt-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app
let lib: typeof import('./lib/youtube/library.ts')

beforeAll(async () => {
  app = (await import('./app.ts')).app
  lib = await import('./lib/youtube/library.ts')
})
afterAll(async () => {
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
              { metadataParts: [{ text: { content: channel, commandRuns: [{ onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: `/@${channel}` } } } } }] } }] },
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
    header: { pageHeaderRenderer: { pageTitle: 'BUILD - WELL', content: { pageHeaderViewModel: { metadata: { avatarStackViewModel: { text: { content: 'by trickticklerschmoove' } } } } } } },
    metadata: { playlistMetadataRenderer: { title: 'BUILD - WELL' } },
  }
  return `<html><script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261002.10.00","INNERTUBE_API_KEY":"KEY"});</script><script nonce="x">var ytInitialData = ${JSON.stringify(data)};</script></html>`
}

/** A fake YouTube; `videos` is what the playlist holds now (the first two on the page, the rest paged). */
function youtube(videos: { id: string; title: string }[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
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
    expect(p).toMatchObject({ title: 'BUILD - WELL', channel: 'trickticklerschmoove', next: 'PAGE2', clientVersion: '2.20261002.10.00', apiKey: 'KEY' })
    expect(p.videos).toEqual([
      {
        id: 'xQRhsoSCXvg',
        title: 'DIY Well Drilling',
        channel: 'WOT',
        channelUrl: 'https://www.youtube.com/@WOT',
        channelAvatar: 'https://yt3.ggpht.com/a=s68',
        duration: '15:25',
        views: '3.7M views',
        published: '4 years ago',
      },
    ])
  })
})

describe('importer', () => {
  it('adds a playlist and discovers all its videos today, across pages and formats', async () => {
    const r = await lib.addPlaylist(`https://www.youtube.com/playlist?list=${LIST}`, youtube([V(1), V(2), V(3)]))
    expect(r).toMatchObject({ playlistId: LIST, title: 'BUILD - WELL', found: 3, added: 3, error: null })
    const { videos, playlists } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(playlists).toMatchObject([{ id: LIST, title: 'BUILD - WELL', channel: 'trickticklerschmoove', count: 3 }])
    expect(videos.map((v) => v.title)).toEqual(['Well 1', 'Well 2', 'Well 3'])
    expect(videos[2]).toMatchObject({ channel: 'Cypsmen', duration: '8:43', views: '1.5M views', published: '5 years ago', playlistIds: [LIST], tags: [] })
    expect(new Set(videos.map((v) => v.addedDate)).size).toBe(1)
  })

  it('imports only what is new and keeps the discovery day of the rest', async () => {
    await req('PATCH', `/api/youtube/videos/${V(1).id}`, { addedDate: '2026-09-01', notes: 'hand drill' })
    const r = await lib.importPlaylist(LIST, youtube([{ ...V(1), title: 'Well 1 (renamed)' }, V(2), V(3), V(4)]))
    expect(r).toMatchObject({ found: 4, added: 1, linked: 0 })
    const { videos } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    // Newest discovery first.
    expect(videos.map((v) => v.title)).toEqual(['Well 4', 'Well 2', 'Well 3', 'Well 1 (renamed)'])
    expect(videos.at(-1)).toMatchObject({ addedDate: '2026-09-01', hasNotes: true })
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
})

describe('tags and notes', () => {
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

  it('keeps images and gifs with a video', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([71, 73, 70])], 'loop.gif', { type: 'image/gif' }))
    const res = await app.request(`/api/youtube/videos/${V(3).id}/images`, { method: 'POST', body: form })
    expect(res.status).toBe(201)
    const { image, activeImageId } = (await res.json()) as { image: { id: string; url: string }; activeImageId: string }
    expect(activeImageId).toBe(image.id)
    expect(image.url).toMatch(/\.gif$/)
    const v = await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(3).id}`)
    expect(v).toMatchObject({ activeImageId: image.id, hasNotes: true, images: [{ id: image.id, mime: 'image/gif' }] })
    expect(await req('DELETE', `/api/youtube/images/${image.id}`)).toEqual({ activeImageId: null })
  })

  it('keeps a video’s notes when its playlist is removed', async () => {
    await req('DELETE', `/api/youtube/playlists/${LIST}`)
    const { videos, playlists } = await req<YtLibraryDTO>('GET', '/api/youtube/library')
    expect(playlists).toEqual([])
    expect(videos).toHaveLength(4)
    expect((await req<YtVideoDTO>('GET', `/api/youtube/videos/${V(1).id}`)).notes).toBe('hand drill')
  })
})
