import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import type { GpsDayDTO, GpsKind, GpsTripDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { useCanvasDay } from '../../state/canvasDay.ts'
import { useStore } from '../../state/store.ts'
import { notify, prefsStore } from '../../state/ui.ts'
import { clock, duration, isMove, isStay, KIND_CODE, KIND_LABEL, KIND_ORDER, kindColor, km, placeNamer, type Theme } from './kinds.ts'
import { MapSync } from './MapSync.tsx'
import { MapView } from './MapView.tsx'
import styles from './Map.module.css'

/** Canvas "Map" tab: a day's GPS as stays and trips, on a map and as a timetable. The day is the canvas's own, or the journal's (ctrl+l). */
export function MapTab(_: CanvasPluginProps) {
  const follows = useStore(prefsStore, (s) => s.canvasFollowsJournal)
  const [date, goTo] = useCanvasDay()
  const theme = useStore(prefsStore, (s) => s.theme) as Theme
  const rev = useRevision()
  const [bump, setBump] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  // Imports from Google Drive run in the background (and from the sync window): refetch when one finishes.
  const tick = useTicker(syncOpen ? 3000 : 60_000)
  const { data: drive } = useFetch(`gpsdrive|${tick}`, (signal) => unwrap(api.gps.drive.status.$get({}, { init: { signal } })))
  const synced = drive?.running ? 'running' : drive?.lastSync
  const { data: day, error, loading } = useFetch<GpsDayDTO>(`gps|${date}|${rev}|${bump}|${synced}`, (signal) =>
    unwrap(api.gps.day[':date'].$get({ param: { date } }, { init: { signal } })),
  )
  const { data: days } = useFetch(`gpsdays|${bump}|${synced}`, (signal) => unwrap(api.gps.days.$get({}, { init: { signal } })))
  const shown = day?.date === date ? day : undefined

  const scan = () =>
    unwrap(api.gps.scan.$post()).then(
      (r) => {
        notify(r.errors.length ? r.errors.join('\n') : `GPS: ${r.processed} day(s) processed, ${r.unchanged} unchanged`)
        setBump((b) => b + 1)
      },
      (err: Error) => notify(err.message),
    )

  // Nearest days with data, for days without.
  const near = useMemo(() => {
    const list = days?.days.map((d) => d.date) ?? []
    return { before: list.filter((d) => d < date).at(-1), after: list.find((d) => d > date) }
  }, [days, date])

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Map</h2>
        <input
          type="date"
          className={styles.date}
          value={date}
          onChange={(e) => e.target.value && goTo(e.target.value)}
          aria-label="Map date"
          title={follows ? 'The journal’s day (Ctrl+L to browse separately)' : 'The canvas’s own day; the journal is browsed separately (Ctrl+L to follow it)'}
        />
        <div className={styles.actions}>
          {near.before && (
            <button onClick={() => goTo(near.before!)} title={`Previous day with GPS: ${formatJournalDate(near.before)}`}>
              ‹
            </button>
          )}
          {near.after && (
            <button onClick={() => goTo(near.after!)} title={`Next day with GPS: ${formatJournalDate(near.after)}`}>
              ›
            </button>
          )}
          <button onClick={scan} title="Process new or changed files in data/gps/">
            Scan
          </button>
          <button className={styles.iconButton} onClick={() => setSyncOpen(true)} title="Map sync: import GPS files from Google Drive" aria-label="Map sync settings">
            <CogIcon />
          </button>
        </div>
      </header>
      {syncOpen && <MapSync onClose={() => setSyncOpen(false)} />}
      {shown ? (
        <Day key={shown.date} day={shown} theme={theme} onChange={() => setBump((b) => b + 1)} />
      ) : loading && !error ? (
        <div className={styles.placeholder} />
      ) : (
        <p className={styles.empty}>
          No GPS for {formatJournalDate(date)}. Import GPSLogger files from Google Drive with the ⚙ button, or drop them (<code>YYYYMMDD.zip</code> or <code>.gpx</code>) into{' '}
          <code>data/gps/</code> and press Scan.
        </p>
      )}
    </div>
  )
}

