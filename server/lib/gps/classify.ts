import type { GpsKind } from '../../../shared/types.ts'
import type { GpsPoint } from './gpx.ts'

// Turns a day of GPS points into a timeline of stays and movements:
//   A = at the homebase, B = at a place, A->B / B->B / B->A = moving between them,
//   A->A = a round trip from the homebase without stopping, gap = no data.
// Rows tile the whole day, so their durations sum to 24 h.

/** A stay is being within this radius of its centroid... */
export const STAY_RADIUS_M = 120
/** ...for at least this long. */
export const MIN_STAY_MS = 5 * 60_000
/** Points outside the radius for less than this (GPS jitter, a walk to the car) don't end a stay. */
const EXCURSION_MS = 90_000
/** Consecutive stays this close in space and time are one stay. */
const MERGE_GAP_MS = 3 * 60_000
/** No points for longer than this is a gap: the phone was off or had no fix. */
export const GAP_MS = 10 * 60_000
/** Movements and gaps shorter than this are boundary noise (stays absorb the walk inside their radius). */
const BLIP_MS = 60_000
/** Path simplification tolerance. */
const SIMPLIFY_M = 5

export interface Place {
  id: string
  lat: number
  lon: number
}

export interface Stay {
  start: number
  end: number
  lat: number
  lon: number
}

export interface Segment {
  kind: GpsKind
  start: number
  end: number
  /** For A/B: the place stayed at. */
  placeId: string | null
  /** For movements: where they start and end (null when that end is not a known place). */
  fromPlaceId: string | null
  toPlaceId: string | null
  distanceM: number
  /** Movements only: simplified [lon, lat, seconds since day start]. */
  path: [number, number, number][]
}

export interface DayTimeline {
  segments: Segment[]
  homebaseId: string | null
  /** Places first seen on this day, to persist. */
  newPlaces: Place[]
}

// ── geometry ───────────────────────────────────────────────────────────────

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const pathLength = (pts: GpsPoint[]) => pts.reduce((sum, p, i) => (i ? sum + distanceM(pts[i - 1]!, p) : 0), 0)

