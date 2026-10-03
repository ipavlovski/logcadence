// Computer activity: the recorder (server/lib/activity.ts) stores spans of keyboard/mouse input; the
// Activity tab bins them into 5-minute slots and groups them into usage sessions. All times are epoch ms.

export interface Span {
  startAt: number
  endAt: number
}

export interface ActivitySpansDTO {
  /** Keyboard/mouse input, merged across devices. */
  input: Span[]
  /** When a recorder was running with the machine awake. */
  tracked: Span[]
  /** Whether this server is recording right now (only the desktop app can). */
  recording: boolean
}

export const BIN_MS = 5 * 60_000
/** Pauses shorter than this stay inside one session (a coffee, a call). */
export const SESSION_GAP_MS = 20 * 60_000
/** Sessions with less input than this are dropped (checking something in passing). */
export const MIN_SESSION_MS = 10 * 60_000

/** Sorted, non-overlapping spans clipped to [from, to); touching spans are joined. */
export function union(spans: Span[], from = -Infinity, to = Infinity): Span[] {
  const out: Span[] = []
  const sorted = spans
    .map((s) => ({ startAt: Math.max(s.startAt, from), endAt: Math.min(s.endAt, to) }))
    .filter((s) => s.endAt > s.startAt)
    .sort((a, b) => a.startAt - b.startAt)
  for (const s of sorted) {
    const last = out.at(-1)
    if (last && s.startAt <= last.endAt) last.endAt = Math.max(last.endAt, s.endAt)
    else out.push({ ...s })
  }
  return out
}

/** Milliseconds covered by `spans` in each `binMs` slot of [from, to). */
export function bin(spans: Span[], from: number, to: number, binMs = BIN_MS): number[] {
  const bins = new Array<number>(Math.ceil((to - from) / binMs)).fill(0)
  for (const s of union(spans, from, to)) {
    for (let i = Math.floor((s.startAt - from) / binMs); i < bins.length; i++) {
      const b0 = from + i * binMs
      if (b0 >= s.endAt) break
      bins[i]! += Math.min(s.endAt, b0 + binMs) - Math.max(s.startAt, b0)
    }
  }
  return bins
}

export interface Session {
  startAt: number
  endAt: number
  /** Input time within the session (the rest is pauses). */
  activeMs: number
}

/** Input spans grouped into sessions: pauses under `gapMs` join them, sessions under `minActiveMs` of input are dropped. */
export function sessions(spans: Span[], from: number, to: number, { gapMs = SESSION_GAP_MS, minActiveMs = MIN_SESSION_MS } = {}): Session[] {
  const out: Session[] = []
  for (const s of union(spans, from, to)) {
    const last = out.at(-1)
    if (last && s.startAt - last.endAt < gapMs) {
      last.endAt = s.endAt
      last.activeMs += s.endAt - s.startAt
    } else out.push({ ...s, activeMs: s.endAt - s.startAt })
  }
  return out.filter((s) => s.activeMs >= minActiveMs)
}

export type PartOfDay = 'Night' | 'Morning' | 'Afternoon' | 'Evening'

/** Local part of the day a session belongs to, by its midpoint. */
export function partOfDay(s: Span): PartOfDay {
  const h = new Date((s.startAt + s.endAt) / 2).getHours()
  return h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 22 ? 'Evening' : 'Night'
}

/** Local midnight of a YYYY-MM-DD day and of the next one (23 or 25 hours apart across DST changes). */
export function dayBounds(iso: string): [number, number] {
  const start = new Date(iso + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return [start.getTime(), end.getTime()]
}
