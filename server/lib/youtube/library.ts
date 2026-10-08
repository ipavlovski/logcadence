import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { toIsoDate } from '../../../shared/dates.ts'
import { cleanTags, isUnder } from '../../../shared/tags.ts'
import type { ImageDTO, TagInfo, UpdateYtVideoBody, YtImageSection, YtImportResult, YtLibraryDTO, YtPlaylistDTO, YtVideoDTO, YtVideoSummary } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { ytImages, ytPlaylists, ytTags, ytVideos, ytVideoTags } from '../../db/content-schema.ts'
import { imageUrl } from '../content.ts'
import { logEvent } from '../events.ts'
import { bad, notFound } from '../validate.ts'
import { fetchPlaylistApi } from './dataApi.ts'
import { fetchPlaylist, parsePlaylistId, YoutubeError, type ImportProgress, type PlaylistVideo } from './playlist.ts'
import { apiKey } from './settings.ts'
import { downloadThumbs } from './thumbs.ts'

// The YouTube catalog: videos imported from playlists, with notes, comments, images and tags of their own. A
// video's day is when it was added to a playlist: from the Data API when an API key is set, else when an import
// first saw it. Later imports refresh what YouTube shows (title, views…) and can only move that day earlier;
// notes, comments and tags stay. Which playlist a video came from is not kept.

type VideoRow = typeof ytVideos.$inferSelect

/** The active image column of each image section. */
const ACTIVE = { notes: 'activeImageId', comments: 'commentsActiveImageId' } as const

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

/** Videos with images in their notes. */
function withNoteImages(): Set<string> {
  return new Set(
    db
      .selectDistinct({ id: ytImages.videoId })
      .from(ytImages)
      .where(eq(ytImages.section, 'notes'))
      .all()
      .map((r) => r.id),
  )
}

function toSummary(v: VideoRow, tags: string[], hasImages: boolean): YtVideoSummary {
  return {
    id: v.id,
    title: v.title,
    channel: v.channel,
    channelUrl: v.channelUrl,
    channelAvatar: v.channelAvatar,
    duration: v.duration,
    views: v.views,
    published: v.published,
    publishedAt: v.publishedAt,
    thumbUrl: v.thumb ? imageUrl(v.thumb) : null,
    thumbSmallUrl: v.thumbSmall ? imageUrl(v.thumbSmall) : null,
    thumbSize: v.thumbSize,
    addedAt: v.addedAt,
    addedDate: v.addedDate,
    importedAt: v.importedAt,
    tags,
    hasNotes: hasImages || !!v.notes.trim(),
  }
}

