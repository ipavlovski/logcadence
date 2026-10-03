import { useEffect, useState } from 'react'
import { GITHUB_OWNER, GITHUB_REPO, parseReleases, type Release } from '../../../shared/releases.ts'
import { compareVersions, versionLabel } from '../../../shared/versions.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { openUpdates, updatesStore } from '../../state/updates.ts'
import { useStore } from '../../state/store.ts'
import { Modal } from '../Modal/Modal.tsx'
import { ReleaseNotes } from './ReleaseNotes.tsx'
import styles from './Updates.module.css'

// The Updates window: the app's GitHub releases and dev builds, newest first, with their notes. Any release newer
// than the installed version can be installed from here (dev builds only ever are; see electron/updater.ts).

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

async function fetchReleases(signal: AbortSignal): Promise<Release[]> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=50`, { signal, headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub rate limit reached; try again in a while.' : `GitHub: HTTP ${res.status}`)
  return parseReleases(await res.json())
}

export function Updates() {
  const open = useStore(updatesStore, (s) => s.open)
  return open ? <UpdatesWindow /> : null
}

function UpdatesWindow() {
  const app = useStore(updatesStore, (s) => s.app)
  const [reload, setReload] = useState(0)
  const { data: releases, error, loading } = useFetch(`releases|${reload}`, fetchReleases)
  const [selected, setSelected] = useState<string | null>(null)
  const current = releases?.find((r) => r.tag === selected) ?? releases?.[0]

  // Start on the newest release that would be an update, else the newest.
  useEffect(() => {
    if (!releases || selected || !app) return
    setSelected((releases.find((r) => compareVersions(r.version, app.version) > 0) ?? releases[0])?.tag ?? null)
  }, [releases, selected, app])

  return (
    <Modal large title="Updates" onClose={() => openUpdates(false)}>
      <header className={styles.header}>
        <h2>Updates</h2>
        {app && (
          <span className={styles.muted}>
            Installed <b>{versionLabel(app.version)}</b>
            {app.channel === 'dev' && ' · LogcadenceDev'}
          </span>
        )}
        <div className={styles.headerActions}>
          <button onClick={() => setReload((n) => n + 1)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => openUpdates(false)} title="Close (Esc)" aria-label="Close">
            ✕
          </button>
        </div>
      </header>
      <div className={styles.body}>
        <nav className={styles.list} aria-label="Releases">
          {releases?.map((r) => {
            const cmp = app ? compareVersions(r.version, app.version) : 0
            return (
              <button key={r.tag} className={r.tag === current?.tag ? styles.selected : ''} onClick={() => setSelected(r.tag)}>
                <span className={styles.version}>
                  {versionLabel(r.version)}
                  {r.dev && <i className={styles.devChip}>dev</i>}
                  {app && cmp === 0 && <i className={styles.installedChip}>installed</i>}
                  {app && cmp > 0 && <i className={styles.newDot} title="Newer than the installed version" />}
                </span>
                <span className={styles.date}>{date(r.publishedAt)}</span>
              </button>
            )
          })}
        </nav>
        <article className={styles.detail}>
          {error ? (
            <p className={styles.empty}>Couldn’t load the releases: {error.message}</p>
          ) : !releases ? null : !current ? (
            <p className={styles.empty}>No releases are published yet.</p>
          ) : (
            <ReleaseDetail release={current} />
          )}
        </article>
      </div>
    </Modal>
  )
}

function ReleaseDetail({ release }: { release: Release }) {
  return (
    <>
      <h1>{release.title}</h1>
      <p className={styles.meta}>
        {date(release.publishedAt)} · {release.dev ? 'Dev build (pre-release)' : 'Release'} ·{' '}
        <a href={release.url} target="_blank" rel="noreferrer">
          View on GitHub ↗
        </a>
      </p>
      <InstallAction release={release} />
      <ReleaseNotes source={release.notes} />
    </>
  )
}

/** Update / progress / restart for a release, depending on the installed version and the updater's status. */
function InstallAction({ release }: { release: Release }) {
  const { app, status } = useStore(updatesStore, (s) => s)
  const [requested, setRequested] = useState<string | null>(null)
  if (!app) return <p className={styles.note}>Updates are installed from the desktop app.</p>
  if (app.channel === 'dev') return <p className={styles.note}>This is LogcadenceDev, which is updated by pnpm preview. Install releases in Logcadence.</p>

  const cmp = compareVersions(release.version, app.version)
  if (cmp === 0) return <p className={styles.note}>This is the installed version.</p>
  if (cmp < 0) return <p className={styles.note}>Older than the installed version {versionLabel(app.version)}.</p>

  const label = versionLabel(release.version)
  const mine = requested === release.tag
  if (status?.state === 'ready' && status.version === release.version)
    return (
      <div className={styles.action}>
        <button data-primary onClick={() => window.desktop!.installUpdate()}>
          Restart to install {label}
        </button>
        <span className={styles.muted}>Downloaded. It also installs when you quit.</span>
      </div>
    )
  const busy = mine && (status?.state === 'checking' || status?.state === 'available' || status?.state === 'downloading')
  return (
    <div className={styles.action}>
      <button
        data-primary
        disabled={busy}
        onClick={() => {
          setRequested(release.tag)
          void window.desktop!.installRelease(release.tag)
        }}
      >
        {busy ? (status?.state === 'downloading' ? `Downloading… ${status.percent}%` : 'Starting…') : `Update to ${label}`}
      </button>
      {mine && status?.state === 'error' ? (
        <span className={styles.error}>{status.message}</span>
      ) : (
        <span className={styles.muted}>Newer than the installed {versionLabel(app.version)}. Downloads in the background, then asks to restart.</span>
      )}
    </div>
  )
}
