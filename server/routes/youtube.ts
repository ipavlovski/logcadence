import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate } from '../../shared/dates.ts'
import type { UpdateYtVideoBody } from '../../shared/types.ts'
import { ASSETS_DIR } from '../db/client.ts'
import { addImage, addPlaylist, deleteImage, deleteTag, deleteVideo, getVideo, importAll, importPlaylist, library, listPlaylists, moveTag, removePlaylist, reorderImages, updateVideo } from '../lib/youtube/library.ts'
import { loadSettings, saveSettings } from '../lib/youtube/settings.ts'
import { normalizeTag } from '../../shared/tags.ts'
import { bad, defined, notFound, obj, optBool, optStr, optStrArr, str } from '../lib/validate.ts'

const MAX_UPLOAD = 50 * 1024 * 1024

function parseUpdate(v: unknown): UpdateYtVideoBody {
  const o = obj(v)
  const active = o.activeImageId
  if (active !== undefined && active !== null && typeof active !== 'string') bad('activeImageId must be a string or null')
  const addedDate = optStr(o, 'addedDate')
  if (addedDate !== undefined && !isIsoDate(addedDate)) bad('addedDate must be a YYYY-MM-DD date')
  return defined({ notes: optStr(o, 'notes'), tags: optStrArr(o, 'tags'), addedDate, activeImageId: active as string | null | undefined })
}

const tagPath = (o: Record<string, unknown>, k: string) => normalizeTag(str(o, k)) || bad(`${k} must be a tag`)

function extension(file: File): string {
  const fromName = path.extname(file.name).slice(1).toLowerCase()
  const ext = /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : (file.type.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5)
  return ext || 'bin'
}

export const youtubeRoutes = new Hono()
  .get('/youtube/library', (c) => c.json(library()))
  .get('/youtube/videos/:id', (c) => c.json(getVideo(c.req.param('id')) ?? notFound('video')))
  .patch('/youtube/videos/:id', validator('json', parseUpdate), (c) => c.json(updateVideo(c.req.param('id'), c.req.valid('json'))))
  .delete('/youtube/videos/:id', (c) => {
    deleteVideo(c.req.param('id'))
    return c.json({ ok: true })
  })
  // Pasted/dropped images and gifs for a video's notes, stored under assets/ like the journal's.
  .post(
    '/youtube/videos/:id/images',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (!file.type.startsWith('image/')) bad('only images are supported')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const videoId = c.req.param('id')
      getVideo(videoId) ?? notFound('video')
      const { file } = c.req.valid('form')
      const id = randomUUID()
      const name = `${id}.${extension(file)}`
      writeFileSync(path.join(ASSETS_DIR, name), Buffer.from(await file.arrayBuffer()))
      return c.json(addImage(videoId, { id, file: name, mime: file.type }), 201)
    },
  )
  .post(
    '/youtube/videos/:id/images/order',
    validator('json', (v) => ({ ids: optStrArr(obj(v), 'ids') ?? [] })),
    (c) => {
      reorderImages(c.req.param('id'), c.req.valid('json').ids)
      return c.json({ ok: true })
    },
  )
  .delete('/youtube/images/:id', (c) => c.json(deleteImage(c.req.param('id'))))

  // ── tags (the YouTube tab's own, apart from the journal's) ──
  .post(
    '/youtube/tags/move',
    validator('json', (v) => {
      const o = obj(v)
      return { from: tagPath(o, 'from'), to: tagPath(o, 'to') }
    }),
    (c) => {
      const { from, to } = c.req.valid('json')
      moveTag(from, to)
      return c.json({ ok: true })
    },
  )
  .post(
    '/youtube/tags/delete',
    validator('json', (v) => ({ path: tagPath(obj(v), 'path') })),
    (c) => {
      deleteTag(c.req.valid('json').path)
      return c.json({ ok: true })
    },
  )

  // ── playlists and the importer ──
  .get('/youtube/playlists', (c) => c.json({ playlists: listPlaylists(), settings: loadSettings() }))
  .post(
    '/youtube/playlists',
    validator('json', (v) => ({ url: str(obj(v), 'url') })),
    async (c) => c.json(await addPlaylist(c.req.valid('json').url), 201),
  )
  .delete('/youtube/playlists/:id', (c) => {
    removePlaylist(c.req.param('id'))
    return c.json({ ok: true })
  })
  .post('/youtube/playlists/:id/import', async (c) => c.json(await importPlaylist(c.req.param('id'))))
  .post('/youtube/import', async (c) => c.json({ results: await importAll() }))
  .patch(
    '/youtube/settings',
    validator('json', (v) => defined({ auto: optBool(obj(v), 'auto') })),
    (c) => c.json(saveSettings(c.req.valid('json'))),
  )
