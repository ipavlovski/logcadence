import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { bin, BIN_MS, dayBounds, partOfDay, sessions, union, type ActivitySpansDTO, type Session, type Span } from '../../../shared/activity.ts'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { journalDateOf, openDate, panesStore } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { clock, duration } from '../Map/kinds.ts'
import styles from './Activity.module.css'

// Days shown in the overview, ending on the journal day.
const OVERVIEW_DAYS = 14
const REFRESH_MS = 60_000

interface Day {
  date: string
  start: number
  end: number
  /** Input ms per 5-minute slot. */
  bins: number[]
  /** Whether each slot was recorded at all (idle vs. computer off or app closed). */
  tracked: boolean[]
  sessions: Session[]
  activeMs: number
  input: Span[]
}

function buildDay(date: string, data: ActivitySpansDTO): Day {
  const [start, end] = dayBounds(date)
  const input = union(data.input, start, end)
  const bins = bin(input, start, end)
  return {
    date,
    start,
    end,
    bins,
    tracked: bin(data.tracked, start, end).map((ms, i) => ms > 0 || bins[i]! > 0),
    sessions: sessions(input, start, end),
    activeMs: bins.reduce((a, b) => a + b, 0),
    input,
  }
}

/** Canvas "Activity" tab: keyboard/mouse activity of the journal day in 5-minute slots, grouped into sessions. */
export function Activity(_: CanvasPluginProps) {
  const date = useStore(panesStore, journalDateOf)
  const isToday = date === today()
  const tick = useTicker(REFRESH_MS)
  const first = shiftDate(date, -(OVERVIEW_DAYS - 1))
  const from = dayBounds(first)[0]
  const to = dayBounds(date)[1]
  const { data, error } = useFetch<ActivitySpansDTO>(`activity|${from}|${to}|${isToday ? tick : 0}`, (signal) =>
    unwrap(api.activity.spans.$get({ query: { from: String(from), to: String(to) } }, { init: { signal } })),
  )

  const days = useMemo(
    () => (data ? Array.from({ length: OVERVIEW_DAYS }, (_, i) => buildDay(shiftDate(first, i), data)).reverse() : []),
    [data, first],
  )
  const day = days[0]?.date === date ? days[0] : undefined
  const anyData = days.some((d) => d.tracked.some(Boolean))

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Activity</h2>
        <span className={styles.muted}>{formatJournalDate(date)}</span>
        {data && (
          <span className={styles.status} title={data.recording ? 'Recording keyboard and mouse activity' : 'Only the desktop app records activity'}>
            <i className={data.recording ? styles.live : ''} /> {data.recording ? 'recording' : 'not recording'}
          </span>
        )}
        <div className={styles.actions}>
          <button onClick={() => openDate(shiftDate(date, -1))} title="Previous day">
            ‹
          </button>
          <button onClick={() => openDate(shiftDate(date, 1))} disabled={isToday} title="Next day">
            ›
          </button>
        </div>
      </header>
      {error ? (
        <p className={styles.empty}>{error.message}</p>
      ) : !data ? (
        <div className={styles.placeholder} />
      ) : !anyData ? (
        <p className={styles.empty}>
          No activity recorded {OVERVIEW_DAYS} days up to {formatJournalDate(date)}. Activity is recorded while the desktop app is running: keyboard and
          mouse input, in 5-minute slots.
        </p>
      ) : (
        <>
          {day && <DayView day={day} />}
          <Overview days={days} />
        </>
      )}
    </div>
  )
}