export function listPlaylists(): YtPlaylistDTO[] {
  return db
    .select()
    .from(ytPlaylists)
    .orderBy(asc(ytPlaylists.createdAt))
    .all()
    .map((p) => ({ id: p.id, title: p.title, channel: p.channel, count: p.lastImportCount, lastImportAt: p.lastImportAt, lastError: p.lastError, progress: progress.get(p.id) ?? null }))
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

/** Every video, most recently added first (videos imported together without dates: in playlist order). */
export function library(): YtLibraryDTO {
  const tags = tagsByVideo()
  const imgs = withNoteImages()
  const videos = db
    .select()
    .from(ytVideos)
    .orderBy(sql`${ytVideos.addedDate} desc, ${ytVideos.addedAt} desc, rowid asc`)
    .all()
    .map((v) => toSummary(v, tags.get(v.id) ?? [], imgs.has(v.id)))
  return { videos, tags: tagInfos() }
}

export function getVideo(id: string): YtVideoDTO | undefined {
  const v = db.select().from(ytVideos).where(eq(ytVideos.id, id)).get()
  if (!v) return undefined
  const rows = db.select().from(ytImages).where(eq(ytImages.videoId, id)).orderBy(asc(ytImages.position)).all()
  const images = (section: YtImageSection): ImageDTO[] => rows.filter((r) => r.section === section).map((r) => ({ id: r.id, url: imageUrl(r.file), mime: r.mime }))
  const notesImages = images('notes')
  return {
    ...toSummary(v, tagsByVideo([id]).get(id) ?? [], notesImages.length > 0),
    notes: v.notes,
    activeImageId: v.activeImageId,
    images: notesImages,
    comments: v.comments,
    commentsActiveImageId: v.commentsActiveImageId,
    commentImages: images('comments'),
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
  logEvent('yt-video', id, 'delete', { title: before.title, notes: before.notes, comments: before.comments, tags: before.tags, addedAt: before.addedAt })
}

export function addImage(videoId: string, section: YtImageSection, img: { id: string; file: string; mime: string }): { image: ImageDTO; activeImageId: string } {
  const video = db.select().from(ytVideos).where(eq(ytVideos.id, videoId)).get() ?? notFound('video')
  const active = video[ACTIVE[section]]
  const max = db
    .select({ p: sql<number | null>`max(${ytImages.position})` })
    .from(ytImages)
    .where(and(eq(ytImages.videoId, videoId), eq(ytImages.section, section)))
    .get()?.p
  db.transaction(() => {
    db.insert(ytImages)
      .values({ ...img, videoId, section, position: (max ?? 0) + 1, createdAt: Date.now() })
      .run()
    if (!active) db.update(ytVideos).set({ [ACTIVE[section]]: img.id }).where(eq(ytVideos.id, videoId)).run()
  })
  logEvent('yt-image', img.id, 'create', { videoId, section, file: img.file, mime: img.mime })
  return { image: { id: img.id, url: imageUrl(img.file), mime: img.mime }, activeImageId: active ?? img.id }
}

/** New order of a section's images; `ids` must be all of them. */
export function reorderImages(videoId: string, section: YtImageSection, ids: string[]) {
  const current = db
    .select({ id: ytImages.id })
    .from(ytImages)
    .where(and(eq(ytImages.videoId, videoId), eq(ytImages.section, section)))
    .all()
    .map((r) => r.id)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) bad(`ids must list each of the video’s ${section} images once`)
  db.transaction(() => ids.forEach((id, i) => db.update(ytImages).set({ position: i + 1 }).where(eq(ytImages.id, id)).run()))
  logEvent('yt-video', videoId, 'edit', { [`${section}ImageOrder`]: ids })
}

/** Removes an image from its video; the file stays in assets/ (the event keeps the row, for an undo). */
export function deleteImage(id: string): { activeImageId: string | null } {
  const img = db.select().from(ytImages).where(eq(ytImages.id, id)).get() ?? notFound('image')
  const video = db.select().from(ytVideos).where(eq(ytVideos.id, img.videoId)).get()!
  const col = ACTIVE[img.section]
  let activeImageId = video[col]
  db.transaction(() => {
    db.delete(ytImages).where(eq(ytImages.id, id)).run()
    if (activeImageId === id) {
      activeImageId =
        db
          .select({ id: ytImages.id })
          .from(ytImages)
          .where(and(eq(ytImages.videoId, video.id), eq(ytImages.section, img.section)))
          .orderBy(asc(ytImages.position))
          .get()?.id ?? null
      db.update(ytVideos).set({ [col]: activeImageId }).where(eq(ytVideos.id, video.id)).run()
    }
  })
  logEvent('yt-image', id, 'delete', { videoId: video.id, section: img.section, file: img.file, mime: img.mime, position: img.position, createdAt: img.createdAt })
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

interface Fetched {
  id: string
  title: string
  channel: string | null
  /** `addedAt` comes with an API key; `info` is left out for videos the catalog has (Data API only). */
  videos: { id: string; addedAt?: number; info?: PlaylistVideo & { publishedAt?: number | null } }[]
  unavailable: number
  dated: boolean
}

// How far each running import is, for the importer window.
const progress = new Map<string, ImportProgress>()

/** Through the Data API when a key is set (real added dates), else from the playlist page. */
async function fetchAny(id: string, fetchFn?: typeof fetch): Promise<Fetched> {
  const key = apiKey()
  const onProgress = (p: ImportProgress) => progress.set(id, p)
  if (key) {
    const known = new Set(db.select({ id: ytVideos.id }).from(ytVideos).all().map((r) => r.id))
    const knownChannels = new Set(
      db
        .selectDistinct({ id: ytVideos.channelId })
        .from(ytVideos)
        .where(sql`${ytVideos.channelId} is not null and ${ytVideos.channelAvatar} is not null`)
        .all()
        .map((r) => r.id!),
    )
    return { ...(await fetchPlaylistApi(id, key, { fetchFn, known, knownChannels, onProgress })), dated: true }
  }
  const p = await fetchPlaylist(id, { fetchFn, onProgress })
  return { ...p, videos: p.videos.map((v) => ({ id: v.id, info: v })), dated: false }
}

/** Errors that are YouTube's (or the network's) become a message; anything else is a bug and stays one. */
function describeError(err: unknown): string {
  if (err instanceof YoutubeError) return err.message
  if (err instanceof TypeError || (err instanceof Error && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket/i.test(err.message))) return `could not reach YouTube: ${err.message}`
  throw err
}

/** Adds a playlist (by link or id) and imports it. */
export async function addPlaylist(input: string, fetchFn?: typeof fetch): Promise<YtImportResult> {
  const id = parsePlaylistId(input) ?? bad('Paste a playlist link (…/playlist?list=…) or its id')
  const existing = db.select().from(ytPlaylists).where(eq(ytPlaylists.id, id)).get()
  if (existing) return importPlaylist(id, fetchFn)
  let playlist: Fetched
  try {
    playlist = await fetchAny(id, fetchFn)
  } catch (err) {
    bad(describeError(err))
  } finally {
    progress.delete(id)
  }
  db.insert(ytPlaylists).values({ id, title: playlist.title, channel: playlist.channel, createdAt: Date.now() }).onConflictDoNothing().run()
  return store(playlist, fetchFn)
}

/** Playlists being added: their progress, until they are in the list (which happens once they are read). */
export function addingPlaylists(): { id: string; progress: ImportProgress }[] {
  const listed = new Set(db.select({ id: ytPlaylists.id }).from(ytPlaylists).all().map((r) => r.id))
  return [...progress].filter(([id]) => !listed.has(id)).map(([id, p]) => ({ id, progress: p }))
}

/** Stops importing a playlist; its videos stay. */
export function removePlaylist(id: string) {
  db.delete(ytPlaylists).where(eq(ytPlaylists.id, id)).run()
}

// One import per playlist at a time (the background job and a click could overlap).
const running = new Map<string, Promise<YtImportResult>>()

/**
 * Imports the playlist's new videos and refreshes the rest. Failures are recorded on the playlist, not thrown.
 * Nothing is written until the whole playlist is read, so a failed import changes nothing (and costs only the
 * listing, a few MB at most, to run again).
 */
export function importPlaylist(id: string, fetchFn?: typeof fetch): Promise<YtImportResult> {
  const p = db.select().from(ytPlaylists).where(eq(ytPlaylists.id, id)).get() ?? notFound('playlist')
  const pending = running.get(id)
  if (pending) return pending
  const job = fetchAny(id, fetchFn)
    .then(
      (playlist) => store(playlist, fetchFn),
      (err: unknown) => {
        const error = describeError(err)
        db.update(ytPlaylists).set({ lastError: error }).where(eq(ytPlaylists.id, id)).run()
        return { playlistId: id, title: p.title, found: 0, added: 0, redated: 0, unavailable: 0, dated: !!apiKey(), error }
      },
    )
    .finally(() => {
      running.delete(id)
      progress.delete(id)
    })
  running.set(id, job)
  return job
}

export async function importAll(fetchFn?: typeof fetch): Promise<YtImportResult[]> {
  const out: YtImportResult[] = []
  // One after another: YouTube is touchy about bursts.
  for (const p of listPlaylists()) out.push(await importPlaylist(p.id, fetchFn))
  return out
}

/** Writes a fetched playlist: new videos join the catalog; known ones get YouTube's current details. Then thumbnails. */
function store(playlist: Fetched, fetchFn?: typeof fetch): YtImportResult {
  const now = Date.now()
  let added = 0
  let redated = 0
  db.transaction(() => {
    db.update(ytPlaylists)
      .set({ title: playlist.title, channel: playlist.channel, lastImportAt: now, lastImportCount: playlist.videos.length, lastError: null })
      .where(eq(ytPlaylists.id, playlist.id))
      .run()
    const known = new Map(
      db
        .select({ id: ytVideos.id, addedAt: ytVideos.addedAt })
        .from(ytVideos)
        .all()
        .map((r) => [r.id, r.addedAt]),
    )
    // A known channel's avatar and link, for new videos whose channel details weren't fetched again.
    const channels = new Map(
      db
        .select({ id: ytVideos.channelId, avatar: ytVideos.channelAvatar, url: ytVideos.channelUrl })
        .from(ytVideos)
        .where(sql`${ytVideos.channelId} is not null and ${ytVideos.channelAvatar} is not null`)
        .all()
        .map((r) => [r.id!, r]),
    )
    for (const v of playlist.videos) {
      const info = v.info
      const ch = info?.channelId ? channels.get(info.channelId) : undefined
      const details = info && {
        title: info.title,
        channel: info.channel,
        channelUrl: info.channelUrl ?? ch?.url ?? null,
        channelAvatar: info.channelAvatar ?? ch?.avatar ?? null,
        channelId: info.channelId,
        duration: info.duration,
        views: info.views,
        ...(info.published !== null || !info.publishedAt ? { published: info.published } : {}),
        ...(info.publishedAt ? { publishedAt: info.publishedAt } : {}),
      }
      const prev = known.get(v.id)
      if (prev !== undefined) {
        // A real added date replaces an import-time guess (always later), and the earliest playlist wins.
        const addedAt = v.addedAt !== undefined && v.addedAt < prev ? v.addedAt : prev
        if (addedAt !== prev) redated++
        if (!details && addedAt === prev) continue
        db.update(ytVideos)
          .set({ ...details, addedAt, addedDate: toIsoDate(new Date(addedAt)) })
          .where(eq(ytVideos.id, v.id))
          .run()
      } else if (details) {
        const addedAt = v.addedAt ?? now
        // Inserted in playlist order, so the rowid keeps videos imported together (same time) in that order.
        db.insert(ytVideos)
          .values({ id: v.id, ...details, addedAt, addedDate: toIsoDate(new Date(addedAt)), importedAt: now, updatedAt: now })
          .run()
        logEvent('yt-video', v.id, 'create', { title: info!.title, addedAt })
        known.set(v.id, addedAt)
        added++
      }
    }
  })
  downloadThumbs(fetchFn).catch((err: Error) => console.warn(`youtube thumbnails: ${err.message}`))
  return { playlistId: playlist.id, title: playlist.title, found: playlist.videos.length, added, redated, unavailable: playlist.unavailable, dated: playlist.dated, error: null }
}
