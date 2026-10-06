import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { toIsoDate } from '../../../shared/dates.ts'
import { cleanTags, isUnder } from '../../../shared/tags.ts'
import type { ImageDTO, TagInfo, UpdateYtVideoBody, YtImportResult, YtLibraryDTO, YtPlaylistDTO, YtVideoDTO, YtVideoSummary } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { ytImages, ytPlaylists, ytPlaylistVideos, ytTags, ytVideos, ytVideoTags } from '../../db/content-schema.ts'
import { imageUrl } from '../content.ts'
import { logEvent } from '../events.ts'
import { bad, notFound } from '../validate.ts'
import { fetchPlaylist, parsePlaylistId, YoutubeError, type Playlist } from './playlist.ts'

// The YouTube catalog: videos imported from playlists, with notes, images and tags of their own. A video's
// discovery day is when an import first saw it; later imports refresh what YouTube shows (title, views…) but
// keep that day, the notes and the tags.

type VideoRow = typeof ytVideos.$inferSelect

// ── listing ────────────────────────────────────────────────────────────────

function tagsByVideo(ids?: string[]): Map<string, string[]> {
  const rows = db
    .select({ videoId: ytVideoTags.videoId, path: ytTags.path })
    .from(ytVideoTags)
    .innerJoin(ytTags, eq(ytTags.id, ytVideoTags.tagId))
    .where(ids ? inArray(ytVideoTags.videoId, ids) : undefined)
    .orderBy(asc(ytVideoTags.position))
    .all()
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.videoId, [...(map.get(r.videoId) ?? []), r.path])
  return map
}

function playlistsByVideo(ids?: string[]): Map<string, string[]> {
  const rows = db
    .select({ videoId: ytPlaylistVideos.videoId, playlistId: ytPlaylistVideos.playlistId })
    .from(ytPlaylistVideos)
    .where(ids ? inArray(ytPlaylistVideos.videoId, ids) : undefined)
    .all()
  const map = new Map<string, string[]>()
  for (const r of rows) map.set(r.videoId, [...(map.get(r.videoId) ?? []), r.playlistId])
  return map
}

function withImages(): Set<string> {
  return new Set(
    db
      .selectDistinct({ id: ytImages.videoId })
      .from(ytImages)
      .all()
      .map((r) => r.id),
  )
}

function toSummary(v: VideoRow, tags: string[], playlistIds: string[], hasImages: boolean): YtVideoSummary {
  return {
    id: v.id,
    title: v.title,
    channel: v.channel,
    channelUrl: v.channelUrl,
    channelAvatar: v.channelAvatar,
    duration: v.duration,
    views: v.views,
    published: v.published,
    addedAt: v.addedAt,
    addedDate: v.addedDate,
    tags,
    playlistIds,
    hasNotes: hasImages || !!v.notes.trim(),
  }
}

export function listPlaylists(): YtPlaylistDTO[] {
  const counts = new Map(
    db
      .select({ id: ytPlaylistVideos.playlistId, n: sql<number>`count(*)` })
      .from(ytPlaylistVideos)
      .groupBy(ytPlaylistVideos.playlistId)
      .all()
      .map((r) => [r.id, r.n]),
  )
  return db
    .select()
    .from(ytPlaylists)
    .orderBy(asc(ytPlaylists.createdAt))
    .all()
    .map((p) => ({ id: p.id, title: p.title, channel: p.channel, count: counts.get(p.id) ?? 0, lastImportAt: p.lastImportAt, lastError: p.lastError }))
}

export function tagInfos(): TagInfo[] {
  return db
    .select({ path: ytTags.path, active: sql<number>`count(${ytVideoTags.videoId})` })
    .from(ytTags)
    .leftJoin(ytVideoTags, eq(ytVideoTags.tagId, ytTags.id))
    .groupBy(ytTags.id)
    .orderBy(asc(ytTags.path))
    .all()
    .map((t) => ({ ...t, archived: 0 }))
}

