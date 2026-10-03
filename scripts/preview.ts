// Builds the working tree as LogcadenceDev (electron/channel.ts) and (re)starts it on Windows, next to the
// released Logcadence. Usage: pnpm preview  (from WSL, or from a Windows shell)
//
// Version: previews are labelled with the dev build they lead up to (shared/versions.ts): with main at 0.1.0 and
// v0.2.0.2 the last dev build, 0.2.0.3-preview. Nothing is tagged; `pnpm release:dev` does that.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git, out, run, uncommitted } from './lib/run.ts'
import { devSeries, nextDevNumber } from '../shared/versions.ts'

const EXE = 'LogcadenceDev.exe'
const WSL = process.platform === 'linux' && !!out('sh', ['-c', 'command -v wslpath'], { ok: true })
if (process.platform !== 'win32' && !WSL) throw new Error('pnpm preview runs on Windows or in WSL')
// Windows programs run from a WSL folder print a UNC warning: start them from C:.
const winOpts = WSL ? { cwd: '/mnt/c' } : {}

const t0 = Date.now()
const step = (msg: string) => console.log(`\n▸ ${msg}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`)

// ── version ─────────────────────────────────────────────────────────────────

const release = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const series = devSeries(release)
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
const dirty = uncommitted()
const n = nextDevNumber(series, git('tag', '-l').split('\n'))
const label = `${series}.${n}-preview`
console.log(`LogcadenceDev ${label}  (main ${release}, ${branch} @ ${git('rev-parse', '--short', 'HEAD')}${dirty.length ? ` + ${dirty.length} uncommitted change(s)` : ''})`)

// ── build ───────────────────────────────────────────────────────────────────

step('type check')
run('tsc', ['--noEmit'])
step('renderer')
run('vite', ['build', '--logLevel', 'warn'])
step('main process')
run('tsx', ['scripts/build-electron.ts', '--channel', 'dev', '--label', label])
step('package')
run('pnpm', [
  'exec',
  'electron-builder',
  '--win',
  '--dir',
  '--config',
  'electron-builder.dev.yml',
  `-c.extraMetadata.version=${series}-preview.${n}`,
  `-c.buildVersion=${series}.${n}`,
])
const built = path.resolve('release-dev/win-unpacked')

// ── deploy ──────────────────────────────────────────────────────────────────

const localAppData = WSL ? out('wslpath', ['-u', out('cmd.exe', ['/d', '/c', 'echo %LOCALAPPDATA%'], winOpts)]) : process.env.LOCALAPPDATA!
const target = path.join(localAppData, 'Programs', 'LogcadenceDev')
const targetWin = WSL ? out('wslpath', ['-w', target]) : target

const running = () => out('tasklist.exe', ['/FI', `IMAGENAME eq ${EXE}`, '/NH'], winOpts).includes(EXE)
const wasRunning = running()
if (wasRunning) {
  // Without /F, taskkill asks the window to close, so the app quits normally: the activity recorder and the
  // journal mirror are flushed and the databases closed.
  step('closing the running LogcadenceDev')
  out('taskkill.exe', ['/IM', EXE], { ...winOpts, ok: true })
  const deadline = Date.now() + 20_000
  while (running() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500))
  if (running()) {
    console.log('Still running after 20 s: forcing it.')
    out('taskkill.exe', ['/F', '/T', '/IM', EXE], { ...winOpts, ok: true })
    await new Promise((r) => setTimeout(r, 1000))
  }
}

step(`copying to ${targetWin}`)
if (WSL) {
  // Electron's own files only change with its version (and their size with it); the app's are always copied.
  run('rsync', ['-r', '--size-only', '--delete', '--exclude', '/resources/', `${built}/`, `${target}/`])
  run('rsync', ['-r', '--delete', `${built}/resources/`, `${target}/resources/`])
} else {
  const r = out('robocopy', [built, target, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'], { ok: true })
  if (r.includes('ERROR')) throw new Error(r)
}

step(wasRunning ? 'restarting' : 'starting')
// Start menu shortcut, for reopening it without a rebuild (written every time, in case it was removed).
const shortcutScript = (dir: string) => `$s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\LogcadenceDev.lnk")
$s.TargetPath = '${dir}\\${EXE}'; $s.WorkingDirectory = '${dir}'; $s.Description = 'Logcadence dev build (pnpm preview)'; $s.Save()`
run('powershell.exe', ['-NoProfile', '-Command', `${shortcutScript(targetWin)}; Start-Process -FilePath '${targetWin}\\${EXE}'`], winOpts)

step(`LogcadenceDev ${label} is running`)
