import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import path from 'node:path'
import { app } from './app.ts'
import { closeDbs, db } from './db/client.ts'
import { entries } from './db/content-schema.ts'
import { adoptPages } from './lib/captures.ts'
import { flushJournalFiles, refreshMirror } from './lib/journalFiles.ts'

// Starts the API (and, given staticDir, the built web app) plus the background jobs. Shared by the web
// server (server/index.ts) and the desktop app, which runs it inside Electron's main process.

export interface StartOptions {
  port: number
  /** Built web app (vite's dist/) to serve next to the API. */
  staticDir?: string
}

export interface RunningServer {
  port: number
  /** Writes pending journal files, stops the server and closes the databases. */
  stop(): Promise<void>
}

export function startServer({ port, staticDir }: StartOptions): Promise<RunningServer> {
  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir)
    // Built files under static/ have content hashes in their names, so they never change. Everything else (the
    // page itself) must be re-checked, or an updated app keeps showing the old page from the browser cache.
    const onFound = (file: string, c: Context) =>
      c.header('Cache-Control', /[\\/]static[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache')
    app.use('/*', serveStatic({ root, onFound }))
    app.get('*', serveStatic({ path: path.join(root, 'index.html'), onFound }))
  }

  // The markdown mirror is derived from the database: rebuilt when it is missing (e.g. after a data import) or older.
  refreshMirror(() => db.selectDistinct({ date: entries.date }).from(entries).all().map((d) => d.date))

  // Bookmarks of a site that has a handler since (a Marketplace listing) become what the handler makes them.
  const adopted = adoptPages()
  if (adopted) console.log(`bookmarks: ${adopted} page(s) taken by their site's handler`)

  return new Promise((resolve, reject) => {
    // Bound to 127.0.0.1 explicitly: Google Drive's login redirect uses that address, and WSL only
    // forwards a Linux 127.0.0.1 listener to Windows' 127.0.0.1 (an IPv6 "::" one becomes [::1] only).
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
      console.log(`API listening on http://127.0.0.1:${port}`)
      server.off('error', reject)
      let stopped: Promise<void> | undefined
      resolve({
        port,
        stop: () =>
          (stopped ??= new Promise<void>((done) => {
            flushJournalFiles()
            server.close(() => {
              closeDbs()
              done()
            })
            // Open keep-alive connections would hold close() back.
            ;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
          })),
      })
    })
    server.once('error', reject)
  })
}