/** Every video, newest discovery first (within a day, in the order they were imported). */
export function library(): YtLibraryDTO {
  const tags = tagsByVideo()
  const lists = playlistsByVideo()
  const imgs = withImages()
  const videos = db
    .select()
    .from(ytVideos)
    .orderBy(sql`${ytVideos.addedDate} desc, ${ytVideos.addedAt} desc, rowid asc`)
    .all()
    .map((v) => toSummary(v, tags.get(v.id) ?? [], lists.get(v.id) ?? [], imgs.has(v.id)))
  return { videos, playlists: listPlaylists(), tags: tagInfos() }
}

export function getVideo(id: string): YtVideoDTO | undefined {
  const v = db.select().from(ytVideos).where(eq(ytVideos.id, id)).get()
  if (!v) return undefined
  const images: ImageDTO[] = db
    .select()
    .from(ytImages)
    .where(eq(ytImages.videoId, id))
    .orderBy(asc(ytImages.position))
    .all()
    .map((r) => ({ id: r.id, url: imageUrl(r.file), mime: r.mime }))
  return {
    ...toSummary(v, tagsByVideo([id]).get(id) ?? [], playlistsByVideo([id]).get(id) ?? [], images.length > 0),
    notes: v.notes,
    activeImageId: v.activeImageId,
    images,
  }
}

// ── editing ────────────────────────────────────────────────────────────────

function ensureTag(path: string): number {
  db.insert(ytTags).values({ path, createdAt: Date.now() }).onConflictDoNothing().run()
  return db.select({ id: ytTags.id }).from(ytTags).where(eq(ytTags.path, path)).get()!.id
}

/** Drops tags no video carries any more. */
function pruneTags() {
  db.delete(ytTags)
    .where(sql`${ytTags.id} not in (select ${ytVideoTags.tagId} from ${ytVideoTags})`)
    .run()
}

function setVideoTags(videoId: string, paths: string[]) {
  const clean = cleanTags(paths)
  db.delete(ytVideoTags).where(eq(ytVideoTags.videoId, videoId)).run()
  clean.forEach((p, position) => db.insert(ytVideoTags).values({ videoId, tagId: ensureTag(p), position }).run())
  pruneTags()
}

export function updateVideo(id: string, b: UpdateYtVideoBody): YtVideoDTO {
  db.select({ id: ytVideos.id }).from(ytVideos).where(eq(ytVideos.id, id)).get() ?? notFound('video')
  db.transaction(() => {
    const { tags, ...cols } = b
    db.update(ytVideos)
      .set({ ...cols, updatedAt: Date.now() })
      .where(eq(ytVideos.id, id))
      .run()
    if (tags) setVideoTags(id, tags)
  })
  logEvent('yt-video', id, 'edit', { ...b })
  return getVideo(id)!
}

/** Removes a video from the catalog (it comes back with a later import while it is still in a playlist). */
export function deleteVideo(id: string) {
  const before = getVideo(id) ?? notFound('video')
  db.delete(ytVideos).where(eq(ytVideos.id, id)).run()
  pruneTags()
  logEvent('yt-video', id, 'delete', { title: before.title, notes: before.notes, tags: before.tags, addedDate: before.addedDate })
}

export function addImage(videoId: string, img: { id: string; file: string; mime: string }): { image: ImageDTO; activeImageId: string } {
  const video = db.select().from(ytVideos).where(eq(ytVideos.id, videoId)).get() ?? notFound('video')
  const max = db
    .select({ p: sql<number | null>`max(${ytImages.position})` })
    .from(ytImages)
    .where(eq(ytImages.videoId, videoId))
    .get()?.p
  db.transaction(() => {
    db.insert(ytImages)
      .values({ ...img, videoId, position: (max ?? 0) + 1, createdAt: Date.now() })
      .run()
    if (!video.activeImageId) db.update(ytVideos).set({ activeImageId: img.id }).where(eq(ytVideos.id, videoId)).run()
  })
  logEvent('yt-image', img.id, 'create', { videoId, file: img.file, mime: img.mime })
  return { image: { id: img.id, url: imageUrl(img.file), mime: img.mime }, activeImageId: video.activeImageId ?? img.id }
}

