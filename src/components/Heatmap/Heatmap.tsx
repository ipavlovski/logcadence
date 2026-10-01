import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import { heatLevel, heatmapWeeks } from '../../heatmap.ts'
import styles from './Heatmap.module.css'

const CELL = 11
const STEP = 14 // cell + 3px gap
const LEFT = 28 // weekday labels
const TOP = 16 // month labels
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  title: string
  counts: Map<string, number>
  /** Last day shown (today). */
  end: string
  /** "12 songs played" */
  describe: (count: number) => string
  /** Hue family of the ramp (one hue per chart, light → dark by count). */
  tone: 'green' | 'pink'
  selected?: string | null
  onSelect?: (date: string) => void
}

/** GitHub-style calendar heatmap; as many weeks as fit (up to a year), most recent on the right. */
export function Heatmap({ title, counts, end, describe, tone, selected, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(53)
  const [hover, setHover] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWeeks(Math.max(12, Math.min(53, Math.floor((e!.contentRect.width - LEFT) / STEP)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cols = useMemo(() => heatmapWeeks(end, weeks), [end, weeks])
  const shown = cols.flat()
  const max = Math.max(0, ...shown.map((d) => counts.get(d) ?? 0))
  const total = shown.reduce((n, d) => n + (counts.get(d) ?? 0), 0)
  const readout = hover ?? selected ?? null

  // A month label over the first week of each month; when two would collide, the later month wins.
  const months: { x: number; label: string }[] = []
  cols.forEach((col, i) => {
    const m = Number(col[0]!.slice(5, 7)) - 1
    if (i && m === Number(cols[i - 1]![0]!.slice(5, 7)) - 1) return
    const x = LEFT + i * STEP
    if (months.length && x - months.at(-1)!.x < 3 * STEP) months.pop()
    months.push({ x, label: MONTHS[m]! })
  })

  return (
    <figure className={styles.heatmap} data-tone={tone}>
      <figcaption className={styles.head}>
        <strong>{title}</strong>
        <span className={styles.total}>
          {total.toLocaleString()} in the last {weeks === 53 ? 'year' : `${weeks} weeks`}
        </span>
      </figcaption>
      <div ref={wrap} className={styles.plot}>
        <svg width={LEFT + cols.length * STEP} height={TOP + 7 * STEP} role="img" aria-label={`${title}: ${total} in the last ${weeks} weeks`}>
          {months.map((m) => (
            <text key={m.x} x={m.x} y={10} className={styles.axis}>
              {m.label}
            </text>
          ))}
          {['Mon', 'Wed', 'Fri'].map((d, i) => (
            <text key={d} x={0} y={TOP + (1 + 2 * i) * STEP + CELL - 2} className={styles.axis}>
              {d}
            </text>
          ))}
          {cols.map((col, w) =>
            col.map((date, d) => {
              const n = counts.get(date) ?? 0
              return (
                <rect
                  key={date}
                  x={LEFT + w * STEP}
                  y={TOP + d * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  className={`${styles.cell} ${date === selected ? styles.selected : ''}`}
                  data-level={heatLevel(n, max)}
                  onMouseEnter={() => setHover(date)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => onSelect?.(date)}
                >
                  <title>{`${formatJournalDate(date)}: ${describe(n)}`}</title>
                </rect>
              )
            }),
          )}
        </svg>
      </div>
      <div className={styles.foot}>
        <span className={styles.readout}>{readout ? `${formatJournalDate(readout)} · ${describe(counts.get(readout) ?? 0)}` : 'Hover a day; click to list it'}</span>
        <span className={styles.legend} aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={styles.cell} data-level={l} />
          ))}
          More
        </span>
      </div>
    </figure>
  )
}