/** Douglas–Peucker on a local flat projection; keeps the first and last points. */
export function simplify(pts: GpsPoint[], toleranceM = SIMPLIFY_M): GpsPoint[] {
  if (pts.length < 3) return pts
  const lat0 = (pts[0]!.lat * Math.PI) / 180
  const xy = pts.map((p) => [p.lon * 111_320 * Math.cos(lat0), p.lat * 110_540] as const)
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = xy[a]!
    const [bx, by] = xy[b]!
    const len = Math.hypot(bx - ax, by - ay)
    let worst = -1
    let worstD = toleranceM
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay)
      if (d > worstD) {
        worst = i
        worstD = d
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

// ── stays ──────────────────────────────────────────────────────────────────

/** Splits points where the logger was silent for longer than GAP_MS. */
export function splitRuns(points: GpsPoint[]): GpsPoint[][] {
  const runs: GpsPoint[][] = []
  for (const p of points) {
    const run = runs.at(-1)
    if (run && p.t - run.at(-1)!.t <= GAP_MS) run.push(p)
    else runs.push([p])
  }
  return runs
}

/** Stays within one continuous run of points, in time order. */
export function detectStays(run: GpsPoint[]): Stay[] {
  const stays: Stay[] = []
  let i = 0
  while (i < run.length) {
    let lat = run[i]!.lat
    let lon = run[i]!.lon
    let n = 1
    let j = i
    while (j + 1 < run.length) {
      const c = { lat: lat / n, lon: lon / n }
      if (distanceM(c, run[j + 1]!) <= STAY_RADIUS_M) {
        j++
        lat += run[j]!.lat
        lon += run[j]!.lon
        n++
        continue
      }
      // A short excursion: skip it if the track comes back within EXCURSION_MS.
      let k = j + 1
      while (k < run.length && run[k]!.t - run[j]!.t <= EXCURSION_MS && distanceM(c, run[k]!) > STAY_RADIUS_M) k++
      if (k < run.length && run[k]!.t - run[j]!.t <= EXCURSION_MS) {
        j = k
        lat += run[j]!.lat
        lon += run[j]!.lon
        n++
        continue
      }
      break
    }
    if (run[j]!.t - run[i]!.t >= MIN_STAY_MS) {
      stays.push({ start: run[i]!.t, end: run[j]!.t, lat: lat / n, lon: lon / n })
      i = j + 1
    } else i++
  }
  // One stay split in two by a brief wander (or a centroid drift) is still one stay.
  const merged: Stay[] = []
  for (const s of stays) {
    const prev = merged.at(-1)
    if (prev && s.start - prev.end <= MERGE_GAP_MS && distanceM(prev, s) <= STAY_RADIUS_M) {
      const a = prev.end - prev.start || 1
      const b = s.end - s.start || 1
      prev.lat = (prev.lat * a + s.lat * b) / (a + b)
      prev.lon = (prev.lon * a + s.lon * b) / (a + b)
      prev.end = s.end
    } else merged.push({ ...s })
  }
  return merged
}

// ── places & homebase ──────────────────────────────────────────────────────

/** The known place within STAY_RADIUS_M of `pos`, nearest first. */
export function nearestPlace(places: Place[], pos: { lat: number; lon: number }): Place | null {
  let best: Place | null = null
  let bestD = STAY_RADIUS_M
  for (const p of places) {
    const d = distanceM(p, pos)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/** The place slept at: the stay covering 03:00, else the day's longest stay. */
function pickHomebase(stays: { start: number; end: number; placeId: string }[], dayStart: number): string | null {
  const night = dayStart + 3 * 3_600_000
  const overnight = stays.find((s) => s.start <= night && s.end >= night)
  if (overnight) return overnight.placeId
  return [...stays].sort((a, b) => b.end - b.start - (a.end - a.start))[0]?.placeId ?? null
}

// ── timeline ───────────────────────────────────────────────────────────────

export interface ClassifyOptions {
  /** Local midnight that starts the day, epoch ms. */
  dayStart: number
  dayEnd: number
  /** Places known from earlier days. */
  places: Place[]
  /** A homebase chosen by hand for this day (e.g. a hotel when travelling). */
  homebaseId?: string | null
  newId: () => string
}

export function classifyDay(points: GpsPoint[], opts: ClassifyOptions): DayTimeline {
  const { dayStart, dayEnd, newId } = opts
  const places = [...opts.places]
  const newPlaces: Place[] = []
  const placeFor = (s: Stay) => {
    const found = nearestPlace(places, s)
    if (found) return found.id
    const p = { id: newId(), lat: s.lat, lon: s.lon }
    places.push(p)
    newPlaces.push(p)
    return p.id
  }

  const runs = splitRuns(points.filter((p) => p.t >= dayStart && p.t < dayEnd))
  const runStays = runs.map((run) => detectStays(run).map((s) => ({ ...s, placeId: placeFor(s) })))
  const homebaseId = opts.homebaseId ?? pickHomebase(runStays.flat(), dayStart)
  const label = (placeId: string | null) => (placeId && placeId === homebaseId ? 'A' : 'B')
  const endpoint = (p: GpsPoint | undefined) => (p ? (nearestPlace(places, p)?.id ?? null) : null)

  const segments: Segment[] = []
  const gap = (start: number, end: number) => {
    if (end > start) segments.push({ kind: 'gap', start, end, placeId: null, fromPlaceId: null, toPlaceId: null, distanceM: 0, path: [] })
  }
  const move = (pts: GpsPoint[], start: number, end: number, fromId: string | null, toId: string | null) => {
    if (end <= start) return
    const kind = `${label(fromId)}->${label(toId)}` as GpsKind
    segments.push({
      kind,
      start,
      end,
      placeId: null,
      fromPlaceId: fromId,
      toPlaceId: toId,
      distanceM: Math.round(pathLength(pts)),
      path: simplify(pts).map((p) => [round6(p.lon), round6(p.lat), Math.round((p.t - dayStart) / 1000)]),
    })
  }

  let cursor = dayStart
  runs.forEach((run, r) => {
    gap(cursor, run[0]!.t)
    cursor = run[0]!.t
    const stays = runStays[r]!
    let fromId = stays[0] && stays[0].start === run[0]!.t ? null : endpoint(run[0])
    for (const s of stays) {
      if (s.start > cursor) move(between(run, cursor, s.start), cursor, s.start, fromId, s.placeId)
      segments.push({ kind: label(s.placeId), start: s.start, end: s.end, placeId: s.placeId, fromPlaceId: null, toPlaceId: null, distanceM: 0, path: [] })
      cursor = s.end
      fromId = s.placeId
    }
    const last = run.at(-1)!
    // The run ends moving: up to its last point, towards wherever that is.
    if (last.t > cursor) move(between(run, cursor, last.t), cursor, last.t, fromId, endpoint(last))
    cursor = Math.max(cursor, last.t)
  })
  gap(cursor, dayEnd)

  return { segments: mergeAdjacent(segments), homebaseId, newPlaces }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const between = (run: GpsPoint[], start: number, end: number) => run.filter((p) => p.t >= start && p.t <= end)

/**
 * Drops sub-minute movements and gaps into their neighbours (the stays on either side already hold
 * that walk), then joins stays at the same place and consecutive gaps.
 */
function mergeAdjacent(all: Segment[]): Segment[] {
  const segments: Segment[] = []
  for (const s of all) {
    const blip = s.kind !== 'A' && s.kind !== 'B' && s.end - s.start < BLIP_MS
    const prev = segments.at(-1)
    if (blip && prev) prev.end = s.end
    else if (blip) continue
    else {
      // A leading blip was skipped: start where it started.
      if (!prev && s.start > all[0]!.start) s.start = all[0]!.start
      segments.push(s)
    }
  }
  const out: Segment[] = []
  for (const s of segments) {
    const prev = out.at(-1)
    if (prev && s.placeId && prev.placeId === s.placeId && prev.end === s.start) prev.end = s.end
    else if (prev && s.kind === 'gap' && prev.kind === 'gap') prev.end = s.end
    else out.push(s)
  }
  return out
}

/** Total time per kind, in ms. */
export function totals(segments: Pick<Segment, 'kind' | 'start' | 'end'>[]): Record<GpsKind, number> {
  const t: Record<GpsKind, number> = { A: 0, B: 0, 'A->B': 0, 'B->B': 0, 'B->A': 0, 'A->A': 0, gap: 0 }
  for (const s of segments) t[s.kind] += s.end - s.start
  return t
}
