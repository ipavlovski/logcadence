import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EntryDTO, ImageDTO } from '../shared/types.ts'

// The db client reads LOGCADENCE_DATA_DIR at import time, so the app is imported after setting it.
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'logcadence-'))
process.env.LOGCADENCE_DATA_DIR = dataDir
let app: typeof import('./app.ts').app
let media: typeof import('./lib/media.ts')

beforeAll(async () => {
  app = (await import('./app.ts')).app
  media = await import('./lib/media.ts')
})
// Databases closed first: Windows can't delete open database files.
afterAll(async () => {
  const { closeDbs } = await import('./db/client.ts')
  closeDbs()
  rmSync(dataDir, { recursive: true, force: true })
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
/** A gif made by ffmpeg: `frames` frames of its test pattern, 33×25 (odd sizes, which an mp4 pads to even). */
function makeGif(frames: number): Buffer {
  const out = path.join(dataDir, `test-${frames}.gif`)
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=33x25:rate=10', '-frames:v', String(frames), out])
  return readFileSync(out)
}
// The classic 1×1 transparent gif.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

async function upload(nodeId: string, name: string, type: string, data: Buffer): Promise<ImageDTO> {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(data)], name, { type }))
  const res = await app.request(`/api/nodes/${nodeId}/images`, { method: 'POST', body: form })
  expect(res.status).toBe(201)
  return ((await res.json()) as { image: ImageDTO }).image
}

async function newNode(date: string): Promise<string> {
  const res = await app.request('/api/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date, title: 'gifs', nodes: [{ content: 'x' }] }) })
  return ((await res.json()) as EntryDTO).nodes[0]!.id
}

describe('isAnimatedGif', () => {
  it('tells one frame from several, and is false for anything else', () => {
    expect(media.isAnimatedGif(PIXEL)).toBe(false)
    expect(media.isAnimatedGif(Buffer.from('not a gif at all'))).toBe(false)
    expect(media.isAnimatedGif(PIXEL.subarray(0, 20))).toBe(false)
  })

  it.skipIf(!hasFfmpeg)('reads ffmpeg-made gifs', () => {
    expect(media.isAnimatedGif(makeGif(1))).toBe(false)
    expect(media.isAnimatedGif(makeGif(3))).toBe(true)
  })
})

describe('gif uploads', () => {
  it.skipIf(!hasFfmpeg)('stores an animated gif as an mp4 with every frame, and drops the gif', async () => {
    const nodeId = await newNode('2026-10-01')
    const img = await upload(nodeId, 'loop.gif', 'image/gif', makeGif(6))
    expect(img).toMatchObject({ mime: 'video/mp4', url: expect.stringMatching(/\.mp4$/) })
    const file = path.join(dataDir, 'assets', img.url.split('/').at(-1)!)
    const probe = execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_name,width,height,nb_read_packets', '-of', 'csv=p=0', file], { encoding: 'utf8' })
    expect(probe.trim()).toBe('h264,34,26,6')
    expect(existsSync(file.replace(/\.mp4$/, '.gif'))).toBe(false)
    const res = await app.request(`/api/journal/2026-10-01`)
    const node = ((await res.json()) as { entries: EntryDTO[] }).entries[0]!.nodes[0]!
    expect(node.images).toMatchObject([{ id: img.id, mime: 'video/mp4' }])
    expect(node.activeImageId).toBe(img.id)
  })

  it('keeps a still gif as a gif', async () => {
    const nodeId = await newNode('2026-10-02')
    expect(await upload(nodeId, 'pixel.gif', 'image/gif', PIXEL)).toMatchObject({ mime: 'image/gif', url: expect.stringMatching(/\.gif$/) })
  })

  it('keeps an animated gif as is without ffmpeg', async () => {
    const nodeId = await newNode('2026-10-03')
    // The pixel's frame twice (its graphic control extension and image), before the trailer.
    const twoFrames = Buffer.concat([PIXEL.subarray(0, -1), PIXEL.subarray(PIXEL.indexOf(0x21), -1), Buffer.from([0x3b])])
    expect(media.isAnimatedGif(twoFrames)).toBe(true)
    process.env.LOGCADENCE_FFMPEG = path.join(dataDir, 'no-such-ffmpeg')
    try {
      const kept = await upload(nodeId, 'loop.gif', 'image/gif', twoFrames)
      expect(kept).toMatchObject({ mime: 'image/gif', url: expect.stringMatching(/\.gif$/) })
      expect(readFileSync(path.join(dataDir, 'assets', kept.url.split('/').at(-1)!))).toEqual(twoFrames)
    } finally {
      delete process.env.LOGCADENCE_FFMPEG
    }
  })
})
