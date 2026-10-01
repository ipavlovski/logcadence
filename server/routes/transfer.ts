import { Hono } from 'hono'
import { PassThrough, Readable } from 'node:stream'
import { today } from '../../shared/dates.ts'
import { DATA_DIR, db, eventsDb } from '../db/client.ts'
import { GPS_DIR } from '../lib/gps/scan.ts'
import { exportTo } from '../lib/transfer/export.ts'

export const transferRoutes = new Hono()
  // The whole library as an export zip (see lib/transfer/format.ts), streamed as a download.
  // ?assets=0 / ?gps=0 leave the media / raw GPS files out.
  .get('/export', (c) => {
    const out = new PassThrough()
    exportTo(out, { db, eventsDb, dataDir: DATA_DIR, gpsDir: GPS_DIR }, { assets: c.req.query('assets') !== '0', gps: c.req.query('gps') !== '0' }).catch((err: Error) =>
      console.error(`export failed: ${err.message}`),
    )
    return new Response(Readable.toWeb(out) as ReadableStream, {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="logcadence-${today()}.zip"`,
      },
    })
  })
