import type React from 'react'
import { CodeBlock } from 'logcadence'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children, width = 480 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width }}>{children}</div>
)

export const Shell = () => (
  <Frame>
    <CodeBlock lang="sh" highlight="" code={'pnpm i --frozen-lockfile\npnpm db:generate\npnpm dev'} />
  </Frame>
)

export const WithHighlight = () => (
  <Frame>
    <CodeBlock
      lang="ts"
      highlight="today"
      code={"const d = today()\nreturn <JournalDay key={d} date={d} find={find} />"}
    />
  </Frame>
)
