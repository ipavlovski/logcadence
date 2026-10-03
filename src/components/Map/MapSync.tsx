import { useEffect, useState } from 'react'
import { formatJournalDate, today } from '../../../shared/dates.ts'
import type { GpsDriveStatus } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch, useTicker } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import { Modal } from '../Modal/Modal.tsx'
import styles from './MapSync.module.css'

// The Map tab's sync settings: a Google Drive folder GPSLogger uploads to, automatic import of new days, and
// manual import of older ones by date range.

const POLL_MS = 2000
const fail = (err: Error) => notify(err.message)

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.round(min / 60)} h ago`
}

export function MapSync({ onClose }: { onClose: () => void }) {
  // Polled: the Google login finishes in another window, and imports run in the background.
  const tick = useTicker(POLL_MS)
  const [bump, setBump] = useState(0)
  const { data: status } = useFetch<GpsDriveStatus>(`drive|${tick}|${bump}`, (signal) => unwrap(api.gps.drive.status.$get({}, { init: { signal } })))
  const apply = (p: Promise<unknown>) => p.catch(fail).finally(() => setBump((b) => b + 1))

  return (
    <Modal title="Map sync" onClose={onClose}>
      {!status ? (
        <div className={styles.loading} />
      ) : (
        <div className={styles.body}>
          <Account status={status} apply={apply} />
          {status.connected && <Folder status={status} apply={apply} />}
          {status.connected && status.folder && <AutoImport status={status} apply={apply} />}
          {status.connected && status.folder && <RangeImport status={status} apply={apply} />}
        </div>
      )}
    </Modal>
  )
}

type SectionProps = { status: GpsDriveStatus; apply: (p: Promise<unknown>) => void }

function Account({ status, apply }: SectionProps) {
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')

  if (!status.configured)
    return (
      <section className={styles.section}>
        <h3>Google Drive</h3>
        <p>Reading the folder needs a (free) Google Cloud OAuth client:</p>
        <ol>
          <li>
            In <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">Google Cloud Console</a>, create a project and enable
            the <em>Google Drive API</em>.
          </li>
          <li>
            Under <em>Google Auth Platform</em>, set up the consent screen (External), add yourself as a test user, then <em>Publish app</em>: a login of an app left in
            Testing expires after 7 days.
          </li>
          <li>
            Create an OAuth client of type <em>Desktop app</em> and paste its Client ID and secret here. (A <em>Web application</em> client needs the redirect URI{' '}
            <code>{status.redirectUri}</code>.)
          </li>
        </ol>
        <div className={styles.fields}>
          <input value={clientId} placeholder="Client ID" spellCheck={false} onChange={(e) => setClientId(e.target.value)} />
          <input value={secret} placeholder="Client secret" type="password" spellCheck={false} onChange={(e) => setSecret(e.target.value)} />
          <button
            className={styles.primary}
            disabled={!clientId.trim() || !secret.trim()}
            onClick={() => apply(unwrap(api.gps.drive.client.$post({ json: { clientId, clientSecret: secret } })))}
          >
            Save
          </button>
        </div>
      </section>
    )

  if (!status.connected)
    return (
      <section className={styles.section}>
        <h3>Google Drive</h3>
        <p>Connect your Google account. The login opens in your browser; this window updates once it is done.</p>
        <div className={styles.row}>
          {/* A new window: Google refuses to sign in inside the desktop app, which opens it in the system browser. */}
          <a className={styles.primary} href="/api/gps/drive/login" target="_blank" rel="noreferrer">
            Connect Google Drive
          </a>
          <button onClick={() => apply(unwrap(api.gps.drive.forget.$post()))}>Change OAuth client</button>
        </div>
        {status.error && <p className={styles.error}>{status.error}</p>}
      </section>
    )

  return (
    <section className={styles.section}>
      <div className={styles.row}>
        <h3>Google Drive</h3>
        <span className={styles.ok}>connected</span>
        <button
          className={styles.push}
          onClick={() => confirm('Disconnect Google Drive? Imported GPS files stay.') && apply(unwrap(api.gps.drive.disconnect.$post()))}
        >
          Disconnect
        </button>
      </div>
    </section>
  )
}

function Folder({ status, apply }: SectionProps) {
  const [editing, setEditing] = useState(!status.folder)
  const [input, setInput] = useState('')
  const save = () => {
    apply(unwrap(api.gps.drive.folder.$put({ json: { folder: input } })))
    setEditing(false)
  }

  return (
    <section className={styles.section}>
      <h3>GPS folder</h3>
      {editing || !status.folder ? (
        <>
          <p className={styles.muted}>The Drive folder GPSLogger uploads its daily files to (YYYYMMDD.zip or .gpx). Paste its link from the browser, or its ID.</p>
          <div className={styles.fields}>
            <input
              value={input}
              placeholder="https://drive.google.com/drive/folders/…"
              spellCheck={false}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && input.trim() && save()}
            />
            <div className={styles.row}>
              <button className={styles.primary} disabled={!input.trim()} onClick={save}>
                Use this folder
              </button>
              {status.folder && <button onClick={() => setEditing(false)}>Cancel</button>}
            </div>
          </div>
        </>
      ) : (
        <div className={styles.row}>
          <a href={`https://drive.google.com/drive/folders/${status.folder.id}`} target="_blank" rel="noreferrer" title="Open in Google Drive">
            {status.folder.name} ↗
          </a>
          <button className={styles.push} onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
      )}
    </section>
  )
}

