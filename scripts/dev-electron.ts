// Desktop app in development: Vite (renderer, hot reload), esbuild watching electron/ and the server, and Electron
// showing the Vite page. Restart it after main-process changes. Usage: pnpm dev:electron
// A cross-platform script rather than package.json env syntax, since this also runs from Windows shells.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electronBin = createRequire(import.meta.url)('electron') as unknown as string
// Set in terminals spawned by VS Code and other Electron apps; it would make Electron run as plain Node.
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env

const children = [
  spawn('vite', [], { stdio: 'inherit', shell: true }),
  spawn('tsx', ['scripts/build-electron.ts', '--watch'], { stdio: 'inherit', shell: true }),
  spawn(electronBin, ['.'], { stdio: 'inherit', env: { ...env, ELECTRON_DEV_URL: 'http://localhost:5174' } }),
]
const stop = () => children.forEach((c) => c.kill())
children[2]!.on('exit', () => (stop(), process.exit(0)))
process.on('SIGINT', stop)
