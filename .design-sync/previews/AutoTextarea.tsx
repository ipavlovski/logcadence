import React from 'react'
import { AutoTextarea } from 'logcadence'

// The app's body paints --bg/--text; the card harness is white, so each story sits on the app surface.
const Frame = ({ children, width = 480 }: { children: React.ReactNode; width?: number }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width }}>{children}</div>
)

// The box style NewEntryDialog gives its note field.
const box: React.CSSProperties = {
  width: '100%',
  resize: 'none',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '6px 8px',
  outline: 'none',
}

const Controlled = ({ initial, placeholder }: { initial: string; placeholder?: string }) => {
  const [v, setV] = React.useState(initial)
  return <AutoTextarea style={box} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
}

export const Empty = () => (
  <Frame>
    <Controlled initial="" placeholder="optional" />
  </Frame>
)

export const GrowsWithContent = () => (
  <Frame>
    <Controlled
      initial={'Booked the train to Porto for Saturday, 9:10 from Santa Apolónia.\nPack: rain jacket, charger, the second notebook.\nAsk Ana about the bookshop near the station.'}
    />
  </Frame>
)