function AutoImport({ status, apply }: SectionProps) {
  const settings = ({ auto, lastDate }: { auto?: boolean; lastDate?: string | null }) => apply(unwrap(api.gps.drive.settings.$patch({ json: { auto, lastDate } })))
  const r = status.result

  return (
    <section className={styles.section}>
      <h3>New files</h3>
      <label className={styles.check}>
        <input type="checkbox" checked={status.auto} onChange={(e) => settings({ auto: e.target.checked })} />
        Import new files automatically (every 30 minutes, and when the app starts)
      </label>
      <div className={styles.row}>
        <span>Last imported day</span>
        <input
          type="date"
          value={status.lastDate ?? ''}
          max={today()}
          onChange={(e) => settings({ lastDate: e.target.value || null })}
          title="Files dated on or after this day are imported as new ones; clear it to import the whole folder"
        />
        {!status.lastDate && <span className={styles.muted}>none: the next import takes the whole folder</span>}
        <button className={styles.push} disabled={!!status.running} onClick={() => apply(unwrap(api.gps.drive['import-new'].$post()))}>
          {status.running === 'new' ? 'Importing…' : 'Import now'}
        </button>
      </div>
      <p className={styles.muted}>
        Files dated on or after the last imported day are downloaded and processed; that day is picked up again while it is still being recorded. Older files
        are left for a manual import below.
      </p>
      <SyncLine status={status} />
      {r?.older && (
        <p className={styles.note}>
          {r.older.count} older {r.older.count === 1 ? 'file is' : 'files are'} in the folder but not imported ({formatJournalDate(r.older.from)} – {formatJournalDate(r.older.to)}).
        </p>
      )}
    </section>
  )
}

function SyncLine({ status }: { status: GpsDriveStatus }) {
  if (status.running)
    return (
      <p className={styles.status}>
        {status.progress?.total ? (
          <>
            Downloading {status.progress.done} of {status.progress.total}… <progress value={status.progress.done} max={status.progress.total} />
          </>
        ) : (
          'Checking the folder…'
        )}
      </p>
    )
  if (status.error) return <p className={styles.error}>Import failed: {status.error}</p>
  const r = status.result
  if (!r || !status.lastSync) return null
  return (
    <p className={styles.status} title={r.errors.join('\n') || undefined}>
      Checked {ago(status.lastSync)}: {r.downloaded ? `${r.downloaded} downloaded, ${r.processed} day(s) processed` : 'nothing new'}
      {r.errors.length > 0 && <span className={styles.error}> · {r.errors.length} error(s)</span>}
    </p>
  )
}

function RangeImport({ status, apply }: SectionProps) {
  const older = status.result?.older
  const [from, setFrom] = useState(older?.from ?? '')
  const [to, setTo] = useState(older?.to ?? '')
  // Suggest the range of the older files found, once known.
  useEffect(() => {
    if (!older) return
    setFrom((f) => f || older.from)
    setTo((t) => t || older.to)
  }, [older])

  return (
    <section className={styles.section}>
      <h3>Older files</h3>
      <p className={styles.muted}>Import the files dated within a range; ones already here and unchanged are skipped.</p>
      <div className={styles.row}>
        <input type="date" value={from} max={to || today()} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <span>to</span>
        <input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <button
          className={styles.push}
          disabled={!from || !to || from > to || !!status.running}
          onClick={() => apply(unwrap(api.gps.drive['import-range'].$post({ json: { from, to } })))}
        >
          {status.running === 'range' ? 'Importing…' : 'Import range'}
        </button>
      </div>
    </section>
  )
}
