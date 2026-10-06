import { YoutubeError, type Playlist, type PlaylistVideo } from './playlist.ts'

// Reads a playlist through the YouTube Data API v3 with an API key. Unlike the playlist page, it tells when each
// video was added to the playlist (playlistItems' snippet.publishedAt), and gives exact durations, view counts and
// publish dates. Cost: 1 quota unit per 50 videos for each of playlistItems, videos and channels (10,000 a day free).

const API = 'https://www.googleapis.com/youtube/v3'
const BATCH = 50
// Guards against a paging loop; YouTube caps playlists at 5,000 videos.
const MAX_PAGES = 200

export interface ApiVideo extends PlaylistVideo {
  /** When it was added to the playlist (epoch ms). */
  addedAt: number
  /** When YouTube published it (epoch ms). */
  publishedAt: number | null
}

export interface ApiPlaylist extends Omit<Playlist, 'videos'> {
  videos: ApiVideo[]
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

async function get(path: string, params: Record<string, string>, key: string, fetchFn: typeof fetch): Promise<Json> {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
  const res = await fetchFn(url, { headers: { accept: 'application/json' } })
  const body = (await res.json().catch(() => ({}))) as Json
  if (!res.ok) {
    const reason = body.error?.errors?.[0]?.reason as string | undefined
    const message = (body.error?.message as string | undefined)?.replace(/<[^>]+>/g, '') ?? `YouTube Data API answered ${res.status}`
    if (reason === 'playlistNotFound') throw new YoutubeError('YouTube has no such playlist (or it is private)')
    if (reason === 'quotaExceeded') throw new YoutubeError('The API key’s daily YouTube quota is used up; try again tomorrow')
    if (res.status === 400 || res.status === 403) throw new YoutubeError(`YouTube Data API: ${message}`)
    throw new YoutubeError(message)
  }
  return body
}

/** Fails with the API's reason when the key doesn't work (1 quota unit). */
export async function checkKey(key: string, fetchFn: typeof fetch = fetch) {
  await get('videos', { part: 'id', id: 'dQw4w9WgXcQ' }, key, fetchFn)
}

/** "PT1H2M3S" → "1:02:03"; "PT15M25S" → "15:25". Null for live streams and junk. */
export function formatDuration(iso: unknown): string | null {
  const m = typeof iso === 'string' ? iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/) : null
  if (!m) return null
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0)) as [number, number, number, number]
  const hours = d * 24 + h
  if (!hours && !min && !s) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`
}

/** 3712345 → "3.7M views", the way YouTube abbreviates. */
export function formatViews(count: unknown): string | null {
  const n = Number(count)
  if (count == null || !Number.isFinite(n)) return null
  if (n === 1) return '1 view'
  return `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} views`
}

const time = (iso: unknown) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

/** Every video of a playlist with the time it was added, in playlist order (unavailable ones left out). */
export async function fetchPlaylistApi(id: string, key: string, fetchFn: typeof fetch = fetch): Promise<ApiPlaylist> {
  const meta = await get('playlists', { part: 'snippet', id }, key, fetchFn)
  const snippet = meta.items?.[0]?.snippet
  if (!snippet) throw new YoutubeError('YouTube has no such playlist (or it is private)')

  const items: { id: string; title: string; channel: string; channelId: string | null; addedAt: number }[] = []
  let pageToken: string | undefined
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await get('playlistItems', { part: 'snippet,status', playlistId: id, maxResults: String(BATCH), ...(pageToken && { pageToken }) }, key, fetchFn)
    for (const it of (page.items ?? []) as Json[]) {
      const s = it.snippet ?? {}
      const videoId = s.resourceId?.videoId as string | undefined
      const status = it.status?.privacyStatus as string | undefined
      // Deleted videos have no owner; private ones say so.
      if (!videoId || status === 'private' || !s.videoOwnerChannelTitle) continue
      items.push({ id: videoId, title: s.title, channel: s.videoOwnerChannelTitle, channelId: s.videoOwnerChannelId ?? null, addedAt: time(s.publishedAt) ?? Date.now() })
    }
    pageToken = page.nextPageToken
    if (!pageToken) break
  }

  // Durations, views and publish dates, then channel avatars and handles; 50 per request.
  const details = new Map<string, Json>()
  for (let i = 0; i < items.length; i += BATCH) {
    const ids = items.slice(i, i + BATCH).map((v) => v.id)
    const page = await get('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: String(BATCH) }, key, fetchFn)
    for (const v of (page.items ?? []) as Json[]) details.set(v.id, v)
  }
  const channelIds = [...new Set(items.map((v) => v.channelId).filter((c): c is string => !!c))]
  const channels = new Map<string, Json>()
  for (let i = 0; i < channelIds.length; i += BATCH) {
    const page = await get('channels', { part: 'snippet', id: channelIds.slice(i, i + BATCH).join(','), maxResults: String(BATCH) }, key, fetchFn)
    for (const c of (page.items ?? []) as Json[]) channels.set(c.id, c)
  }

  const seen = new Set<string>()
  const videos: ApiVideo[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    const d = details.get(it.id)
    const c = it.channelId ? channels.get(it.channelId) : undefined
    const handle = c?.snippet?.customUrl as string | undefined
    videos.push({
      id: it.id,
      title: d?.snippet?.title ?? it.title,
      channel: it.channel,
      channelUrl: handle ? `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}` : it.channelId ? `https://www.youtube.com/channel/${it.channelId}` : null,
      channelAvatar: c?.snippet?.thumbnails?.default?.url ?? null,
      duration: formatDuration(d?.contentDetails?.duration),
      views: formatViews(d?.statistics?.viewCount),
      published: null,
      addedAt: it.addedAt,
      publishedAt: time(d?.snippet?.publishedAt),
    })
  }
  return { id, title: snippet.title ?? id, channel: snippet.channelTitle ?? null, videos }
}
