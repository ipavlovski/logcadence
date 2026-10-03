import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GpsDriveResult, GpsDriveStatus } from '../../../shared/types.ts'
import { DATA_DIR } from '../../db/client.ts'
import { isConfigured, isConnected, REDIRECT_URI } from '../gdrive/auth.ts'
import { download, getFolder, listFolder, parseFolderId, type DriveFile } from '../gdrive/drive.ts'
import { bad } from '../validate.ts'
import { GPS_DIR, gpsFileDate, rescanGps } from './scan.ts'

// GPS files from a Google Drive folder (where GPSLogger uploads them) into data/gps/. Automatic imports take the
// files dated on or after the newest day imported so far (lastDate), so the day being recorded is picked up again
// as it grows; older files are imported by hand with a date range. A downloaded file gets Drive's modified time
// as its mtime, so a local copy with the same size and time is known to be current.

const FILE = path.join(DATA_DIR, 'gps-drive.json')

interface Settings {
  folderId?: string
  folderName?: string
  auto?: boolean
  lastDate?: string | null
}

function load(): Settings {
  try {
    return existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Settings) : {}
  } catch {
    return {}
  }
}

const save = (patch: Settings) => writeFileSync(FILE, JSON.stringify({ ...load(), ...patch }, null, 2))

// ── planning ───────────────────────────────────────────────────────────────

export interface RemoteDay extends DriveFile {
  date: string
}

interface LocalFile {
  size: number
  mtimeMs: number
}

function localFiles(): Map<string, LocalFile> {
  const out = new Map<string, LocalFile>()
  let names: string[] = []
  try {
    names = readdirSync(GPS_DIR)
  } catch {
    // no folder yet
  }
  for (const name of names) {
    if (!gpsFileDate(name)) continue
    const st = statSync(path.join(GPS_DIR, name))
    out.set(name, { size: st.size, mtimeMs: st.mtimeMs })
  }
  return out
}

/** One file per day (the most recently modified, should a day have a .zip and a .gpx); other files are ignored. */
export function remoteDays(files: DriveFile[]): RemoteDay[] {
  const byDate = new Map<string, RemoteDay>()
  for (const f of files) {
    const date = gpsFileDate(f.name)
    if (!date) continue
    const prev = byDate.get(date)
    if (!prev || f.modifiedTime > prev.modifiedTime) byDate.set(date, { ...f, date })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

const isCurrent = (f: RemoteDay, local: LocalFile | undefined) => !!local && local.size === f.size && Math.abs(local.mtimeMs - f.modifiedTime) < 2000

/** The files in [from, to] (either end open when null) to download, and how many are already here. */
export function plan(days: RemoteDay[], local: Map<string, LocalFile>, from: string | null, to: string | null) {
  const inRange = days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to))
  const todo = inRange.filter((d) => !isCurrent(d, local.get(d.name)))
  return { inRange, todo, unchanged: inRange.length - todo.length }
}

/** Files before `lastDate` that aren't here (or differ). */
export function olderMissing(days: RemoteDay[], local: Map<string, LocalFile>, lastDate: string | null): GpsDriveResult['older'] {
  if (!lastDate) return null
  const missing = days.filter((d) => d.date < lastDate && !isCurrent(d, local.get(d.name)))
  return missing.length ? { count: missing.length, from: missing[0]!.date, to: missing.at(-1)!.date } : null
}

// ── importing ──────────────────────────────────────────────────────────────

let running: GpsDriveStatus['running'] = null
let progress: GpsDriveStatus['progress'] = null
let lastSync: number | null = null
let lastError: string | null = null
let lastResult: GpsDriveResult | null = null

async function importFiles(from: string | null, to: string | null): Promise<GpsDriveResult> {
  const settings = load()
  if (!settings.folderId) throw new Error('Choose a Google Drive folder first')
  const days = remoteDays(await listFolder(settings.folderId))
  const local = localFiles()
  const { inRange, todo, unchanged } = plan(days, local, from, to)
  const result: GpsDriveResult = { downloaded: 0, unchanged, processed: 0, errors: [], older: null }

  mkdirSync(GPS_DIR, { recursive: true })
  progress = { done: 0, total: todo.length }
  for (const f of todo) {
    try {
      const data = await download(f.id)
      const file = path.join(GPS_DIR, f.name)
      // Written aside and renamed, so a scan never reads half a file.
      writeFileSync(`${file}.part`, data)
      const mtime = new Date(f.modifiedTime)
      utimesSync(`${file}.part`, mtime, mtime)
      renameSync(`${file}.part`, file)
      local.set(f.name, { size: data.length, mtimeMs: f.modifiedTime })
      result.downloaded++
    } catch (err) {
      result.errors.push(`${f.name}: ${(err as Error).message}`)
    }
    progress = { done: progress.done + 1, total: todo.length }
  }

  // Move lastDate up to the newest day now here, never back (a range import of old files leaves it alone).
  const here = inRange.filter((d) => isCurrent(d, local.get(d.name))).at(-1)?.date
  const lastDate = here && (!settings.lastDate || here > settings.lastDate) ? here : (settings.lastDate ?? null)
  if (lastDate !== (settings.lastDate ?? null)) save({ lastDate })

  if (result.downloaded) {
    const scan = await rescanGps()
    result.processed = scan.processed
    result.errors.push(...scan.errors)
  }
  result.older = olderMissing(days, local, lastDate)
  return result
}

function start(mode: 'new' | 'range', from: string | null, to: string | null): Promise<GpsDriveResult> {
  if (running) bad('A GPS import is already running')
  running = mode
  return importFiles(from, to)
    .then(
      (r) => {
        lastResult = r
        lastError = null
        return r
      },
      (err: Error) => {
        lastError = err.message
        throw err
      },
    )
    .finally(() => {
      lastSync = Date.now()
      running = null
      progress = null
    })
}

/** Imports the files dated on or after lastDate. */
export const importNew = () => start('new', load().lastDate ?? null, null)

/** Imports the files dated from..to (inclusive), whatever lastDate is. */
export const importRange = (from: string, to: string) => start('range', from, to)

/** Whether the background job should run an import now. */
export const autoReady = () => !running && isConnected() && !!load().folderId && load().auto !== false

// ── settings ───────────────────────────────────────────────────────────────

export function status(): GpsDriveStatus {
  const s = load()
  return {
    configured: isConfigured(),
    connected: isConnected(),
    redirectUri: REDIRECT_URI,
    folder: s.folderId ? { id: s.folderId, name: s.folderName ?? s.folderId } : null,
    auto: s.auto !== false,
    lastDate: s.lastDate ?? null,
    running,
    progress,
    lastSync,
    error: lastError,
    result: lastResult,
  }
}

/** Picks the Drive folder from a link or ID. The first time, lastDate starts at the newest GPS day already here. */
export async function setFolder(input: string) {
  const id = parseFolderId(input) ?? bad('Paste a Google Drive folder link or ID')
  const folder = await getFolder(id)
  const s = load()
  const newestLocal = [...localFiles().keys()].map((n) => gpsFileDate(n)!).sort().at(-1) ?? null
  save({ folderId: folder.id, folderName: folder.name, lastDate: s.lastDate ?? newestLocal })
  lastResult = null
  return folder
}

export function updateSettings(patch: { auto?: boolean; lastDate?: string | null }) {
  save(patch)
}
