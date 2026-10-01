import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GpsDayDTO } from '../shared/types.ts'
import { classifyDay, detectStays, simplify, totals, type Place } from './lib/gps/classify.ts'
import { parseGpx, type GpsPoint } from './lib/gps/gpx.ts'

const root = mkdtempSync(path.join(os.tmpdir(), 'logseq-gps-'))
process.env.LOGSEQ_DATA_DIR = path.join(root, 'data')
const gpsDir = path.join(root, 'data', 'gps')
let app: typeof import('./app.ts').app

// ── a synthetic day (local time −03:00) ─────────────────────────────────────

const DATE = '2026-09-17'
const DAY0 = Date.parse(`${DATE}T00:00:00-03:00`)
const at = (h: number, m = 0) => DAY0 + (h * 60 + m) * 60_000
const HOME = { lat: 44.63, lon: -63.89 }
const SHOP = { lat: 44.63, lon: -63.83 } // ~4.8 km east
const offset = (p: { lat: number; lon: number }, dEastM: number, dNorthM = 0) => ({
  lat: p.lat + dNorthM / 110_540,
  lon: p.lon + dEastM / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
})

function stay(p: { lat: number; lon: number }, from: number, to: number): GpsPoint[] {
  const out: GpsPoint[] = []
  for (let t = from, i = 0; t < to; t += 5000, i++) {
    const j = offset(p, ((i * 7) % 21) - 10, ((i * 13) % 17) - 8) // ±10 m jitter
    out.push({ t, ...j })
  }
  return out
}

function travel(a: { lat: number; lon: number }, b: { lat: number; lon: number }, from: number, to: number): GpsPoint[] {
  const out: GpsPoint[] = []
  for (let t = from; t < to; t += 5000) {
    const f = (t - from) / (to - from)
    out.push({ t, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f })
  }
  return out
}

const TURN = offset(HOME, 0, 2000) // 2 km north: the loop's turnaround
const dayPoints: GpsPoint[] = [
  ...stay(HOME, at(0), at(8)),
  ...travel(HOME, SHOP, at(8), at(8, 20)),
  ...stay(SHOP, at(8, 20), at(8, 40)),
  ...stay(offset(SHOP, 200), at(8, 40), at(8, 41)), // a minute across the parking lot
  ...stay(SHOP, at(8, 41), at(9)),
  ...travel(SHOP, HOME, at(9), at(9, 20)),
  ...stay(HOME, at(9, 20), at(12)),
  ...travel(HOME, TURN, at(12), at(12, 15)),
  ...travel(TURN, HOME, at(12, 15), at(12, 30)),
  ...stay(HOME, at(12, 30), at(14)),
  // 14:00–16:00: phone off
  ...stay(HOME, at(16), at(24)),
]

let nextId = 0
const newId = () => `place${++nextId}`

describe('GPS classification', () => {
  it('finds stays, tolerating jitter and a short excursion', () => {
    // A stay starts once within 120 m, a little before arriving: compare within 3 minutes.
    const stays = detectStays(dayPoints.filter((p) => p.t < at(14)))
    const expected = [
      [at(0), at(8)],
      [at(8, 20), at(9)], // the minute across the parking lot does not split it
      [at(9, 20), at(12)],
      [at(12, 30), at(14)],
    ]
    expect(stays).toHaveLength(expected.length)
    stays.forEach((s, i) => {
      expect(Math.abs(s.start - expected[i]![0]!)).toBeLessThanOrEqual(3 * 60_000)
      expect(Math.abs(s.end - expected[i]![1]!)).toBeLessThanOrEqual(3 * 60_000)
    })
  })

  it('labels the day A / A->B / B / B->A / A->A with a gap, tiling 24 h', () => {
    const day = classifyDay(dayPoints, { dayStart: DAY0, dayEnd: DAY0 + 86_400_000, places: [], newId })
    expect(day.segments.map((s) => s.kind)).toEqual(['A', 'A->B', 'B', 'B->A', 'A', 'A->A', 'A', 'gap', 'A'])
    expect(day.newPlaces).toHaveLength(2)
    expect(day.homebaseId).toBe(day.segments[0]!.placeId)
    const t = totals(day.segments)
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(86_400_000)
    expect(t.gap).toBeGreaterThanOrEqual(2 * 3_600_000)
    const out = day.segments[1]!
    // 4.75 km between the two places, less what the stays at either end absorb.
    expect(out.distanceM).toBeGreaterThan(4300)
    expect(out.distanceM).toBeLessThan(4800)
    // A straight drive simplifies to its two ends; times are seconds since midnight.
    expect(out.path).toHaveLength(2)
    expect(Math.abs(out.path[0]![2] - 8 * 3600)).toBeLessThan(60)
  })

  it('reuses known places and honours a homebase picked by hand', () => {
    const first = classifyDay(dayPoints, { dayStart: DAY0, dayEnd: DAY0 + 86_400_000, places: [], newId })
    const places: Place[] = first.newPlaces
    const shop = first.segments[2]!.placeId!
    const again = classifyDay(dayPoints, { dayStart: DAY0, dayEnd: DAY0 + 86_400_000, places, homebaseId: shop, newId })
    expect(again.newPlaces).toEqual([])
    expect(again.segments.slice(0, 4).map((s) => s.kind)).toEqual(['B', 'B->A', 'A', 'A->B'])
  })

  it('simplifies paths within tolerance', () => {
    const wiggly = Array.from({ length: 100 }, (_, i) => ({ t: i, ...offset(HOME, i * 10, i % 2) }))
    expect(simplify(wiggly).length).toBe(2)
  })
})

