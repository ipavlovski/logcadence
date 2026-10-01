// Writes the library (data/, or LOGCADENCE_DATA_DIR) as an export zip that the desktop app can import.
// Usage: pnpm export:data [out.zip] [--no-assets] [--no-gps]
// Safe while the server runs: the databases are read in one snapshot.

import { createWriteStream } from 'node:fs'
import { today } from '../shared/dates.ts'
import { DATA_DIR, db, eventsDb } from '../server/db/client.ts'
import { GPS_DIR } from '../server/lib/gps/scan.ts'
import { exportTo } from '../server/lib/transfer/export.ts'

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? `logcadence-${today()}.zip`
const started = Date.now()
let last = ''

const manifest = await exportTo(
  createWriteStream(out),
  { db, eventsDb, dataDir: DATA_DIR, gpsDir: GPS_DIR },
  {
    assets: !args.includes('--no-assets'),
    gps: !args.includes('--no-gps'),
    onProgress: ({ phase, done, total }) => {
      const line = `${phase} ${done}/${total}`
      if (line !== last) process.stdout.write(`\r${(last = line).padEnd(30)}`)
    },
  },
)
const rows = Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0)
console.log(`\n${out}: ${rows} rows, ${manifest.assets.files} assets (${(manifest.assets.bytes / 2 ** 30).toFixed(2)} GB), ${manifest.gps.files} gps files in ${((Date.now() - started) / 1000).toFixed(0)}s`)
