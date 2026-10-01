import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { toIsoDate } from '../shared/dates.ts'
import type { SpotifyDayCount, SpotifyPlay, SpotifyResume, SpotifyStatus } from '../shared/types.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'logseq-spotify-'))
const dataDir = path.join(root, 'data')
process.env.LOGSEQ_DATA_DIR = dataDir
const authFile = path.join(dataDir, 'spotify.json')
let app: typeof import('./app.ts').app

// ── fake Spotify ────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60_000
// Two days ago: the last listening day before today, which is what "continue" looks for.
const T = Date.now() - 2 * DAY
const yesterday = toIsoDate(new Date(T))
const today = toIsoDate(new Date())

const track = (id: string, name: string) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  duration_ms: 200_000,
  artists: [{ name: 'Artist' }],
  album: { name: 'Album', images: [{ url: `https://img/${id}`, width: 64 }] },
})
const play = (id: string, at: number, context: string | null) => ({
  track: track(id, `Song ${id}`),
  played_at: new Date(at).toISOString(),
  context: context ? { type: context.split(':')[1], uri: context } : null,
})

let recent: object[] = []
let library: object[] = []
let playResponses: number[] = []
const calls: { method: string; url: string; body?: string }[] = []

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ method, url, body: init?.body ? String(init.body) : undefined })
  if (url.startsWith('https://accounts.spotify.com/api/token')) return respond(200, { access_token: 'fresh', expires_in: 3600 })
  const p = url.replace('https://api.spotify.com/v1', '')
  if (p.startsWith('/me/player/recently-played')) return respond(200, { items: recent })
  if (p.startsWith('/me/tracks')) return respond(200, { items: library, next: null })
  if (p.startsWith('/playlists/p1')) return respond(200, { name: 'Focus Mix', images: [] })
  if (p.startsWith('/playlists/')) return respond(404, { error: { status: 404, message: 'Not found' } })
  if (p.startsWith('/me/player/devices')) return respond(200, { devices: [{ id: 'dev1', is_restricted: false }] })
  if (p.startsWith('/me/player/play')) {
    const status = playResponses.shift() ?? 204
    return status === 204 ? new Response(null, { status }) : respond(status, { error: { status, message: 'nope', reason: status === 404 ? 'NO_ACTIVE_DEVICE' : 'PREMIUM_REQUIRED' } })
  }
  return respond(404, { error: { message: `unexpected ${p}` } })
})

async function req<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as T }
}

beforeAll(async () => {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(authFile, JSON.stringify({ clientId: 'c'.repeat(32), accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 }))
  vi.stubGlobal('fetch', fakeFetch)
  app = (await import('./app.ts')).app
})
afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  calls.length = 0
})

describe('Spotify', () => {
  it('reports the connection and the redirect URI to register', async () => {
    const { json } = await req<SpotifyStatus>('GET', '/api/spotify/status')
    expect(json).toMatchObject({ configured: true, connected: true, redirectUri: 'http://127.0.0.1:3002/api/spotify/callback' })
  })

  it('syncs plays with their playlist and likes, refreshing an expired token', async () => {
    recent = [
      play('c', T + 20 * 60_000, null),
      play('b', T + 10 * 60_000, 'spotify:playlist:p1'),
      play('a', T, 'spotify:playlist:p1'),
      play('z', T - 5 * 60_000, 'spotify:playlist:gone'),
    ]
    library = [
      { added_at: new Date(T + 1000).toISOString(), track: track('b', 'Song b') },
      { added_at: new Date(T - DAY).toISOString(), track: track('y', 'Song y') },
    ]
    const { json } = await req<{ plays: number; likes: number }>('POST', '/api/spotify/sync')
    expect(json).toEqual({ plays: 4, likes: 2 })
    expect(calls[0]!.url).toContain('accounts.spotify.com/api/token')
    expect(JSON.parse(readFileSync(authFile, 'utf8')).accessToken).toBe('fresh')

    // Already stored: nothing new on the next sync.
    expect((await req<{ plays: number; likes: number }>('POST', '/api/spotify/sync')).json).toEqual({ plays: 0, likes: 0 })

    const day = await req<{ plays: SpotifyPlay[] }>('GET', `/api/spotify/day/${yesterday}`)
    expect(day.json.plays.map((p) => [p.trackName, p.context?.name ?? null])).toEqual(
      [
        ['Song z', 'Spotify playlist'], // a playlist the API won't show (e.g. Spotify-made)
        ['Song a', 'Focus Mix'],
        ['Song b', 'Focus Mix'],
        ['Song c', null],
      ].filter((_, i) => toIsoDate(new Date([T - 5 * 60_000, T, T + 10 * 60_000, T + 20 * 60_000][i]!)) === yesterday),
    )

    const stats = await req<{ plays: SpotifyDayCount[]; likes: SpotifyDayCount[] }>('GET', '/api/spotify/stats')
    expect(stats.json.plays.reduce((n, d) => n + d.count, 0)).toBe(4)
    expect(stats.json.likes.map((d) => d.date)).toEqual([toIsoDate(new Date(T - DAY)), toIsoDate(new Date(T + 1000))].sort())
  })

  it('offers to continue each playlist from the last listening day at its last track', async () => {
    const { json } = await req<{ resume: SpotifyResume[] }>('GET', `/api/spotify/resume?before=${today}`)
    const p1 = json.resume.find((r) => r.context.uri === 'spotify:playlist:p1')!
    expect(p1).toMatchObject({ context: { name: 'Focus Mix' }, trackUri: 'spotify:track:b', trackName: 'Song b' })
    expect(json.resume.every((r) => r.date === json.resume[0]!.date)).toBe(true)
  })

  it('starts the playlist at that track, falling back to an available device', async () => {
    playResponses = [404, 204]
    const res = await req('POST', '/api/spotify/play', { contextUri: 'spotify:playlist:p1', trackUri: 'spotify:track:b' })
    expect(res.status).toBe(200)
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts.map((c) => c.url.replace('https://api.spotify.com/v1', ''))).toEqual(['/me/player/play', '/me/player/play?device_id=dev1'])
    expect(JSON.parse(puts[0]!.body!)).toEqual({ context_uri: 'spotify:playlist:p1', offset: { uri: 'spotify:track:b' }, position_ms: 0 })
  })

  it('explains that playback control needs Premium', async () => {
    playResponses = [403]
    const res = await req<{ error: string }>('POST', '/api/spotify/play', { contextUri: 'spotify:playlist:p1', trackUri: 'spotify:track:b' })
    expect(res.status).toBe(400)
    expect(res.json.error).toMatch(/Premium/)
  })

  it('validates the Client ID', async () => {
    expect((await req('POST', '/api/spotify/client-id', { clientId: 'nope' })).status).toBe(400)
  })
})