export function reorderImages(videoId: string, ids: string[]) {
  const current = db.select({ id: ytImages.id }).from(ytImages).where(eq(ytImages.videoId, videoId)).all().map((r) => r.id)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) bad('ids must list each of the video’s images once')
  db.transaction(() => ids.forEach((id, i) => db.update(ytImages).set({ position: i + 1 }).where(eq(ytImages.id, id)).run()))
  logEvent('yt-video', videoId, 'edit', { imageOrder: ids })
}

/** Removes an image from its video; the file stays in assets/ (the event keeps the row, for an undo). */
export function deleteImage(id: string): { activeImageId: string | null } {
  const img = db.select().from(ytImages).where(eq(ytImages.id, id)).get() ?? notFound('image')
  const video = db.select().from(ytVideos).where(eq(ytVideos.id, img.videoId)).get()!
  let activeImageId = video.activeImageId
  db.transaction(() => {
    db.delete(ytImages).where(eq(ytImages.id, id)).run()
    if (activeImageId === id) {
      activeImageId = db.select({ id: ytImages.id }).from(ytImages).where(eq(ytImages.videoId, video.id)).orderBy(asc(ytImages.position)).get()?.id ?? null
      db.update(ytVideos).set({ activeImageId }).where(eq(ytVideos.id, video.id)).run()
    }
  })
  logEvent('yt-image', id, 'delete', { videoId: video.id, file: img.file, mime: img.mime, position: img.position, createdAt: img.createdAt })
  return { activeImageId }
}

// ── tags ───────────────────────────────────────────────────────────────────

const subtree = (root: string) => sql`(${ytTags.path} = ${root} or substr(${ytTags.path}, 1, ${root.length + 1}) = ${root + ':'})`

/** Moves `from` and its subtree under `to`; where a target path exists, the tags merge. */
export function moveTag(from: string, to: string) {
  if (from === to) return
  if (isUnder(to, from)) bad('cannot move a tag into its own subtree')
  const rows = db.select().from(ytTags).where(subtree(from)).all()
  if (!rows.length) bad(`tag ${from} not found`)
  db.transaction(() => {
    for (const row of rows) {
      const target = to + row.path.slice(from.length)
      const existing = db.select().from(ytTags).where(eq(ytTags.path, target)).get()
      if (!existing) {
        db.update(ytTags).set({ path: target }).where(eq(ytTags.id, row.id)).run()
        continue
      }
      const already = db.select({ videoId: ytVideoTags.videoId }).from(ytVideoTags).where(eq(ytVideoTags.tagId, existing.id)).all().map((r) => r.videoId)
      if (already.length)
        db.delete(ytVideoTags)
          .where(and(eq(ytVideoTags.tagId, row.id), inArray(ytVideoTags.videoId, already)))
          .run()
      db.update(ytVideoTags).set({ tagId: existing.id }).where(eq(ytVideoTags.tagId, row.id)).run()
      db.delete(ytTags).where(eq(ytTags.id, row.id)).run()
    }
  })
  logEvent('yt-tag', from, 'edit', { to })
}

/** Removes `path` and its subtree from every video. */
export function deleteTag(path: string) {
  db.delete(ytTags).where(subtree(path)).run()
  logEvent('yt-tag', path, 'delete')
}

// ── import ─────────────────────────────────────────────────────────────────

/** Adds a playlist to the catalog (by link or id) and imports it. */
export async function addPlaylist(input: string, fetchFn?: typeof fetch): Promise<YtImportResult> {
  const id = parsePlaylistId(input) ?? bad('Paste a playlist link (…/playlist?list=…) or its id')
  const existing = db.select().from(ytPlaylists).where(eq(ytPlaylists.id, id)).get()
  if (existing) return importPlaylist(id, fetchFn)
  let playlist: Playlist
  try {
    playlist = await fetchPlaylist(id, fetchFn)
  } catch (err) {
    if (err instanceof YoutubeError) bad(err.message)
    throw err
  }
  db.insert(ytPlaylists).values({ id, title: playlist.title, channel: playlist.channel, createdAt: Date.now() }).onConflictDoNothing().run()
  return store(playlist)
}

