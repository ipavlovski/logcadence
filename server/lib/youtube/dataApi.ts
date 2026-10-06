import { isRetryableStatus, RetryableError, retryAfter, withRetry } from './http.ts'
import { YoutubeError, type ImportProgress, type PlaylistVideo } from './playlist.ts'

// Reads a playlist through the YouTube Data API v3 with an API key. Unlike the playlist page, it tells when each
// video was added to the playlist (playlistItems' snippet.publishedAt), and gives exact durations, view counts and
// publish dates. Cost: 1 quota unit per 50 videos for playlistItems, and for videos and channels only for what the
// catalog doesn't have yet (10,000 units a day free). Answers are trimmed to the fields used (`fields`), so a
// 4,000-video playlist lists in well under a megabyte.

const API = 'https://www.googleapis.com/youtube/v3'
const BATCH = 50
// Guards against a paging loop; YouTube caps playlists at 5,000 videos.
const MAX_PAGES = 200

/** A video of the playlist with when it was added; `info` is missing for videos the catalog already has. */
export interface ApiVideo {
  id: string
  /** When it was added to the playlist (epoch ms). */
  addedAt: number
  info?: PlaylistVideo & { publishedAt: number | null }
}

export interface ApiPlaylist {
  id: string
  title: string
  channel: string | null
  videos: ApiVideo[]
  /** Entries that are private or deleted (left out). */
  unavailable: number
}

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// 403s that mean "slow down" rather than "no".
const RATE_LIMITS = new Set(['rateLimitExceeded', 'userRateLimitExceeded'])

async function get(path: string, params: Record<string, string>, key: string, fetchFn: typeof fetch): Promise<Json> {
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
  return withRetry(async () => {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } })
    const body = (await res.json().catch(() => ({}))) as Json
    if (res.ok) return body
    const reason = body.error?.errors?.[0]?.reason as string | undefined
    const message = (body.error?.message as string | undefined)?.replace(/<[^>]+>/g, '') ?? `YouTube Data API answered ${res.status}`
    if (isRetryableStatus(res.status) || (reason && RATE_LIMITS.has(reason))) throw new RetryableError(`YouTube Data API: ${message}`, retryAfter(res))
    if (reason === 'playlistNotFound') throw new YoutubeError('YouTube has no such playlist (or it is private)')
    if (reason === 'quotaExceeded') throw new YoutubeError('The API key’s daily YouTube quota is used up; try again tomorrow')
    throw new YoutubeError(`YouTube Data API: ${message}`)
  }).catch((err: Error) => {
    // Retries used up: report it as YouTube's answer, not a crash.
    if (err instanceof RetryableError) throw new YoutubeError(`${err.message} (after retries)`)
    throw err
  })
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

export interface ApiOptions {
  fetchFn?: typeof fetch
  /** Videos the catalog already has: their details aren't fetched again. */
  known?: ReadonlySet<string>
  /** Channels whose avatar the catalog already has. */
  knownChannels?: ReadonlySet<string>
  onProgress?: (p: ImportProgress) => void
}

