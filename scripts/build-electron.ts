// Bundles the desktop app's main process (with the server), the import worker and the preload into dist-electron/.
// Usage: tsx scripts/build-electron.ts [--watch] [--channel dev --label 0.2.0.3]
//
// Main and worker are ESM with code splitting, so the server stays in its own chunk that main imports only after
// it knows the library folder. The preload is CommonJS, as sandboxed preloads must be. Packages stay external:
// package.json "dependencies" are exactly what the main process needs at runtime (the renderer's libraries are
// devDependencies, since Vite bundles them into dist/).

import { context, type BuildOptions } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

const args = process.argv.slice(2)
const watch = args.includes('--watch')
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const OUT = 'dist-electron'

// The channel (electron/channel.ts): "dev" builds LogcadenceDev.
const define = { __CHANNEL__: JSON.stringify(arg('--channel') ?? 'release'), __BUILD_LABEL__: JSON.stringify(arg('--label') ?? '') }
const common: BuildOptions = { bundle: true, platform: 'node', target: 'node24', packages: 'external', sourcemap: true, logLevel: 'info', define }
const builds: BuildOptions[] = [
  { ...common, entryPoints: { main: 'electron/main.ts', 'import-worker': 'electron/importWorker.ts' }, outdir: OUT, format: 'esm', splitting: true, chunkNames: 'chunks/[name]-[hash]' },
  { ...common, entryPoints: { preload: 'electron/preload.ts' }, outdir: OUT, format: 'cjs', outExtension: { '.js': '.cjs' } },
]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
copyFileSync('electron/setup.html', `${OUT}/setup.html`)

const contexts = await Promise.all(builds.map((b) => context(b)))
if (watch) await Promise.all(contexts.map((c) => c.watch()))
else {
  await Promise.all(contexts.map((c) => c.rebuild()))
  await Promise.all(contexts.map((c) => c.dispose()))
}
