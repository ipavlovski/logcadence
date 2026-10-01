import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'node:path'
import { app } from './app.ts'
import { ROOT } from './db/client.ts'
import { flushJournalFiles } from './lib/journalFiles.ts'
import { isConnected } from './lib/spotify/auth.ts'
import { sync as syncSpotify } from './lib/spotify/spotify.ts'

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

// Spotify history: "recently played" holds only the last 50 plays, so sync well within that.
const SPOTIFY_SYNC_MS = 3 * 60_000
const spotifyTick = () => {
  if (isConnected()) syncSpotify().catch((err: Error) => console.warn(`spotify sync: ${err.message}`))
}
setInterval(spotifyTick, SPOTIFY_SYNC_MS).unref()
spotifyTick()

const port = Number(process.env.PORT ?? 3002)
// Bound to 127.0.0.1 explicitly: Spotify's login redirect must use that address, and WSL only
// forwards a Linux 127.0.0.1 listener to Windows' 127.0.0.1 (an IPv6 "::" one becomes [::1] only).
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`API listening on http://127.0.0.1:${port}`))