export function removePlaylist(id: string) {
  db.delete(ytPlaylists).where(eq(ytPlaylists.id, id)).run()
}

// One import per playlist at a time (the background job and a click could overlap).
const running = new Map<string, Promise<YtImportResult>>()

/** Imports the playlist's new videos and refreshes the rest. Failures are recorded on the playlist, not thrown. */
export function importPlaylist(id: string, fetchFn?: typeof fetch): Promise<YtImportResult> {
  const p = db.select().from(ytPlaylists).where(eq(ytPlaylists.id, id)).get() ?? notFound('playlist')
  const pending = running.get(id)
  if (pending) return pending
  const job = fetchPlaylist(id, fetchFn)
    .then(store, (err: Error) => {
      const error = err instanceof YoutubeError ? err.message : `could not reach YouTube: ${err.message}`
      db.update(ytPlaylists).set({ lastError: error }).where(eq(ytPlaylists.id, id)).run()
      return { playlistId: id, title: p.title, found: 0, added: 0, linked: 0, error }
    })
    .finally(() => running.delete(id))
  running.set(id, job)
  return job
}

export async function importAll(fetchFn?: typeof fetch): Promise<YtImportResult[]> {
  const out: YtImportResult[] = []
  // One after another: YouTube is touchy about bursts.
  for (const p of listPlaylists()) out.push(await importPlaylist(p.id, fetchFn))
  return out
}

/** Writes a fetched playlist: new videos are discovered now; known ones get YouTube's current details. */
function store(playlist: Playlist): YtImportResult {
  const now = Date.now()
  const date = toIsoDate(new Date(now))
  let added = 0
  let linked = 0
  db.transaction(() => {
    db.update(ytPlaylists).set({ title: playlist.title, channel: playlist.channel, lastImportAt: now, lastError: null }).where(eq(ytPlaylists.id, playlist.id)).run()
    const known = new Set(
      db
        .select({ id: ytVideos.id })
        .from(ytVideos)
        .where(
          inArray(
            ytVideos.id,
            playlist.videos.map((v) => v.id),
          ),
        )
        .all()
        .map((r) => r.id),
    )
    const inList = new Set(
      db
        .select({ id: ytPlaylistVideos.videoId })
        .from(ytPlaylistVideos)
        .where(eq(ytPlaylistVideos.playlistId, playlist.id))
        .all()
        .map((r) => r.id),
    )
    playlist.videos.forEach((v, position) => {
      const details = { title: v.title, channel: v.channel, channelUrl: v.channelUrl, channelAvatar: v.channelAvatar, duration: v.duration, views: v.views, published: v.published }
      if (known.has(v.id)) db.update(ytVideos).set(details).where(eq(ytVideos.id, v.id)).run()
      else {
        // Imported in playlist order, so the rowid keeps a day's discoveries in that order.
        db.insert(ytVideos)
          .values({ id: v.id, ...details, addedAt: now, addedDate: date, updatedAt: now })
          .run()
        logEvent('yt-video', v.id, 'create', { title: v.title, playlistId: playlist.id })
        added++
      }
      if (inList.has(v.id)) db.update(ytPlaylistVideos).set({ position }).where(and(eq(ytPlaylistVideos.playlistId, playlist.id), eq(ytPlaylistVideos.videoId, v.id))).run()
      else {
        db.insert(ytPlaylistVideos).values({ playlistId: playlist.id, videoId: v.id, position, addedAt: now }).run()
        if (known.has(v.id)) linked++
      }
    })
  })
  return { playlistId: playlist.id, title: playlist.title, found: playlist.videos.length, added, linked, error: null }
}
