import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'node:path'
import { app } from './app.ts'
import { ROOT } from './db/client.ts'
import { flushJournalFiles } from './lib/journalFiles.ts'

if (process.env.NODE_ENV === 'production') {
  const dist = path.relative(process.cwd(), path.join(ROOT, 'dist'))
  app.use('/*', serveStatic({ root: dist }))
  app.get('*', serveStatic({ path: path.join(dist, 'index.html') }))
}

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    flushJournalFiles()
    process.exit(0)
  })

const port = Number(process.env.PORT ?? 3002)
serve({ fetch: app.fetch, port }, () => console.log(`API listening on http://localhost:${port}`))
