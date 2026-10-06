import { useState } from 'react'
import type { YtImportResult } from '../../../shared/types.ts'
import { api, unwrap } from '../../api.ts'
import { useFetch } from '../../hooks/useFetch.ts'
import { notify } from '../../state/ui.ts'
import { bumpYt, setYtFilter } from '../../state/youtube.ts'
import { Modal } from '../Modal/Modal.tsx'
import styles from './Youtube.module.css'

// The YouTube tab's importer: playlists to import from, and importing their new videos (all, or one playlist).
// A video counts as discovered on the day an import first sees it.

const fail = (err: Error) => notify(err.message)

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return new Date(ms).toLocaleDateString()
}

const describe = (r: YtImportResult) =>
  r.error ? `${r.title}: ${r.error}` : `${r.title}: ${r.added ? `${r.added} new` : 'nothing new'}${r.linked ? `, ${r.linked} already in the catalog` : ''} (${r.found} in the playlist)`

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
      if (rs.some((r) => r.added || r.linked)) bumpYt()
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
                    <button
                      className={styles.plTitle}
                      onClick={() => {
                        setYtFilter({ kind: 'playlist', id: p.id })
                        onClose()
                      }}
                      title="Show its videos"
                    >
                      {p.title}
                    </button>
                    <span className={styles.muted}>
                      {[p.channel, `${p.count} videos`, p.lastImportAt && `imported ${ago(p.lastImportAt)}`].filter(Boolean).join(' · ')}
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

        {data && (
          <section>
            <label className={styles.check}>
              <input type="checkbox" checked={data.settings.auto} onChange={(e) => setAuto(e.target.checked)} />
              Import new videos automatically (when the app starts, then every 3 hours)
            </label>
            <p className={styles.muted}>
              A video’s discovery day is the day an import first sees it, so importing often keeps those days true. Videos from the first import of a playlist all land on
              that day; change a video’s day on its page if it matters.
            </p>
          </section>
        )}
      </div>
    </Modal>
  )
}
