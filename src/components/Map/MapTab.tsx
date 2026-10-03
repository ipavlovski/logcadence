import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { formatJournalDate } from '../../../shared/dates.ts'
import type { GpsDayDTO, GpsKind } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { journalDateOf, openDate, panesStore } from '../../state/panes.ts'
import { useStore } from '../../state/store.ts'
import { notify, prefsStore } from '../../state/ui.ts'
import { clock, duration, isMove, isStay, KIND_CODE, KIND_LABEL, KIND_ORDER, kindColor, km, placeNamer, type Theme } from './kinds.ts'
import { MapSync } from './MapSync.tsx'
import { MapView } from './MapView.tsx'
import styles from './Map.module.css'

/** Canvas "Map" tab: the journal day's GPS as stays and trips, on a map and as a timetable. */
export function MapTab(_: CanvasPluginProps) {
  const date = useStore(panesStore, journalDateOf)
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
        <span className={styles.muted}>{formatJournalDate(date)}</span>
        <div className={styles.actions}>
          {near.before && (
            <button onClick={() => openDate(near.before!)} title={`Previous day with GPS: ${formatJournalDate(near.before)}`}>
              ‹ GPS
            </button>
          )}
          {near.after && (
            <button onClick={() => openDate(near.after!)} title={`Next day with GPS: ${formatJournalDate(near.after)}`}>
              GPS ›
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
        <Day day={shown} theme={theme} onChange={() => setBump((b) => b + 1)} />
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
  const [selected, setSelected] = useState<number | null>(null)
  const name = useMemo(
    () => placeNamer(day.places, day.homebaseId, day.segments.flatMap((s) => [s.placeId, s.fromPlaceId, s.toPlaceId])),
    [day],
  )
  const onHover = useCallback((i: number | null) => setHovered(i), [])
  const onSelect = useCallback((i: number) => setSelected(i), [])

  const rename = (placeId: string) => {
    const next = prompt('Name this place', name(placeId))
    if (next === null) return
    unwrap(api.gps.places[':id'].$patch({ param: { id: placeId }, json: { name: next } })).then(onChange, (err: Error) => notify(err.message))
  }
  const setHomebase = (placeId: string | null) =>
    unwrap(api.gps.day[':date'].homebase.$put({ param: { date: day.date }, json: { placeId } })).then(onChange, (err: Error) => notify(err.message))

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
              className={[i === hovered && styles.hovered, i === selected && styles.selected, s.kind === 'gap' && styles.gapRow].filter(Boolean).join(' ')}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => s.kind !== 'gap' && setSelected(i)}
            >
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
