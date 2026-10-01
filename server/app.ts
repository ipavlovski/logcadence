import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import path from 'node:path'
import { ASSETS_DIR } from './db/client.ts'
import { stripReplyPreviews } from './lib/ai/importer.ts'
import { aiRoutes } from './routes/ai.ts'
import { entryRoutes } from './routes/entries.ts'
import { gpsRoutes } from './routes/gps.ts'
import { journalRoutes } from './routes/journal.ts'
import { nodeRoutes } from './routes/nodes.ts'
import { searchRoutes } from './routes/search.ts'
import { spotifyRoutes } from './routes/spotify.ts'
import { tagRoutes } from './routes/tags.ts'

stripReplyPreviews()

export const app = new Hono()
if (process.env.NODE_ENV !== 'test') app.use('/api/*', logger())

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'internal error' }, 500)
})

const routes = app.route('/api', journalRoutes).route('/api', entryRoutes).route('/api', nodeRoutes).route('/api', tagRoutes).route('/api', searchRoutes).route('/api', aiRoutes).route('/api', spotifyRoutes).route('/api', gpsRoutes)
export type AppType = typeof routes

// Asset file names are server-generated uuids and never change, so cache them forever.
app.use(
  '/assets/*',
  serveStatic({
    root: path.relative(process.cwd(), ASSETS_DIR),
    rewriteRequestPath: (p) => {
      const rel = p.slice('/assets'.length)
      return rel.split('/').some((seg) => seg === '..') ? '/__invalid__' : rel
    },
    onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
  }),
)