function DayView({ day }: { day: Day }) {
  const [hover, setHover] = useState<number | null>(null)
  const lane = useRef<HTMLDivElement>(null)
  const laneWidth = useWidth(lane)
  const span = day.end - day.start
  const pct = (t: number) => `${((t - day.start) / span) * 100}%`
  const firstInput = day.input[0]?.startAt
  const lastInput = day.input.at(-1)?.endAt
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
    const d = new Date(day.start)
    d.setHours(h)
    return { h, t: d.getTime() }
  })

  return (
    <>
      <section className={styles.stats}>
        <Stat label="Active" value={duration(day.activeMs)} />
        <Stat label="Sessions" value={String(day.sessions.length)} />
        <Stat label="In sessions" value={duration(day.sessions.reduce((n, s) => n + s.endAt - s.startAt, 0))} />
        <Stat label="First – last input" value={firstInput != null && lastInput != null ? `${clock(firstInput)} – ${clock(lastInput)}` : '—'} />
      </section>

      <section className={styles.chart}>
        <div className={styles.readout}>
          {hover != null ? (
            <>
              <b>
                {clock(day.start + hover * BIN_MS)}–{clock(Math.min(day.end, day.start + (hover + 1) * BIN_MS))}
              </b>{' '}
              {day.tracked[hover] ? `${duration(day.bins[hover]!)} of input` : 'not recorded'}
            </>
          ) : (
            <span className={styles.muted}>Input per 5-minute slot · blank: not recorded</span>
          )}
        </div>
        <div className={styles.bars} style={{ '--n': day.bins.length } as CSSProperties} onMouseLeave={() => setHover(null)}>
          {day.bins.map((ms, i) => (
            <div key={i} className={`${styles.slot} ${day.tracked[i] ? '' : styles.untracked} ${hover === i ? styles.hovered : ''}`} onMouseEnter={() => setHover(i)}>
              {ms > 0 && <span style={{ height: `${Math.max(4, (ms / BIN_MS) * 100)}%` }} />}
            </div>
          ))}
        </div>
        <div className={styles.lane} ref={lane}>
          {day.sessions.map((s) => (
            <SessionBand key={s.startAt} s={s} start={(s.startAt - day.start) / span} size={(s.endAt - s.startAt) / span} laneWidth={laneWidth} />
          ))}
        </div>
        <div className={styles.axis}>
          {ticks.map(({ h, t }) => (
            <span key={h} style={{ left: pct(t) }}>
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </section>

      {day.sessions.length > 0 && (
        <section className={styles.sessions}>
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Time</th>
                <th className={styles.num}>Length</th>
                <th className={styles.num}>Input</th>
              </tr>
            </thead>
            <tbody>
              {day.sessions.map((s) => (
                <tr key={s.startAt}>
                  <td>{partOfDay(s)}</td>
                  <td>
                    {clock(s.startAt)} – {clock(s.endAt)}
                  </td>
                  <td className={styles.num}>{duration(s.endAt - s.startAt)}</td>
                  <td className={styles.num}>
                    {duration(s.activeMs)} <span className={styles.muted}>{Math.round((s.activeMs / (s.endAt - s.startAt)) * 100)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

function SessionBand({ s, start, size, laneWidth }: { s: Session; start: number; size: number; laneWidth: number }) {
  const long = `${partOfDay(s)} · ${duration(s.endAt - s.startAt)}`
  // As much of "Morning · 3 h 05" as fits the band (~7 px per character).
  const px = size * laneWidth - 14
  const label = px >= long.length * 7 ? long : px >= duration(s.endAt - s.startAt).length * 7 ? duration(s.endAt - s.startAt) : ''
  return (
    <span className={styles.band} style={{ left: `${start * 100}%`, width: `${size * 100}%` }} title={`${long} (${clock(s.startAt)} – ${clock(s.endAt)}, ${duration(s.activeMs)} of input)`}>
      <em>{label}</em>
    </span>
  )
}

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

/** One strip per day: slot shade is input time, the line under it the sessions. Click a day to open it. */
function Overview({ days }: { days: Day[] }) {
  return (
    <section className={styles.overview}>
      <h3>Last {days.length} days</h3>
      {days.map((d) => (
        <button key={d.date} className={styles.row} onClick={() => openDate(d.date)} title={`${formatJournalDate(d.date)}: ${duration(d.activeMs)} active`}>
          <span className={styles.rowDate}>
            {weekday(d.date).slice(0, 3)} {d.date.slice(5)}
          </span>
          <span className={styles.strip}>
            <svg viewBox={`0 0 ${d.bins.length} 1`} preserveAspectRatio="none" shapeRendering="crispEdges" aria-hidden>
              {runs(d.tracked).map(([a, b]) => (
                <rect key={`t${a}`} className={styles.tracked} x={a} width={b - a} height={1} />
              ))}
              {d.bins.map((ms, i) => ms > 0 && <rect key={i} x={i} width={1} height={1} fillOpacity={0.2 + 0.8 * (ms / BIN_MS)} />)}
            </svg>
            {d.sessions.map((s) => (
              <u key={s.startAt} style={{ left: `${((s.startAt - d.start) / (d.end - d.start)) * 100}%`, width: `${((s.endAt - s.startAt) / (d.end - d.start)) * 100}%` }} />
            ))}
          </span>
          <span className={styles.rowTotal}>{d.activeMs ? duration(d.activeMs) : ''}</span>
        </button>
      ))}
    </section>
  )
}

/** [start, end) index ranges where `flags` is true. */
function runs(flags: boolean[]): [number, number][] {
  const out: [number, number][] = []
  flags.forEach((f, i) => {
    if (!f) return
    const last = out.at(-1)
    if (last && last[1] === i) last[1] = i + 1
    else out.push([i, i + 1])
  })
  return out
}
