import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { UpdateYtVideoBody, YtImageSection } from '../../shared/types.ts'
import { ASSETS_DIR } from '../db/client.ts'
import { extension } from '../lib/content.ts'
import { addImage, addingPlaylists, addPlaylist, deleteImage, deleteTag, deleteVideo, getVideo, importAll, importPlaylist, library, listPlaylists, moveTag, removePlaylist, reorderImages, updateVideo } from '../lib/youtube/library.ts'
import { checkKey } from '../lib/youtube/dataApi.ts'
import { YoutubeError } from '../lib/youtube/playlist.ts'
import { publicSettings, saveSettings } from '../lib/youtube/settings.ts'
import { thumbStatus } from '../lib/youtube/thumbs.ts'
import { normalizeTag } from '../../shared/tags.ts'
import { bad, defined, notFound, obj, optBool, optStr, optStrArr, str } from '../lib/validate.ts'

// Screen recordings are the big ones.
const MAX_UPLOAD = 500 * 1024 * 1024

function parseUpdate(v: unknown): UpdateYtVideoBody {
  const o = obj(v)
  const image = (k: string) => {
    const v = o[k]
    if (v !== undefined && v !== null && typeof v !== 'string') bad(`${k} must be a string or null`)
    return v as string | null | undefined
  }
  return defined({
    notes: optStr(o, 'notes'),
    comments: optStr(o, 'comments'),
    tags: optStrArr(o, 'tags'),
    activeImageId: image('activeImageId'),
    commentsActiveImageId: image('commentsActiveImageId'),
  })
}

const SECTIONS: YtImageSection[] = ['notes', 'comments']
const section = (v: string | undefined): YtImageSection => (SECTIONS.includes(v as YtImageSection) ? (v as YtImageSection) : bad('section must be notes or comments'))

const tagPath = (o: Record<string, unknown>, k: string) => normalizeTag(str(o, k)) || bad(`${k} must be a tag`)


export const youtubeRoutes = new Hono()
  .get('/youtube/library', (c) => c.json(library()))
  .get('/youtube/videos/:id', (c) => c.json(getVideo(c.req.param('id')) ?? notFound('video')))
  .patch('/youtube/videos/:id', validator('json', parseUpdate), (c) => c.json(updateVideo(c.req.param('id'), c.req.valid('json'))))
  .delete('/youtube/videos/:id', (c) => {
    deleteVideo(c.req.param('id'))
    return c.json({ ok: true })
  })
  // Pasted/dropped images, gifs and videos for a video's notes or comments (screenshots, recordings), stored under assets/ like the journal's.
  .post(
    '/youtube/videos/:id/images/:section',
    validator('form', (v) => {
      const file = v.file
      if (!(file instanceof File)) bad('file is required')
      if (!/^(image|video)\//.test(file.type)) bad('only images and videos are supported')
      if (file.size > MAX_UPLOAD) bad('file too large')
      return { file }
    }),
    async (c) => {
      const videoId = c.req.param('id')
      const sec = section(c.req.param('section'))
      getVideo(videoId) ?? notFound('video')
      const { file } = c.req.valid('form')
      const id = randomUUID()
      const name = `${id}.${extension(file)}`
      writeFileSync(path.join(ASSETS_DIR, name), Buffer.from(await file.arrayBuffer()))
      return c.json(addImage(videoId, sec, { id, file: name, mime: file.type }), 201)
    },
  )
  .post(
    '/youtube/videos/:id/images/:section/order',
    validator('json', (v) => ({ ids: optStrArr(obj(v), 'ids') ?? [] })),
    (c) => {
      reorderImages(c.req.param('id'), section(c.req.param('section')), c.req.valid('json').ids)
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
  .get('/youtube/playlists', (c) => c.json({ playlists: listPlaylists(), adding: addingPlaylists(), settings: publicSettings(), thumbs: thumbStatus() }))
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
    validator('json', (v) => {
      const o = obj(v)
      const key = o.apiKey
      if (key !== undefined && key !== null && typeof key !== 'string') bad('apiKey must be a string or null')
      return defined({ auto: optBool(o, 'auto'), apiKey: key === null ? null : (key as string | undefined)?.trim() }) as { auto?: boolean; apiKey?: string | null }
    }),
    async (c) => {
      const { auto, apiKey } = c.req.valid('json')
      // A new key is tried once first, so a typo shows up here rather than at the next import.
      if (apiKey)
        try {
          await checkKey(apiKey)
        } catch (err) {
          if (err instanceof YoutubeError) bad(err.message)
          throw err
        }
      saveSettings({ ...(auto !== undefined && { auto }), ...(apiKey !== undefined && { apiKey: apiKey ?? undefined }) })
      return c.json(publicSettings())
    },
  )
