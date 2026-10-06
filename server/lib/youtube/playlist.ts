// Reads a public (or unlisted) YouTube playlist without an API key: the playlist page carries its first ~100
// videos in `ytInitialData`, and the web client's browse endpoint pages through the rest with continuation
// tokens. YouTube renders playlist rows as `lockupViewModel`s now and `playlistVideoRenderer`s before; both
// are read.

export class YoutubeError extends Error {}

export interface PlaylistVideo {
  id: string
  title: string
  channel: string
  channelUrl: string | null
  channelAvatar: string | null
  duration: string | null
  views: string | null
  published: string | null
}

export interface Playlist {
  id: string
  title: string
  channel: string | null
  videos: PlaylistVideo[]
}

const ORIGIN = 'https://www.youtube.com'
const HEADERS = {
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  // Skips the cookie consent page YouTube shows in the EU.
  cookie: 'SOCS=CAI; CONSENT=YES+',
}
// Guards against a continuation loop; 200 pages is ~20,000 videos (YouTube caps playlists at 5,000).
const MAX_PAGES = 200

/** The list id from a playlist link (or a watch link with `list=`), or a bare id. */
export function parsePlaylistId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{10,64}$/.test(s)) return s
  try {
    const id = new URL(s).searchParams.get('list')
    return id && /^[\w-]{10,64}$/.test(id) ? id : null
  } catch {
    return null
  }
}

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** Follows a path of keys and array indexes; undefined when anything along it is missing. */
function at(v: unknown, ...keys: (string | number)[]): unknown {
  for (const k of keys) {
    if (typeof k === 'number') v = Array.isArray(v) ? v[k] : undefined
    else v = isObj(v) ? v[k] : undefined
    if (v === undefined) return undefined
  }
  return v
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Text of a `{ simpleText }` or `{ runs: [{ text }] }` field. */
function text(v: unknown): string | null {
  if (!isObj(v)) return str(v)
  if (typeof v.simpleText === 'string') return str(v.simpleText)
  if (typeof v.content === 'string') return str(v.content)
  const runs = arr(v.runs).map((r) => (isObj(r) && typeof r.text === 'string' ? r.text : ''))
  return runs.length ? str(runs.join('')) : null
}

/** Every value under `key`, anywhere in `v` (depth first). */
function findAll(v: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) for (const x of v) findAll(x, key, out)
  else if (isObj(v))
    for (const [k, x] of Object.entries(v)) {
      if (k === key) out.push(x)
      else findAll(x, key, out)
    }
  return out
}

const UNAVAILABLE = /^\[(private|deleted) video\]$/i

const largest = (sources: unknown): string | null => {
  const list = arr(sources).filter(isObj)
  return str(list.at(-1)?.url)
}

const channelLink = (url: unknown) => {
  const u = str(url)
  return u ? (u.startsWith('http') ? u : ORIGIN + u) : null
}

function fromLockup(l: Json): PlaylistVideo | null {
  if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null
  const id = str(l.contentId)
  const meta = at(l, 'metadata', 'lockupMetadataViewModel')
  const title = text(at(meta, 'title'))
  if (!id || !title || UNAVAILABLE.test(title)) return null
  const rows = arr(at(meta, 'metadata', 'contentMetadataViewModel', 'metadataRows')).map((r) => arr(at(r, 'metadataParts')).filter(isObj))
  const channelPart = rows[0]?.[0]
  const [viewsPart, publishedPart] = rows[1] ?? []
  const views = text(viewsPart?.text)
  const badge = findAll(l.contentImage, 'thumbnailBadgeViewModel').find(isObj)
  return {
    id,
    title,
    channel: text(channelPart?.text) ?? '',
    channelUrl: channelLink(at(channelPart, 'text', 'commandRuns', 0, 'onTap', 'innertubeCommand', 'commandMetadata', 'webCommandMetadata', 'url')),
    channelAvatar: largest(at(meta, 'image', 'decoratedAvatarViewModel', 'avatar', 'avatarViewModel', 'image', 'sources')),
    duration: str(badge?.text),
    // "3.7M" with a play icon; the label spells it out ("3.7 million views").
    views: views && (/view/i.test(views) ? views : `${views} views`),
    published: str(publishedPart?.accessibilityLabel) ?? text(publishedPart?.text),
  }
}

function fromRenderer(r: Json): PlaylistVideo | null {
  const id = str(r.videoId)
  const title = text(r.title)
  if (!id || !title || UNAVAILABLE.test(title) || r.isPlayable === false) return null
  const byline = text(r.shortBylineText)
  // "3.7M views • 4 years ago"
  const info = arr(at(r, 'videoInfo', 'runs'))
    .map((x) => (isObj(x) ? str(x.text) : null))
    .filter((x): x is string => !!x && x !== '•')
  return {
    id,
    title,
    channel: byline ?? '',
    channelUrl: channelLink(at(r, 'shortBylineText', 'runs', 0, 'navigationEndpoint', 'commandMetadata', 'webCommandMetadata', 'url')),
    channelAvatar: null,
    duration: text(r.lengthText),
    views: info[0] ?? null,
    published: info[1] ?? null,
  }
}

