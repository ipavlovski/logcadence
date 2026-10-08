import { useMemo, type ReactNode } from 'react'
import { dayBounds, union, type ActivitySpansDTO } from '../../../shared/activity.ts'
import { formatJournalDate, shiftDate, today, weekday } from '../../../shared/dates.ts'
import type { DayCount } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useDebounced, useFetch, useTicker } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { openDate } from '../../state/panes.ts'
import { Heatmap } from '../Heatmap/Heatmap.tsx'
import { ChecklistsSection } from '../Checklists/Checklists.tsx'
import { duration, km } from '../Map/kinds.ts'
import styles from './Dashboard.module.css'

// The canvas dashboard: today's report. Computer activity and travel for today and the 6 days before it, up to a year
// of journal entries and AI prompts as heatmaps (as many weeks as fit), then the day's checklists. Click a day to open
// it in the journal.

const WEEK = 7
const YEAR_DAYS = 371 // 53 weeks, the most a heatmap shows
const REFRESH_MS = 60_000

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const countMap = (days: DayCount[] | undefined) => new Map(days?.map((d) => [d.date, d.count]))

export function Dashboard() {
  const tick = useTicker(REFRESH_MS)
  // A new day rolls the report over (the ticker re-renders, today() moves on).
  const end = today()
  const first = shiftDate(end, -(WEEK - 1))
  const week = useMemo(() => Array.from({ length: WEEK }, (_, i) => shiftDate(first, i)), [first])

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Today</h2>
        <span className={styles.muted}>
          {weekday(end)}, {formatJournalDate(end)}
        </span>
      </header>
      {/* 2×2: the week bar charts on top, the year heatmaps under them (they narrow down to a few weeks). */}
      <div className={styles.grid}>
        <ActivityCard week={week} tick={tick} />
        <TravelCard week={week} tick={tick} />
        <Heatmaps end={end} tick={tick} />
      </div>
      <ChecklistsSection tick={tick} />
    </div>
  )
}

function ActivityCard({ week, tick }: { week: string[]; tick: number }) {
  const from = dayBounds(week[0]!)[0]
  const to = dayBounds(week.at(-1)!)[1]
  const { data, error } = useFetch<ActivitySpansDTO>(`dash-activity|${from}|${to}|${tick}`, (signal) =>
    unwrap(api.activity.spans.$get({ query: { from: String(from), to: String(to) } }, { init: { signal } })),
  )
  const values = useMemo(
    () =>
      week.map((date) => {
        const [start, end] = dayBounds(date)
        return union(data?.input ?? [], start, end).reduce((n, s) => n + s.endAt - s.startAt, 0)
      }),
    [data, week],
  )
  const empty = !!data && !values.some(Boolean)

  return (
    <Card
      title="Computer activity"
      note={data && !data.recording ? 'not recording' : undefined}
      value={data ? duration(values.at(-1)!) : '—'}
      sub={data ? `${duration(values.reduce((a, b) => a + b, 0))} in 7 days` : ''}
      error={error?.message}
      empty={empty ? 'No activity recorded this week. The desktop app records keyboard and mouse activity while it runs.' : undefined}
    >
      {data && <WeekBars week={week} values={values} label={(ms) => (ms ? duration(ms) : 'none')} />}
    </Card>
  )
}

function TravelCard({ week, tick }: { week: string[]; tick: number }) {
  const { data, error } = useFetch(`dash-travel|${week[0]}|${tick}`, (signal) =>
    unwrap(api.gps.travel.$get({ query: { from: week[0]!, to: week.at(-1)! } }, { init: { signal } })),
  )
  const byDate = new Map(data?.days.map((d) => [d.date, d]))
  const todays = byDate.get(week.at(-1)!)
  const total = data?.days.reduce((n, d) => n + d.distanceM, 0) ?? 0

  return (
    <Card
      title="Travel"
      value={!data ? '—' : todays ? km(todays.distanceM) : 'no GPS'}
      sub={data ? `${todays ? `${duration(todays.movingMs)} moving · ` : ''}${km(total)} in 7 days` : ''}
      error={error?.message}
      empty={data && !data.days.length ? 'No GPS data this week. GPS files are imported in the Map tab.' : undefined}
    >
      {data && (
        <WeekBars
          week={week}
          values={week.map((d) => byDate.get(d)?.distanceM ?? 0)}
          label={(m, date) => {
            const d = byDate.get(date)
            return !d ? 'no GPS data' : `${km(m)} · ${duration(d.movingMs)} moving`
          }}
        />
      )}
    </Card>
  )
}

function Heatmaps({ end, tick }: { end: string; tick: number }) {
  const from = shiftDate(end, -(YEAR_DAYS - 1))
  // Journal edits bump the revision on every save; a refetch a moment later is enough.
  const rev = useDebounced(useRevision(), 2000)
  const prompts = useFetch(`dash-prompts|${from}|${tick}`, (signal) => unwrap(api.ai['prompt-days'].$get({ query: { from } }, { init: { signal } })))
  const journal = useFetch(`dash-journal|${from}|${rev}`, (signal) => unwrap(api['journal-activity'].$get({ query: { from } }, { init: { signal } })))
  const promptCounts = useMemo(() => countMap(prompts.data?.days), [prompts.data])
  const entryCounts = useMemo(() => countMap(journal.data?.days), [journal.data])

  return (
    <>
      <section className={styles.card}>
        {journal.error ? (
          <p className={styles.error}>Journal: {journal.error.message}</p>
        ) : (
          <Heatmap title="Journal entries" tone="green" counts={entryCounts} end={end} describe={(n) => plural(n, 'entry', 'entries')} onSelect={openDate} hint="Hover a day; click to open it" />
        )}
      </section>
      <section className={styles.card}>
        {prompts.error ? (
          <p className={styles.error}>AI prompts: {prompts.error.message}</p>
        ) : (
          <Heatmap title="AI prompts" tone="pink" counts={promptCounts} end={end} describe={(n) => plural(n, 'prompt')} hint="Hover a day" />
        )}
      </section>
    </>
  )
}

function Card(props: { title: string; note?: string; value: string; sub: string; error?: string; empty?: string; children?: ReactNode }) {
  return (
    <section className={styles.card}>
      <header>
        <h3>{props.title}</h3>
        {props.note && <span className={styles.muted}>{props.note}</span>}
      </header>
      {props.error ? (
        <p className={styles.error}>{props.error}</p>
      ) : (
        <>
          <div className={styles.value}>
            <b>{props.value}</b>
            <span>today</span>
          </div>
          <p className={styles.sub}>{props.sub}</p>
          {props.empty ? <p className={styles.empty}>{props.empty}</p> : props.children}
        </>
      )}
    </section>
  )
}

/** One bar per day, today on the right; click a day to open it. */
function WeekBars({ week, values, label }: { week: string[]; values: number[]; label: (v: number, date: string) => string }) {
  const max = Math.max(...values)
  return (
    <div className={styles.bars}>
      {week.map((date, i) => {
        const v = values[i]!
        return (
          <button key={date} className={i === week.length - 1 ? styles.today : ''} onClick={() => openDate(date)} title={`${formatJournalDate(date)}: ${label(v, date)}`}>
            <span className={styles.track}>{v > 0 && <span style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />}</span>
            <span className={styles.day}>{weekday(date).slice(0, 1)}</span>
          </button>
        )
      })}
    </div>
  )
}
