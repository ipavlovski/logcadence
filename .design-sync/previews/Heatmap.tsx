import React from 'react'
import { Heatmap } from 'logcadence'

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, width: 820 }}>{children}</div>
)

const END = '2026-10-01'

// Deterministic, realistic-looking daily counts (weekends busier, some empty days).
function counts(seed: number, scale: number): Map<string, number> {
  const m = new Map<string, number>()
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const end = new Date(END + 'T12:00:00Z')
  for (let i = 0; i < 371; i++) {
    const d = new Date(end.getTime() - i * 86400000)
    const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6
    const r = rnd()
    if (r < 0.22) continue
    m.set(d.toISOString().slice(0, 10), Math.round(r * scale * (weekend ? 1.6 : 1)))
  }
  return m
}

const plays = counts(7, 40)
const likes = counts(3, 6)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export const SongsPlayed = () => {
  const [day, setDay] = React.useState<string | null>('2026-09-27')
  return (
    <Frame>
      <Heatmap title="Songs played" tone="green" counts={plays} end={END} describe={(n) => `${plural(n, 'song')} played`} selected={day} onSelect={setDay} />
    </Frame>
  )
}

export const SongsLiked = () => (
  <Frame>
    <Heatmap title="Songs liked" tone="pink" counts={likes} end={END} describe={(n) => `${plural(n, 'song')} liked`} />
  </Frame>
)
