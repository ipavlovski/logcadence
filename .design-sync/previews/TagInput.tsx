import React from 'react'
import { TagInput } from 'logseq-rewrite'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children, width = 480 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width }}>{children}</div>
)

// TagInput has no border; the app wraps it in this box (NewEntryDialog .box).
const box: React.CSSProperties = { border: '1px solid var(--border)', background: 'var(--bg)', borderRadius: 'var(--radius)', padding: '6px 8px' }

const Controlled = (props: { initial: string[]; single?: boolean; locked?: string; placeholder?: string; autoFocus?: boolean }) => {
  const [tags, setTags] = React.useState(props.initial)
  return (
    <div style={box}>
      <TagInput value={tags} onChange={setTags} single={props.single} locked={props.locked} placeholder={props.placeholder} autoFocus={props.autoFocus} />
    </div>
  )
}

export const Tags = () => (
  <Frame>
    <Controlled initial={['travel/lisbon', 'food', 'photos']} />
  </Frame>
)

export const Empty = () => (
  <Frame>
    <Controlled initial={[]} placeholder="first tag is primary…" />
  </Frame>
)

export const SinglePicker = () => (
  <Frame>
    <Controlled initial={['reading']} single />
  </Frame>
)

export const LockedSource = () => (
  <Frame>
    <Controlled initial={['ai/claude', 'projects/logseq-rewrite']} locked="ai/claude" />
  </Frame>
)

// Focused: the ★ (make primary) and × (remove) chip buttons appear on hover/focus.
export const Editing = () => (
  <Frame>
    <Controlled initial={['travel/lisbon', 'food', 'photos']} autoFocus />
  </Frame>
)