// ── files and API ───────────────────────────────────────────────────────────

const iso = (t: number) => new Date(t - 3 * 3_600_000).toISOString().replace('Z', '-03:00')
const gpx = (points: GpsPoint[]) =>
  `<?xml version="1.0"?><gpx version="1.0"><trk><trkseg>${points
    .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${iso(p.t)}</time><hdop>0.8</hdop><src>gps</src></trkpt>\n`)
    .join('')}<trkpt lat="1" lon="1"><time>${iso(at(5))}</time><src>network</src></trkpt></trkseg></trk></gpx>`

async function req<T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await app.request(url, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: (await res.json()) as T }
}

beforeAll(async () => {
  mkdirSync(gpsDir, { recursive: true })
  writeFileSync(path.join(gpsDir, '20260917.gpx'), gpx(dayPoints))
  app = (await import('./app.ts')).app
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('GPS files', () => {
  it('parses GPX, dropping network fixes', () => {
    const t = parseGpx(gpx(dayPoints.slice(0, 3)))
    expect(t).toMatchObject({ offset: '-03:00', dropped: 1 })
    expect(t.points).toHaveLength(3)
  })

  it('scans data/gps once per file version and serves the timetable', async () => {
    expect((await req('POST', '/api/gps/scan')).json).toMatchObject({ processed: 1, unchanged: 0, errors: [] })
    expect((await req('POST', '/api/gps/scan')).json).toMatchObject({ processed: 0, unchanged: 1 })
    const { json: day } = await req<GpsDayDTO>('GET', `/api/gps/day/${DATE}`)
    expect(day.segments.map((s) => s.kind)).toEqual(['A', 'A->B', 'B', 'B->A', 'A', 'A->A', 'A', 'gap', 'A'])
    expect(day.places.map((p) => p.id).sort()).toEqual([day.homebaseId, day.segments[2]!.placeId].sort())
    expect((await req<{ days: { date: string }[] }>('GET', '/api/gps/days')).json.days.map((d) => d.date)).toEqual([DATE])
  })

  it('names places and re-classifies a day around a hand-picked homebase', async () => {
    const { json: day } = await req<GpsDayDTO>('GET', `/api/gps/day/${DATE}`)
    const shop = day.segments[2]!.placeId!
    await req('PATCH', `/api/gps/places/${shop}`, { name: 'Hardware store' })
    const { json: moved } = await req<GpsDayDTO>('PUT', `/api/gps/day/${DATE}/homebase`, { placeId: shop })
    expect(moved).toMatchObject({ homebaseId: shop, homebaseOverride: true })
    expect(moved.places.find((p) => p.id === shop)!.name).toBe('Hardware store')
    expect(moved.segments[0]!.kind).toBe('B')
    // A rescan of the unchanged file keeps the override; null returns to the overnight guess.
    const { json: back } = await req<GpsDayDTO>('PUT', `/api/gps/day/${DATE}/homebase`, { placeId: null })
    expect(back).toMatchObject({ homebaseId: day.homebaseId, homebaseOverride: false })
  })
})