/** The videos of one page of a playlist and the token for the next page, from a list of rows. */
export function parseItems(items: unknown[]): { videos: PlaylistVideo[]; next: string | null } {
  const videos: PlaylistVideo[] = []
  let next: string | null = null
  for (const item of items) {
    if (!isObj(item)) continue
    const v = isObj(item.lockupViewModel) ? fromLockup(item.lockupViewModel) : isObj(item.playlistVideoRenderer) ? fromRenderer(item.playlistVideoRenderer) : null
    if (v) videos.push(v)
    const token =
      at(item, 'continuationItemViewModel', 'continuationCommand', 'innertubeCommand', 'continuationCommand', 'token') ??
      at(item, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token') ??
      findAll(item.continuationItemRenderer, 'token')[0]
    if (!next && (isObj(item.continuationItemViewModel) || isObj(item.continuationItemRenderer))) next = str(token)
  }
  return { videos, next }
}

/** The playlist's rows on its page: the item section listing the videos (or the older playlistVideoListRenderer). */
function pageItems(data: unknown): unknown[] {
  const old = findAll(data, 'playlistVideoListRenderer').find(isObj)
  if (old) return arr(old.contents)
  const sections = findAll(at(data, 'contents'), 'itemSectionRenderer').filter(isObj)
  const list = sections.find((s) => arr(s.contents).some((c) => isObj(c) && (isObj(c.lockupViewModel) || isObj(c.playlistVideoRenderer))))
  if (!list) return []
  // The paging token sits next to the section, in the enclosing section list.
  const parent = findAll(at(data, 'contents'), 'sectionListRenderer').find(isObj)
  const after = arr(parent?.contents).filter((c) => isObj(c) && (isObj(c.continuationItemViewModel) || isObj(c.continuationItemRenderer)))
  return [...arr(list.contents), ...after]
}

/** Title and owner from the playlist page. */
export function parseHeader(data: unknown): { title: string | null; channel: string | null } {
  const title = str(at(data, 'metadata', 'playlistMetadataRenderer', 'title')) ?? str(at(data, 'header', 'pageHeaderRenderer', 'pageTitle')) ?? text(at(data, 'header', 'playlistHeaderRenderer', 'title'))
  const byline = findAll(at(data, 'header'), 'avatarStackViewModel')
    .map((a) => text(at(a, 'text')))
    .find(Boolean)
  const channel = byline?.replace(/^by\s+/i, '') ?? text(at(data, 'header', 'playlistHeaderRenderer', 'ownerText'))
  return { title, channel: channel ?? null }
}

/** The first page of a playlist, parsed from its HTML. */
export function parsePlaylistPage(html: string): { title: string | null; channel: string | null; videos: PlaylistVideo[]; next: string | null; clientVersion: string | null; apiKey: string | null } {
  const data = extractInitialData(html)
  const alert = findAll(data.alerts, 'alertRenderer').map((a) => text(at(a, 'text'))).find(Boolean)
  const items = pageItems(data)
  if (!items.length && alert) throw new YoutubeError(alert)
  return {
    ...parseHeader(data),
    ...parseItems(items),
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? null,
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? null,
  }
}

function extractInitialData(html: string): Json {
  const start = html.search(/(?:var\s+|window\[["'])ytInitialData["']?\]?\s*=\s*\{/)
  if (start < 0) throw new YoutubeError('YouTube sent a page without playlist data (it may have changed its format)')
  const from = html.indexOf('{', start)
  // The JSON ends at the "};" that closes the script statement.
  const end = html.indexOf('};</script>', from)
  try {
    return JSON.parse(html.slice(from, end < 0 ? undefined : end + 1)) as Json
  } catch {
    throw new YoutubeError('Could not read the playlist data YouTube sent')
  }
}

/** Continuation pages answer with `appendContinuationItemsAction`s holding the next rows. */
export function parseContinuation(data: unknown): { videos: PlaylistVideo[]; next: string | null } {
  const items = findAll(at(data, 'onResponseReceivedActions'), 'continuationItems').flatMap(arr)
  return parseItems(items)
}

/** Every video of a playlist, in playlist order (duplicates dropped). */
export async function fetchPlaylist(id: string, fetchFn: typeof fetch = fetch): Promise<Playlist> {
  const res = await fetchFn(`${ORIGIN}/playlist?list=${encodeURIComponent(id)}&hl=en`, { headers: HEADERS })
  if (res.status === 404) throw new YoutubeError('YouTube has no such playlist')
  if (!res.ok) throw new YoutubeError(`YouTube answered ${res.status}`)
  const page = parsePlaylistPage(await res.text())
  const videos = [...page.videos]
  let next = page.next
  for (let n = 0; next && n < MAX_PAGES; n++) {
    const url = `${ORIGIN}/youtubei/v1/browse?prettyPrint=false${page.apiKey ? `&key=${page.apiKey}` : ''}`
    const r = await fetchFn(url, {
      method: 'POST',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: page.clientVersion ?? '2.20260101.00.00', hl: 'en', gl: 'US' } }, continuation: next }),
    })
    if (!r.ok) throw new YoutubeError(`YouTube answered ${r.status} for page ${n + 2} of the playlist`)
    const more = parseContinuation(await r.json())
    videos.push(...more.videos)
    next = more.next
  }
  const seen = new Set<string>()
  return {
    id,
    title: page.title ?? id,
    channel: page.channel,
    videos: videos.filter((v) => !seen.has(v.id) && !!seen.add(v.id)),
  }
}
