// Imports an export zip (pnpm export:data, or Export in the app) into an empty library folder.
// Usage: pnpm import:data <export.zip> [--data-dir <dir>]   (default: LOGCADENCE_DATA_DIR, else data/)
// Deliberately doesn't open the library's databases itself: the import replaces them.

import path from 'node:path'
import { ROOT } from '../server/db/open.ts'
import { importFrom } from '../server/lib/transfer/import.ts'

const args = process.argv.slice(2)
const flag = args.indexOf('--data-dir')
const dataDir = path.resolve(flag >= 0 ? args[flag + 1]! : (process.env.LOGCADENCE_DATA_DIR ?? path.join(ROOT, 'data')))
const zip = args.find((a, i) => !a.startsWith('--') && i !== flag + 1)
if (!zip) {
  console.error('Usage: pnpm import:data <export.zip> [--data-dir <dir>]')
  process.exit(1)
}

const started = Date.now()
let last = ''
try {
  const { manifest, warnings } = importFrom(zip, {
    dataDir,
    gpsDir: process.env.LOGCADENCE_GPS_DIR,
    onProgress: ({ phase, done, total }) => {
      const line = `${phase} ${done}/${total}`
      if (line !== last) process.stdout.write(`\r${(last = line).padEnd(30)}`)
    },
  })
  for (const w of warnings) console.warn(`\nwarning: ${w}`)
  const rows = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0)
  console.log(`\nimported into ${dataDir}: ${rows} rows, ${manifest.assets.files} assets, ${manifest.gps.files} gps files in ${((Date.now() - started) / 1000).toFixed(0)}s`)
} catch (err) {
  console.error(`\nimport failed: ${(err as Error).message}`)
  process.exit(1)
}
