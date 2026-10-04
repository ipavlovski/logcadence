import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm'
import type { GpsDayDTO, GpsKind, GpsPlaceDTO } from '../../../shared/types.ts'
import { DATA_DIR, db } from '../../db/client.ts'
import { gpsDays, gpsPlaces, gpsSegments, gpsTrips } from '../../db/content-schema.ts'
import { bad, notFound } from '../validate.ts'
import { withZip } from '../zip.ts'
import { classifyDay, totals } from './classify.ts'
import { parseGpx } from './gpx.ts'

// GPS files land in data/gps/, dropped by hand or imported from Google Drive (./drive.ts): one file per
// day named YYYYMMDD(.zip|.gpx), as GPSLogger writes them. Each changed file is classified once.

export const GPS_DIR = process.env.LOGCADENCE_GPS_DIR ? path.resolve(process.env.LOGCADENCE_GPS_DIR) : path.join(DATA_DIR, 'gps')

/** The day a GPS file covers, from its name; null for other files. */
export function gpsFileDate(name: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})\.(zip|gpx)$/i.exec(name)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface SourceFile {
  date: string
  file: string
  stamp: string
}

function sourceFiles(): SourceFile[] {
  let names: string[]
  try {
    names = readdirSync(GPS_DIR)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const date = gpsFileDate(name)
    if (!date) return []
    const file = path.join(GPS_DIR, name)
    const st = statSync(file)
    return [{ date, file, stamp: `${Math.round(st.mtimeMs)}:${st.size}` }]
  })
}

function readGpx(file: string): string {
  if (!file.toLowerCase().endsWith('.zip')) return readFileSync(file, 'utf8')
  return withZip(file, (members) => {
    const gpx = members.find((m) => m.name.toLowerCase().endsWith('.gpx'))
    if (!gpx) throw new Error(`${path.basename(file)}: no .gpx inside`)
    return gpx.read().toString('utf8')
  })
}

/** Classifies one day's file and replaces its timeline. `homebaseId` undefined keeps an earlier override. */
function processDay(src: SourceFile, homebaseId?: string | null) {
  const { points, offset } = parseGpx(readGpx(src.file))
  const dayStart = Date.parse(`${src.date}T00:00:00${offset}`)
  const prev = db.select().from(gpsDays).where(eq(gpsDays.date, src.date)).get()
  const override = homebaseId !== undefined ? homebaseId : prev?.homebaseOverride ? prev.homebaseId : null
  const places = db.select({ id: gpsPlaces.id, lat: gpsPlaces.lat, lon: gpsPlaces.lon }).from(gpsPlaces).all()
  const day = classifyDay(points, { dayStart, dayEnd: dayStart + 86_400_000, places, homebaseId: override, newId: randomUUID })
  const now = Date.now()

  db.transaction(() => {
    for (const p of day.newPlaces) db.insert(gpsPlaces).values({ ...p, name: null, createdAt: now }).run()
    const row = { sourceStamp: src.stamp, dayStart, homebaseId: day.homebaseId, homebaseOverride: !!override, pointCount: points.length, processedAt: now }
    db.insert(gpsDays)
      .values({ date: src.date, ...row })
      .onConflictDoUpdate({ target: gpsDays.date, set: row })
      .run()
    db.delete(gpsSegments).where(eq(gpsSegments.date, src.date)).run()
    day.segments.forEach((s, idx) =>
      db
        .insert(gpsSegments)
        .values({ date: src.date, idx, kind: s.kind, startAt: s.start, endAt: s.end, placeId: s.placeId, fromPlaceId: s.fromPlaceId, toPlaceId: s.toPlaceId, distanceM: s.distanceM, path: s.path })
        .run(),
    )
  })
}

let scanning: Promise<{ processed: number; unchanged: number; errors: string[] }> | null = null

/** Processes new and changed day files, oldest first so places are numbered in order. Concurrent calls share one run. */
export function scanGps() {
  return (scanning ??= (async () => {
    const known = new Map(db.select({ date: gpsDays.date, stamp: gpsDays.sourceStamp }).from(gpsDays).all().map((d) => [d.date, d.stamp]))
    const result = { processed: 0, unchanged: 0, errors: [] as string[] }
    for (const src of sourceFiles().sort((a, b) => a.date.localeCompare(b.date))) {
      if (known.get(src.date) === src.stamp) {
        result.unchanged++
        continue
      }
      try {
        processDay(src)
        result.processed++
      } catch (err) {
        result.errors.push(`${path.basename(src.file)}: ${(err as Error).message}`)
      }
      // A day takes ~0.1 s; let requests through between days.
      await new Promise((r) => setImmediate(r))
    }
    return result
  })().finally(() => (scanning = null)))
}

