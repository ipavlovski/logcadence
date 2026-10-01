import type React from 'react'
import { TagChip } from 'logseq-rewrite'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children, width }: { children: React.ReactNode; width?: number }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width }}>{children}</div>
)

export const Default = () => (
  <Frame>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <TagChip tag="reading" />
      <TagChip tag="projects/logseq-rewrite" />
      <TagChip tag="health/running" />
    </div>
  </Frame>
)

export const Primary = () => (
  <Frame>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <TagChip tag="travel/lisbon" primary />
      <TagChip tag="food" />
      <TagChip tag="photos" />
    </div>
  </Frame>
)

export const InlineInText = () => (
  <Frame>
    <p style={{ margin: 0, maxWidth: 360 }}>
      Finished the second half of the book — adding it to <TagChip tag="reading" inline /> and the{' '}
      <TagChip tag="books/2026" inline /> list.
    </p>
  </Frame>
)
