import { execFile } from 'node:child_process'
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ASSETS_DIR } from '../db/client.ts'
import { extension } from './content.ts'

const run = promisify(execFile)

/** The packaged app ships its own ffmpeg (electron/main.ts sets this); in development it is the one on PATH. */
const ffmpeg = () => process.env.LOGCADENCE_FFMPEG || 'ffmpeg'

/**
 * Whether a gif has more than one frame: walks its blocks (header, color tables, extensions, image descriptors)
 * without decoding them. Unreadable data counts as not animated.
 */
export function isAnimatedGif(b: Buffer): boolean {
  if (b.length < 13 || b.toString('latin1', 0, 3) !== 'GIF') return false
  const skipTable = (flags: number) => (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0)
  const skipSubBlocks = (i: number) => {
    while (i < b.length && b[i]! > 0) i += b[i]! + 1
    return i + 1
  }
  let i = 13 + skipTable(b[10]!)
  let frames = 0
  while (i < b.length) {
    const block = b[i]!
    if (block === 0x2c) {
      if (++frames > 1) return true
      i = skipSubBlocks(i + 10 + skipTable(b[i + 9] ?? 0) + 1) // descriptor, local table, LZW code size, data
    } else if (block === 0x21) i = skipSubBlocks(i + 2)
    else break // 0x3b trailer, or garbage
  }
  return false
}

/**
 * An animated gif as an H.264 mp4: every frame at its own delay, padded to even dimensions (yuv420p needs them),
 * `faststart` so it plays before it has fully loaded. Typically a tenth of the gif's size or less.
 */
export async function gifToMp4(src: string, dest: string): Promise<void> {
  const part = `${dest}.part`
  try {
    await run(
      ffmpeg(),
      ['-v', 'error', '-y', '-i', src, '-map', '0:v', '-fps_mode', 'vfr', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=black',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-f', 'mp4', part],
      { timeout: 10 * 60_000, windowsHide: true },
    )
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

/**
 * An uploaded image or video, saved under assets/ as `<id>.<ext>`. An animated gif is stored as an mp4 instead
 * (the galleries and the board play it muted and looping, like a gif); without ffmpeg, or when it can't read
 * the gif, the gif is kept as it is.
 */
export async function saveUpload(id: string, file: File): Promise<{ file: string; mime: string }> {
  const data = Buffer.from(await file.arrayBuffer())
  const name = `${id}.${extension(file)}`
  const target = path.join(ASSETS_DIR, name)
  writeFileSync(target, data)
  if (file.type !== 'image/gif' || !isAnimatedGif(data)) return { file: name, mime: file.type }
  try {
    await gifToMp4(target, path.join(ASSETS_DIR, `${id}.mp4`))
  } catch (err) {
    console.warn(`gif kept as is (${name}): ${err instanceof Error ? err.message : String(err)}`)
    return { file: name, mime: file.type }
  }
  rmSync(target, { force: true })
  return { file: `${id}.mp4`, mime: 'video/mp4' }
}