/** Like scanGps, but a scan already running (which may have listed the folder too early) is waited out first. */
export async function rescanGps() {
  await scanning?.catch(() => {})
  return scanGps()
}

// ── queries ────────────────────────────────────────────────────────────────

export function listDays(): { date: string; totals: Record<GpsKind, number> }[] {
  const segs = db.select({ date: gpsSegments.date, kind: gpsSegments.kind, start: gpsSegments.startAt, end: gpsSegments.endAt }).from(gpsSegments).all()
  const byDate = new Map<string, { kind: GpsKind; start: number; end: number }[]>()
  for (const s of segs) byDate.set(s.date, [...(byDate.get(s.date) ?? []), { ...s, kind: s.kind as GpsKind }])
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, totals: totals(list) }))
}

export function getDay(date: string): GpsDayDTO | null {
  const day = db.select().from(gpsDays).where(eq(gpsDays.date, date)).get()
  if (!day) return null
  const rows = db.select().from(gpsSegments).where(eq(gpsSegments.date, date)).orderBy(asc(gpsSegments.idx)).all()
  const segments = rows.map((r) => ({
    kind: r.kind as GpsKind,
    start: r.startAt,
    end: r.endAt,
    placeId: r.placeId,
    fromPlaceId: r.fromPlaceId,
    toPlaceId: r.toPlaceId,
    distanceM: r.distanceM,
    path: r.path,
  }))
  const ids = [...new Set(segments.flatMap((s) => [s.placeId, s.fromPlaceId, s.toPlaceId]).concat(day.homebaseId).filter((x): x is string => !!x))]
  const places: GpsPlaceDTO[] = ids.length
    ? db.select({ id: gpsPlaces.id, lat: gpsPlaces.lat, lon: gpsPlaces.lon, name: gpsPlaces.name }).from(gpsPlaces).where(inArray(gpsPlaces.id, ids)).all()
    : []
  return {
    date,
    dayStart: day.dayStart,
    homebaseId: day.homebaseId,
    homebaseOverride: day.homebaseOverride,
    pointCount: day.pointCount,
    segments,
    places,
    trips: db
      .select({ id: gpsTrips.id, start: gpsTrips.startAt, end: gpsTrips.endAt })
      .from(gpsTrips)
      .where(eq(gpsTrips.date, date))
      .orderBy(asc(gpsTrips.startAt))
      .all(),
    totals: totals(segments),
  }
}

export function renamePlace(id: string, name: string | null) {
  const res = db.update(gpsPlaces).set({ name }).where(eq(gpsPlaces.id, id)).run()
  if (!res.changes) notFound('place')
}

/** Sets (or clears, with null) the day's homebase by hand and re-classifies the day. */
export function setHomebase(date: string, placeId: string | null) {
  const src = sourceFiles().find((s) => s.date === date) ?? notFound('GPS file for that day')
  if (placeId && !db.select().from(gpsPlaces).where(eq(gpsPlaces.id, placeId)).get()) bad('unknown place')
  processDay(src, placeId)
}

/** Groups the stretch start–end of a day into a trip; trips it overlaps are merged into it. */
export function addTrip(date: string, start: number, end: number) {
  if (!db.select().from(gpsDays).where(eq(gpsDays.date, date)).get()) notFound('GPS day')
  db.transaction((tx) => {
    const overlap = and(eq(gpsTrips.date, date), lt(gpsTrips.startAt, end), gt(gpsTrips.endAt, start))
    for (const t of tx.select().from(gpsTrips).where(overlap).all()) {
      start = Math.min(start, t.startAt)
      end = Math.max(end, t.endAt)
    }
    tx.delete(gpsTrips).where(overlap).run()
    tx.insert(gpsTrips).values({ id: randomUUID(), date, startAt: start, endAt: end, createdAt: Date.now() }).run()
  })
}

export function deleteTrip(date: string, id: string) {
  const res = db.delete(gpsTrips).where(and(eq(gpsTrips.date, date), eq(gpsTrips.id, id))).run()
  if (!res.changes) notFound('trip')
}
