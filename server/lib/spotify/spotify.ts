import { and, asc, desc, eq, gte, inArray, lt, max, sql } from 'drizzle-orm'
import { toIsoDate } from '../../../shared/dates.ts'
import type { SpotifyContext, SpotifyDayCount, SpotifyNowPlaying, SpotifyPlay, SpotifyResume } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { spotifyContexts, spotifyLikes, spotifyPlays } from '../../db/content-schema.ts'
import { accessToken } from './auth.ts'

// Listening history from the Spotify Web API. Plays come from "recently played" (each with the
// playlist/album it was played from), likes from the library's added_at dates. The server syncs
// in the background; the canvas tab reads the stored history.

const API = 'https://api.spotify.com/v1'

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message)
  }
}

async function call<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T | null> {
  const token = await accessToken()
  if (!token) throw new SpotifyError('Spotify is not connected', 401)
  const res = await fetch(`${API}${pathAndQuery}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } })
  if (res.status === 204) return null
  const json = (await res.json().catch(() => null)) as { error?: { message?: string; reason?: string } } | null
  if (!res.ok) throw new SpotifyError(json?.error?.message ?? `Spotify ${res.status}`, res.status, json?.error?.reason)
  return json as T
}

// ── Web API shapes (only the fields used) ──────────────────────────────────

interface ApiTrack {
  id: string | null
  uri: string
  name: string
  duration_ms: number
  artists: { name: string }[]
  album: { name: string; images?: { url: string; width?: number | null }[] }
}
interface ApiContext {
  type: string
  uri: string
}

const artistsOf = (t: ApiTrack) => t.artists.map((a) => a.name).join(', ')
// Smallest cover that is still at least 64px wide.
const imageOf = (t: ApiTrack) => [...(t.album.images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0)).find((i) => (i.width ?? 64) >= 64)?.url ?? null
const contextKind = (uri: string) => uri.split(':')[1] ?? ''

// ── context names ──────────────────────────────────────────────────────────

const CONTEXT_TTL = 24 * 60 * 60_000

/** Looks up names of playlists/albums not yet known (or stale). Spotify-owned playlists may be unreadable. */
async function resolveContexts(uris: string[]) {
  const unique = [...new Set(uris)]
  if (!unique.length) return
  const known = new Map(
    db
      .select()
      .from(spotifyContexts)
      .where(inArray(spotifyContexts.uri, unique))
      .all()
      .map((c) => [c.uri, c]),
  )
  for (const uri of unique) {
    const k = known.get(uri)
    if (k && Date.now() - k.fetchedAt < CONTEXT_TTL) continue
    const [, type, id] = uri.split(':')
    if (!id || !['playlist', 'album', 'artist'].includes(type!)) continue
    let name = k?.name ?? fallbackName(uri)
    let imageUrl = k?.imageUrl ?? null
    try {
      const r = await call<{ name: string; images?: { url: string }[] }>(`/${type}s/${id}${type === 'playlist' ? '?fields=name,images' : ''}`)
      if (r) {
        name = r.name
        imageUrl = r.images?.at(-1)?.url ?? null
      }
    } catch (err) {
      if (!(err instanceof SpotifyError) || err.status !== 404) throw err
    }
    db.insert(spotifyContexts)
      .values({ uri, name, imageUrl, fetchedAt: Date.now() })
      .onConflictDoUpdate({ target: spotifyContexts.uri, set: { name, imageUrl, fetchedAt: Date.now() } })
      .run()
  }
}

const fallbackName = (uri: string) => (uri.includes(':collection') ? 'Liked Songs' : `Spotify ${contextKind(uri) || 'context'}`)

function contextsByUri(uris: (string | null)[]): Map<string, SpotifyContext> {
  const list = [...new Set(uris.filter((u): u is string => !!u))]
  const rows = list.length ? db.select().from(spotifyContexts).where(inArray(spotifyContexts.uri, list)).all() : []
  const names = new Map(rows.map((r) => [r.uri, r.name]))
  return new Map(list.map((uri) => [uri, { uri, type: contextKind(uri), name: names.get(uri) ?? fallbackName(uri) }]))
}

// ── sync ───────────────────────────────────────────────────────────────────

/**
 * Stores new plays. Spotify keeps only the last 50, so syncing at least every couple of hours
 * misses nothing; plays already stored are skipped by their timestamp. Returns how many were added.
 */
export async function syncPlays(): Promise<number> {
  const r = await call<{ items: { track: ApiTrack; played_at: string; context: ApiContext | null }[] }>('/me/player/recently-played?limit=50')
  let added = 0
  const contexts: string[] = []
  for (const i of r?.items ?? []) {
    if (!i.track?.id) continue
    const playedAt = Date.parse(i.played_at)
    added += db
      .insert(spotifyPlays)
      .values({
        playedAt,
        date: toIsoDate(new Date(playedAt)),
        trackId: i.track.id,
        trackName: i.track.name,
        artists: artistsOf(i.track),
        album: i.track.album.name,
        imageUrl: imageOf(i.track),
        durationMs: i.track.duration_ms,
        contextType: i.context?.type ?? null,
        contextUri: i.context?.uri ?? null,
      })
      .onConflictDoNothing()
      .run().changes
    if (i.context?.uri) contexts.push(i.context.uri)
  }
  await resolveContexts(contexts)
  return added
}

/** Stores liked songs newer than the newest one stored (the library lists newest first). */
export async function syncLikes(): Promise<number> {
  const newest = db.select({ v: max(spotifyLikes.addedAt) }).from(spotifyLikes).get()?.v ?? 0
  let added = 0
  for (let offset = 0; ; offset += 50) {
    const r = await call<{ items: { added_at: string; track: ApiTrack }[]; next: string | null }>(`/me/tracks?limit=50&offset=${offset}`)
    const items = r?.items ?? []
    let reachedKnown = false
    for (const i of items) {
      const addedAt = Date.parse(i.added_at)
      if (addedAt <= newest) {
        reachedKnown = true
        break
      }
      if (!i.track?.id) continue
      added += db
        .insert(spotifyLikes)
        .values({ trackId: i.track.id, addedAt, date: toIsoDate(new Date(addedAt)), trackName: i.track.name, artists: artistsOf(i.track) })
        .onConflictDoUpdate({ target: spotifyLikes.trackId, set: { addedAt, date: toIsoDate(new Date(addedAt)) } })
        .run().changes
    }
    if (reachedKnown || !r?.next || !items.length) break
  }
  return added
}

let lastSync: number | null = null
let lastError: string | null = null
let syncing: Promise<{ plays: number; likes: number }> | null = null

/** Syncs plays and likes; concurrent calls share one run. */
export function sync(): Promise<{ plays: number; likes: number }> {
  return (syncing ??= (async () => {
    try {
      const plays = await syncPlays()
      const likes = await syncLikes()
      lastSync = Date.now()
      lastError = null
      return { plays, likes }
    } catch (err) {
      lastError = (err as Error).message
      throw err
    }
  })().finally(() => (syncing = null)))
}

export const syncState = () => ({ lastSync, error: lastError })

// ── now playing ────────────────────────────────────────────────────────────

export async function nowPlaying(): Promise<SpotifyNowPlaying> {
  const r = await call<{ is_playing: boolean; progress_ms: number | null; item: ApiTrack | null; context: ApiContext | null; device?: { name: string } }>(
    '/me/player?additional_types=track',
  )
  const t = r?.item?.id ? r.item : null
  if (r?.context?.uri) await resolveContexts([r.context.uri])
  return {
    isPlaying: !!r?.is_playing,
    progressMs: r?.progress_ms ?? 0,
    device: r?.device?.name ?? null,
    track: t && { trackId: t.id!, trackName: t.name, artists: artistsOf(t), album: t.album.name, imageUrl: imageOf(t), durationMs: t.duration_ms },
    context: r?.context?.uri ? contextsByUri([r.context.uri]).get(r.context.uri)! : null,
  }
}

// ── queries ────────────────────────────────────────────────────────────────

export function playsOn(date: string): SpotifyPlay[] {
  const rows = db.select().from(spotifyPlays).where(eq(spotifyPlays.date, date)).orderBy(asc(spotifyPlays.playedAt)).all()
  const ctx = contextsByUri(rows.map((r) => r.contextUri))
  return rows.map((r) => ({
    playedAt: r.playedAt,
    trackId: r.trackId,
    trackName: r.trackName,
    artists: r.artists,
    album: r.album,
    imageUrl: r.imageUrl,
    durationMs: r.durationMs,
    context: r.contextUri ? ctx.get(r.contextUri)! : null,
  }))
}

function countsSince(table: typeof spotifyPlays | typeof spotifyLikes, from: string): SpotifyDayCount[] {
  return db
    .select({ date: table.date, count: sql<number>`count(*)` })
    .from(table)
    .where(gte(table.date, from))
    .groupBy(table.date)
    .orderBy(asc(table.date))
    .all()
}

export const stats = (from: string) => ({ plays: countsSince(spotifyPlays, from), likes: countsSince(spotifyLikes, from) })

/**
 * The most recent listening day before `before`, as one resume point per playlist/album played
 * that day, latest first: the last track heard there.
 */
export function resumePoints(before: string): SpotifyResume[] {
  const day = db
    .select({ date: spotifyPlays.date })
    .from(spotifyPlays)
    .where(and(lt(spotifyPlays.date, before), inArray(spotifyPlays.contextType, ['playlist', 'album'])))
    .orderBy(desc(spotifyPlays.date))
    .limit(1)
    .get()?.date
  if (!day) return []
  const rows = db
    .select()
    .from(spotifyPlays)
    .where(and(eq(spotifyPlays.date, day), inArray(spotifyPlays.contextType, ['playlist', 'album'])))
    .orderBy(desc(spotifyPlays.playedAt))
    .all()
  const ctx = contextsByUri(rows.map((r) => r.contextUri))
  const out = new Map<string, SpotifyResume>()
  for (const r of rows) {
    const seen = out.get(r.contextUri!)
    if (seen) seen.plays++
    else
      out.set(r.contextUri!, {
        date: day,
        context: ctx.get(r.contextUri!)!,
        trackUri: `spotify:track:${r.trackId}`,
        trackName: r.trackName,
        artists: r.artists,
        playedAt: r.playedAt,
        plays: 1,
      })
  }
  return [...out.values()]
}

// ── playback ───────────────────────────────────────────────────────────────

/**
 * Starts `contextUri` at `trackUri`. Without an active player, starts on the first available device.
 * Needs Spotify Premium.
 */
export async function playFrom(contextUri: string, trackUri: string): Promise<void> {
  const body = JSON.stringify({ context_uri: contextUri, offset: { uri: trackUri }, position_ms: 0 })
  const play = (device?: string) => call(`/me/player/play${device ? `?device_id=${encodeURIComponent(device)}` : ''}`, { method: 'PUT', body, headers: { 'content-type': 'application/json' } })
  try {
    await play()
  } catch (err) {
    if (!(err instanceof SpotifyError)) throw err
    if (err.status === 403) throw new SpotifyError('Spotify only lets Premium accounts control playback', 403, err.reason)
    if (err.status !== 404) throw err
    const devices = (await call<{ devices: { id: string | null; is_restricted: boolean }[] }>('/me/player/devices'))?.devices ?? []
    const device = devices.find((d) => d.id && !d.is_restricted)
    if (!device) throw new SpotifyError('No Spotify player found: open Spotify on this computer or your phone, then try again', 404, 'NO_ACTIVE_DEVICE')
    await play(device.id!)
  }
}
