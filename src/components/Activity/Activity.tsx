import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { bin, BIN_MS, dayBounds, partOfDay, sessions, union, type ActivitySpansDTO, type Session, type Span } from '../../../shared/activity.ts'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { useCanvasDay } from '../../state/canvasDay.ts'
import { clock, duration } from '../Map/kinds.ts'
import styles from './Activity.module.css'

// Days shown in the overview, ending on the day shown.
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

/** Canvas "Activity" tab: keyboard/mouse activity of a day in 5-minute slots, grouped into sessions. The day is the canvas's own, or the journal's (ctrl+l). */
export function Activity(_: CanvasPluginProps) {
  const [date, setDate] = useCanvasDay()
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
          <button onClick={() => setDate(shiftDate(date, -1))} title="Previous day">
            ‹
          </button>
          <button onClick={() => setDate(shiftDate(date, 1))} disabled={isToday} title="Next day">
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
          <Overview days={days} onDate={setDate} />
        </>
      )}
    </div>
  )
}

function DayView({ day }: { day: Day }) {
  // The zoomed session, by its start (the live session's end moves on every refresh).
  const [zoomAt, setZoomAt] = useState<number | null>(null)
  const zoom = day.sessions.find((s) => s.startAt === zoomAt)
  const toggleZoom = (s: Session) => setZoomAt(s.startAt === zoom?.startAt ? null : s.startAt)
  const firstInput = day.input[0]?.startAt
  const lastInput = day.input.at(-1)?.endAt

  return (
    <>
      <section className={styles.stats}>
        <Stat label="Active" value={duration(day.activeMs)} />
        <Stat label="Sessions" value={String(day.sessions.length)} />
        <Stat label="In sessions" value={duration(day.sessions.reduce((n, s) => n + s.endAt - s.startAt, 0))} />
        <Stat label="First – last input" value={firstInput != null && lastInput != null ? `${clock(firstInput)} – ${clock(lastInput)}` : '—'} />
      </section>

      <Chart key={zoom?.startAt ?? 'day'} day={day} zoom={zoom} onBand={toggleZoom} onUnzoom={() => setZoomAt(null)} />

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
                <tr key={s.startAt} className={s.startAt === zoom?.startAt ? styles.zoomed : ''} onClick={() => toggleZoom(s)} title="Zoom into this session">

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

/** Slots a zoomed view fits across the chart's width (4 hours); longer sessions scroll sideways. */
const ZOOM_BINS = 48
/** Narrowest a zoomed slot gets: two slots (one 10-minute mark) leave the slanted labels clear of each other; narrower panes scroll. */
const ZOOM_SLOT_PX = 9

/** Slot range [i0, i1) of a zoomed session: the session plus a slot either side, widened around it to at least ZOOM_BINS. */
function zoomRange(day: Day, s: Session): [number, number] {
  const n = day.bins.length
  let i0 = Math.max(0, Math.floor((s.startAt - day.start) / BIN_MS) - 1)
  let i1 = Math.min(n, Math.ceil((s.endAt - day.start) / BIN_MS) + 1)
  const short = ZOOM_BINS - (i1 - i0)
  if (short > 0) {
    i0 = Math.max(0, i0 - Math.floor(short / 2))
    i1 = Math.min(n, i0 + ZOOM_BINS)
    i0 = Math.max(0, i1 - ZOOM_BINS)
  }
  return [i0, i1]
}

/** Bars, session lane and time axis of the whole day, or of the slots around one session (`zoom`). */
function Chart({ day, zoom, onBand, onUnzoom }: { day: Day; zoom?: Session; onBand: (s: Session) => void; onUnzoom: () => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const lane = useRef<HTMLDivElement>(null)
  const laneWidth = useWidth(lane)
  const [i0, i1] = zoom ? zoomRange(day, zoom) : [0, day.bins.length]
  const from = day.start + i0 * BIN_MS
  const to = Math.min(day.end, day.start + i1 * BIN_MS)
  const frac = (t: number) => (Math.min(to, Math.max(from, t)) - from) / (to - from)
  const ticks: { t: number; label: string; hour?: boolean }[] = zoom
    ? // Every 10 minutes, slanted; labels end at their mark, so none within two slots of the left edge where it'd be cut off.
      Array.from({ length: i1 - i0 - 2 }, (_, k) => day.start + (i0 + k + 2) * BIN_MS)
        .filter((t) => new Date(t).getMinutes() % 10 === 0)
        .map((t) => ({ t, label: clock(t), hour: new Date(t).getMinutes() === 0 }))
    : [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
        const d = new Date(day.start)
        d.setHours(h)
        return { t: d.getTime(), label: String(h).padStart(2, '0') }
      })

  return (
    <section className={styles.chart}>
      <div className={styles.readout}>
        {zoom && (
          <button className={styles.unzoom} onClick={onUnzoom} title="Back to the whole day">
            ‹ Day
          </button>
        )}
        {hover != null ? (
          <span>
            <b>
              {clock(day.start + hover * BIN_MS)}–{clock(Math.min(day.end, day.start + (hover + 1) * BIN_MS))}
            </b>{' '}
            {day.tracked[hover] ? `${duration(day.bins[hover]!)} of input` : 'not recorded'}
          </span>
        ) : zoom ? (
          <span>
            <b>
              {partOfDay(zoom)} {clock(zoom.startAt)} – {clock(zoom.endAt)}
            </b>{' '}
            {duration(zoom.activeMs)} of input in {duration(zoom.endAt - zoom.startAt)}
          </span>
        ) : (
          <span className={styles.muted}>Input per 5-minute slot · blank: not recorded · click a session to zoom in</span>
        )}
      </div>
      <div className={zoom ? styles.scroll : ''}>
        <div style={zoom ? { width: `${(Math.max(ZOOM_BINS, i1 - i0) / ZOOM_BINS) * 100}%`, minWidth: (i1 - i0) * ZOOM_SLOT_PX } : undefined}>
          <div className={styles.bars} style={{ '--n': i1 - i0 } as CSSProperties} onMouseLeave={() => setHover(null)}>
            {day.bins.slice(i0, i1).map((ms, k) => {
              const i = i0 + k
              return (
                <div key={i} className={`${styles.slot} ${day.tracked[i] ? '' : styles.untracked} ${hover === i ? styles.hovered : ''}`} onMouseEnter={() => setHover(i)}>
                  {ms > 0 && <span style={{ height: `${Math.max(4, (ms / BIN_MS) * 100)}%` }} />}
                </div>
              )
            })}
          </div>
          <div className={`${styles.axis} ${zoom ? styles.slanted : ''}`}>
            {ticks.map(({ t, label, hour }) => (
              <Fragment key={t}>
                {zoom && <i className={hour ? styles.hour : ''} style={{ left: `${frac(t) * 100}%` }} />}
                <span className={`${t === from ? styles.edge : ''} ${hour ? styles.hour : ''}`} style={{ left: `${frac(t) * 100}%` }}>
                  {label}
                </span>
              </Fragment>
            ))}
          </div>
          <div className={styles.lane} ref={lane}>
            {day.sessions
              .filter((s) => s.endAt > from && s.startAt < to)
              .map((s) => (
                <SessionBand
                  key={s.startAt}
                  s={s}
                  start={frac(s.startAt)}
                  size={frac(s.endAt) - frac(s.startAt)}
                  laneWidth={laneWidth}
                  zoomed={s.startAt === zoom?.startAt}
                  onClick={() => onBand(s)}
                />
              ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function SessionBand({ s, start, size, laneWidth, zoomed, onClick }: { s: Session; start: number; size: number; laneWidth: number; zoomed: boolean; onClick: () => void }) {
  const long = `${partOfDay(s)} · ${duration(s.endAt - s.startAt)}`
  // As much of "Morning · 3 h 05" as fits the band (~7 px per character).
  const px = size * laneWidth - 14
  const label = px >= long.length * 7 ? long : px >= duration(s.endAt - s.startAt).length * 7 ? duration(s.endAt - s.startAt) : ''
  return (
    <button
      className={`${styles.band} ${zoomed ? styles.zoomed : ''}`}
      style={{ left: `${start * 100}%`, width: `${size * 100}%` }}
      onClick={onClick}
      title={`${long} (${clock(s.startAt)} – ${clock(s.endAt)}, ${duration(s.activeMs)} of input) · ${zoomed ? 'click for the whole day' : 'click to zoom in'}`}
    >
      <em>{label}</em>
    </button>
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

/** One strip per day: slot shade is input time, the line under it the sessions. Click a day to show it. */
function Overview({ days, onDate }: { days: Day[]; onDate: (date: string) => void }) {
  return (
    <section className={styles.overview}>
      <h3>Last {days.length} days</h3>
      {days.map((d) => (
        <button key={d.date} className={styles.row} onClick={() => onDate(d.date)} title={`${formatJournalDate(d.date)}: ${duration(d.activeMs)} active`}>
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
