import { renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { desc, eq, isNull, sql } from 'drizzle-orm'
import type { YtThumbStatus } from '../../../shared/types.ts'
import { ASSETS_DIR, db } from '../../db/client.ts'
import { ytVideos } from '../../db/content-schema.ts'
import { isRetryableStatus, RetryableError, retryAfter, withRetry } from './http.ts'

// Thumbnails, downloaded once into data/assets so the catalog keeps them (even after a video is removed from YouTube)
// and never fetches them again. Two per video: the largest YouTube has for the video page, and a 480×360 one for
// the grid (decoding thousands of 1280×720 images while scrolling would be heavy). YouTube's largest thumbnail is
// 1280×720 (maxresdefault, made for most HD uploads); there is no 1080p one. WebP comes first: about half the size
// of the JPEG. Downloads run in the background after an import, newest videos first, and pick up where they
// stopped (app closed, offline) at the next import or start.

type Size = 'maxres' | 'sd' | 'hq'

const SOURCES: { size: Size; url: (id: string) => string }[] = [
  { size: 'maxres', url: (id) => `https://i.ytimg.com/vi_webp/${id}/maxresdefault.webp` },
  { size: 'maxres', url: (id) => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
  { size: 'sd', url: (id) => `https://i.ytimg.com/vi_webp/${id}/sddefault.webp` },
  { size: 'sd', url: (id) => `https://i.ytimg.com/vi/${id}/sddefault.jpg` },
  { size: 'hq', url: (id) => `https://i.ytimg.com/vi_webp/${id}/hqdefault.webp` },
  { size: 'hq', url: (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
]
const SMALL = SOURCES.filter((s) => s.size === 'hq')

const CONCURRENCY = 4
// This many videos in a row failing to download (not "YouTube has none") means we're offline: stop until next time.
const GIVE_UP_AFTER = 12

let state = { running: false, done: 0, total: 0, failed: 0, error: null as string | null }

export function thumbStatus(): YtThumbStatus {
  const pending = db.select({ n: sql<number>`count(*)` }).from(ytVideos).where(isNull(ytVideos.thumbSize)).get()?.n ?? 0
  return { ...state, pending }
}

/** The first of `sources` YouTube has; null when it has none of them (all 404). Network trouble throws. */
async function fetchFirst(id: string, sources: typeof SOURCES, fetchFn: typeof fetch): Promise<{ size: Size; ext: string; data: Buffer } | null> {
  for (const s of sources) {
    const got = await withRetry(async () => {
      const res = await fetchFn(s.url(id))
      if (isRetryableStatus(res.status)) throw new RetryableError(`thumbnail: YouTube answered ${res.status}`, retryAfter(res))
      // A missing size is a 404 (with a grey placeholder image as its body).
      if (!res.ok) return null
      const type = res.headers.get('content-type') ?? ''
      const data = Buffer.from(await res.arrayBuffer())
      if (!type.startsWith('image/') || data.length < 1000) return null
      return { size: s.size, ext: type.includes('webp') ? 'webp' : 'jpg', data }
    })
    if (got) return got
  }
  return null
}

/** Written under a temporary name and renamed, so an interrupted download never leaves half a file behind. */
function save(name: string, data: Buffer) {
  const file = path.join(ASSETS_DIR, name)
  writeFileSync(`${file}.part`, data)
  renameSync(`${file}.part`, file)
}

/** Downloads the thumbnails of one video and records them. */
export async function downloadThumb(id: string, fetchFn: typeof fetch = fetch) {
  const big = await fetchFirst(id, SOURCES, fetchFn)
  if (!big) {
    db.update(ytVideos).set({ thumbSize: 'none', thumb: null, thumbSmall: null }).where(eq(ytVideos.id, id)).run()
    return
  }
  const thumb = `yt-${id}.${big.ext}`
  save(thumb, big.data)
  let thumbSmall = thumb
  if (big.size !== 'hq') {
    // Without the small one the grid shows the large one: better than downloading the large one again.
    const small = await fetchFirst(id, SMALL, fetchFn).catch(() => null)
    if (small) save((thumbSmall = `yt-${id}-sm.${small.ext}`), small.data)
  }
  db.update(ytVideos).set({ thumb, thumbSmall, thumbSize: big.size }).where(eq(ytVideos.id, id)).run()
}

let job: Promise<void> | null = null

/** Downloads every missing thumbnail in the background (one run at a time; a call during a run joins it). */
export function downloadThumbs(fetchFn: typeof fetch = fetch): Promise<void> {
  job ??= (async () => {
    state = { running: true, done: 0, total: 0, failed: 0, error: null }
    // Videos imported while this runs (another playlist) join it: it goes on until none is left untried.
    const queued = new Set<string>()
    const ids: string[] = []
    const refill = () => {
      const more = db
        .select({ id: ytVideos.id })
        .from(ytVideos)
        .where(isNull(ytVideos.thumbSize))
        .orderBy(desc(ytVideos.addedAt))
        .all()
        .map((r) => r.id)
        .filter((id) => !queued.has(id))
      for (const id of more) queued.add(id)
      ids.push(...more)
      state.total = ids.length
      return more.length > 0
    }
    let next = 0
    let failedInRow = 0
    const worker = async () => {
      while (failedInRow < GIVE_UP_AFTER && (next < ids.length || refill())) {
        const id = ids[next++]!
        try {
          await downloadThumb(id, fetchFn)
          failedInRow = 0
        } catch (err) {
          state.failed++
          failedInRow++
          state.error = `thumbnail of ${id}: ${(err as Error).message}`
        }
        state.done++
      }
    }
    refill()
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    if (failedInRow >= GIVE_UP_AFTER) state.error = `stopped after ${GIVE_UP_AFTER} failed downloads in a row (offline?); the rest are tried at the next import. Last: ${state.error}`
  })().finally(() => {
    state.running = false
    job = null
  })
  return job
}
