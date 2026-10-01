import { useEffect, useMemo, useState } from 'react'
import { formatJournalDate, shiftDate, today } from '../../../shared/dates.ts'
import type { SpotifyNowPlaying, SpotifyPlay, SpotifyResume, SpotifyStatus } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import type { CanvasPluginProps } from '../../canvas/plugins.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { useRevision } from '../../state/bus.ts'
import { notify } from '../../state/ui.ts'
import { Heatmap } from '../Heatmap/Heatmap.tsx'
import styles from './Spotify.module.css'

const STATUS_POLL_MS = 20_000
const NOW_POLL_MS = 15_000

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.round(min / 60)} h ago`
}

/** Re-renders every `ms` while the page is visible. */
function useTicker(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

/** Canvas "Spotify" tab: what is playing, where yesterday's listening stopped, and daily history. */
export function Spotify(_: CanvasPluginProps) {
  const [bump, setBump] = useState(0)
  const tick = useTicker(STATUS_POLL_MS)
  const { data: status, error } = useFetch<SpotifyStatus>(`status|${tick}|${bump}`, (signal) => unwrap(api.spotify.status.$get({}, { init: { signal } })))
  const refresh = () => setBump((b) => b + 1)

  if (error && !status) return <p className={styles.error}>{error.message}</p>
  if (!status) return <div className={styles.frame} />
  if (!status.configured) return <Setup status={status} onSaved={refresh} />
  if (!status.connected) return <Connect status={status} onChange={refresh} />
  return <Connected status={status} onChange={refresh} />
}

// ── setup ──────────────────────────────────────────────────────────────────

function Setup({ status, onSaved }: { status: SpotifyStatus; onSaved: () => void }) {
  const [id, setId] = useState('')
  const save = () =>
    unwrap(api.spotify['client-id'].$post({ json: { clientId: id } })).then(onSaved, (err: Error) => notify(err.message))
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Spotify</h2>
      </header>
      <div className={styles.setup}>
        <p>Listening history comes from the Spotify Web API, which needs a (free) Spotify developer app:</p>
        <ol>
          <li>
            Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and create an app; tick <em>Web API</em>.
          </li>
          <li>
            Add this Redirect URI: <code>{status.redirectUri}</code>
          </li>
          <li>Paste the app’s Client ID here. No secret is needed.</li>
        </ol>
        <div className={styles.row}>
          <input value={id} placeholder="Client ID" spellCheck={false} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          <button className={styles.primary} disabled={!id.trim()} onClick={save}>
            Save
          </button>
        </div>
        <p className={styles.muted}>
          Starting playlists from here (“continue from yesterday”) needs Spotify Premium; history and stats work on any account.
        </p>
      </div>
    </div>
  )
}

function Connect({ status, onChange }: { status: SpotifyStatus; onChange: () => void }) {
  const login = `/api/spotify/login?return=${encodeURIComponent(location.href)}`
  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Spotify</h2>
      </header>
      <div className={styles.setup}>
        <p>The Client ID is saved. Connect your account to start tracking what you listen to.</p>
        <div className={styles.row}>
          <a className={styles.primary} href={login}>
            Connect Spotify
          </a>
          <button onClick={() => unwrap(api.spotify.forget.$post()).then(onChange)}>Change Client ID</button>
        </div>
        <p className={styles.muted}>
          If Spotify says the redirect URI is invalid, add <code>{status.redirectUri}</code> to the app’s settings.
        </p>
      </div>
    </div>
  )
}

// ── connected ──────────────────────────────────────────────────────────────

function Connected({ status, onChange }: { status: SpotifyStatus; onChange: () => void }) {
  const rev = useRevision()
  const [day, setDay] = useState(today())
  const [syncing, setSyncing] = useState(false)
  const key = `${status.lastSync}|${rev}`
  const end = today()

  const { data: stats } = useFetch(`stats|${key}`, (signal) => unwrap(api.spotify.stats.$get({ query: {} }, { init: { signal } })))
  const playCounts = useMemo(() => new Map(stats?.plays.map((d) => [d.date, d.count])), [stats])
  const likeCounts = useMemo(() => new Map(stats?.likes.map((d) => [d.date, d.count])), [stats])

  const syncNow = () => {
    setSyncing(true)
    unwrap(api.spotify.sync.$post())
      .then((r) => notify(r.plays || r.likes ? `Spotify: ${plural(r.plays, 'new play')}, ${plural(r.likes, 'new like')}` : 'Spotify: up to date'), (err: Error) => notify(err.message))
      .finally(() => {
        setSyncing(false)
        onChange()
      })
  }

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <h2>Spotify</h2>
        <span className={status.error ? styles.errorText : styles.muted} title={status.error ?? undefined}>
          {status.error ? `sync failed: ${status.error}` : status.lastSync ? `synced ${ago(status.lastSync)}` : 'syncing…'}
        </span>
        <div className={styles.actions}>
          <button onClick={syncNow} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            onClick={() => confirm('Disconnect Spotify? The listening history stays.') && unwrap(api.spotify.disconnect.$post()).then(onChange)}
            title="Forget the login (history is kept)"
          >
            Disconnect
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <NowPlaying />
        <Resume dataKey={key} />
        <section className={styles.charts}>
          <Heatmap title="Songs played" tone="green" counts={playCounts} end={end} describe={(n) => `${plural(n, 'song')} played`} selected={day} onSelect={setDay} />
          <Heatmap title="Songs liked" tone="pink" counts={likeCounts} end={end} describe={(n) => `${plural(n, 'song')} liked`} selected={day} onSelect={setDay} />
        </section>
        <DayPlays date={day} dataKey={key} onDate={setDay} />
      </div>
    </div>
  )
}

function Cover({ url }: { url: string | null }) {
  return url ? <img className={styles.cover} src={url} alt="" loading="lazy" /> : <span className={styles.cover} />
}

function NowPlaying() {
  const tick = useTicker(NOW_POLL_MS)
  const { data: now, error } = useFetch<SpotifyNowPlaying>(`now|${tick}`, (signal) => unwrap(api.spotify.now.$get({}, { init: { signal } })))
  if (error && !now) return <section className={`${styles.card} ${styles.muted}`}>Now playing unavailable: {error.message}</section>
  if (!now) return <section className={styles.card} />
  if (!now.track) return <section className={`${styles.card} ${styles.muted}`}>Nothing playing right now.</section>
  const t = now.track
  return (
    <section className={styles.card}>
      <Cover url={t.imageUrl} />
      <div className={styles.cardMain}>
        <span className={styles.kicker}>
          {now.isPlaying ? 'Now playing' : 'Paused'}
          {now.device && ` · ${now.device}`}
        </span>
        <strong className={styles.ellipsis}>{t.trackName}</strong>
        <span className={`${styles.muted} ${styles.ellipsis}`}>{t.artists}</span>
        <span className={styles.ellipsis}>{now.context ? <>from <b>{now.context.name}</b></> : <span className={styles.muted}>not from a playlist</span>}</span>
        <progress className={styles.progress} value={now.progressMs} max={t.durationMs} />
      </div>
    </section>
  )
}

function Resume({ dataKey }: { dataKey: string }) {
  const { data } = useFetch(`resume|${dataKey}`, (signal) => unwrap(api.spotify.resume.$get({ query: {} }, { init: { signal } })))
  const [busy, setBusy] = useState<string | null>(null)
  const list = data?.resume ?? []
  if (!data) return null
  if (!list.length) return <section className={`${styles.card} ${styles.muted}`}>Nothing to continue yet: playlists you listen to show up here the next day.</section>

  const play = (r: SpotifyResume) => {
    setBusy(r.context.uri)
    unwrap(api.spotify.play.$post({ json: { contextUri: r.context.uri, trackUri: r.trackUri } }))
      .then(() => notify(`Playing ${r.context.name} from “${r.trackName}”`), (err: Error) => notify(err.message))
      .finally(() => setBusy(null))
  }
  const when = list[0]!.date === shiftDate(today(), -1) ? 'yesterday' : `on ${formatJournalDate(list[0]!.date)}`
  const [first, ...rest] = list

  return (
    <section className={`${styles.card} ${styles.resume}`}>
      <div className={styles.cardMain}>
        <span className={styles.kicker}>Continue from {when}</span>
        <ResumeRow r={first!} busy={busy} onPlay={play} main />
        {rest.map((r) => (
          <ResumeRow key={r.context.uri} r={r} busy={busy} onPlay={play} />
        ))}
      </div>
    </section>
  )
}

function ResumeRow({ r, busy, onPlay, main }: { r: SpotifyResume; busy: string | null; onPlay: (r: SpotifyResume) => void; main?: boolean }) {
  return (
    <div className={`${styles.resumeRow} ${main ? styles.resumeMain : ''}`}>
      <div className={styles.cardMain}>
        <span className={styles.ellipsis}>
          <b>{r.context.name}</b> <span className={styles.muted}>· {plural(r.plays, 'song')} · stopped {clock(r.playedAt)}</span>
        </span>
        <span className={`${styles.muted} ${styles.ellipsis}`}>
          at “{r.trackName}” · {r.artists}
        </span>
      </div>
      <button className={main ? styles.primary : ''} disabled={!!busy} onClick={() => onPlay(r)} title="Start this playlist at that track on your active Spotify player">
        {busy === r.context.uri ? '…' : '▶ Continue'}
      </button>
    </div>
  )
}

/** A day's plays, in runs from the same playlist/album. */
function DayPlays({ date, dataKey, onDate }: { date: string; dataKey: string; onDate: (d: string) => void }) {
  const { data } = useFetch(`day|${date}|${dataKey}`, (signal) => unwrap(api.spotify.day[':date'].$get({ param: { date } }, { init: { signal } })))
  const runs = useMemo(() => {
    const out: { key: string; name: string | null; plays: SpotifyPlay[] }[] = []
    for (const p of data?.plays ?? []) {
      const uri = p.context?.uri ?? ''
      const last = out.at(-1)
      if (last && last.key === uri) last.plays.push(p)
      else out.push({ key: uri, name: p.context?.name ?? null, plays: [p] })
    }
    return out
  }, [data])
  const count = data?.plays.length ?? 0
  const playlists = new Set(runs.filter((r) => r.name).map((r) => r.key)).size

  return (
    <section className={styles.day}>
      <div className={styles.dayHead}>
        <button onClick={() => onDate(shiftDate(date, -1))} title="Previous day">
          ‹
        </button>
        <h3>{date === today() ? 'Today' : formatJournalDate(date)}</h3>
        <button onClick={() => onDate(shiftDate(date, 1))} disabled={date >= today()} title="Next day">
          ›
        </button>
        <span className={styles.muted}>
          {plural(count, 'song')}
          {playlists > 0 && ` from ${plural(playlists, 'playlist')}`}
        </span>
      </div>
      {data && !count && <p className={styles.muted}>No plays recorded.</p>}
      {runs.map((run) => (
        <details key={`${run.key}|${run.plays[0]!.playedAt}`} className={styles.run} open={runs.length <= 3}>
          <summary>
            <b>{run.name ?? 'Not from a playlist'}</b>
            <span className={styles.muted}>
              {' '}
              · {plural(run.plays.length, 'song')} · {clock(run.plays[0]!.playedAt)}
              {run.plays.length > 1 && `–${clock(run.plays.at(-1)!.playedAt)}`}
            </span>
          </summary>
          <ol className={styles.tracks}>
            {run.plays.map((p) => (
              <li key={p.playedAt}>
                <span className={styles.time}>{clock(p.playedAt)}</span>
                <Cover url={p.imageUrl} />
                <span className={styles.ellipsis}>
                  {p.trackName} <span className={styles.muted}>· {p.artists}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  )
}