/** Every available video of a playlist with the time it was added, in playlist order. */
export async function fetchPlaylistApi(id: string, key: string, { fetchFn = fetch, known = new Set(), knownChannels = new Set(), onProgress }: ApiOptions = {}): Promise<ApiPlaylist> {
  const meta = await get('playlists', { part: 'snippet,contentDetails', id, fields: 'items(snippet(title,channelTitle),contentDetails/itemCount)' }, key, fetchFn)
  const snippet = meta.items?.[0]?.snippet
  if (!snippet) throw new YoutubeError('YouTube has no such playlist (or it is private)')
  const expected = Number(meta.items[0].contentDetails?.itemCount) || 0

  const items: { id: string; title: string; channel: string; channelId: string | null; addedAt: number }[] = []
  let unavailable = 0
  let pageToken: string | undefined
  const fields = 'nextPageToken,items(snippet(publishedAt,title,videoOwnerChannelTitle,videoOwnerChannelId,resourceId/videoId),status/privacyStatus)'
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await get('playlistItems', { part: 'snippet,status', playlistId: id, maxResults: String(BATCH), fields, ...(pageToken && { pageToken }) }, key, fetchFn)
    for (const it of (page.items ?? []) as Json[]) {
      const s = it.snippet ?? {}
      const videoId = s.resourceId?.videoId as string | undefined
      const status = it.status?.privacyStatus as string | undefined
      // Deleted videos have no owner (and status "privacyStatusUnspecified"); private ones say so.
      if (!videoId || status === 'private' || !s.videoOwnerChannelTitle) {
        unavailable++
        continue
      }
      items.push({ id: videoId, title: s.title ?? '', channel: s.videoOwnerChannelTitle, channelId: s.videoOwnerChannelId ?? null, addedAt: time(s.publishedAt) ?? Date.now() })
    }
    onProgress?.({ phase: 'listing', done: items.length + unavailable, total: Math.max(expected, items.length + unavailable) })
    pageToken = page.nextPageToken
    if (!pageToken) break
  }

  // Durations, views and publish dates of new videos, then avatars and handles of new channels; 50 per request.
  const fresh = [...new Set(items.filter((v) => !known.has(v.id)).map((v) => v.id))]
  const details = new Map<string, Json>()
  for (let i = 0; i < fresh.length; i += BATCH) {
    const ids = fresh.slice(i, i + BATCH)
    const page = await get('videos', { part: 'snippet,contentDetails,statistics', id: ids.join(','), maxResults: String(BATCH), fields: 'items(id,snippet(title,publishedAt),contentDetails/duration,statistics/viewCount)' }, key, fetchFn)
    for (const v of (page.items ?? []) as Json[]) details.set(v.id, v)
    onProgress?.({ phase: 'details', done: Math.min(i + BATCH, fresh.length), total: fresh.length })
  }
  const freshSet = new Set(fresh)
  const channelIds = [...new Set(items.filter((v) => freshSet.has(v.id)).map((v) => v.channelId).filter((c): c is string => !!c && !knownChannels.has(c)))]
  const channels = new Map<string, Json>()
  for (let i = 0; i < channelIds.length; i += BATCH) {
    const page = await get('channels', { part: 'snippet', id: channelIds.slice(i, i + BATCH).join(','), maxResults: String(BATCH), fields: 'items(id,snippet(customUrl,thumbnails/default/url))' }, key, fetchFn)
    for (const c of (page.items ?? []) as Json[]) channels.set(c.id, c)
  }

  const seen = new Set<string>()
  const videos: ApiVideo[] = []
  for (const it of items) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    if (!freshSet.has(it.id)) {
      videos.push({ id: it.id, addedAt: it.addedAt })
      continue
    }
    const d = details.get(it.id)
    const c = it.channelId ? channels.get(it.channelId) : undefined
    const handle = c?.snippet?.customUrl as string | undefined
    // A channel the catalog has: its stored avatar and link are used (left null here).
    const knownChannel = !!it.channelId && knownChannels.has(it.channelId)
    videos.push({
      id: it.id,
      addedAt: it.addedAt,
      info: {
        id: it.id,
        title: d?.snippet?.title ?? it.title,
        channel: it.channel,
        channelUrl: handle
          ? `https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`
          : it.channelId && !knownChannel
            ? `https://www.youtube.com/channel/${it.channelId}`
            : null,
        channelAvatar: c?.snippet?.thumbnails?.default?.url ?? null,
        channelId: it.channelId,
        duration: formatDuration(d?.contentDetails?.duration),
        views: formatViews(d?.statistics?.viewCount),
        published: null,
        publishedAt: time(d?.snippet?.publishedAt),
      },
    })
  }
  return { id, title: snippet.title ?? id, channel: snippet.channelTitle ?? null, videos, unavailable }
}
