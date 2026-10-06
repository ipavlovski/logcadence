import { useState } from 'react'
import type { YtImportResult, YtSettingsDTO } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import { bumpYt } from '../../state/youtube.ts'
import { Modal } from '../Modal/Modal.tsx'
import styles from './Youtube.module.css'

// The YouTube tab's importer: playlists to import from, importing their new videos (all, or one playlist), and the
// YouTube Data API key that gives each video the time it was added to a playlist.

const fail = (err: Error) => notify(err.message)

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return new Date(ms).toLocaleDateString()
}

const describe = (r: YtImportResult) =>
  r.error
    ? `${r.title}: ${r.error}`
    : `${r.title}: ${r.added ? `${r.added} new` : 'nothing new'}${r.redated ? `, ${r.redated} given their real added date` : ''} (${r.found} in the playlist)`

export function YoutubeImport({ onClose }: { onClose: () => void }) {
  const [bump, setBump] = useState(0)
  const { data } = useFetch(`ytpl|${bump}`, (signal) => unwrap(api.youtube.playlists.$get({}, { init: { signal } })))
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<YtImportResult[]>([])

  const run = (label: string, p: Promise<YtImportResult[]>) => {
    setBusy(label)
    p.then((rs) => {
      setResults(rs)
      if (rs.some((r) => r.added || r.redated)) bumpYt()
    }, fail).finally(() => {
      setBusy(null)
      setBump((b) => b + 1)
    })
  }
  const add = () => {
    run(
      'add',
      unwrap(api.youtube.playlists.$post({ json: { url } })).then((r) => {
        setUrl('')
        return [r]
      }),
    )
  }
  const importOne = (id: string) => run(id, unwrap(api.youtube.playlists[':id'].import.$post({ param: { id } })).then((r) => [r]))
  const importAll = () => run('all', unwrap(api.youtube.import.$post()).then((r) => r.results))
  const remove = (id: string, title: string) => {
    if (!confirm(`Stop importing “${title}”? Its videos stay in the catalog, with their notes and tags.`)) return
    unwrap(api.youtube.playlists[':id'].$delete({ param: { id } })).then(() => {
      setBump((b) => b + 1)
      bumpYt()
    }, fail)
  }
  const setAuto = (auto: boolean) => unwrap(api.youtube.settings.$patch({ json: { auto } })).then(() => setBump((b) => b + 1), fail)
  const setKey = (apiKey: string | null) => unwrap(api.youtube.settings.$patch({ json: { apiKey } })).then(() => setBump((b) => b + 1))

  const playlists = data?.playlists ?? []
  return (
    <Modal title="Import from YouTube" onClose={onClose}>
      <div className={styles.importer}>
        <section>
          <h3>Add a playlist</h3>
          <p className={styles.muted}>Paste the link of a public or unlisted playlist. All its videos are imported now; later imports bring in only the new ones.</p>
          <div className={styles.row}>
            <input
              value={url}
              placeholder="https://www.youtube.com/playlist?list=…"
              spellCheck={false}
              autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && add()}
            />
            <button className={styles.primary} disabled={!url.trim() || !!busy} onClick={add}>
              {busy === 'add' ? 'Importing…' : 'Add'}
            </button>
          </div>
        </section>

        <section>
          <div className={styles.row}>
            <h3>Playlists</h3>
            {playlists.length > 1 && (
              <button className={styles.push} disabled={!!busy} onClick={importAll}>
                {busy === 'all' ? 'Importing…' : 'Import new from all'}
              </button>
            )}
          </div>
          {!playlists.length ? (
            <p className={styles.muted}>None yet.</p>
          ) : (
            <ul className={styles.playlists}>
              {playlists.map((p) => (
                <li key={p.id}>
                  <div className={styles.plText}>
                    <span className={styles.plTitle}>{p.title}</span>
                    <span className={styles.muted}>
                      {[p.channel, p.count != null && `${p.count} videos`, p.lastImportAt && `imported ${ago(p.lastImportAt)}`].filter(Boolean).join(' · ')}
                    </span>
                    {p.lastError && <span className={styles.error}>Last import failed: {p.lastError}</span>}
                  </div>
                  <a className={styles.link} href={`https://www.youtube.com/playlist?list=${p.id}`} target="_blank" rel="noreferrer" title="Open on YouTube">
                    ↗
                  </a>
                  <button disabled={!!busy} onClick={() => importOne(p.id)} title="Import the videos added since the last import">
                    {busy === p.id ? 'Importing…' : 'Import new'}
                  </button>
                  <button className={styles.link} onClick={() => remove(p.id, p.title)} title="Stop importing this playlist">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results.length > 0 && (
            <ul className={styles.results}>
              {results.map((r) => (
                <li key={r.playlistId} className={r.error ? styles.error : undefined}>
                  {describe(r)}
                </li>
              ))}
            </ul>
          )}
        </section>

        {data && <ApiKey settings={data.settings} onSave={setKey} />}

        {data && (
          <section>
            <label className={styles.check}>
              <input type="checkbox" checked={data.settings.auto} onChange={(e) => setAuto(e.target.checked)} />
              Import new videos automatically (when the app starts, then every 3 hours)
            </label>
          </section>
        )}
      </div>
    </Modal>
  )
}

function ApiKey({ settings, onSave }: { settings: YtSettingsDTO; onSave: (key: string | null) => Promise<unknown> }) {
  const [editing, setEditing] = useState(!settings.apiKey)
  const [key, setKey] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = () => {
    setChecking(true)
    setError(null)
    onSave(key)
      .then(() => {
        setKey('')
        setEditing(false)
      }, (err: Error) => setError(err.message))
      .finally(() => setChecking(false))
  }

  return (
    <section>
      <div className={styles.row}>
        <h3>YouTube Data API key</h3>
        {settings.apiKey && !editing && (
          <>
            <span className={styles.ok}>set {settings.apiKey}</span>
            {!settings.apiKeyFromEnv && (
              <>
                <button className={styles.push} onClick={() => setEditing(true)}>
                  Change
                </button>
                <button onClick={() => confirm('Remove the API key? Imports then date new videos by when they are imported.') && void onSave(null).catch(fail)}>Remove</button>
              </>
            )}
          </>
        )}
      </div>
      {settings.apiKey && !editing ? (
        <p className={styles.muted}>
          Imports take each video’s real “added to playlist” date from the API{settings.apiKeyFromEnv ? ' (the key comes from YOUTUBE_API_KEY)' : ''}. Videos imported before the key
          was set get theirs at the next import.
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            With a key, each video is dated by when it was added to the playlist. Without one, by when an import first sees it. To get a (free) key: in{' '}
            <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
              Google Cloud Console
            </a>
            , enable the <em>YouTube Data API v3</em> for a project, then under <em>Credentials</em> create an <em>API key</em> (restrict it to that API). An import uses about 3
            of the 10,000 daily quota units per 50 videos.
          </p>
          <div className={styles.row}>
            <input value={key} placeholder="AIza…" spellCheck={false} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key.trim() && !checking && save()} />
            <button className={styles.primary} disabled={!key.trim() || checking} onClick={save}>
              {checking ? 'Checking…' : 'Save'}
            </button>
            {settings.apiKey && <button onClick={() => setEditing(false)}>Cancel</button>}
          </div>
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </section>
  )
}
