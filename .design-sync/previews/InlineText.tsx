import type React from 'react'
import { InlineText } from 'logseq-rewrite'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children, width = 480 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width }}>{children}</div>
)

export const EntryTitles = () => (
  <Frame>
    <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
      <li><InlineText text="Trip planning for #travel/lisbon" /></li>
      <li><InlineText text="**Ship** the map tab — see [[projects/logseq-rewrite]]" /></li>
      <li><InlineText text="Read chapter 4 of *The Overstory* `p. 112`" /></li>
    </ul>
  </Frame>
)

export const AsHeading = () => (
  <Frame>
    <h3 style={{ margin: 0, fontSize: 15 }}>
      <InlineText text="Weekly review [[2026-09-28]] #review" highlight="review" />
    </h3>
  </Frame>
)