function Day({ day, theme, onChange }: { day: GpsDayDTO; theme: Theme; onChange: () => void }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [hoveredTrip, setHoveredTrip] = useState<GpsTripDTO | null>(null)
  // Clicked rows: a click sets both ends, Shift+click moves the focus end.
  const [sel, setSel] = useState<{ anchor: number; focus: number } | null>(null)
  const lo = sel ? Math.min(sel.anchor, sel.focus) : -1
  const hi = sel ? Math.max(sel.anchor, sel.focus) : -1
  const selected = useMemo(() => (lo < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k)), [lo, hi])
  const tripOf = useMemo(() => day.segments.map((s) => tripAt(day.trips, (s.start + s.end) / 2)), [day])
  // The selection is exactly one trip: its button removes it; a longer selection gets one that adds a trip.
  const selTrip = lo >= 0 && tripOf[lo] && tripOf[lo] === tripOf[hi] && tripOf[lo - 1] !== tripOf[lo] && tripOf[hi + 1] !== tripOf[hi] ? tripOf[lo] : null
  const name = useMemo(
    () => placeNamer(day.places, day.homebaseId, day.segments.flatMap((s) => [s.placeId, s.fromPlaceId, s.toPlaceId])),
    [day],
  )
  const onHover = useCallback((i: number | null) => setHovered(i), [])
  const onSelect = useCallback((i: number) => setSel({ anchor: i, focus: i }), [])
  const click = (i: number, shift: boolean) => {
    if (shift && sel) setSel({ ...sel, focus: i })
    else if (i >= lo && i <= hi) setSel(null)
    else setSel({ anchor: i, focus: i })
  }

  const rename = (placeId: string) => {
    const next = prompt('Name this place', name(placeId))
    if (next === null) return
    unwrap(api.gps.places[':id'].$patch({ param: { id: placeId }, json: { name: next } })).then(onChange, (err: Error) => notify(err.message))
  }
  const setHomebase = (placeId: string | null) =>
    unwrap(api.gps.day[':date'].homebase.$put({ param: { date: day.date }, json: { placeId } })).then(onChange, (err: Error) => notify(err.message))

  const addTrip = () =>
    unwrap(api.gps.day[':date'].trips.$post({ param: { date: day.date }, json: { start: day.segments[lo]!.start, end: day.segments[hi]!.end } })).then(onChange, (err: Error) =>
      notify(err.message),
    )
  const removeTrip = (id: string) =>
    unwrap(api.gps.day[':date'].trips[':id'].$delete({ param: { date: day.date, id } })).then(onChange, (err: Error) => notify(err.message))
  const tripTitle = (t: GpsTripDTO) => {
    const rows = day.segments.filter((_, i) => tripOf[i] === t)
    return `Trip ${clock(t.start)}–${clock(t.end)} · ${duration(t.end - t.start)}, ${km(rows.reduce((n, s) => n + s.distanceM, 0))}`
  }

  const travelled = day.segments.reduce((n, s) => n + s.distanceM, 0)
  const moving = day.totals['A->B'] + day.totals['B->B'] + day.totals['B->A'] + day.totals['A->A']

  return (
    <>
      <section className={styles.summary}>
        {/* Share of the day per type: one stacked bar, legend below with the durations. */}
        <div className={styles.bar} role="img" aria-label="Time per movement type">
          {KIND_ORDER.filter((k) => day.totals[k] > 0).map((k) => (
            <span
              key={k}
              className={k === 'gap' ? styles.gapFill : ''}
              style={{ flexGrow: day.totals[k], '--c': kindColor(k, theme) } as CSSProperties}
              title={`${KIND_LABEL[k]}: ${duration(day.totals[k])}`}
            />
          ))}
        </div>
        <div className={styles.legend}>
          {KIND_ORDER.filter((k) => day.totals[k] > 0).map((k) => (
            <span key={k}>
              <Chip kind={k} theme={theme} /> {KIND_LABEL[k]} <b>{duration(day.totals[k])}</b>
            </span>
          ))}
          <span className={styles.muted}>
            · moving {duration(moving)}, {km(travelled)}
          </span>
          {day.homebaseOverride && (
            <button className={styles.link} onClick={() => setHomebase(null)} title="Use the place slept at as the homebase again">
              reset homebase
            </button>
          )}
        </div>
      </section>

      <MapView day={day} theme={theme} name={name} hovered={hovered} selected={selected} onHover={onHover} onSelect={onSelect} />

      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.tripCol} />
            <th>Type</th>
            <th>Time</th>
            <th>Duration</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          {day.segments.map((s, i) => (
            <tr
              key={i}
              className={[i === hovered && styles.hovered, i >= lo && i <= hi && styles.selected, s.kind === 'gap' && styles.gapRow].filter(Boolean).join(' ')}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              // Shift would select the table's text.
              onMouseDown={(e) => e.shiftKey && e.preventDefault()}
              onClick={(e) => click(i, e.shiftKey)}
            >
              <td className={styles.tripCol}>
                {tripOf[i] && (
                  <span
                    className={[styles.trip, tripOf[i - 1] !== tripOf[i] && styles.tripStart, tripOf[i + 1] !== tripOf[i] && styles.tripEnd, (tripOf[i] === selTrip || tripOf[i] === hoveredTrip) && styles.tripOn]
                      .filter(Boolean)
                      .join(' ')}
                    title={`${tripTitle(tripOf[i]!)} (click to select)`}
                    onMouseEnter={() => setHoveredTrip(tripOf[i])}
                    onMouseLeave={() => setHoveredTrip(null)}
                    onClick={(e) => {
                      e.stopPropagation()
                      const t = tripOf[i]
                      setSel(t === selTrip ? null : { anchor: tripOf.indexOf(t), focus: tripOf.lastIndexOf(t) })
                    }}
                  />
                )}
                {i === lo && selTrip ? (
                  <button className={styles.tripButton} onClick={(e) => (e.stopPropagation(), removeTrip(selTrip.id))} title="Remove this trip" aria-label="Remove trip">
                    ×
                  </button>
                ) : (
                  i === lo &&
                  hi > lo && (
                    <button className={styles.tripButton} onClick={(e) => (e.stopPropagation(), addTrip())} title="Group the selected rows into a trip" aria-label="Add trip">
                      +
                    </button>
                  )
                )}
              </td>
              <td>
                <Chip kind={s.kind} theme={theme} /> {KIND_CODE[s.kind]}
              </td>
              <td className={styles.time}>
                {clock(s.start)}–{clock(s.end)}
              </td>
              <td className={styles.time}>{duration(s.end - s.start)}</td>
              <td>
                {isStay(s.kind) && s.placeId ? (
                  <>
                    <button className={styles.place} onClick={(e) => (e.stopPropagation(), rename(s.placeId!))} title="Name this place">
                      {name(s.placeId)}
                    </button>
                    {s.kind === 'B' && (
                      <button
                        className={`${styles.link} ${styles.rowAction}`}
                        onClick={(e) => (e.stopPropagation(), setHomebase(s.placeId))}
                        title="Use this place as the homebase for this day (e.g. a hotel)"
                      >
                        ⌂ homebase
                      </button>
                    )}
                  </>
                ) : isMove(s.kind) ? (
                  <>
                    {name(s.fromPlaceId)} → {name(s.toPlaceId)} <span className={styles.muted}>· {km(s.distanceM)}</span>
                  </>
                ) : (
                  <span className={styles.muted}>no GPS fixes</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

/** The trip a moment falls in. */
function tripAt(trips: GpsTripDTO[], t: number): GpsTripDTO | null {
  return trips.find((trip) => t >= trip.start && t <= trip.end) ?? null
}

function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function Chip({ kind, theme }: { kind: GpsKind; theme: Theme }) {
  // Stays are dots, movements dashes: the same shapes as on the map.
  return <i className={`${styles.chip} ${isStay(kind) ? styles.dot : kind === 'gap' ? styles.gapChip : ''}`} style={{ '--c': kindColor(kind, theme) } as CSSProperties} />
}
