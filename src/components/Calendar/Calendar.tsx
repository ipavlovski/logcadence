import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatJournalDate, shiftDate, today, toIsoDate } from '../../../shared/dates.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { openDate } from '../../state/panes.ts'
import styles from './Calendar.module.css'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** The month's grid, Monday first: six weeks of days, the neighbouring months' ones included. */
function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1, 12)
  const start = new Date(first)
  start.setDate(1 - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return toIsoDate(d)
  })
}

/**
 * A day tab's calendar, under the tab (`anchor`): picks the journal's day; ctrl+click opens it in a tab of its own.
 * Days with entries carry a dot.
 */
export function Calendar({ date, anchor, onClose }: { date: string; anchor: HTMLElement; onClose: () => void }) {
  const [view, setView] = useState(() => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 }))
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const dates = useFetch('journal-dates', (signal) => unwrap(api['journal-dates'].$get({}, { init: { signal } })))
  const counts = useMemo(() => new Map((dates.data?.dates ?? []).map((d) => [d.date, d.count])), [dates.data])
  const days = monthGrid(view.year, view.month)
  const now = today()

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const width = ref.current?.offsetWidth ?? 260
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4 })
  }, [anchor])

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])

  const step = (months: number) =>
    setView((v) => {
      const m = v.month + months
      return { year: v.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 }
    })
  const pick = (d: string, newTab = false) => {
    openDate(d, { newTab, focus: true })
    onClose()
  }

  return createPortal(
    <div ref={ref} className={styles.calendar} style={pos} role="dialog" aria-label="Pick a day">
      <header className={styles.head}>
        <button onClick={() => step(-1)} aria-label="Previous month">
          ‹
        </button>
        <span className={styles.month}>
          {MONTHS[view.month]} {view.year}
        </span>
        <button onClick={() => step(1)} aria-label="Next month">
          ›
        </button>
      </header>
      <div className={styles.grid} role="grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className={styles.weekday}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const count = counts.get(d)
          const cls = [
            styles.day,
            Number(d.slice(5, 7)) - 1 !== view.month && styles.outside,
            d === date && styles.selected,
            d === now && styles.today,
            count && styles.hasEntries,
          ]
          return (
            <button
              key={d}
              className={cls.filter(Boolean).join(' ')}
              onClick={(e) => pick(d, e.ctrlKey || e.metaKey)}
              onAuxClick={(e) => e.button === 1 && pick(d, true)}
              title={`${formatJournalDate(d)}${count ? ` · ${count} ${count === 1 ? 'entry' : 'entries'}` : ''} (Ctrl+click: a tab of its own)`}
            >
              {Number(d.slice(8))}
            </button>
          )
        })}
      </div>
      <footer className={styles.foot}>
        <button onClick={() => pick(shiftDate(date, -1))} title="Previous day (Ctrl+[)">
          ‹ day
        </button>
        <button onClick={() => pick(now)}>Today</button>
        <button onClick={() => pick(shiftDate(date, 1))} title="Next day (Ctrl+])">
          day ›
        </button>
      </footer>
    </div>,
    document.body,
  )
}
