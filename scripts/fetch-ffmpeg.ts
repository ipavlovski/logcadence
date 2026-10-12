// The Windows ffmpeg the desktop app ships (electron-builder.yml extraResources → resources/ffmpeg/ffmpeg.exe), used
// to turn uploaded gifs into mp4s (server/lib/media.ts). A pinned build, checked against its hash, downloaded once
// into vendor/ffmpeg/ (gitignored): the gyan.dev "essentials" build of ffmpeg 6.1.1 (GPLv3, with libx264), as
// republished by the ffmpeg-static package. Fetched here rather than through that package so a build from WSL
// (pnpm preview) gets the Windows binary too.
// Usage: tsx scripts/fetch-ffmpeg.ts (scripts/build-electron.ts runs it)

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'

const BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const GZ_SHA256 = '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77'
const DIR = 'vendor/ffmpeg'
const EXE = `${DIR}/ffmpeg.exe`
const STAMP = `${DIR}/ffmpeg.exe.sha256` // the archive's hash, so a changed pin downloads again

export async function fetchFfmpeg(): Promise<void> {
  if (existsSync(EXE) && existsSync(STAMP) && readFileSync(STAMP, 'utf8').trim() === GZ_SHA256) return
  console.log(`fetching ffmpeg (${BASE}/ffmpeg-win32-x64.gz)`)
  const res = await fetch(`${BASE}/ffmpeg-win32-x64.gz`)
  if (!res.ok) throw new Error(`ffmpeg download failed: HTTP ${res.status}`)
  const gz = Buffer.from(await res.arrayBuffer())
  const sha = createHash('sha256').update(gz).digest('hex')
  if (sha !== GZ_SHA256) throw new Error(`ffmpeg download has the wrong hash (${sha})`)
  mkdirSync(DIR, { recursive: true })
  writeFileSync(`${EXE}.part`, gunzipSync(gz), { mode: 0o755 })
  renameSync(`${EXE}.part`, EXE)
  writeFileSync(STAMP, `${GZ_SHA256}\n`)
  // Its license, beside it in the app.
  writeFileSync(`${DIR}/LICENSE.txt`, 'FFmpeg 6.1.1 (https://www.gyan.dev/ffmpeg/builds/, essentials build), licensed under the GNU GPL v3.\nSource: https://ffmpeg.org/download.html\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await fetchFfmpeg()
