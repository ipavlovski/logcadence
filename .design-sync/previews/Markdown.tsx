import type React from 'react'
import { Markdown } from 'logseq-rewrite'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, maxWidth: 480 }}>{children}</div>
)

const note = `Long run along the river, **14 km** in 1:18. Knee felt *fine* after the first 3 km.
Route notes in [[2026-09-28]], gear list under #health/running.
Strava export: https://www.strava.com/activities/1234567`

const withCode = `Fixed the WSL redirect: bind the API server to \`127.0.0.1\` instead of \`localhost\`.
\`\`\`ts
serve({ fetch: app.fetch, port: 3002, hostname: '127.0.0.1' })
console.log('listening on 3002')
\`\`\`
See [[projects/logseq-rewrite]] for the rest.`

export const Note = () => (
  <Frame>
    <Markdown source={note} />
  </Frame>
)

export const WithCode = () => (
  <Frame>
    <Markdown source={withCode} />
  </Frame>
)

export const FindHighlight = () => (
  <Frame>
    <Markdown source="Coffee with Ana at the corner café — she recommended a new coffee roaster in #lisbon." highlight="coffee" />
  </Frame>
)
