import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { app } from './app.ts'
import { closeDbs, db, JOURNALS_DIR } from './db/client.ts'
import { entries } from './db/content-schema.ts'
import { setClaudeWeb, type ClaudeWebClient } from './lib/ai/claudeWeb.ts'
import { flushJournalFiles, touchDates } from './lib/journalFiles.ts'
import { importAll as importYoutube } from './lib/youtube/library.ts'
import { loadSettings as youtubeSettings } from './lib/youtube/settings.ts'
import { downloadThumbs } from './lib/youtube/thumbs.ts'

// Starts the API (and, given staticDir, the built web app) plus the background jobs. Shared by the web
// server (server/index.ts) and the desktop app, which runs it inside Electron's main process.

// YouTube playlists: new videos count as discovered on the day an import sees them, so check a few times a day.
const YOUTUBE_SYNC_MS = 3 * 60 * 60_000

export interface StartOptions {
  port: number
  /** Built web app (vite's dist/) to serve next to the API. */
  staticDir?: string
  /** The claude.ai session the desktop app signs in to; given, the AI scan syncs claude.ai chats. */
  claudeWeb?: ClaudeWebClient
}

export interface RunningServer {
  port: number
  /** Writes pending journal files, stops the server and closes the databases. */
  stop(): Promise<void>
}

export function startServer({ port, staticDir, claudeWeb }: StartOptions): Promise<RunningServer> {
  setClaudeWeb(claudeWeb)
  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir)
    // Built files under static/ have content hashes in their names, so they never change. Everything else (the
    // page itself) must be re-checked, or an updated app keeps showing the old page from the browser cache.
    const onFound = (file: string, c: Context) =>
      c.header('Cache-Control', /[\\/]static[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache')
    app.use('/*', serveStatic({ root, onFound }))
    app.get('*', serveStatic({ path: path.join(root, 'index.html'), onFound }))
  }

  // The markdown mirror is derived from the database: rebuild it when it is missing (e.g. after a data import).
  if (!readdirSync(JOURNALS_DIR).length) {
    const dates = db.selectDistinct({ date: entries.date }).from(entries).all()
    if (dates.length) touchDates(...dates.map((d) => d.date))
  }

  const youtubeTick = () => {
    if (!youtubeSettings().auto) return
    importYoutube().then(
      (rs) => {
        const added = rs.reduce((n, r) => n + r.added, 0)
        if (added) console.log(`youtube: ${added} new video(s)`)
        for (const r of rs) if (r.error) console.warn(`youtube import of ${r.title}: ${r.error}`)
      },
      (err: Error) => console.warn(`youtube import: ${err.message}`),
    )
  }
  const youtubeTimer = setInterval(youtubeTick, YOUTUBE_SYNC_MS)
  youtubeTimer.unref()
  youtubeTick()
  // Thumbnails left over from an interrupted run (app closed, offline), when no import is due to start them.
  if (!youtubeSettings().auto) downloadThumbs().catch((err: Error) => console.warn(`youtube thumbnails: ${err.message}`))

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
            clearInterval(youtubeTimer)
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
